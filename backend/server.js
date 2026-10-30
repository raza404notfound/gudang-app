const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');                 // jangan umumkan "Express" ke penyerang
app.set('trust proxy', 1);                   // Railway di belakang proxy → req.ip = IP asli pengunjung
app.use((req, res, next) => {                // header keamanan dasar
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  next();
});
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));
// Versi web: berubah setiap deploy. Dipakai untuk memaksa browser mengambil JS/CSS terbaru
// tanpa perlu hapus cache (index.html selalu segar, file JS/CSS diberi ?v=versi).
const VERSI_WEB = (process.env.RAILWAY_DEPLOYMENT_ID || process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 12);
let indexHtmlCache = null;
function kirimIndex(req, res) {
  if (!indexHtmlCache) {
    indexHtmlCache = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8')
      .replace(/(src|href)="(\/(?:js|css)\/[^"?]+\.(?:js|css))"/g, `$1="$2?v=${VERSI_WEB}"`);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(indexHtmlCache);
}
app.use((req, res, next) => { res.setHeader('x-versi-web', VERSI_WEB); next(); });
app.get(['/', '/index.html'], kirimIndex);
app.use(express.static(path.join(__dirname, '../public'), {
  index: false,
  setHeaders: (res, file) => {
    // file bervers (?v=) boleh disimpan lama; tanpa versi wajib dicek ulang ke server (murah: 304)
    res.setHeader('Cache-Control', res.req && res.req.query && res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
}));

// =============================================
// ENVIRONMENT VARIABLES (semua dari Railway)
// Tidak ada credential yang hardcoded di sini.
// Isi semua variable ini di Railway > Variables.
// =============================================
const BITESHIP_API_KEY = process.env.BITESHIP_API_KEY;
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || '';
const SUPERUSER_KEY    = process.env.SUPERUSER_KEY;

const WAREHOUSES = [
  { id: 'pdc',    name: 'PDC Warehouse',    username: process.env.WH_PDC_USER,    password: process.env.WH_PDC_PASS,    warehouse_id: '38' },
  { id: 'febri',  name: 'Febri Warehouse',  username: process.env.WH_FEBRI_USER,  password: process.env.WH_FEBRI_PASS,  warehouse_id: '67' },
  { id: 'palem',  name: 'Palem Warehouse',  username: process.env.WH_PALEM_USER,  password: process.env.WH_PALEM_PASS,  warehouse_id: '94' },
  { id: 'cemara', name: 'Cemara Warehouse', username: process.env.WH_CEMARA_USER, password: process.env.WH_CEMARA_PASS, warehouse_id: '96' },
  { id: 'sakura', name: 'Sakura Warehouse', username: process.env.WH_SAKURA_USER, password: process.env.WH_SAKURA_PASS, warehouse_id: '124' }
];

const REQUIRED_ENV = [
  'BITESHIP_API_KEY',
  'WH_PDC_USER',    'WH_PDC_PASS',
  'WH_FEBRI_USER',  'WH_FEBRI_PASS',
  'WH_PALEM_USER',  'WH_PALEM_PASS',
  'WH_CEMARA_USER', 'WH_CEMARA_PASS',
  'WH_SAKURA_USER', 'WH_SAKURA_PASS',
  'SUPERUSER_KEY',  'SHEET_SCRIPT_URL', 'PINDAH_SCRIPT_URL'
];
const MISSING_ENV = REQUIRED_ENV.filter(key => !process.env[key]);
if (MISSING_ENV.length > 0) {
  console.warn('⚠️  [ENV WARNING] Variable berikut belum diisi di Railway:');
  MISSING_ENV.forEach(key => console.warn(`   - ${key}`));
  console.warn('   Server tetap jalan, tapi fitur terkait tidak akan berfungsi.');
}

// =============================================
// DASHBOARD CACHE
// =============================================
const tokenCache     = {};
const tokenCacheTime = {};
const dashboardCache  = { inbound: null, outbound: null };
const lastCacheTime   = { inbound: 0, outbound: 0 };
const CACHE_DURATION  = 60 * 1000;
const BASE_URL        = 'https://pdcgudang.et.r.appspot.com/v1';

// "Hari ini" menurut jam WIB (server Railway berjalan di UTC)
function getTodayTimestamps() {
  const WIB = 7 * 60 * 60 * 1000;
  const w = new Date(Date.now() + WIB);   // komponen UTC dari objek ini = jam WIB
  const y = w.getUTCFullYear(), m = w.getUTCMonth(), d = w.getUTCDate();
  return {
    time_min: Date.UTC(y, m, d, 0, 0, 0, 0) - WIB,
    time_max: Date.UTC(y, m, d, 23, 59, 59, 999) - WIB
  };
}

function parseTotalTrx(data) {
  if (!data) return 0;
  if (Array.isArray(data)) {
    return data.reduce((sum, item) => {
      if (item.status === 'cancel') return sum;
      return sum + (Number(item.transaction_count) || 0);
    }, 0);
  }
  if (typeof data.total_trx === 'number') return data.total_trx;
  return 0;
}

async function getWarehouseToken(wh) {
  // Token di-cache selama 30 menit, lalu hapus otomatis
  if (tokenCache[wh.id]) {
    const age = Date.now() - (tokenCacheTime[wh.id] || 0);
    if (age < 30 * 60 * 1000) return tokenCache[wh.id];
    delete tokenCache[wh.id];
    delete tokenCacheTime[wh.id];
    console.log(`🔄 [TOKEN EXPIRED] ${wh.name} — login ulang`);
  }
  if (!wh.username || !wh.password) {
    console.error(`❌ [LOGIN GAGAL] ${wh.name}: username/password belum diisi di Railway.`);
    return null;
  }
  console.time(`⏱️ login-${wh.id}`);
  try {
    const response = await axios.post(`${BASE_URL}/users/login`, {
      username: wh.username,
      password: wh.password,
      from: 'warehouse'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json, text/plain, */*',
        'origin': 'https://warehouse.onlypdc.com',
        'referer': 'https://warehouse.onlypdc.com/'
      }
    });
    const resData = response.data?.data || response.data;
    const token = resData?.auth_token || resData?.token || resData?.access_token;
    console.timeEnd(`⏱️ login-${wh.id}`);
    if (token && !wh.warehouse_id) {
      // Coba temukan warehouse_id dari respons login (untuk gudang yang ID-nya belum diisi)
      const kandidat = resData?.warehouse_id ?? resData?.user?.warehouse_id ?? resData?.warehouse?.id
        ?? (Array.isArray(resData?.warehouses) ? resData.warehouses[0]?.id : undefined)
        ?? (Array.isArray(resData?.user?.warehouses) ? resData.user.warehouses[0]?.id : undefined);
      if (kandidat) {
        wh.warehouse_id = String(kandidat);
        console.log(`ℹ️  [WAREHOUSE ID] ${wh.name} = ${wh.warehouse_id} (dari respons login). Simpan di Railway agar pasti.`);
      } else {
        console.warn(`⚠️  [WAREHOUSE ID] ${wh.name} tidak ditemukan di respons login. Isi variable ID-nya di Railway.`);
      }
    }
    if (token) {
      tokenCache[wh.id]     = token;
      tokenCacheTime[wh.id] = Date.now();
      console.log(`✅ [LOGIN SUKSES] ${wh.name}`);
      return token;
    }
  } catch (err) {
    console.timeEnd(`⏱️ login-${wh.id}`);
    console.error(`❌ [LOGIN GAGAL] ${wh.name}:`, err.response?.data?.message || err.message);
  }
  return null;
}

async function fetchOverview(type, wh) {
  console.time(`⏱️ overview-${type}-${wh.id}`);
  const token = await getWarehouseToken(wh);
  if (!token) {
    console.timeEnd(`⏱️ overview-${type}-${wh.id}`);
    return { total_trx: 0, status_error: 'Login Failed' };
  }

  if (!wh.warehouse_id) {
    console.timeEnd(`⏱️ overview-${type}-${wh.id}`);
    return { total_trx: 0, status_error: 'ID gudang belum diisi (WH_' + wh.id.toUpperCase() + '_ID)' };
  }

  const { time_min, time_max } = getTodayTimestamps();
  const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://warehouse.onlypdc.com',
    'referer': 'https://warehouse.onlypdc.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36'
  };
  const url = `${BASE_URL}/warehouses/insight/overview?type=${type}&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;

  try {
    const res = await axios.get(url, { headers });
    const rawData = res.data?.data || res.data;
    console.timeEnd(`⏱️ overview-${type}-${wh.id}`);
    return { total_trx: parseTotalTrx(rawData), details: rawData };
  } catch (err) {
    console.timeEnd(`⏱️ overview-${type}-${wh.id}`);
    return { total_trx: 0, status_error: err.response?.data?.message || 'Access Restricted' };
  }
}

async function getFreshDashboardData(type) {
  console.time(`⏱️ TOTAL-dashboard-${type || 'all'}`);
  const results = await Promise.all(
    WAREHOUSES.map(async (wh) => {
      let inboundData = null;
      let outboundData = null;
      if (type === 'inbound') {
        inboundData = await fetchOverview('inbound', wh);
      } else if (type === 'outbound') {
        outboundData = await fetchOverview('outbound', wh);
      } else {
        [inboundData, outboundData] = await Promise.all([
          fetchOverview('inbound', wh),
          fetchOverview('outbound', wh)
        ]);
      }
      return { id: wh.id, name: wh.name, data: { inbound: inboundData, outbound: outboundData } };
    })
  );
  console.timeEnd(`⏱️ TOTAL-dashboard-${type || 'all'}`);

  let totalInboundTrx = 0, totalOutboundTrx = 0;
  results.forEach(item => {
    if (item.data?.inbound)  totalInboundTrx  += item.data.inbound.total_trx  || 0;
    if (item.data?.outbound) totalOutboundTrx += item.data.outbound.total_trx || 0;
  });

  return {
    summary: { totalOutboundTrx, totalInboundTrx },
    warehouses: results,
    cached_at: new Date().toLocaleTimeString()
  };
}

// =============================================
// BACKGROUND REFRESH — jaga cache tetap "hangat"
// Server otomatis ambil data baru tiap 30 detik,
// jadi user TIDAK PERNAH menunggu fetch live saat
// buka/refresh Dashboard — selalu dapat dari cache.
// isRefreshing = penanda anti-tabrakan: kalau proses
// sebelumnya belum selesai, proses baru dilewati dulu.
// =============================================
const REFRESH_INTERVAL = 30 * 1000; // ⬅️ bisa diubah sesuai kebutuhan
const isRefreshing = { inbound: false, outbound: false };

async function backgroundRefresh(type) {
  if (isRefreshing[type]) {
    console.log(`⏭️  [SKIP REFRESH] ${type} — proses sebelumnya masih berjalan, dilewati dulu.`);
    return;
  }
  isRefreshing[type] = true;
  try {
    console.log(`🔁 [BACKGROUND REFRESH] Mulai ambil data ${type} otomatis...`);
    const data = await getFreshDashboardData(type);
    dashboardCache[type] = data;
    lastCacheTime[type] = Date.now();
    console.log(`✅ [BACKGROUND REFRESH] Data ${type} berhasil diperbarui di cache.`);
  } catch (err) {
    console.error(`❌ [BACKGROUND REFRESH GAGAL] ${type}:`, err.message);
  } finally {
    isRefreshing[type] = false;
  }
}

// DIMATIKAN: dashboard lama sudah diganti /api/dashboard/gudang.
// Refresh latar ini dulu memanggil API PDC 10x tiap 30 detik (5 gudang x 2),
// menambah antrean di server PDC sehingga dashboard baru sering timeout.
// /api/dashboard tetap bisa dipanggil manual bila dibutuhkan.

// GET /api/dashboard
app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const type = req.query.type;
    const forceRefresh = req.query.force === 'true';
    const now = Date.now();

    if (type === 'inbound' || type === 'outbound') {
      // Dengan background refresh aktif, cache seharusnya selalu ada & fresh.
      // Fallback ini tetap dijaga untuk kondisi darurat: server baru nyala
      // dan background refresh pertama belum selesai, atau forceRefresh diminta.
      if (dashboardCache[type] && (now - lastCacheTime[type] < CACHE_DURATION) && !forceRefresh) {
        console.log(`💾 [CACHE HIT] ${type} — data dari cache, tidak fetch ulang`);
        return res.json(dashboardCache[type]);
      }
      console.log(`🔄 [CACHE MISS] ${type} — cache belum siap / diminta force, fetch fresh sekarang`);
      const data = await getFreshDashboardData(type);
      dashboardCache[type] = data;
      lastCacheTime[type] = now;
      return res.json(data);
    }

    res.json(await getFreshDashboardData());
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/track-awb-chunk
app.post('/api/track-awb-chunk', requireAuth, async (req, res) => {
  const { batchResi, kurir = 'jnt' } = req.body;
  if (!Array.isArray(batchResi) || batchResi.length === 0) {
    return res.json({ success: false, data: [] });
  }
  if (!BITESHIP_API_KEY) {
    return res.status(500).json({ success: false, message: 'BITESHIP_API_KEY belum diatur di Railway.' });
  }

  // Format tanggal+jam WIB (GMT+7) untuk TGL INPUT
  function getNowWIB() {
    const now = new Date();
    const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const yyyy = wib.getUTCFullYear();
    const mm   = String(wib.getUTCMonth() + 1).padStart(2, '0');
    const dd   = String(wib.getUTCDate()).padStart(2, '0');
    const hh   = String(wib.getUTCHours()).padStart(2, '0');
    const min  = String(wib.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  // Dari history Biteship, ambil timestamp PERTAMA setelah status manifest
  // Ini adalah waktu saat resi berpindah status dari manifest ke status berikutnya
  function getTglDicatatFromHistory(history) {
    if (!history || history.length === 0) return '';
    // Cari index history yang statusnya manifest/allocated
    let manifestIdx = -1;
    for (let i = 0; i < history.length; i++) {
      const note = (history[i].note || '').toLowerCase();
      const status = (history[i].status || '').toLowerCase();
      if (note.includes('manifes') || note.includes('disimpan') ||
          status.includes('manifest') || status.includes('allocated')) {
        manifestIdx = i;
      }
    }
    // Ambil entry SETELAH manifest (yaitu saat status berubah dari manifest)
    if (manifestIdx >= 0 && manifestIdx + 1 < history.length) {
      const next = history[manifestIdx + 1];
      if (next.updated_at || next.created_at) {
        const raw = next.updated_at || next.created_at;
        const d = new Date(raw);
        const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        const yyyy = wib.getUTCFullYear();
        const mm   = String(wib.getUTCMonth() + 1).padStart(2, '0');
        const dd   = String(wib.getUTCDate()).padStart(2, '0');
        const hh   = String(wib.getUTCHours()).padStart(2, '0');
        const min  = String(wib.getUTCMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
      }
    }
    // Fallback: ambil timestamp entry terakhir
    const last = history[history.length - 1];
    if (last.updated_at || last.created_at) {
      const raw = last.updated_at || last.created_at;
      const d = new Date(raw);
      const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      const yyyy = wib.getUTCFullYear();
      const mm   = String(wib.getUTCMonth() + 1).padStart(2, '0');
      const dd   = String(wib.getUTCDate()).padStart(2, '0');
      const hh   = String(wib.getUTCHours()).padStart(2, '0');
      const min  = String(wib.getUTCMinutes()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
    }
    return '';
  }

  const tglInput = getNowWIB(); // jam saat user klik Lacak Sekarang (WIB)

  const promises = batchResi.map(async (r) => {
    const resiClean = String(r).trim();
    if (!resiClean) return null;
    try {
      const response = await axios.get(
        `https://api.biteship.com/v1/trackings/${resiClean}/couriers/${kurir}`,
        { headers: { 'Authorization': BITESHIP_API_KEY, 'Content-Type': 'application/json' }, timeout: 12000 }
      );
      const data = response.data;
      const status = data?.success ? (data.status || 'Unknown') : 'Gagal API';
      const history = data?.history || [];
      const note = history.length > 0 ? history[history.length - 1].note : 'Data dimuat';
      const tglDicatat = getTglDicatatFromHistory(history);
      return { resi: resiClean, status, note, tglDicatat, tglInput, success: true };
    } catch (err) {
      try {
        const fallback = await axios.get(
          `https://api.biteship.com/v1/trackings/${resiClean}`,
          { headers: { 'Authorization': BITESHIP_API_KEY, 'Content-Type': 'application/json' }, timeout: 12000 }
        );
        const data = fallback.data;
        const history = data?.history || [];
        const note = history.length > 0 ? history[history.length - 1].note : 'Data dimuat';
        const tglDicatat = getTglDicatatFromHistory(history);
        return { resi: resiClean, status: data.status || 'Unknown', note, tglDicatat, tglInput, success: true };
      } catch (fallbackErr) {
        return { resi: resiClean, status: 'Gagal Cek', note: fallbackErr.response?.data?.message || 'Gagal API / Resi Tidak Ditemukan', tglDicatat: '', tglInput, success: false };
      }
    }
  });

  const results = await Promise.all(promises);
  res.json({ success: true, data: results.filter(Boolean) });
});

// =============================================
// SISTEM AUTENTIKASI
// Akun disimpan di Google Sheet tab _Akun (via Apps Script).
// Superuser (raza404nf) bisa login langsung lewat SUPERUSER_KEY
// tanpa perlu ada di sheet — sebagai fallback darurat.
// =============================================
const SUPERUSER = 'raza404nf';

// Hash password: scrypt + salt acak (format "scrypt$salt$hash").
// Hash lama (SHA-256 polos) tetap bisa login, lalu otomatis di-upgrade ke scrypt.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function samaAman(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function cekPassword(password, tersimpan) {
  tersimpan = String(tersimpan || '');
  if (tersimpan.startsWith('scrypt$')) {
    const [, salt, hash] = tersimpan.split('$');
    return samaAman(crypto.scryptSync(String(password), salt, 64).toString('hex'), hash);
  }
  return samaAman(crypto.createHash('sha256').update(String(password)).digest('hex'), tersimpan);
}

// Batas percobaan login dalam 15 menit: 5x salah per akun, 30x salah per IP
// (IP dibuat longgar karena satu kantor/gudang biasanya memakai IP yang sama)
const LOGIN_MAKS = 5, LOGIN_MAKS_IP = 30, LOGIN_JENDELA = 15 * 60 * 1000;
const loginGagal = new Map();   // kunci → { n, awal }
function cekKunciLogin(kunci) {
  const g = loginGagal.get(kunci);
  if (!g) return 0;
  if (Date.now() - g.awal > LOGIN_JENDELA) { loginGagal.delete(kunci); return 0; }
  return g.n >= (kunci.startsWith('ip:') ? LOGIN_MAKS_IP : LOGIN_MAKS) ? Math.ceil((g.awal + LOGIN_JENDELA - Date.now()) / 60000) : 0;
}
function catatGagalLogin(kunci) {
  const g = loginGagal.get(kunci);
  if (!g || Date.now() - g.awal > LOGIN_JENDELA) loginGagal.set(kunci, { n: 1, awal: Date.now() });
  else g.n++;
}

// =============================================
// SESI LOGIN — token bertanda tangan (HMAC), tetap berlaku walau server restart / deploy ulang
// Format: base64url(JSON {u, r, i: waktu login, t: aktivitas terakhir, n: nomor acak}) + "." + tanda tangan
// =============================================
const SESI_MAKS_DIAM = 12 * 3600 * 1000;      // habis setelah 12 jam tidak dipakai
const SESI_PERBARUI  = 15 * 60 * 1000;        // token diperbarui tiap 15 menit selama dipakai
const SESI_RAHASIA = process.env.SESSION_SECRET ||
  (SUPERUSER_KEY ? crypto.createHash('sha256').update('pdc-sesi:' + SUPERUSER_KEY).digest('hex')
                 : crypto.randomBytes(32).toString('hex'));
const sesiKeluar = new Map();     // nomor sesi yang sudah logout → waktu
const sesiCabut  = new Map();     // username → waktu (sesi sebelum waktu ini dicabut: ganti sandi / akun dihapus)
function tandaSesi(isi) { return crypto.createHmac('sha256', SESI_RAHASIA).update(isi).digest('base64url'); }
function buatToken(username, role, awal, nomor) {
  const isi = Buffer.from(JSON.stringify({ u: username, r: role, i: awal || Date.now(), t: Date.now(),
    n: nomor || crypto.randomBytes(9).toString('base64url') })).toString('base64url');
  return isi + '.' + tandaSesi(isi);
}
function bacaToken(token) {
  const [isi, sig] = String(token || '').split('.');
  if (!isi || !sig || !samaAman(sig, tandaSesi(isi))) return null;
  try { return JSON.parse(Buffer.from(isi, 'base64url').toString()); } catch (e) { return null; }
}
function sesiAktif(token) {
  const p = bacaToken(token);
  if (!p || !p.u) return null;
  const now = Date.now();
  if (now - (p.t || 0) > SESI_MAKS_DIAM || sesiKeluar.has(p.n)) return null;
  if ((sesiCabut.get(p.u) || 0) > p.i) return null;
  let role = p.r;
  if (p.u !== SUPERUSER) {
    if (!usersCache || now - usersCacheTime > USERS_CACHE_TTL) getUsers().catch(() => {});   // segarkan di belakang
    if (usersCache) {
      const akun = usersCache[p.u];
      if (!akun) return null;                                                       // akun sudah dihapus
      const ganti = Date.parse(akun.passwordUpdatedAt || '') || 0;
      if (ganti > p.i) return null;                                                 // sandi sudah diganti
      role = akun.role || 'user';
    }
  }
  return { username: p.u, role, _p: p };
}
// Pasang token baru di header kalau token sudah > 15 menit (browser menyimpannya otomatis)
function perbaruiSesi(res, user) {
  const p = user._p;
  if (Date.now() - p.t > SESI_PERBARUI) res.setHeader('x-sesi-baru', buatToken(p.u, user.role, p.i, p.n));
}
setInterval(() => {
  const now = Date.now();
  sesiKeluar.forEach((w, k) => { if (now - w > SESI_MAKS_DIAM) sesiKeluar.delete(k); });
  loginGagal.forEach((g, k) => { if (now - g.awal > LOGIN_JENDELA) loginGagal.delete(k); });
}, 60 * 60 * 1000);

// Cache akun di memory supaya login tidak lambat (refresh tiap 2 menit)
let usersCache = null;
let usersCacheTime = 0;
const USERS_CACHE_TTL = 2 * 60 * 1000; // 2 menit

async function getUsers(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && usersCache && (now - usersCacheTime < USERS_CACHE_TTL)) {
    return usersCache;
  }
  if (!SHEET_SCRIPT_URL) return {};
  try {
    const res = await axios.get(SHEET_SCRIPT_URL, { params: { action: 'getUsers' }, timeout: 10000 });
    if (res.data && res.data.success) {
      usersCache = res.data.users || {};
      usersCacheTime = now;
      return usersCache;
    }
  } catch (err) {
    console.error('Gagal ambil users dari sheet:', err.message);
    // Kalau gagal fetch, kembalikan cache lama kalau ada
    if (usersCache) return usersCache;
  }
  return {};
}

async function saveUsers(users) {
  if (!SHEET_SCRIPT_URL) throw new Error('SHEET_SCRIPT_URL belum diatur.');
  const res = await axios.post(SHEET_SCRIPT_URL, { action: 'saveUsers', users }, { timeout: 15000 });
  if (!res.data || !res.data.success) throw new Error(res.data?.message || 'Gagal simpan akun.');
  // Reset cache supaya data terbaru langsung terbaca
  usersCache = null;
  return res.data;
}

function requireAuth(req, res, next) {
  const user = sesiAktif(req.headers['x-session-token']);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  perbaruiSesi(res, user);
  req.sessionUser = user;
  next();
}

function requireSuperuser(req, res, next) {
  const user = sesiAktif(req.headers['x-session-token']);
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (user.role !== 'superuser') {
    return res.status(403).json({ success: false, message: 'Akun Anda tidak bisa mengakses fitur ini.' });
  }
  perbaruiSesi(res, user);
  req.sessionUser = user;
  next();
}

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const uname = String(username).trim().toLowerCase();
  const kunciIp = 'ip:' + req.ip, kunciAkun = 'akun:' + uname;
  const sisa = Math.max(cekKunciLogin(kunciIp), cekKunciLogin(kunciAkun));
  if (sisa) {
    return res.status(429).json({ success: false, message: `Terlalu banyak percobaan login. Coba lagi dalam ${sisa} menit.` });
  }
  const gagal = () => {
    catatGagalLogin(kunciIp); catatGagalLogin(kunciAkun);
    console.warn(`🔒 [LOGIN GAGAL] ${uname} dari ${req.ip}`);
    return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
  };

  // Jalur superuser langsung via SUPERUSER_KEY (tidak perlu ada di sheet)
  // Ini memastikan raza404nf selalu bisa login meski sheet bermasalah
  if (uname === SUPERUSER && SUPERUSER_KEY && samaAman(password, SUPERUSER_KEY)) {
    loginGagal.delete(kunciAkun);
    const token = buatToken(SUPERUSER, 'superuser');
    return res.json({ success: true, token, username: SUPERUSER, role: 'superuser' });
  }

  // Jalur akun biasa — cek ke sheet _Akun
  try {
    const users = await getUsers();
    const user  = users[uname];
    if (!user || !cekPassword(password, user.password)) return gagal();
    loginGagal.delete(kunciAkun);
    // Upgrade hash lama (SHA-256) ke scrypt di belakang layar — password tidak berubah
    if (!String(user.password || '').startsWith('scrypt$')) {
      (async () => {
        try {
          const segar = await getUsers(true);
          if (segar[uname] && segar[uname].password === user.password) {
            segar[uname].password = hashPassword(password);
            await saveUsers(segar);
            console.log(`🔐 [HASH] ${uname} di-upgrade ke scrypt`);
          }
        } catch (e) { console.error('Upgrade hash gagal:', e.message); }
      })();
    }
    const token = buatToken(uname, user.role || 'user');
    res.json({ success: true, token, username: uname, role: user.role || 'user' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menghubungi database akun.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  sesiKeluar.set(req.sessionUser._p.n, Date.now());
  res.json({ success: true, message: 'Logout berhasil.' });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, username: req.sessionUser.username, role: req.sessionUser.role });
});

// GET /api/users (superuser only)
app.get('/api/users', requireSuperuser, async (req, res) => {
  try {
    const users = await getUsers(true); // force refresh supaya selalu data terbaru
    const list = Object.entries(users).map(([username, data]) => ({
      username, role: data.role || 'user', createdAt: data.createdAt || ''
    }));
    const peta = await petaNama();
    list.forEach(u => { u.nama = peta[u.username] || ''; });
    // Tambahkan superuser ke list kalau belum ada di sheet
    if (!list.find(u => u.username === SUPERUSER)) {
      list.unshift({ username: SUPERUSER, role: 'superuser', createdAt: '', nama: peta[SUPERUSER] || '' });
    }
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/users (superuser only)
app.post('/api/users', requireSuperuser, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }
  const uname = username.trim().toLowerCase();
  if (uname === SUPERUSER) {
    return res.status(403).json({ success: false, message: 'Username tersebut tidak bisa digunakan.' });
  }
  try {
    const users = await getUsers(true);
    if (users[uname]) {
      return res.status(409).json({ success: false, message: 'Username sudah terdaftar.' });
    }
    users[uname] = {
      password: hashPassword(password),
      role: role === 'superuser' ? 'superuser' : role === 'admin' ? 'admin' : 'user',
      createdAt: new Date().toISOString()
    };
    await saveUsers(users);
    res.json({ success: true, message: `Akun '${uname}' berhasil dibuat.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/users/:username (superuser only)
app.delete('/api/users/:username', requireSuperuser, async (req, res) => {
  const target = req.params.username.toLowerCase();
  if (target === SUPERUSER) {
    return res.status(403).json({ success: false, message: 'Akun superuser tidak bisa dihapus.' });
  }
  try {
    const users = await getUsers(true);
    if (!users[target]) {
      return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    }
    delete users[target];
    sesiCabut.set(target, Date.now());   // keluarkan semua sesi lama akun ini
    await saveUsers(users);
    res.json({ success: true, message: `Akun '${target}' berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/users/:username/password (superuser only)
app.put('/api/users/:username/password', requireSuperuser, async (req, res) => {
  const target = req.params.username.toLowerCase();
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: 'Password baru wajib diisi.' });
  try {
    const users = await getUsers(true);
    if (!users[target]) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    if (String(password).trim().length < 6) return res.status(400).json({ success: false, message: 'Password minimal 6 karakter.' });
    users[target].password = hashPassword(String(password).trim());
    users[target].passwordUpdatedAt = new Date().toISOString();
    await saveUsers(users);
    // Keluarkan sesi lama akun tsb supaya wajib login pakai sandi baru
    sesiCabut.set(target, Date.now());   // keluarkan semua sesi lama akun ini
    res.json({ success: true, message: `Password akun '${target}' berhasil diubah.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================================
// PROXY KE GOOGLE APPS SCRIPT — 2 TAB
// =============================================

// Helper proxy umum untuk GET ke Apps Script
async function gasGet(params, timeout = 15000) {
  if (!SHEET_SCRIPT_URL) throw new Error('SHEET_SCRIPT_URL belum dikonfigurasi di Railway Variables.');
  const response = await axios.get(SHEET_SCRIPT_URL, { params, timeout });
  return response.data;
}

// Helper proxy umum untuk POST ke Apps Script
async function gasPost(body, timeout = 30000) {
  if (!SHEET_SCRIPT_URL) throw new Error('SHEET_SCRIPT_URL belum dikonfigurasi di Railway Variables.');
  const response = await axios.post(SHEET_SCRIPT_URL, body, {
    headers: { 'Content-Type': 'application/json' }, timeout
  });
  return response.data;
}

// GET /api/sheet/load
// Dipakai tombol "Ambil dari Sheet" — baca dari tab Resi Harian
app.get('/api/sheet/load', requireAuth, async (req, res) => {
  const { tanggal, gudang, onlyPending } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  try {
    const params = { action: 'loadResi', tanggal };
    if (gudang)      params.gudang      = gudang;
    if (onlyPending) params.onlyPending = onlyPending;
    const data = await gasGet(params);
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data dari Resi Harian.' });
    res.json({ success: true, rows: data.rows || [] });
  } catch (err) {
    console.error('Sheet load error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// GET /api/sheet/resi-belum-jalan
// Dipakai tombol "Resi Belum Jalan" — baca Resi Harian, filter yang belum ada di Tracking AWB
app.get('/api/sheet/resi-belum-jalan', requireAuth, async (req, res) => {
  const { tanggal, gudang } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  try {
    const params = { action: 'loadResi', tanggal, onlyPending: 'true' };
    if (gudang) params.gudang = gudang;
    const data = await gasGet(params);
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data.' });
    res.json({ success: true, rows: data.rows || [] });
  } catch (err) {
    console.error('Resi belum jalan error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// GET /api/sheet/cek-resi
// Dipakai tombol "Cek Resi" — baca dari tab Tracking AWB (tanpa Biteship)
app.get('/api/sheet/cek-resi', requireAuth, async (req, res) => {
  const { tanggal, gudang } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  try {
    const params = { action: 'loadTracking', tanggal };
    if (gudang) params.gudang = gudang;
    const data = await gasGet(params);
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data tracking.' });
    res.json({ success: true, rows: data.rows || [] });
  } catch (err) {
    console.error('Cek resi error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// POST /api/sheet/sync
// Dipakai tombol "Simpan ke Sheet" — tulis ke tab Tracking AWB
app.post('/api/sheet/sync', requireAuth, async (req, res) => {
  const { tanggal, data: trackData } = req.body;
  if (!tanggal || !Array.isArray(trackData)) return res.status(400).json({ success: false, message: 'Data tidak valid.' });
  try {
    const result = await gasPost({
      action: 'syncTracking',
      tanggal,
      rows: trackData.map(item => ({
        gudang     : item.gudang      || '',
        resi       : item.resi        || '',
        kurir      : item.kurir       || '',
        status     : item.status      || '',
        keterangan : item.keterangan  || item.note || '',
        tglInput   : item.tglInput    || tanggal,
        tglDicatat : item.tglDicatat  || ''
      }))
    });
    res.json({ success: result.success, message: result.message || 'Selesai.' });
  } catch (err) {
    console.error('Sheet sync error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// GET /api/sheet/cancel-list
// Dipakai tombol "Lacak Cancel" — baca dari Tracking AWB
app.get('/api/sheet/cancel-list', requireAuth, async (req, res) => {
  const { tanggal, gudang } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  try {
    const params = { action: 'cancelList', tanggal };
    if (gudang) params.gudang = gudang;
    const data = await gasGet(params);
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data cancel.' });
    res.json({ success: true, rows: data.rows || [] });
  } catch (err) {
    console.error('Cancel list error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// =============================================
// STOCK OPNAME — endpoint fallback via Railway
// (frontend memanggil Apps Script langsung,
//  endpoint ini hanya dipakai jika CORS gagal)
// =============================================

// GET /api/so/sesi — daftar tab SO YYYY-MM
app.get('/api/so/sesi', requireAuth, async (req, res) => {
  try {
    const data = await gasGet({ action: 'soListSesi' });
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil daftar sesi SO.' });
    res.json({ success: true, data: data.data || [] });
  } catch (err) {
    console.error('SO list sesi error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Apps Script.' });
  }
});

// GET /api/so/data?sesi=SO+2026-09 — baris SO satu bulan
app.get('/api/so/data', requireAuth, async (req, res) => {
  const { sesi } = req.query;
  if (!sesi) return res.status(400).json({ success: false, message: 'Parameter sesi wajib diisi.' });
  try {
    const data = await gasGet({ action: 'soLoadData', sesi });
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data SO.' });
    res.json({ success: true, rows: data.rows || [], personil: data.personil || [] });
  } catch (err) {
    console.error('SO data error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Apps Script.' });
  }
});

// =============================================
// STOCK OPNAME — RUSAK
// Tab _SO_RUSAK di sheet DATABASE GUDANG
// =============================================

// GET /api/so/rusak?sesi=SO+2026-09
// Load semua data rusak untuk sesi tertentu (data terbaru per SKU)
app.get('/api/so/rusak', requireAuth, async (req, res) => {
  const { sesi } = req.query;
  if (!sesi) return res.status(400).json({ success: false, message: 'Parameter sesi wajib.' });
  try {
    const data = await gasGet({ action: 'soGetRusak', sesi });
    res.json(data.success ? { success: true, rows: data.rows||[] } : { success: false, message: data.message });
  } catch(err) {
    console.error('SO rusak load error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Apps Script.' });
  }
});

// GET /api/so/riwayat?sku=XXX&sesi=SO+2026-09
// Semua riwayat rusak untuk satu SKU (semua sesi atau filter sesi)
app.get('/api/so/riwayat', requireAuth, async (req, res) => {
  const { sku, sesi } = req.query;
  if (!sku) return res.status(400).json({ success: false, message: 'Parameter sku wajib.' });
  try {
    const data = await gasGet({ action: 'soGetRiwayat', sku, sesi: sesi||'' });
    res.json(data.success ? { success: true, rows: data.rows||[] } : { success: false, message: data.message });
  } catch(err) {
    console.error('SO riwayat error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Apps Script.' });
  }
});

// POST /api/so/rusak
// Simpan laporan barang rusak — username diambil dari session
app.post('/api/so/rusak', requireAuth, async (req, res) => {
  const { sku, namaProduk, sesi, jumlahRusak, keterangan } = req.body;
  if (!sku || !sesi || !jumlahRusak) {
    return res.status(400).json({ success: false, message: 'sku, sesi, dan jumlahRusak wajib diisi.' });
  }
  const oleh = req.sessionUser.username;
  // Timestamp WIB
  const now = new Date();
  const wib = new Date(now.getTime() + 7*60*60*1000);
  const pad = n => String(n).padStart(2,'0');
  const dicatatPada = `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth()+1)}-${pad(wib.getUTCDate())} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}`;
  try {
    const data = await gasPost({
      action: 'soSimpanRusak',
      sku, namaProduk: namaProduk||'', sesi,
      jumlahRusak: Number(jumlahRusak),
      keterangan: keterangan||'',
      oleh, dicatatPada
    });
    res.json(data.success
      ? { success: true, message: data.message, oleh, dicatatPada }
      : { success: false, message: data.message||'Gagal simpan.' });
  } catch(err) {
    console.error('SO simpan rusak error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Apps Script.' });
  }
});

// =============================================
// PINDAH GUDANG — sheet LAPORAN BARANG
// Memakai Apps Script terpisah, URL-nya di Railway Variables: PINDAH_SCRIPT_URL
// =============================================
const PINDAH_SCRIPT_URL = process.env.PINDAH_SCRIPT_URL || '';

function cekPindahUrl() {
  if (!PINDAH_SCRIPT_URL) {
    const err = new Error('PINDAH_SCRIPT_URL belum diisi di Railway Variables.');
    err.config = true;
    throw err;
  }
}
function cekJsonPindah(data) {
  if (!data || typeof data !== 'object') {
    const err = new Error('Apps Script Pindah Gudang tidak mengembalikan data. Cek deploy Web App (akses: Siapa saja).');
    err.config = true;
    throw err;
  }
  return data;
}
async function pindahGet(params, timeout = 45000) {
  cekPindahUrl();
  const r = await axios.get(PINDAH_SCRIPT_URL, { params, timeout });
  return cekJsonPindah(r.data);
}
async function pindahPost(body, timeout = 120000) {
  cekPindahUrl();
  const r = await axios.post(PINDAH_SCRIPT_URL, body, {
    headers: { 'Content-Type': 'application/json' }, timeout,
    maxBodyLength: Infinity, maxContentLength: Infinity
  });
  return cekJsonPindah(r.data);
}
function waktuWIB() {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${wib.getUTCFullYear()}-${pad(wib.getUTCMonth() + 1)}-${pad(wib.getUTCDate())} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}`;
}
function pesanErrorPindah(err) {
  return err.config ? err.message : 'Gagal terhubung ke Apps Script Pindah Gudang.';
}

// =============================================
// MEMORI BERSAMA STOK OPNAME (satu perangkat memuat dari sheet, semua kebagian)
// - Data CSV + status + isi hitungan disimpan di memori server.
// - Simpan / hapus lewat server → memori langsung diperbarui (tanpa baca sheet lagi).
// - Setiap perubahan menaikkan nomor versi; HP cukup bertanya "ada yang lebih baru dari versi X?".
// - Dicek ulang ke sheet tiap 5 menit (antisipasi edit manual di sheet) selama ada yang membuka.
// =============================================
const PG_SEGAR_MS = 5 * 60 * 1000;
const pgMem = { master: null, exportInfo: [], exportTim: {}, status: {}, versi: 1, versiPenuh: 1, ubah: {}, waktu: 0, akses: 0, memuat: null };

function pgNaikVersi(kode) { pgMem.versi++; if (kode) pgMem.ubah[kode] = pgMem.versi; }

// Ambil ulang dari sheet (dedup: permintaan bersamaan menunggu proses yang sama)
function pgMuatMem() {
  if (pgMem.memuat) return pgMem.memuat;
  pgMem.memuat = (async () => {
    try {
      const d = await pindahGet({ action: 'pgLoad' });
      if (!d.success) throw Object.assign(new Error(d.message || 'Gagal memuat data.'), { dariSheet: true });
      const masterBaru = JSON.stringify(d.master || []);
      const masterBerubah = pgMem.master !== null && JSON.stringify(pgMem.master) !== masterBaru;
      const lama = pgMem.status, baru = d.status || {};
      if (pgMem.master === null || masterBerubah) {
        pgMem.versi++; pgMem.versiPenuh = pgMem.versi; pgMem.ubah = {};
      } else {
        // hanya rak yang berubah yang dapat versi baru
        new Set([...Object.keys(lama), ...Object.keys(baru)]).forEach(k => {
          if (JSON.stringify(lama[k] || null) !== JSON.stringify(baru[k] || null)) pgNaikVersi(k);
        });
      }
      pgMem.master = d.master || [];
      pgMem.exportInfo = d.exportInfo || [];
      pgMem.exportTim = d.exportTim || {};
      pgMem.status = baru;
      pgMem.waktu = Date.now();
      if (masterBerubah) siarkanPindah('muatUlang', { oleh: 'sheet' });
      return pgMem;
    } finally {
      pgMem.memuat = null;
    }
  })();
  return pgMem.memuat;
}
async function pgPastikanMem() {
  pgMem.akses = Date.now();
  if (!pgMem.master) await pgMuatMem();
  else if (Date.now() - pgMem.waktu > PG_SEGAR_MS) pgMuatMem().catch(() => {});   // pakai yang ada, segarkan di belakang
}
// Perbarui satu rak di memori (dipakai setelah simpan / hapus)
function pgSetStatusMem(kode, st) {
  if (!pgMem.master) return;
  if (st) pgMem.status[kode] = st; else delete pgMem.status[kode];
  pgNaikVersi(kode);
}
// Cek ulang ke sheet tiap 5 menit selama halaman Stok Opname dibuka seseorang (10 menit terakhir)
setInterval(() => {
  if (pgMem.master && Date.now() - pgMem.akses < 10 * 60 * 1000 && Date.now() - pgMem.waktu >= PG_SEGAR_MS - 5000) {
    pgMuatMem().catch(e => console.error('Segarkan stok opname gagal:', e.message));
  }
}, 60 * 1000);

// Jaga Apps Script tetap "bangun" (jam 06.00–23.00 WIB) supaya tidak ada jeda bangun 1–3 detik
const GAS_OPNAME_SHEET_URL = 'https://script.google.com/macros/s/AKfycbwBaBiM08RtAuPayp-vtJINsO3li2blbVg1sbTJtKFPF3-xLN6zhBg5_UbUG_79mQoJ/exec';
function jagaGasBangun() {
  const jam = new Date(Date.now() + 7 * 3600 * 1000).getUTCHours();
  if (jam < 6 || jam >= 23) return;
  [...new Set([PINDAH_SCRIPT_URL, SHEET_SCRIPT_URL, GAS_OPNAME_SHEET_URL].filter(Boolean))].forEach(url => {
    axios.get(url, { params: { action: 'ping' }, timeout: 30000 }).catch(() => {});
  });
}
setInterval(jagaGasBangun, 4 * 60 * 1000);
// Siapkan memori begitu server menyala (setelah deploy / restart), supaya pengguna pertama tidak menunggu
setTimeout(() => {
  if (!PINDAH_SCRIPT_URL) return;
  pgMuatMem().catch(e => console.error('Siapkan Stok Opname gagal:', e.message));
  owMuatMem('').catch(() => {});
  prMuatMem().catch(() => {});
  ambilProfil(true).catch(() => {});
  jagaGasBangun();
}, 3000);

// GET /api/pindah/data — data CSV + status + isi hitungan (dari memori bersama)
// ?segar=1 → paksa ambil ulang dari sheet (tombol Muat Ulang), maksimal sekali per 20 detik
app.get('/api/pindah/data', requireAuth, async (req, res) => {
  try {
    if (req.query.segar === '1' && Date.now() - pgMem.waktu > 20000) await pgMuatMem();
    else await pgPastikanMem();
    res.json({ success: true, master: pgMem.master, status: pgMem.status, sedang: {}, versi: pgMem.versi,
      exportInfo: pgMem.exportInfo, exportTim: pgMem.exportTim, saya: req.sessionUser.username, role: req.sessionUser.role });
  } catch (err) {
    console.error('Pindah load error:', err.message);
    res.status(500).json({ success: false, message: err.dariSheet ? err.message : pesanErrorPindah(err) });
  }
});

// GET /api/pindah/status?versi=N — hanya perubahan sejak versi N
app.get('/api/pindah/status', requireAuth, async (req, res) => {
  try {
    await pgPastikanMem();
    const v = Number(req.query.versi) || 0;
    if (v >= pgMem.versi) return res.json({ success: true, versi: pgMem.versi, sama: true });
    if (v < pgMem.versiPenuh) return res.json({ success: true, versi: pgMem.versi, status: pgMem.status, penuh: true });
    const ubah = {};
    Object.keys(pgMem.ubah).forEach(k => { if (pgMem.ubah[k] > v) ubah[k] = pgMem.status[k] || null; });
    res.json({ success: true, versi: pgMem.versi, ubah });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// GET /api/pindah/rak?kode=0001A — isi hitungan satu kode rak
app.get('/api/pindah/rak', requireAuth, async (req, res) => {
  const kode = String(req.query.kode || '').trim();
  if (!kode) return res.status(400).json({ success: false, message: 'Parameter kode wajib.' });
  try {
    const data = await pindahGet({ action: 'pgRak', kode }, 30000);
    res.json(data.success ? data : { success: false, message: data.message || 'Gagal memuat rak.' });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// POST /api/pindah/upload — ganti isi tab "Data CSV" (khusus superuser)
app.post('/api/pindah/upload', requireAuth, async (req, res) => {
  if (req.sessionUser.role !== 'superuser') {
    return res.status(403).json({ success: false, message: 'Upload CSV hanya untuk akun superuser.' });
  }
  const { rows, mode, label, waktuExport, namaFile } = req.body;
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ success: false, message: 'Data CSV kosong.' });
  }
  if (!label) return res.status(400).json({ success: false, message: 'Label export wajib ada.' });
  try {
    const data = await pindahPost({
      action: 'pgUpload', rows, mode: mode === 'semua' ? 'semua' : 'tim',
      label: String(label).slice(0, 120), waktuExport: String(waktuExport || '').slice(0, 20),
      namaFile: String(namaFile || '').slice(0, 200), oleh: req.sessionUser.username,
      namaOleh: await namaTampil(req.sessionUser.username), waktu: waktuWIB()
    });
    if (data.success) {
      try { await pgMuatMem(); } catch (e) {}
      owTandaiBerubah();
      siarkanPindah('muatUlang', { oleh: req.sessionUser.username });
    }
    res.json(data.success
      ? { success: true, message: data.message, perluCek: data.perluCek || [] }
      : { success: false, message: data.message || 'Gagal upload CSV.' });
  } catch (err) {
    console.error('Pindah upload error:', err.message);
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// POST /api/pindah/hapus — hapus HITUNGAN (data CSV tidak disentuh)
// body: { jenis: 'rak'|'sku', kodeRak, id, alasan }
//  - per SKU : semua akun (konfirmasi "Ya" di web)
//  - satu rak: khusus superuser
app.post('/api/pindah/hapus', requireAuth, async (req, res) => {
  const saya = req.sessionUser.username;
  const jenis = req.body.jenis === 'rak' ? 'rak' : req.body.jenis === 'tim' ? 'tim' : 'sku';
  const kodeRak = String(req.body.kodeRak || '').trim().toUpperCase();
  const id = String(req.body.id || '').trim();
  const tim = String(req.body.tim || '').trim().slice(0, 10);
  if (jenis === 'tim' && !tim) return res.status(400).json({ success: false, message: 'Tim tidak diisi.' });
  if (!kodeRak || (jenis === 'sku' && !id)) return res.status(400).json({ success: false, message: 'Data hapus tidak lengkap.' });
  if (jenis !== 'sku' && req.sessionUser.role !== 'superuser') {
    return res.status(403).json({ success: false, message: 'Hapus hitungan satu rak hanya untuk superuser.' });
  }
  try {
    const data = await pindahPost({
      action: 'pgHapus', jenis, kodeRak, id, tim, oleh: saya, namaOleh: await namaTampil(saya), waktu: waktuWIB(),
      alasan: String(req.body.alasan || '').slice(0, 300)
    }, 60000);
    if (data.success) {
      console.log(`🗑️ [HAPUS HITUNGAN] ${saya}: ${jenis} ${kodeRak} ${id}`);
      pgSetStatusMem(kodeRak, data.kembaliBelum ? null : (data.status || null));
      owTandaiBerubah();
      siarkanPindah('hapusHitung', { oleh: saya, jenis, kodeRak, id, tim, status: data.status || null, kembaliBelum: !!data.kembaliBelum });
    }
    res.json(data.success ? { success: true, message: data.message, status: data.status || null, kembaliBelum: !!data.kembaliBelum }
      : { success: false, message: data.message || 'Gagal menghapus hitungan.' });
  } catch (err) {
    console.error('Pindah hapus error:', err.message);
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// GET /api/pindah/hapus-riwayat — laporan siapa menghapus hitungan (khusus superuser)
app.get('/api/pindah/hapus-riwayat', requireSuperuser, async (req, res) => {
  try {
    const data = await pindahGet({ action: 'pgHapusRiwayat' }, 30000);
    res.json(data.success ? { success: true, rows: data.rows || [] } : { success: false, message: data.message || 'Gagal memuat riwayat hapus.' });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// POST /api/pindah/simpan — simpan satu paket hasil hitung (bisa beberapa kode rak)
// body: { raks: [{ kodeRak, items, versiDasar, paksa }] }  (qtyKirim kosong = belum dihitung)
app.post('/api/pindah/simpan', requireAuth, async (req, res) => {
  const raks = Array.isArray(req.body.raks) ? req.body.raks.slice(0, 25) : null;
  if (!raks || !raks.length) {
    return res.status(400).json({ success: false, message: 'Tidak ada data rak untuk disimpan.' });
  }
  const oleh = req.sessionUser.username;
  const waktu = waktuWIB();
  try {
    const perangkat = String(req.body.perangkat || '').slice(0, 60);
    const data = await pindahPost({ action: 'pgSimpan', raks, oleh, namaOleh: await namaTampil(oleh), waktu, perangkat });
    if (data.success) {
      const ok = (data.hasil || []).filter(h => h.ok);
      if (ok.length) {
        ok.forEach(h => lepasSedangMemori(h.kodeRak, perangkat));
        owTandaiBerubah();
        ok.forEach(h => {
          const lama = pgMem.status[h.kodeRak] || {};
          pgSetStatusMem(h.kodeRak, { status: h.status, nSelisih: h.nSelisih, nBelum: h.nBelum, perluCek: false,
            petugas: h.petugas, waktu: h.waktu, versi: h.versi, perangkat: h.perangkat || '', isi: h.isi || lama.isi || [] });
        });
        siarkanPindah('simpan', { hasil: ok });
        siarkanSedang();
      }
    }
    res.json(data.success
      ? { success: true, hasil: data.hasil || [], oleh, waktu }
      : { success: false, message: data.message || 'Gagal simpan.' });
  } catch (err) {
    console.error('Pindah simpan error:', err.message);
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// GET /api/pindah/opname?bulan=SO+2026-10 — data per produk untuk menu Opname WEB
// Memori bersama per bulan: tampil instan, diperbarui di belakang layar
const owMem = {};   // { bulan: { data, waktu, memuat } }
function owMuatMem(bulan) {
  const m = owMem[bulan] || (owMem[bulan] = { data: null, waktu: 0, memuat: null });
  if (m.memuat) return m.memuat;
  m.memuat = (async () => {
    try {
      const d = await pindahGet({ action: 'pgOpname', bulan }, 90000);
      if (!d.success) throw Object.assign(new Error(d.message || 'Gagal memuat Opname WEB.'), { dariSheet: true });
      m.data = d; m.waktu = Date.now();
      if (!bulan && d.bulan) owMem[d.bulan] = { data: d, waktu: m.waktu, memuat: null };
      return d;
    } finally { m.memuat = null; }
  })();
  return m.memuat;
}
// Dipanggil setiap ada simpan / hapus / upload / barang rusak / ganti nama: segarkan di belakang (digabung 5 detik)
let owTimerSegar = null;
function owTandaiBerubah() {
  Object.values(owMem).forEach(m => { m.waktu = 0; });
  clearTimeout(owTimerSegar);
  owTimerSegar = setTimeout(() => {
    Object.keys(owMem).forEach(b => { if (owMem[b].data) owMuatMem(b).catch(() => {}); });
  }, 5000);
}
app.get('/api/pindah/opname', requireAuth, async (req, res) => {
  const bulan = String(req.query.bulan || '');
  try {
    const m = owMem[bulan];
    let data;
    if (req.query.segar === '1') data = await owMuatMem(bulan);
    else if (m && m.data) {
      data = m.data;
      if (Date.now() - m.waktu > PG_SEGAR_MS) owMuatMem(bulan).catch(() => {});   // tampil dulu, segarkan di belakang
    } else data = await owMuatMem(bulan);
    res.json({ ...data, waktuData: (owMem[bulan] && owMem[bulan].waktu) || Date.now() });
  } catch (err) {
    console.error('Opname web error:', err.message);
    res.status(500).json({ success: false, message: err.dariSheet ? err.message : pesanErrorPindah(err) });
  }
});

// GET /api/pindah/rusak?id=...&bulan=... — riwayat barang rusak (Opname WEB)
app.get('/api/pindah/rusak', requireAuth, async (req, res) => {
  const id = String(req.query.id || '').trim();
  if (!id) return res.status(400).json({ success: false, message: 'Parameter id wajib.' });
  try {
    const data = await pindahGet({ action: 'pgRusakRiwayat', id, bulan: String(req.query.bulan || '') }, 30000);
    res.json(data.success ? { success: true, rows: data.rows || [] } : { success: false, message: data.message });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// POST /api/pindah/rusak — simpan laporan barang rusak (Opname WEB)
app.post('/api/pindah/rusak', requireAuth, async (req, res) => {
  const { id, nama, kodeRak, bulan, jumlah, keterangan } = req.body;
  if (!id || !(Number(jumlah) >= 1)) {
    return res.status(400).json({ success: false, message: 'ID produk dan jumlah rusak wajib diisi.' });
  }
  const oleh = req.sessionUser.username;
  const waktu = waktuWIB();
  try {
    const data = await pindahPost({ action: 'pgRusak', namaOleh: await namaTampil(req.sessionUser.username), id, nama: nama || '', kodeRak: kodeRak || '', bulan: bulan || '',
      jumlah: Number(jumlah), keterangan: keterangan || '', oleh, waktu });
    if (data.success) owTandaiBerubah();
    res.json(data.success ? { success: true, message: data.message, oleh, dicatatPada: waktu }
                          : { success: false, message: data.message || 'Gagal simpan.' });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// =============================================
// REALTIME STOK OPNAME
// "Sedang dihitung" disimpan di memori server (bukan sheet) lalu langsung
// disiarkan ke semua layar lewat Server-Sent Events (/api/pindah/stream).
// Hasil simpan juga disiarkan, jadi kartu di layar lain berubah seketika.
// =============================================
const SEDANG_BATAS_MS = 2 * 60 * 1000;   // tanda hilang bila tidak ada detak 2 menit
const sedangMemori = {};                 // { kodeRak: { perangkatId: { petugas, perangkat, jenis, sejak, detak } } }
const pendengarPindah = new Set();       // koneksi SSE yang aktif

function petaSedang() {
  const kini = Date.now(), hasil = {};
  Object.keys(sedangMemori).forEach(kode => {
    Object.keys(sedangMemori[kode]).forEach(pid => {
      const x = sedangMemori[kode][pid];
      if (kini - x.detak > SEDANG_BATAS_MS) { delete sedangMemori[kode][pid]; return; }
      (hasil[kode] = hasil[kode] || []).push({ petugas: x.petugas, perangkat: x.perangkat, jenis: x.jenis, sejak: x.sejak });
    });
    if (!Object.keys(sedangMemori[kode]).length) delete sedangMemori[kode];
  });
  return hasil;
}
function lepasSedangMemori(kode, perangkat) {
  if (!sedangMemori[kode]) return;
  if (perangkat) delete sedangMemori[kode][perangkat]; else delete sedangMemori[kode];
}
function siarkanPindah(jenis, data) {
  const pesan = `event: ${jenis}\ndata: ${JSON.stringify(data)}\n\n`;
  pendengarPindah.forEach(res => { try { res.write(pesan); } catch (e) { pendengarPindah.delete(res); } });
}
function siarkanSedang() { siarkanPindah('sedang', petaSedang()); }

// POST /api/pindah/tandai — { kodeRak, aksi: 'buka'|'detak'|'tutup', perangkat, jenis }
app.post('/api/pindah/tandai', requireAuth, (req, res) => {
  const kode = String(req.body.kodeRak || '').trim().slice(0, 40);
  const perangkat = String(req.body.perangkat || '').slice(0, 60) || 'tanpa-id';
  if (!kode) return res.status(400).json({ success: false, message: 'kodeRak wajib.' });
  if (req.body.aksi === 'tutup') {
    lepasSedangMemori(kode, perangkat);
  } else {
    const ada = sedangMemori[kode] && sedangMemori[kode][perangkat];
    (sedangMemori[kode] = sedangMemori[kode] || {})[perangkat] = {
      petugas: req.sessionUser.username, perangkat, jenis: String(req.body.jenis || '').slice(0, 30),
      sejak: ada ? ada.sejak : Date.now(), detak: Date.now()
    };
    if (ada && req.body.aksi === 'detak') return res.json({ success: true });   // detak tidak perlu disiarkan
  }
  siarkanSedang();
  res.json({ success: true });
});

// GET /api/pindah/stream?token=... — siaran realtime (EventSource tidak bisa kirim header)
app.get('/api/pindah/stream', (req, res) => {
  const token = String(req.query.token || '');
  if (!sesiAktif(token)) return res.status(401).end();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write(`retry: 3000\n\n`);
  res.write(`event: sedang\ndata: ${JSON.stringify(petaSedang())}\n\n`);
  pendengarPindah.add(res);
  const detak = setInterval(() => { try { res.write(': detak\n\n'); } catch (e) {} }, 20000);
  req.on('close', () => { clearInterval(detak); pendengarPindah.delete(res); });
});

// Bersihkan tanda yang kedaluwarsa dan kabari layar lain
setInterval(() => {
  const sebelum = JSON.stringify(Object.keys(sedangMemori).map(k => [k, Object.keys(sedangMemori[k])]));
  const sesudah = petaSedang();
  if (JSON.stringify(Object.keys(sedangMemori).map(k => [k, Object.keys(sedangMemori[k])])) !== sebelum) siarkanPindah('sedang', sesudah);
}, 30000);

// GET /api/pindah/config — alamat Apps Script untuk baca data langsung dari browser
// (simpan tetap lewat server). Link sheet hanya untuk superuser.
let pindahSheetUrl = '';
app.get('/api/pindah/config', requireAuth, async (req, res) => {
  const superuser = req.sessionUser.role === 'superuser';
  if (superuser && !pindahSheetUrl && PINDAH_SCRIPT_URL) {
    try { const d = await pindahGet({ action: 'pgInfo' }, 20000); pindahSheetUrl = d.url || ''; } catch (e) {}
  }
  res.json({
    success: true,
    scriptUrl: PINDAH_SCRIPT_URL,
    saya: req.sessionUser.username,
    role: req.sessionUser.role,
    sheetUrl: superuser ? pindahSheetUrl : '',
    namaPeta: await petaNama()
  });
});

// =============================================
// PROFIL AKUN (nama tampilan, No HP, foto) — disimpan di tab "Profil Akun"
// Username login tetap jadi kunci; nama tampilan hanya label.
// =============================================
let profilCache = null, profilWaktu = 0;
async function ambilProfil(paksa = false) {
  if (!paksa && profilCache && Date.now() - profilWaktu < 2 * 60 * 1000) return profilCache;
  try {
    const d = await pindahGet({ action: 'pgProfil' }, 20000);
    if (d.success) { profilCache = d.profil || {}; profilWaktu = Date.now(); }
  } catch (e) { console.error('Profil gagal dimuat:', e.message); }
  return profilCache || {};
}
async function namaTampil(username) {
  const p = (await ambilProfil())[String(username || '').toLowerCase()];
  return (p && p.nama) || username;
}
async function petaNama() {
  const p = await ambilProfil(), peta = {};
  Object.keys(p).forEach(u => { if (p[u].nama) peta[u] = p[u].nama; });
  return peta;
}
async function simpanProfil(username, data, res) {
  const nama = String(data.nama || '').trim().replace(/\s+/g, ' ');
  if (nama.length < 3 || nama.length > 40) return res.status(400).json({ success: false, message: 'Nama tampilan 3–40 huruf.' });
  // Tidak boleh sama dengan username login akun lain (supaya tidak tertukar)
  const users = await getUsers();
  const semua = Object.keys(users).concat([SUPERUSER]);
  if (semua.some(u => u !== username && u.toLowerCase() === nama.toLowerCase())) {
    return res.status(409).json({ success: false, message: 'Nama tidak boleh sama dengan username akun lain.' });
  }
  try {
    const d = await pindahPost({ action: 'pgSimpanProfil', username, nama, hp: data.hp,
      foto: data.foto, waktu: waktuWIB() }, 90000);
    if (d.success) { await ambilProfil(true); siarkanPindah('profil', { username }); owTandaiBerubah(); pgMuatMem().catch(() => {}); }
    res.json(d.success ? { success: true, message: d.message, nama: d.nama } : { success: false, message: d.message || 'Gagal menyimpan profil.' });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
}

// GET /api/profil/peta — { username: nama tampilan } untuk semua akun
app.get('/api/profil/peta', requireAuth, async (req, res) => {
  res.json({ success: true, peta: await petaNama() });
});
// GET /api/profil/saya — profil akun yang sedang login (termasuk foto)
app.get('/api/profil/saya', requireAuth, async (req, res) => {
  const u = req.sessionUser.username;
  const p = (await ambilProfil())[u] || {};
  let foto = '';
  if (p.adaFoto) { try { foto = (await pindahGet({ action: 'pgFoto', username: u }, 20000)).foto || ''; } catch (e) {} }
  res.json({ success: true, username: u, role: req.sessionUser.role, nama: p.nama || '', hp: p.hp || '', foto });
});
// POST /api/profil — ubah profil sendiri { nama, hp, foto }
app.post('/api/profil', requireAuth, async (req, res) => {
  const foto = String(req.body.foto || '');
  if (foto && foto !== 'HAPUS' && (!foto.startsWith('data:image/') || foto.length > 45000)) {
    return res.status(400).json({ success: false, message: 'Foto tidak valid atau terlalu besar.' });
  }
  await simpanProfil(req.sessionUser.username, { nama: req.body.nama, hp: String(req.body.hp || '').replace(/[^\d+\- ]/g, ''), foto }, res);
});
// POST /api/profil/:username — superuser mengubah nama tampilan akun lain
app.post('/api/profil/:username', requireSuperuser, async (req, res) => {
  const target = String(req.params.username || '').toLowerCase();
  const p = (await ambilProfil(true))[target] || {};
  await simpanProfil(target, { nama: req.body.nama, hp: p.hp || '', foto: '' }, res);
});

// =============================================
// PECAH RAK — CSV sementara untuk perencanaan rak (semua akun)
// =============================================
const prMem = { data: null, waktu: 0, memuat: null };
function prMuatMem() {
  if (prMem.memuat) return prMem.memuat;
  prMem.memuat = (async () => {
    try {
      const d = await pindahGet({ action: 'prLoad' }, 60000);
      if (!d.success) throw new Error(d.message || 'Gagal memuat data Pecah Rak.');
      prMem.data = { rows: d.rows || [], setel: d.setel || {} }; prMem.waktu = Date.now();
      return prMem.data;
    } finally { prMem.memuat = null; }
  })();
  return prMem.memuat;
}
app.get('/api/pecah/data', requireAuth, async (req, res) => {
  try {
    let d = prMem.data;
    if (!d || req.query.segar === '1') d = await prMuatMem();
    else if (Date.now() - prMem.waktu > PG_SEGAR_MS) prMuatMem().catch(() => {});
    res.json({ success: true, rows: d.rows, setel: d.setel, saya: req.sessionUser.username });
  } catch (err) { res.status(500).json({ success: false, message: err.message || pesanErrorPindah(err) }); }
});
app.post('/api/pecah/upload', requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 20000) : [];
  if (!rows.length) return res.status(400).json({ success: false, message: 'CSV kosong.' });
  try {
    const d = await pindahPost({ action: 'prUpload', rows, oleh: await namaTampil(req.sessionUser.username),
      waktu: waktuWIB(), namaFile: String(req.body.namaFile || '') }, 120000);
    if (d.success) await prMuatMem().catch(() => {});
    res.json(d.success ? { success: true, message: d.message } : { success: false, message: d.message || 'Gagal upload.' });
  } catch (err) { res.status(500).json({ success: false, message: pesanErrorPindah(err) }); }
});
app.post('/api/pecah/hapus', requireAuth, async (req, res) => {
  try {
    const d = await pindahPost({ action: 'prHapus', tim: String(req.body.tim || '').slice(0, 10) }, 60000);
    if (d.success) await prMuatMem().catch(() => {});
    res.json(d.success ? { success: true, message: d.message } : { success: false, message: d.message || 'Gagal menghapus.' });
  } catch (err) { res.status(500).json({ success: false, message: pesanErrorPindah(err) }); }
});
app.post('/api/pecah/setel', requireAuth, async (req, res) => {
  const tim = String(req.body.tim || '').slice(0, 10);
  if (!tim) return res.status(400).json({ success: false, message: 'Tim kosong.' });
  try {
    if (prMem.data) prMem.data.setel[tim] = req.body.setel || {};   // langsung berlaku di memori
    const d = await pindahPost({ action: 'prSetel', tim, setel: req.body.setel || {},
      oleh: await namaTampil(req.sessionUser.username), waktu: waktuWIB() }, 30000);
    res.json(d.success ? { success: true } : { success: false, message: d.message || 'Gagal menyimpan setelan.' });
  } catch (err) { res.status(500).json({ success: false, message: pesanErrorPindah(err) }); }
});

// =============================================
// DASHBOARD GUDANG
// GET /api/dashboard/gudang?gudang=pdc|...|semua&dari=YYYY-MM-DD&sampai=YYYY-MM-DD
//
// Skema cepat:
//  1. Hanya gudang yang sedang dibuka yang diambil dari PDC (bukan selalu 5 gudang).
//  2. Cache per gudang + rentang. Bila ada data di cache, langsung dikirim (< 0,1 dtk);
//     bila sudah lewat 60 dtk, data lama tetap dikirim lalu diperbarui di latar belakang
//     ("stale-while-revalidate"), dan layar mengambil versi baru beberapa detik kemudian.
//  3. Penjaga latar belakang: tiap 60 dtk, data HARI INI untuk gudang yang dilihat
//     dalam 5 menit terakhir diperbarui. Tidak ada yang melihat = tidak ada panggilan ke PDC.
//  4. Maksimal 4 panggilan ke PDC berjalan bersamaan, timeout 60 dtk, dicoba ulang bila putus.
// =============================================
const DASH_SEGAR_MS    = 60 * 1000;        // data dianggap segar selama 60 dtk
const DASH_SIMPAN_MS   = 30 * 60 * 1000;   // data lama disimpan maksimal 30 menit
const DASH_PANTAU_MS   = 5 * 60 * 1000;    // gudang dipantau bila dilihat 5 menit terakhir
const dashCache  = {};   // { 'pdc|2026-10-19|2026-10-19': { t, data } }
const dashJalan  = {};   // pengambilan yang sedang berjalan per kunci (anti-dobel)
const dashDilihat = {};  // { 'pdc': timestamp terakhir dilihat }

// Batasi jumlah panggilan ke API PDC yang berjalan bersamaan
const PDC_MAKS_SERENTAK = 4;
let pdcJalan = 0;
const pdcAntre = [];
function pdcAmbilSlot() {
  if (pdcJalan < PDC_MAKS_SERENTAK) { pdcJalan++; return Promise.resolve(); }
  return new Promise(r => pdcAntre.push(r));
}
function pdcLepasSlot() {
  const next = pdcAntre.shift();
  if (next) next(); else pdcJalan--;
}

// GET ke API PDC dengan token gudang; login ulang sekali bila token kedaluwarsa,
// coba ulang bila timeout / gangguan jaringan.
async function pdcGudangGet(wh, url) {
  await pdcAmbilSlot();
  try { return await pdcGudangGetInti(wh, url); }
  finally { pdcLepasSlot(); }
}
async function pdcGudangGetInti(wh, url) {
  for (let coba = 0; coba < 3; coba++) {
    const token = await getWarehouseToken(wh);
    if (!token) throw new Error('Login gagal');
    try {
      const r = await axios.get(url, {
        headers: {
          'authorization': `Bearer ${token}`,
          'accept': 'application/json, text/plain, */*',
          'origin': 'https://warehouse.onlypdc.com',
          'referer': 'https://warehouse.onlypdc.com/',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
        },
        timeout: 60000
      });
      return r.data?.data ?? r.data;
    } catch (err) {
      const st = err.response?.status;
      if ((st === 401 || st === 403) && coba === 0) {
        delete tokenCache[wh.id]; delete tokenCacheTime[wh.id];
        continue;
      }
      const putus = err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || st === 502 || st === 503 || st === 504;
      if (putus && coba < 2) {
        console.warn(`⏳ [PDC] ${wh.name} lambat/putus (${err.code || st}), coba ulang...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw new Error(err.response?.data?.message || err.message);
    }
  }
}

// Ambil 3 data satu gudang. Bagian yang gagal diisi data lama dari cache (ditandai).
async function ambilSatuGudang(wh, dari, sampai) {
  const kunci = `${wh.id}|${dari}|${sampai}`;
  const lalu = dashCache[kunci]?.data;
  const hasil = { id: wh.id, name: wh.name, inbound: [], outbound: [], prosesWaktu: null, error: [], lama: [], diambil: waktuWIB() };
  if (!wh.warehouse_id) { hasil.error.push('ID gudang belum diisi'); return hasil; }
  const time_min = dateToTimestamp(dari, false), time_max = dateToTimestamp(sampai, true);
  const q = `time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;
  const BASE_V2 = BASE_URL.replace(/\/v1$/, '/v2');
  const [inb, out, waktu] = await Promise.allSettled([
    pdcGudangGet(wh, `${BASE_URL}/warehouses/insight/overview?type=inbound&${q}`),
    pdcGudangGet(wh, `${BASE_URL}/warehouses/insight/overview?type=outbound&${q}`),
    pdcGudangGet(wh, `${BASE_V2}/warehouses/insight/process_time?from=warehouse&warehouse_id=${wh.warehouse_id}&domain_id=${wh.warehouse_id}&time_min=${time_min}&time_max=${time_max}`)
  ]);
  const isi = (r, bagian, label, cek) => {
    if (r.status === 'fulfilled' && cek(r.value)) { hasil[bagian] = r.value; return; }
    hasil.error.push(label + ': ' + (r.status === 'rejected' ? r.reason.message : 'format data tidak dikenal'));
    if (lalu && lalu[bagian] && (Array.isArray(lalu[bagian]) ? lalu[bagian].length : true)) {
      hasil[bagian] = lalu[bagian];
      hasil.lama.push(label + ' ' + String(lalu.diambil).slice(-5));
    }
  };
  isi(inb, 'inbound', 'Inbound', Array.isArray);
  isi(out, 'outbound', 'Outbound', Array.isArray);
  isi(waktu, 'prosesWaktu', 'Waktu', v => v && typeof v === 'object' && !Array.isArray(v));
  return hasil;
}

// Perbarui cache satu gudang (tanpa dobel bila sudah ada yang mengambil)
function segarkanGudang(wh, dari, sampai) {
  const kunci = `${wh.id}|${dari}|${sampai}`;
  if (dashJalan[kunci]) return dashJalan[kunci];
  dashJalan[kunci] = ambilSatuGudang(wh, dari, sampai)
    .then(data => {
      // Jangan timpa data bagus dengan hasil yang semuanya gagal
      const semuaGagal = data.error.length === 3 && !data.lama.length;
      if (!semuaGagal || !dashCache[kunci]) dashCache[kunci] = { t: Date.now(), data };
      return data;
    })
    .finally(() => { delete dashJalan[kunci]; });
  return dashJalan[kunci];
}

function tanggalWIBHariIni() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

app.get('/api/dashboard/gudang', requireAuth, async (req, res) => {
  const pola = /^\d{4}-\d{2}-\d{2}$/;
  const dari = String(req.query.dari || ''), sampai = String(req.query.sampai || '');
  const pilih = String(req.query.gudang || 'semua');
  if (!pola.test(dari) || !pola.test(sampai)) return res.status(400).json({ success: false, message: 'Format tanggal harus YYYY-MM-DD.' });
  if (sampai < dari) return res.status(400).json({ success: false, message: 'Tanggal "Sampai" lebih awal dari "Dari".' });
  if (dateToTimestamp(sampai, true) - dateToTimestamp(dari, false) > 370 * 24 * 3600 * 1000) {
    return res.status(400).json({ success: false, message: 'Rentang maksimal 1 tahun.' });
  }
  const target = pilih === 'semua' ? WAREHOUSES : WAREHOUSES.filter(w => w.id === pilih);
  if (!target.length) return res.status(400).json({ success: false, message: 'Gudang tidak dikenal.' });

  const paksa = req.query.force === 'true';
  const kini = Date.now();
  target.forEach(wh => { dashDilihat[wh.id] = kini; });

  try {
    let adaLama = false;
    const gudang = await Promise.all(target.map(async wh => {
      const c = dashCache[`${wh.id}|${dari}|${sampai}`];
      if (c && !paksa) {
        if (kini - c.t > DASH_SEGAR_MS) { adaLama = true; segarkanGudang(wh, dari, sampai).catch(() => {}); }
        return c.data;                        // langsung kirim dari cache
      }
      return segarkanGudang(wh, dari, sampai); // belum ada di cache: tunggu
    }));
    res.json({
      success: true, gudangDipilih: pilih, dari, sampai, gudang,
      segar: !adaLama,           // false = sebagian data sedang diperbarui, minta ulang sebentar lagi
      diambil: waktuWIB()
    });
  } catch (err) {
    console.error('Dashboard gudang error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal memuat data gudang: ' + err.message });
  }
});

// Penjaga latar belakang: data hari ini untuk gudang yang sedang dipantau
setInterval(() => {
  const kini = Date.now();
  const hari = tanggalWIBHariIni();
  WAREHOUSES.forEach(wh => {
    if (kini - (dashDilihat[wh.id] || 0) > DASH_PANTAU_MS) return;
    const c = dashCache[`${wh.id}|${hari}|${hari}`];
    if (!c || kini - c.t > DASH_SEGAR_MS - 5000) segarkanGudang(wh, hari, hari).catch(() => {});
  });
  // Bersihkan cache yang sudah lama tidak dipakai
  Object.keys(dashCache).forEach(k => { if (kini - dashCache[k].t > DASH_SIMPAN_MS) delete dashCache[k]; });
}, 30 * 1000);

// =============================================
// GUDANG INSIGHT
// =============================================

// Helper buat timestamp dari tanggal string YYYY-MM-DD
// Selalu pakai jam WIB (UTC+7), bukan jam server.
// Server Railway berjalan di UTC; tanpa ini "Hari Ini" bergeser 7 jam
// (07:00 WIB s/d 06:59 WIB besok), sehingga angkanya tidak sama dengan web PDC.
function dateToTimestamp(dateStr, isEnd = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const WIB = 7 * 60 * 60 * 1000;
  if (isEnd) return Date.UTC(y, m - 1, d, 23, 59, 59, 999) - WIB;
  return Date.UTC(y, m - 1, d, 0, 0, 0, 0) - WIB;
}

// Fetch by_status — breakdown per status (Menunggu, Dikemas, Diserahkan, dll)
async function fetchByStatus(type, wh, time_min, time_max) {
  const token = await getWarehouseToken(wh);
  if (!token) return null;
    const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://warehouse.onlypdc.com',
    'referer': 'https://warehouse.onlypdc.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };
  try {
    const url = `${BASE_URL}/warehouses/insight/by_status?type=${type}&tx_type=order&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;
    const res = await axios.get(url, { headers, timeout: 20000 });
    const d = res.data?.data || res.data;
    return Array.isArray(d) ? d : null;
  } catch(err) {
    console.error(`fetchByStatus ${type} ${wh.id}:`, err.response?.status, err.response?.data?.message || err.message);
    return null;
  }
}

// Fetch daily traffic — data per hari untuk chart
async function fetchDaily(type, wh, time_min, time_max) {
  const token = await getWarehouseToken(wh);
  if (!token) return null;
    const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://warehouse.onlypdc.com',
    'referer': 'https://warehouse.onlypdc.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };
  try {
    const url = `${BASE_URL}/warehouses/traffic/daily?type=${type}&tx_type=order&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;
    const res = await axios.get(url, { headers, timeout: 20000 });
    const d = res.data?.data || res.data;
    return Array.isArray(d) ? d : null;
  } catch(err) {
    console.error(`fetchDaily ${type} ${wh.id}:`, err.response?.status, err.response?.data?.message || err.message);
    return null;
  }
}

// Fetch most used products
async function fetchByTeam(type, wh, time_min, time_max) {
  const token = await getWarehouseToken(wh);
  if (!token) return null;
  const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://warehouse.onlypdc.com',
    'referer': 'https://warehouse.onlypdc.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };
  try {
    const url = `${BASE_URL}/warehouses/insight/rank?type=${type}&tx_type=order&order_by=item_count&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;
    const res = await axios.get(url, { headers, timeout: 20000 });
    const d = res.data?.data || res.data;
    return Array.isArray(d) ? d : null;
  } catch(err) {
    console.error(`fetchByTeam ${type} ${wh.id}:`, err.response?.status, err.response?.data?.message || err.message);
    return null;
  }
}

async function fetchMostUsed(type, wh, time_min, time_max) {
  const token = await getWarehouseToken(wh);
  if (!token) return null;
    const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://warehouse.onlypdc.com',
    'referer': 'https://warehouse.onlypdc.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };
  try {
    const url = `${BASE_URL}/warehouses/insight/most_used?warehouse_id=${wh.warehouse_id}&type=${type}&time_min=${time_min}&time_max=${time_max}&limit=5`;
    const res = await axios.get(url, { headers, timeout: 20000 });
    const d = res.data?.data || res.data;
    return Array.isArray(d) ? d : (d ? [d] : null);
  } catch(err) {
    console.error(`fetchMostUsed ${type} ${wh.id}:`, err.response?.status, err.response?.data?.message || err.message);
    return null;
  }
}

// GET /api/insight?type=outbound&date_from=2026-09-01&date_to=2026-09-21&warehouse_id=pdc
app.get('/api/insight', requireAuth, async (req, res) => {
  try {
    const { type = 'outbound', date_from, date_to, warehouse_id } = req.query;
    if (!date_from || !date_to) {
      return res.status(400).json({ success: false, message: 'date_from dan date_to wajib diisi.' });
    }

    const time_min = dateToTimestamp(date_from, false);
    const time_max = dateToTimestamp(date_to, true);

    // Filter gudang — kalau tidak ada ambil semua
    const targets = warehouse_id
      ? WAREHOUSES.filter(w => w.id === warehouse_id)
      : WAREHOUSES;

    const results = await Promise.all(targets.map(async (wh) => {
      // Jalankan overview dulu sendiri, lalu yang lain parallel
      const overview = await fetchOverviewRange(type, wh, time_min, time_max);
      const [byStatus, daily, mostUsed, byTeam] = await Promise.all([
        fetchByStatus(type, wh, time_min, time_max),
        fetchDaily(type, wh, time_min, time_max),
        fetchMostUsed(type, wh, time_min, time_max),
        fetchByTeam(type, wh, time_min, time_max)
      ]);
      return {
        id          : wh.id,
        name        : wh.name,
        warehouse_id: wh.warehouse_id,
        overview, byStatus, daily, mostUsed, byTeam
      };
    }));

    res.json({ success: true, type, date_from, date_to, warehouses: results });
  } catch(err) {
    console.error('Insight error detail:', err.stack || err.message);
    res.status(500).json({ success: false, message: 'Gagal mengambil data insight: ' + err.message });
  }
});

// fetchOverview dengan range tanggal custom (bukan hanya hari ini)
async function fetchOverviewRange(type, wh, time_min, time_max) {
  const token = await getWarehouseToken(wh);
  if (!token) return { total_trx: 0, total_pcs: 0, status_error: 'Login Failed' };
  const headers = {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json, text/plain, */*',
    'origin': 'https://warehouse.onlypdc.com',
    'referer': 'https://warehouse.onlypdc.com/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };
  try {
    const url = `${BASE_URL}/warehouses/insight/overview?type=${type}&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;
    const res = await axios.get(url, { headers, timeout: 30000 });
    const raw = res.data?.data || res.data;
    // Hitung total trx dan pcs dari array status
    let total_trx = 0, total_pcs = 0;
    if (Array.isArray(raw)) {
      raw.forEach(item => {
        if (item.status !== 'cancel') {
          total_trx += Number(item.transaction_count) || 0;
          total_pcs += Number(item.item_count)        || 0;
        }
      });
    }
    return { total_trx, total_pcs, raw };
  } catch(err) {
    const status = err.response?.status;
    // Token expired → clear cache dan retry sekali
    if (status === 401 || status === 403) {
      delete tokenCache[wh.id];
      delete tokenCacheTime[wh.id];
      console.log(`🔄 [TOKEN RETRY] ${wh.name}`);
      try {
        const token2 = await getWarehouseToken(wh);
        if (token2) {
          const h2 = {
            'authorization': `Bearer ${token2}`,
            'accept': 'application/json, text/plain, */*',
            'origin': 'https://warehouse.onlypdc.com',
            'referer': 'https://warehouse.onlypdc.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
          };
          const url2 = `${BASE_URL}/warehouses/insight/overview?type=${type}&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;
          const res2 = await axios.get(url2, { headers: h2, timeout: 30000 });
          const raw2 = res2.data?.data || res2.data;
          let t = 0, p = 0;
          if (Array.isArray(raw2)) {
            raw2.forEach(item => { if(item.status!=='cancel'){ t+=Number(item.transaction_count)||0; p+=Number(item.item_count)||0; } });
          }
          return { total_trx: t, total_pcs: p, raw: raw2 };
        }
      } catch(e2) { console.error(`Retry gagal ${wh.name}:`, e2.message); }
    }
    console.error(`fetchOverviewRange ${type} ${wh.id}:`, status, err.message);
    return { total_trx: 0, total_pcs: 0, status_error: err.response?.data?.message || 'Error' };
  }
}

// =============================================
// PDC SELLING — STATISTIK TEAM
// Endpoint: /selling_iface.v1.SellingStatService/TeamStatMetric
// Protocol: gRPC-Web / protobuf (manual encode-decode)
// Login: POST /v1/users/login?from=selling  (server PDC Gudang)
// =============================================

const SELLING_BASE_URL = 'https://selling-service-1008190962565.asia-southeast2.run.app';
const SHARED_SERVICE_URL = 'https://shared-service-1008190962565.asia-southeast2.run.app';
const sellingTokenCache = { token: null, time: 0 };

// Cache nama tim: { id: nama } — di-refresh sekali per jam
const teamNameCache = { map: {}, time: 0 };

// PublicTeamIDs: request field1 = DAFTAR ID TEAM (packed varint) yang mau diambil namanya.
// Dulu body-nya disalin mentah dari cURL → isinya cuma 20 ID team tertentu, sehingga team lain
// tampil sebagai "Tim {id internal}" (mis. "Tim 82" padahal Team 21).
// Sekarang: semua ID diminta, dipecah per 20 (sama seperti web asli), yang belum ketemu dicoba ulang.
async function mintaNamaTeam(token, ids) {
  const isi = Buffer.concat(ids.map(id => encodeVarint(BigInt(id))));
  const body = Buffer.concat([Buffer.from([0x0a]), encodeVarint(BigInt(isi.length)), isi]);
  const res = await axios.post(`${SHARED_SERVICE_URL}/common.v1.TeamService/PublicTeamIDs`, body, {
    headers: {
      'content-type': 'application/proto',
      'accept': '*/*',
      'connect-protocol-version': '1',
      'authorization': `Bearer ${token}`,
      'origin': 'https://sellingteam.pdcoke.com',
      'referer': 'https://sellingteam.pdcoke.com/',
      'x-pdc-source': 'CDQQAQ=='
    },
    responseType: 'arraybuffer',
    timeout: 15000
  });
  return decodePublicTeamIDs(Buffer.from(res.data));
}
async function getTeamNames(token, ids = []) {
  ids = [...new Set(ids.map(Number).filter(n => n > 0))];
  const basi = Date.now() - teamNameCache.time > 60 * 60 * 1000;
  let minta = basi ? ids : ids.filter(id => !teamNameCache.map[id]);
  if (!minta.length) return teamNameCache.map;

  for (let putaran = 1; putaran <= 3 && minta.length; putaran++) {
    const ukuran = putaran === 1 ? 20 : putaran === 2 ? 5 : 1;   // makin kecil kalau masih ada yang belum ketemu
    const kelompok = [];
    for (let i = 0; i < minta.length; i += ukuran) kelompok.push(minta.slice(i, i + ukuran));
    const hasil = await Promise.all(kelompok.map(k => mintaNamaTeam(token, k).catch(err => {
      console.error('⚠️ [TEAM NAMES] Gagal ambil', k.join(','), ':', err.message); return {};
    })));
    hasil.forEach(m => Object.assign(teamNameCache.map, m));
    minta = minta.filter(id => !hasil.some(m => m[id]));
  }
  if (basi) teamNameCache.time = Date.now();
  if (minta.length) console.warn('⚠️ [TEAM NAMES] Nama belum ketemu untuk ID:', minta.join(', '));
  else console.log('✅ [TEAM NAMES] Semua nama ketemu (' + ids.length + ' team)');
  return teamNameCache.map;
}

// Field nama di PublicTeamIDs ternyata pesan bersarang (berisi nama, kode, "selling",
// nomor HP, dll). Ambil teks yang terbaca, utamakan yang diawali "Team".
function teksDariProto(buf, kedalaman = 0, hasil = []) {
  let pos = 0;
  try {
    while (pos < buf.length) {
      const tag = decodeVarint(buf, pos); pos = tag.next;
      const wt = Number(tag.value & 7n);
      if (wt === 0) { pos = decodeVarint(buf, pos).next; }
      else if (wt === 1) { pos += 8; }
      else if (wt === 5) { pos += 4; }
      else if (wt === 2) {
        const ld = readLengthDelimited(buf, pos); pos = ld.next;
        const t = ld.data.toString('utf8');
        if (/^[\x20-\x7E\u00A0-\uFFFF]+$/.test(t) && !t.includes('\uFFFD')) hasil.push(t.trim());
        else if (kedalaman < 3) teksDariProto(ld.data, kedalaman + 1, hasil);
      } else break;
      if (pos > buf.length) break;
    }
  } catch (e) { /* bukan protobuf, abaikan */ }
  return hasil;
}
function namaTimDariProto(buf) {
  const teks = teksDariProto(buf).filter(Boolean);
  if (!teks.length) {
    const polos = buf.toString('utf8');
    const m = polos.match(/Team\s*\w+/i);
    return m ? m[0] : '';
  }
  return teks.find(t => /^team\b/i.test(t)) || teks[0];
}

function decodePublicTeamIDs(buf) {
  // Response: repeated message field1 = {field1=id (varint), field2=name (string), ...}
  const map = {};
  let pos = 0;
  while (pos < buf.length) {
    const tagR = decodeVarint(buf, pos); pos = tagR.next;
    const fn = Number(tagR.value >> 3n);
    const wt = Number(tagR.value & 7n);
    if (wt === 2) {
      const ld = readLengthDelimited(buf, pos); pos = ld.next;
      if (fn === 1) {
        // Parse satu team entry
        let sp = 0, tid = 0, tname = '';
        while (sp < ld.data.length) {
          const sr = decodeVarint(ld.data, sp); sp = sr.next;
          const sfn = Number(sr.value >> 3n);
          const swt = Number(sr.value & 7n);
          if (swt === 0) {
            const sv = decodeVarint(ld.data, sp); sp = sv.next;
            if (sfn === 1) tid = Number(sv.value);
          } else if (swt === 2) {
            const sl = readLengthDelimited(ld.data, sp); sp = sl.next;
            if (sfn === 2) tname = namaTimDariProto(sl.data);
          } else if (swt === 1) { sp += 8; }
          else if (swt === 5) { sp += 4; }
          else break;
        }
        if (tid && tname) map[tid] = tname;
        else if (tid) console.warn('⚠️ [TEAM NAMES] ID', tid, 'tanpa nama terbaca, hex:', ld.data.slice(0, 120).toString('hex'));
      }
    } else {
      pos = skipField(buf, pos, wt);
    }
  }
  return map;
}

async function getSellingToken(forceRefresh = false) {
  const age = Date.now() - sellingTokenCache.time;
  if (!forceRefresh && sellingTokenCache.token && age < 28 * 60 * 1000) {
    return sellingTokenCache.token;
  }
  const user = process.env.SELLING_USER;
  const pass = process.env.SELLING_PASS;
  if (!user || !pass) {
    console.error('❌ [SELLING] SELLING_USER / SELLING_PASS belum diisi di Railway.');
    return null;
  }
  try {
    // PDC Selling login: coba username dulu, fallback ke email jika gagal
    const loginBody = { username: user, password: pass, from: 'selling' };
    const res = await axios.post(`${BASE_URL}/users/login`, loginBody, {
      headers: {
        'Content-Type': 'application/json',
        'accept': 'application/json, text/plain, */*',
        'origin': 'https://selling.onlypdc.com',
        'referer': 'https://selling.onlypdc.com/'
      },
      timeout: 15000
    });
    const d = res.data?.data || res.data;
    const token = d?.auth_token || d?.token || d?.access_token;
    if (token) {
      sellingTokenCache.token = token;
      sellingTokenCache.time  = Date.now();
      console.log('✅ [SELLING] Login sukses');
      return token;
    }
    console.error('❌ [SELLING] Token tidak ditemukan di response. Keys:', Object.keys(d || {}));
  } catch (err) {
    console.error('❌ [SELLING] Login gagal status:', err.response?.status);
    console.error('❌ [SELLING] Login gagal body:', JSON.stringify(err.response?.data));
    console.error('❌ [SELLING] Login gagal msg:', err.message);
  }
  return null;
}

// ---- Protobuf encode helpers ----
function encodeVarint(val) {
  const out = [];
  let v = BigInt(val);
  while (v > 127n) {
    out.push(Number((v & 0xffn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
}

function encodeFixed64LE(val) {
  // 8-byte little-endian int64 — dipakai untuk microsecond timestamp
  const b = Buffer.alloc(8);
  const big = BigInt(val);
  b.writeBigInt64LE(big, 0);
  return b;
}

function encodeField(fieldNum, wireType, valueBuffer) {
  const tag = encodeVarint(BigInt(fieldNum) << 3n | BigInt(wireType));
  return Buffer.concat([tag, valueBuffer]);
}

function encodeString(fieldNum, str) {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([
    encodeField(fieldNum, 2, Buffer.concat([encodeVarint(b.length), b]))
  ]);
}

function encodeInt32Field(fieldNum, val) {
  return encodeField(fieldNum, 0, encodeVarint(val));
}

function encodeFixed64Field(fieldNum, val) {
  return encodeField(fieldNum, 1, encodeFixed64LE(val));
}

function encodeBoolField(fieldNum, val) {
  return encodeField(fieldNum, 0, encodeVarint(val ? 1 : 0));
}

function encodeMessageField(fieldNum, msgBuf) {
  // wireType 2 = length-delimited (nested message)
  const lenBuf = encodeVarint(msgBuf.length);
  const tagBuf = encodeVarint(BigInt(fieldNum) << 3n | 2n);
  return Buffer.concat([tagBuf, lenBuf, msgBuf]);
}

function encodeTeamStatMetricRequest(timeStartSec, timeEndSec) {
  // Decoded dari cURL asli PDC Selling (Connect Protocol, application/proto):
  //
  // message TeamStatMetricRequest {
  //   message FilterWrapper {         // field 1
  //     message Pagination {          // field 1 dalam FilterWrapper
  //       int32 page  = 1;
  //       int32 limit = 2;
  //     }
  //     message TimeRange {           // field 2 dalam FilterWrapper
  //       message TimeBound { int64 value = 1; }  // timestamp SECONDS (varint)
  //       TimeBound start = 1;
  //       TimeBound end   = 2;
  //     }
  //   }
  //   message Sort {                  // field 2
  //     int32 field1 = 1;  // = 2
  //     int32 field3 = 3;  // = 1
  //   }
  //   message Field4 { int32 v = 1; } // field 4, value = 1
  // }
  //
  // Timestamp unit: SECONDS (bukan microseconds/milliseconds)
  // Protocol: Connect Protocol (connect-protocol-version: 1)

  // TimeBound messages: {field1: seconds}
  const startBound = encodeInt32Field(1, Number(timeStartSec));
  const endBound   = encodeInt32Field(1, Number(timeEndSec));

  // TimeRange: {field1: startBound, field2: endBound}
  const timeRange = Buffer.concat([
    encodeMessageField(1, startBound),
    encodeMessageField(2, endBound),
  ]);

  // Pagination: {page:1, limit:100}
  const pagination = Buffer.concat([
    encodeInt32Field(1, 1),    // page
    encodeInt32Field(2, 100),  // limit (asli 20, kita pakai 100)
  ]);

  // FilterWrapper: {field1: pagination, field2: timeRange}
  const filterWrapper = Buffer.concat([
    encodeMessageField(1, pagination),
    encodeMessageField(2, timeRange),
  ]);

  // Sort: {field1: 2, field3: 1}
  const sort = Buffer.concat([
    encodeInt32Field(1, 2),
    encodeInt32Field(3, 1),
  ]);

  // Field4 = daftar metrik (packed). Web asli kirim [1] = transaksi → bytes 22 01 01.
  // Dulu kita kirim 22 02 08 01 = metrik [8, 1] → server balas metrik 8 duluan (bukan transaksi) → angka tidak valid.
  const field4 = Buffer.from([0x01]);

  // Outer message: Connect Protocol — raw protobuf, TANPA gRPC-Web frame
  const body = Buffer.concat([
    encodeMessageField(1, filterWrapper),  // field 1
    encodeMessageField(2, sort),           // field 2
    encodeMessageField(4, field4),         // field 4
  ]);

  return body; // langsung protobuf, bukan gRPC-Web frame
}

// ---- Protobuf decode helpers ----
function decodeVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let i = offset;
  while (i < buf.length) {
    const b = BigInt(buf[i++]);
    result |= (b & 0x7fn) << shift;
    shift += 7n;
    if (!(b & 0x80n)) break;
  }
  return { value: result, next: i };
}

function readLengthDelimited(buf, offset) {
  const r = decodeVarint(buf, offset);
  const len = Number(r.value);
  return { data: buf.slice(r.next, r.next + len), next: r.next + len };
}

function skipField(buf, pos, wireType) {
  if (wireType === 0) { const r = decodeVarint(buf, pos); return r.next; }
  if (wireType === 1) return pos + 8;
  if (wireType === 2) { const r = decodeVarint(buf, pos); return r.next + Number(r.value); }
  if (wireType === 5) return pos + 4;
  return buf.length; // unknown — bail
}

function decodeTeamStatMetricResponse(buf) {
  // Connect Protocol response: raw protobuf, dua outer field1:
  //   #1 (current period): {field8: {repeated field1: team_entry}}
  //   #2 (comparison period): {repeated field1: team_entry} — kita skip
  //
  // Struktur team_entry:
  //   .field1 = team_id (varint)
  //   .field2 (nested message):
  //     .field1 = team_id (varint, konfirmasi)
  //     .field2 = transaksi (varint)
  //     .field4 = nilai_belanja (float64 LE)
  //     .field5 = nilai_transaksi (float64 LE)
  //     .field6 = timestamp range (skip)
  const teams = [];
  let pos = 0;
  let outerCount = 0;
  while (pos < buf.length) {
    const tagR = decodeVarint(buf, pos);
    if (tagR.next >= buf.length && tagR.value === 0n) break;
    pos = tagR.next;
    const fieldNum = Number(tagR.value >> 3n);
    const wireType = Number(tagR.value & 7n);
    if (wireType === 2) {
      const ld = readLengthDelimited(buf, pos);
      pos = ld.next;
      if (fieldNum === 1) {
        outerCount++;
        if (outerCount === 1) {
          // Outer record 1 (current period) — parse field8 di dalam
          parseOuterRecord(ld.data, teams);
        }
        // Outer record 2 (comparison) — skip
      } else {
        // skip field lain di level paling atas
      }
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
  return teams;
}

function parseOuterRecord(buf, teams) {
  // Cari field8 (wire2) yang berisi repeated team entries
  let pos = 0;
  while (pos < buf.length) {
    const tagR = decodeVarint(buf, pos);
    pos = tagR.next;
    const fieldNum = Number(tagR.value >> 3n);
    const wireType = Number(tagR.value & 7n);
    if (wireType === 2) {
      const ld = readLengthDelimited(buf, pos);
      pos = ld.next;
      if (fieldNum === 1) {
        // field1 = metrik transaksi → berisi repeated field1 = team entries (sama dengan web asli)
        parseTeamEntries(ld.data, teams);
        return;
      }
      // skip field lain
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
}

function parseTeamEntries(buf, teams) {
  // repeated field1 = satu team entry
  let pos = 0;
  while (pos < buf.length) {
    const tagR = decodeVarint(buf, pos);
    pos = tagR.next;
    const fieldNum = Number(tagR.value >> 3n);
    const wireType = Number(tagR.value & 7n);
    if (wireType === 2) {
      const ld = readLengthDelimited(buf, pos);
      pos = ld.next;
      if (fieldNum === 1) {
        const team = parseOneTeam(ld.data);
        if (team) teams.push(team);
      }
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
}

function parseTeamStatFrame(frame, teams) {
  // Legacy wrapper — redirect ke decodeTeamStatMetricResponse logic
  parseTeamEntries(frame, teams);
}

function parseOneTeam(buf) {
  // Struktur entry (dari reverse-engineer hex_full):
  //   field1 (varint) = team_id
  //   field2 (nested):
  //     field1 (varint) = team_id (duplikat)
  //     field2 (varint) = transaksi (jumlah order)
  //     field4 (f64LE) = nilai_belanja
  //     field5 (f64LE) = nilai_transaksi (omzet)
  //     field6 (nested) = timestamp range (skip)
  let pos = 0;
  const team = { team_id: 0, team_name: '', transaksi: 0, nilai_belanja: 0, nilai_transaksi: 0 };
  while (pos < buf.length) {
    const tagR = decodeVarint(buf, pos);
    pos = tagR.next;
    const fieldNum = Number(tagR.value >> 3n);
    const wireType = Number(tagR.value & 7n);
    if (wireType === 0) {
      const r = decodeVarint(buf, pos);
      pos = r.next;
      if (fieldNum === 1) team.team_id = Number(r.value);
    } else if (wireType === 2) {
      const ld = readLengthDelimited(buf, pos);
      pos = ld.next;
      if (fieldNum === 2) {
        // Parse stats nested message
        let sp = 0;
        while (sp < ld.data.length) {
          const sr = decodeVarint(ld.data, sp);
          sp = sr.next;
          const sfn = Number(sr.value >> 3n);
          const swt = Number(sr.value & 7n);
          if (swt === 0) {
            const sv = decodeVarint(ld.data, sp); sp = sv.next;
            if (sfn === 1) team.team_id   = Number(sv.value);
            if (sfn === 2) team.transaksi = Number(sv.value);
          } else if (swt === 1) {
            const f64 = ld.data.readDoubleLE(sp); sp += 8;
            if (sfn === 4) team.nilai_belanja   = f64;
            if (sfn === 5) team.nilai_transaksi = f64;
          } else if (swt === 2) {
            const sl = readLengthDelimited(ld.data, sp); sp = sl.next;
            if (sfn === 6) {   // field6 = Timestamp {1: detik, 2: nano} → waktu transaksi terakhir
              const d = decodeVarint(sl.data, 1);
              if (sl.data[0] === 0x08) team.terakhir = Number(d.value) * 1000;
            }
          } else {
            sp = skipField(ld.data, sp, swt);
          }
        }
      }
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 5) {
      pos += 4;
    } else break;
  }
  if (!team.team_id) return null;
  // Buat nama tim dari team_id (karena nama tidak ada di response)
  team.team_name = `ID ${team.team_id}`;   // sementara, diganti nama asli dari PublicTeamIDs
  return team;
}

// GET /api/selling/team-stat?date_from=2026-01-01&date_to=2026-10-16
// Cache hasil Statistik Team: periode yang memuat hari ini disegarkan tiap 2 menit, periode lampau 30 menit.
// Pengguna langsung dapat data dari memori; kalau sudah lewat waktunya, data lama dikirim dulu lalu disegarkan di belakang.
const tsCache = new Map();   // "from|to" → { data, waktu, memuat }
function tsUmurMaks(date_to) {
  const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  return date_to >= hariIni ? 2 * 60 * 1000 : 30 * 60 * 1000;
}
async function tsAmbilLewatCache(req, date_from, date_to, paksa) {
  const kunci = date_from + '|' + date_to;
  const c = tsCache.get(kunci);
  const segarkan = () => {
    if (c && c.memuat) return c.memuat;
    const isi = c || { data: null, waktu: 0, memuat: null };
    tsCache.set(kunci, isi);
    isi.memuat = new Promise((ok, gagal) => {
      const resPalsu = { status() { return this; }, json(d) { d && d.success ? ok(d) : gagal(new Error((d && d.message) || 'Gagal')); } };
      tsHandler({ query: { date_from, date_to } }, resPalsu);
    }).then(d => { isi.data = d; isi.waktu = Date.now(); return d; })
      .finally(() => { isi.memuat = null; });
    if (tsCache.size > 30) tsCache.delete(tsCache.keys().next().value);
    return isi.memuat;
  };
  if (c && c.data && !paksa) {
    if (Date.now() - c.waktu > tsUmurMaks(date_to)) segarkan().catch(() => {});
    return c.data;
  }
  return segarkan();
}
app.get('/api/selling/team-stat', requireAuth, async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date_from || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date_to || ''))) {
    return res.status(400).json({ success: false, message: 'date_from dan date_to wajib diisi (YYYY-MM-DD).' });
  }
  try {
    const d = await tsAmbilLewatCache(req, date_from, date_to, req.query.segar === '1');
    const c = tsCache.get(date_from + '|' + date_to);
    res.json({ ...d, waktuData: c ? c.waktu : Date.now() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
async function tsHandler(req, res) {
  try {
    const { date_from, date_to } = req.query;

    // Millisecond → seconds (Connect Protocol pakai seconds, bukan microseconds)
    const timeStartSec = Math.floor(dateToTimestamp(date_from, false) / 1000);
    const timeEndSec   = Math.floor(dateToTimestamp(date_to,   true)  / 1000);

    let token = await getSellingToken();
    if (!token) return res.status(503).json({ success: false, message: 'Gagal login ke PDC Selling. Cek SELLING_USER/SELLING_PASS di Railway.' });

    const protoBody = encodeTeamStatMetricRequest(timeStartSec, timeEndSec);

    async function callSellingAPI(t) {
      return axios.post(
        `${SELLING_BASE_URL}/selling_iface.v1.SellingStatService/TeamStatMetric`,
        protoBody,
        {
          headers: {
            'Authorization': `Bearer ${t}`,
            'Content-Type': 'application/proto',
            'Accept': '*/*',
            'connect-protocol-version': '1',
            'x-pdc-source': 'CDQQAQ==',
            'origin': 'https://sellingteam.pdcoke.com',
            'referer': 'https://sellingteam.pdcoke.com/'
          },
          responseType: 'arraybuffer',
          timeout: 30000
        }
      );
    }

    let apiRes;
    try {
      apiRes = await callSellingAPI(token);
    } catch (err) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.log('🔄 [SELLING] Token expired, login ulang...');
        token = await getSellingToken(true);
        if (!token) return res.status(503).json({ success: false, message: 'Re-login ke PDC Selling gagal.' });
        apiRes = await callSellingAPI(token);
      } else throw err;
    }

    const rawBuf = Buffer.from(apiRes.data);

    const teams  = decodeTeamStatMetricResponse(rawBuf);

    // Ambil nama tim dari PublicTeamIDs (di-cache 1 jam)
    const nameMap = await getTeamNames(token, teams.map(t => t.team_id));
    teams.forEach(t => {
      const nama = nameMap[Number(t.team_id)];
      if (nama) t.team_name = nama;
      // else tetap "Tim {id}" dari parseOneTeam
    });

    // Urutkan berdasarkan transaksi terbesar
    teams.sort((a, b) => b.transaksi - a.transaksi);

    res.json({ success: true, date_from, date_to, teams });
  } catch (err) {
    console.error('❌ [SELLING team-stat]', err.message);
    res.status(500).json({ success: false, message: 'Gagal mengambil data statistik tim: ' + err.message });
  }
}

// Fallback route
app.get(/.*/, kirimIndex);

// =============================================
// PORT — selalu baca dari process.env.PORT
// Railway mengisi ini otomatis saat deploy.
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Server PDC Warehouse Admin: port ${PORT}`);
  console.log(`========================================`);
});

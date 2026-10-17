const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

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
  { id: 'cemara', name: 'Cemara Warehouse', username: process.env.WH_CEMARA_USER, password: process.env.WH_CEMARA_PASS, warehouse_id: '96' }
];

const REQUIRED_ENV = [
  'BITESHIP_API_KEY',
  'WH_PDC_USER',    'WH_PDC_PASS',
  'WH_FEBRI_USER',  'WH_FEBRI_PASS',
  'WH_PALEM_USER',  'WH_PALEM_PASS',
  'WH_CEMARA_USER', 'WH_CEMARA_PASS',
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

function getTodayTimestamps() {
  const now = new Date();
  return {
    time_min: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime(),
    time_max: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime()
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

// Jalankan pertama kali begitu server nyala (supaya cache langsung terisi,
// tidak perlu menunggu user pertama buka Dashboard)
backgroundRefresh('inbound');
backgroundRefresh('outbound');

// Ulangi otomatis tiap REFRESH_INTERVAL
setInterval(() => backgroundRefresh('inbound'),  REFRESH_INTERVAL);
setInterval(() => backgroundRefresh('outbound'), REFRESH_INTERVAL);

// GET /api/dashboard
app.get('/api/dashboard', async (req, res) => {
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
app.post('/api/track-awb-chunk', async (req, res) => {
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

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

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

const activeSessions = {};

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !activeSessions[token]) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  req.sessionUser = activeSessions[token];
  next();
}

function requireSuperuser(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !activeSessions[token]) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  const user = activeSessions[token];
  if (user.role !== 'superuser') {
    return res.status(403).json({ success: false, message: 'Akun Anda tidak bisa mengakses fitur ini.' });
  }
  req.sessionUser = user;
  next();
}

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const uname = username.trim().toLowerCase();

  // Jalur superuser langsung via SUPERUSER_KEY (tidak perlu ada di sheet)
  // Ini memastikan raza404nf selalu bisa login meski sheet bermasalah
  if (uname === SUPERUSER && SUPERUSER_KEY && password === SUPERUSER_KEY) {
    const token = generateToken();
    activeSessions[token] = { username: SUPERUSER, role: 'superuser' };
    return res.json({ success: true, token, username: SUPERUSER, role: 'superuser' });
  }

  // Jalur akun biasa — cek ke sheet _Akun
  try {
    const users = await getUsers();
    const user  = users[uname];
    if (!user || user.password !== hashPassword(password)) {
      return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
    }
    const token = generateToken();
    activeSessions[token] = { username: uname, role: user.role || 'user' };
    res.json({ success: true, token, username: uname, role: user.role || 'user' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menghubungi database akun.' });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers['x-session-token'];
  delete activeSessions[token];
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
    // Tambahkan superuser ke list kalau belum ada di sheet
    if (!list.find(u => u.username === SUPERUSER)) {
      list.unshift({ username: SUPERUSER, role: 'superuser', createdAt: '-' });
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
    Object.keys(activeSessions).forEach(token => {
      if (activeSessions[token].username === target) delete activeSessions[token];
    });
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
    users[target].password = hashPassword(password);
    await saveUsers(users);
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

// GET /api/pindah/data — data CSV + status per rak + tanda sedang dihitung
app.get('/api/pindah/data', requireAuth, async (req, res) => {
  try {
    const data = await pindahGet({ action: 'pgLoad' });
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal memuat data pindah gudang.' });
    res.json({ success: true, master: data.master || [], status: data.status || {}, sedang: data.sedang || {}, url: data.url || '',
      exportInfo: data.exportInfo || [], exportTim: data.exportTim || {}, saya: req.sessionUser.username, role: req.sessionUser.role });
  } catch (err) {
    console.error('Pindah load error:', err.message);
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// GET /api/pindah/status — data ringan untuk sinkron berkala
app.get('/api/pindah/status', requireAuth, async (req, res) => {
  try {
    const data = await pindahGet({ action: 'pgStatus' }, 30000);
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal memuat status.' });
    res.json({ success: true, status: data.status || {}, sedang: data.sedang || {} });
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
      namaFile: String(namaFile || '').slice(0, 200), oleh: req.sessionUser.username, waktu: waktuWIB()
    });
    res.json(data.success
      ? { success: true, message: data.message, perluCek: data.perluCek || [] }
      : { success: false, message: data.message || 'Gagal upload CSV.' });
  } catch (err) {
    console.error('Pindah upload error:', err.message);
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
    const data = await pindahPost({ action: 'pgSimpan', raks, oleh, waktu, perangkat });
    res.json(data.success
      ? { success: true, hasil: data.hasil || [], oleh, waktu }
      : { success: false, message: data.message || 'Gagal simpan.' });
  } catch (err) {
    console.error('Pindah simpan error:', err.message);
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// GET /api/pindah/opname?bulan=SO+2026-10 — data per produk untuk menu Opname WEB
app.get('/api/pindah/opname', requireAuth, async (req, res) => {
  try {
    const data = await pindahGet({ action: 'pgOpname', bulan: String(req.query.bulan || '') }, 60000);
    res.json(data.success ? data : { success: false, message: data.message || 'Gagal memuat Opname WEB.' });
  } catch (err) {
    console.error('Opname web error:', err.message);
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
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
    const data = await pindahPost({ action: 'pgRusak', id, nama: nama || '', kodeRak: kodeRak || '', bulan: bulan || '',
      jumlah: Number(jumlah), keterangan: keterangan || '', oleh, waktu });
    res.json(data.success ? { success: true, message: data.message, oleh, dicatatPada: waktu }
                          : { success: false, message: data.message || 'Gagal simpan.' });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// POST /api/pindah/tandai — tanda "sedang dihitung" { kodeRak, aksi: 'buka'|'tutup' }
app.post('/api/pindah/tandai', requireAuth, async (req, res) => {
  const { kodeRak, aksi } = req.body;
  if (!kodeRak) return res.status(400).json({ success: false, message: 'kodeRak wajib.' });
  try {
    const data = await pindahPost({
      action: 'pgTandai', kodeRak, aksi: aksi === 'tutup' ? 'tutup' : 'buka', oleh: req.sessionUser.username,
      perangkat: String(req.body.perangkat || '').slice(0, 60), jenis: String(req.body.jenis || '').slice(0, 30)
    }, 20000);
    res.json({ success: !!data.success, message: data.message || '' });
  } catch (err) {
    res.status(500).json({ success: false, message: pesanErrorPindah(err) });
  }
});

// =============================================
// GUDANG INSIGHT
// =============================================

// Helper buat timestamp dari tanggal string YYYY-MM-DD
function dateToTimestamp(dateStr, isEnd = false) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (isEnd) return new Date(y, m-1, d, 23, 59, 59, 999).getTime();
  return new Date(y, m-1, d, 0, 0, 0, 0).getTime();
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

async function getTeamNames(token) {
  const age = Date.now() - teamNameCache.time;
  if (teamNameCache.time > 0 && age < 60 * 60 * 1000) return teamNameCache.map;

  try {
    // Body persis dari cURL intercept: field1 = 20-byte session fingerprint
    const body = Buffer.from('0a142c2f453d4c304b3f1f4d3b2d3e33425062343248', 'hex');
    const res = await axios.post(
      `${SHARED_SERVICE_URL}/common.v1.TeamService/PublicTeamIDs`,
      body,
      {
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
      }
    );
    const buf = Buffer.from(res.data);
    console.log('✅ [TEAM NAMES] Response length:', buf.length, 'hex[:100]:', buf.slice(0, 100).toString('hex'));
    const map = decodePublicTeamIDs(buf);
    if (Object.keys(map).length > 0) {
      teamNameCache.map  = map;
      teamNameCache.time = Date.now();
      console.log('✅ [TEAM NAMES] Loaded', Object.keys(map).length, 'teams');
    }
    return map;
  } catch (err) {
    console.error('⚠️ [TEAM NAMES] Gagal fetch, pakai "Tim {id}":', err.message);
    return teamNameCache.map; // fallback ke cache lama atau kosong
  }
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
            if (sfn === 2) tname = sl.data.toString('utf8');
          } else if (swt === 1) { sp += 8; }
          else if (swt === 5) { sp += 4; }
          else break;
        }
        if (tid && tname) map[tid] = tname;
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
    console.log('🔍 [SELLING] Mencoba login dengan body:', JSON.stringify({ ...loginBody, password: '***' }));
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
    console.log('🔍 [SELLING] Login response keys:', Object.keys(d || {}));
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

  // Field4: {field1: 1}
  const field4 = encodeInt32Field(1, 1);

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
      if (fieldNum === 8) {
        // field8 berisi repeated field1 = team entries
        parseTeamEntries(ld.data, teams);
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
            // skip nested (field6 = timestamp range)
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
  team.team_name = `Tim ${team.team_id}`;
  return team;
}

// DEBUG: endpoint tanpa auth untuk inspect raw response — hapus setelah selesai debug
app.get('/api/selling/raw-debug', async (req, res) => {
  try {
    const token = await getSellingToken();
    if (!token) return res.json({ error: 'Login gagal' });

    // Gunakan tanggal hari ini sebagai test
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm   = String(today.getMonth() + 1).padStart(2, '0');
    const dd   = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const timeStartSec = Math.floor(dateToTimestamp(dateStr, false) / 1000);
    const timeEndSec   = Math.floor(dateToTimestamp(dateStr, true)  / 1000);
    const protoBody = encodeTeamStatMetricRequest(timeStartSec, timeEndSec);

    console.log('🔍 [DEBUG] Request hex:', protoBody.toString('hex'));

    const apiRes = await axios.post(
      `${SELLING_BASE_URL}/selling_iface.v1.SellingStatService/TeamStatMetric`,
      protoBody,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
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

    const rawBuf = Buffer.from(apiRes.data);
    const hexFull = rawBuf.toString('hex');

    res.json({
      http_status: apiRes.status,
      response_headers: apiRes.headers,
      buffer_length: rawBuf.length,
      hex_preview: hexFull.slice(0, 500),
      hex_full: hexFull,
      request_hex: protoBody.toString('hex'),
      timeStartSec,
      timeEndSec
    });
  } catch (err) {
    res.json({
      error: err.message,
      status: err.response?.status,
      body: err.response?.data ? Buffer.from(err.response.data).toString('utf8') : null
    });
  }
});

// GET /api/selling/team-stat?date_from=2026-01-01&date_to=2026-10-16
app.get('/api/selling/team-stat', requireAuth, async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) {
      return res.status(400).json({ success: false, message: 'date_from dan date_to wajib diisi.' });
    }

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
    console.log('🔍 [SELLING] Response status:', apiRes.status);
    console.log('🔍 [SELLING] Raw buffer length:', rawBuf.length);
    console.log('🔍 [SELLING] Raw hex (first 300 bytes):', rawBuf.slice(0, 300).toString('hex'));

    const teams  = decodeTeamStatMetricResponse(rawBuf);
    console.log('🔍 [SELLING] Teams parsed:', teams.length, JSON.stringify(teams.slice(0,2)));

    // Ambil nama tim dari PublicTeamIDs (di-cache 1 jam)
    const nameMap = await getTeamNames(token);
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
});

// Fallback route
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

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

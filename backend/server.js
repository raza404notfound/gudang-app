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
  'SUPERUSER_KEY',  'SHEET_SCRIPT_URL'
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
const tokenCache   = {};
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
  if (tokenCache[wh.id]) return tokenCache[wh.id];
  if (!wh.username || !wh.password) {
    console.error(`❌ [LOGIN GAGAL] ${wh.name}: username/password belum diisi di Railway.`);
    return null;
  }
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
    if (token) {
      tokenCache[wh.id] = token;
      console.log(`✅ [LOGIN SUKSES] ${wh.name}`);
      return token;
    }
  } catch (err) {
    console.error(`❌ [LOGIN GAGAL] ${wh.name}:`, err.response?.data?.message || err.message);
  }
  return null;
}

async function fetchOverview(type, wh) {
  const token = await getWarehouseToken(wh);
  if (!token) return { total_trx: 0, status_error: 'Login Failed' };

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
    return { total_trx: parseTotalTrx(rawData), details: rawData };
  } catch (err) {
    return { total_trx: 0, status_error: err.response?.data?.message || 'Access Restricted' };
  }
}

async function getFreshDashboardData(type) {
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

// GET /api/dashboard
app.get('/api/dashboard', async (req, res) => {
  try {
    const type = req.query.type;
    const forceRefresh = req.query.force === 'true';
    const now = Date.now();

    if (type === 'inbound' || type === 'outbound') {
      if (dashboardCache[type] && (now - lastCacheTime[type] < CACHE_DURATION) && !forceRefresh) {
        return res.json(dashboardCache[type]);
      }
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

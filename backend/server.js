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
      return { resi: resiClean, status, note, success: true };
    } catch (err) {
      try {
        const fallback = await axios.get(
          `https://api.biteship.com/v1/trackings/${resiClean}`,
          { headers: { 'Authorization': BITESHIP_API_KEY, 'Content-Type': 'application/json' }, timeout: 12000 }
        );
        const data = fallback.data;
        const history = data?.history || [];
        return { resi: resiClean, status: data.status || 'Unknown', note: history.length > 0 ? history[history.length - 1].note : 'Data dimuat', success: true };
      } catch (fallbackErr) {
        return { resi: resiClean, status: 'Gagal Cek', note: fallbackErr.response?.data?.message || 'Gagal API / Resi Tidak Ditemukan', success: false };
      }
    }
  });

  const results = await Promise.all(promises);
  res.json({ success: true, data: results.filter(Boolean) });
});

// =============================================
// SISTEM AUTENTIKASI
// Akun disimpan di file users.json (Railway Volume)
// =============================================
const USERS_FILE = path.join(__dirname, 'users.json');
const SUPERUSER  = 'raza404nf';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// Buat akun superuser otomatis saat server pertama kali jalan
function initSuperuser() {
  const users = readUsers();
  if (!users[SUPERUSER]) {
    const defaultPass = SUPERUSER_KEY || 'Admin@PDC2024';
    users[SUPERUSER] = {
      password: hashPassword(defaultPass),
      role: 'superuser',
      createdAt: new Date().toISOString()
    };
    writeUsers(users);
    console.log(`✅ [AUTH] Akun superuser '${SUPERUSER}' berhasil dibuat.`);
  }
}
initSuperuser();

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
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }

  const users = readUsers();
  const user  = users[username.trim()];

  if (!user || user.password !== hashPassword(password)) {
    return res.status(401).json({ success: false, message: 'Username atau Password salah!' });
  }

  const token = generateToken();
  activeSessions[token] = { username: username.trim(), role: user.role };
  res.json({ success: true, token, username: username.trim(), role: user.role });
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
app.get('/api/users', requireSuperuser, (req, res) => {
  const users = readUsers();
  const list = Object.entries(users).map(([username, data]) => ({
    username, role: data.role, createdAt: data.createdAt
  }));
  res.json({ success: true, data: list });
});

// POST /api/users (superuser only)
app.post('/api/users', requireSuperuser, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi.' });
  }
  const users = readUsers();
  if (users[username.trim()]) {
    return res.status(409).json({ success: false, message: 'Username sudah terdaftar.' });
  }
  users[username.trim()] = {
    password: hashPassword(password),
    role: role === 'superuser' ? 'superuser' : role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };
  writeUsers(users);
  res.json({ success: true, message: `Akun '${username.trim()}' berhasil dibuat.` });
});

// DELETE /api/users/:username (superuser only)
app.delete('/api/users/:username', requireSuperuser, (req, res) => {
  const target = req.params.username;
  if (target === SUPERUSER) {
    return res.status(403).json({ success: false, message: 'Akun superuser tidak bisa dihapus.' });
  }
  const users = readUsers();
  if (!users[target]) {
    return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
  }
  delete users[target];
  // Hapus sesi aktif user yang dihapus
  Object.keys(activeSessions).forEach(token => {
    if (activeSessions[token].username === target) delete activeSessions[token];
  });
  writeUsers(users);
  res.json({ success: true, message: `Akun '${target}' berhasil dihapus.` });
});

// PUT /api/users/:username/password (superuser only)
app.put('/api/users/:username/password', requireSuperuser, (req, res) => {
  const target = req.params.username;
  const { password } = req.body;
  if (!password) return res.status(400).json({ success: false, message: 'Password baru wajib diisi.' });
  const users = readUsers();
  if (!users[target]) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
  users[target].password = hashPassword(password);
  writeUsers(users);
  res.json({ success: true, message: `Password akun '${target}' berhasil diubah.` });
});

// =============================================
// PROXY KE GOOGLE APPS SCRIPT
// =============================================

// GET /api/sheet/load
app.get('/api/sheet/load', requireAuth, async (req, res) => {
  const { tanggal, gudang, filter, onlyPending } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum dikonfigurasi di Railway Variables.' });

  try {
    const params = { action: 'load', tanggal };
    if (gudang)      params.gudang      = gudang;
    if (filter)      params.filter      = filter;
    if (onlyPending) params.onlyPending = onlyPending;

    const response = await axios.get(SHEET_SCRIPT_URL, { params, timeout: 15000 });
    const data = response.data;
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data dari Sheet.' });
    res.json({ success: true, rows: data.rows || [] });
  } catch (err) {
    console.error('Sheet load error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// POST /api/sheet/sync
app.post('/api/sheet/sync', requireAuth, async (req, res) => {
  const { tanggal, data: trackData } = req.body;
  if (!tanggal || !Array.isArray(trackData)) return res.status(400).json({ success: false, message: 'Data tidak valid.' });
  if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum dikonfigurasi di Railway Variables.' });

  try {
    const response = await axios.post(SHEET_SCRIPT_URL, {
      action: 'sync',
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
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });

    const result = response.data;
    res.json({ success: result.success, message: result.message || 'Selesai.' });
  } catch (err) {
    console.error('Sheet sync error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// GET /api/sheet/cancel-list (untuk fitur Lacak Cancel)
app.get('/api/sheet/cancel-list', requireAuth, async (req, res) => {
  const { tanggal, gudang } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum dikonfigurasi di Railway Variables.' });

  try {
    const params = { action: 'cancelList', tanggal };
    if (gudang) params.gudang = gudang;

    const response = await axios.get(SHEET_SCRIPT_URL, { params, timeout: 15000 });
    const data = response.data;
    if (!data.success) return res.json({ success: false, message: data.message || 'Gagal ambil data cancel.' });
    res.json({ success: true, rows: data.rows || [] });
  } catch (err) {
    console.error('Cancel list error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
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

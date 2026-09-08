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

// Mengarahkan file statis (HTML/CSS/JS Client) ke folder public di luar backend
app.use(express.static(path.join(__dirname, '../public')));

const BASE_URL = 'https://pdcgudang.et.r.appspot.com/v1';

// Konfigurasi API Key Biteship — diambil dari Railway Environment Variables
const BITESHIP_API_KEY = process.env.BITESHIP_API_KEY;

// Kredensial gudang — diambil dari Railway Environment Variables
// Daftarkan di Railway: Settings > Variables
const WAREHOUSES = [
  { id: 'pdc',    name: 'PDC Warehouse',   username: process.env.WH_PDC_USER,    password: process.env.WH_PDC_PASS,    warehouse_id: '38' },
  { id: 'febri',  name: 'Febri Warehouse', username: process.env.WH_FEBRI_USER,  password: process.env.WH_FEBRI_PASS,  warehouse_id: '67' },
  { id: 'palem',  name: 'Palem Warehouse', username: process.env.WH_PALEM_USER,  password: process.env.WH_PALEM_PASS,  warehouse_id: '94' },
  { id: 'cemara', name: 'Cemara Warehouse',username: process.env.WH_CEMARA_USER, password: process.env.WH_CEMARA_PASS, warehouse_id: '96' }
];

// Validasi Environment Variables saat server pertama kali jalan
const REQUIRED_ENV = [
  'BITESHIP_API_KEY',
  'WH_PDC_USER',    'WH_PDC_PASS',
  'WH_FEBRI_USER',  'WH_FEBRI_PASS',
  'WH_PALEM_USER',  'WH_PALEM_PASS',
  'WH_CEMARA_USER', 'WH_CEMARA_PASS'
];
const MISSING_ENV = REQUIRED_ENV.filter(key => !process.env[key]);
if (MISSING_ENV.length > 0) {
  console.warn('⚠️  [ENV WARNING] Variable berikut belum diisi di Railway:');
  MISSING_ENV.forEach(key => console.warn(`   - ${key}`));
  console.warn('   Server tetap jalan, tapi fitur terkait tidak akan berfungsi.');
}

const tokenCache = {};
const dashboardCache = { inbound: null, outbound: null };
const lastCacheTime = { inbound: 0, outbound: 0 };
const CACHE_DURATION = 60 * 1000;

function getTodayTimestamps() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  return { time_min: startOfDay, time_max: endOfDay };
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
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
  };

  const url = `${BASE_URL}/warehouses/insight/overview?type=${type}&time_min=${time_min}&time_max=${time_max}&warehouse_id=${wh.warehouse_id}`;

  try {
    const res = await axios.get(url, { headers });
    const rawData = res.data?.data || res.data;
    
    return {
      total_trx: parseTotalTrx(rawData),
      details: rawData
    };
  } catch (err) {
    return {
      total_trx: 0,
      status_error: err.response?.data?.message || 'Access Restricted'
    };
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

      return {
        id: wh.id,
        name: wh.name,
        data: {
          inbound: inboundData,
          outbound: outboundData
        }
      };
    })
  );

  let totalInboundTrx = 0;
  let totalOutboundTrx = 0;

  results.forEach(item => {
    if (item.data?.inbound) {
      totalInboundTrx += item.data.inbound.total_trx || 0;
    }
    if (item.data?.outbound) {
      totalOutboundTrx += item.data.outbound.total_trx || 0;
    }
  });

  return {
    summary: { totalOutboundTrx, totalInboundTrx },
    warehouses: results,
    cached_at: new Date().toLocaleTimeString()
  };
}

// Endpoint Dashboard
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

    const data = await getFreshDashboardData();
    res.json(data);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Endpoint Backend Pelacakan Bulk Resi Biteship (Adaptasi Logika Appscript & Timeout Handling)
app.post('/api/track-awb-chunk', async (req, res) => {
  const { batchResi, kurir = 'jnt' } = req.body;

  if (!Array.isArray(batchResi) || batchResi.length === 0) {
    return res.json({ success: false, data: [] });
  }

  const promises = batchResi.map(async (r) => {
    const resiClean = String(r).trim();
    if (!resiClean) return null;

    try {
      const response = await axios.get(`https://api.biteship.com/v1/trackings/${resiClean}/couriers/${kurir}`, {
        headers: {
          'Authorization': BITESHIP_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      });

      const data = response.data;
      let status = "Unknown";
      let note = "Data dimuat";

      if (data && data.success) {
        status = data.status || "Unknown";
        const history = data.history || [];
        note = (history.length > 0) ? history[history.length - 1].note : "Data dimuat";
      } else {
        status = "Gagal API";
        note = data.error || data.message || "Gagal mendapatkan data";
      }

      return { resi: resiClean, status: status, note: note, success: true };
    } catch (err) {
      // Fallback ke endpoint pelacakan standar jika endpoint spesifik kurir melempar error
      try {
        const fallbackRes = await axios.get(`https://api.biteship.com/v1/trackings/${resiClean}`, {
          headers: {
            'Authorization': BITESHIP_API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 12000
        });

        const data = fallbackRes.data;
        const status = data.status || "Unknown";
        const history = data.history || [];
        const note = (history.length > 0) ? history[history.length - 1].note : "Data dimuat";
        return { resi: resiClean, status: status, note: note, success: true };
      } catch (fallbackErr) {
        const noteErr = fallbackErr.response?.data?.message || fallbackErr.response?.data?.error || "Gagal API / Resi Tidak Ditemukan";
        return { resi: resiClean, status: "Gagal Cek", note: noteErr, success: false };
      }
    }
  });

  const results = await Promise.all(promises);
  res.json({ success: true, data: results.filter(Boolean) });
});

// =============================================
// SISTEM AUTENTIKASI — Data disimpan di Railway
// =============================================

const USERS_FILE = path.join(__dirname, 'users.json');
const SUPERUSER = 'raza404nf';

// Hash password pakai SHA-256
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Baca data user dari file
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return {};
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

// Simpan data user ke file
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// Inisialisasi akun superuser otomatis jika belum ada
function initSuperuser() {
  const users = readUsers();
  if (!users[SUPERUSER]) {
    const defaultPass = process.env.SUPERUSER_KEY || 'Admin@PDC2024';
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

// Middleware cek session token sederhana (in-memory)
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
  const user = users[username.trim()];

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

// GET /api/auth/me — cek sesi masih valid
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, username: req.sessionUser.username, role: req.sessionUser.role });
});

// GET /api/users — daftar semua user (superuser only)
app.get('/api/users', requireSuperuser, (req, res) => {
  const users = readUsers();
  const list = Object.entries(users).map(([username, data]) => ({
    username,
    role: data.role,
    createdAt: data.createdAt
  }));
  res.json({ success: true, data: list });
});

// POST /api/users — buat akun baru (superuser only)
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

// DELETE /api/users/:username — hapus akun (superuser only, tidak bisa hapus diri sendiri)
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
  writeUsers(users);

  // Hapus sesi aktif user yang dihapus
  Object.keys(activeSessions).forEach(token => {
    if (activeSessions[token].username === target) delete activeSessions[token];
  });

  res.json({ success: true, message: `Akun '${target}' berhasil dihapus.` });
});

// PUT /api/users/:username/password — ganti password (superuser only)
app.put('/api/users/:username/password', requireSuperuser, (req, res) => {
  const { password } = req.body;
  const target = req.params.username;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password baru wajib diisi.' });
  }

  const users = readUsers();
  if (!users[target]) {
    return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
  }

  users[target].password = hashPassword(password);
  writeUsers(users);

  res.json({ success: true, message: `Password akun '${target}' berhasil diubah.` });
});

// =============================================
// GOOGLE SHEETS INTEGRATION
// =============================================
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || '';

// GET /api/sheet/load?tanggal=YYYY-MM-DD
app.get('/api/sheet/load', requireAuth, async (req, res) => {
  const { tanggal } = req.query;
  if (!tanggal) return res.status(400).json({ success: false, message: 'Parameter tanggal wajib diisi.' });
  if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum dikonfigurasi di Railway Variables.' });

  try {
    const response = await axios.get(SHEET_SCRIPT_URL, {
      params: { action: 'load', tanggal },
      timeout: 15000
    });

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
        tanggal: item.tanggal,
        resi: item.resi,
        status: item.status,
        catatan: item.note,
        waktuUpdate: item.waktuUpdate
      }))
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000
    });

    const result = response.data;
    res.json({ success: result.success, message: result.message || 'Selesai.' });
  } catch (err) {
    console.error('Sheet sync error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke Google Apps Script.' });
  }
});

// Fallback route
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Server Proxy PDC berjalan di http://localhost:${PORT}`);
  console.log(`========================================`);
});

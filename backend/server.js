const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// ===== DATA DIRECTORY =====
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ===== KV STORE (untuk data lain) =====
const STORE_FILE = path.join(DATA_DIR, 'store.json');
function loadStore() {
  if (fs.existsSync(STORE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')); } catch(e) { return {}; }
  }
  return {};
}
function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
let kvStore = loadStore();

// ===== USER MANAGEMENT =====
const USERS_FILE = path.join(DATA_DIR, 'users.json');
function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')); } catch(e) {}
  }
  // Buat superuser default jika belum ada
  const defaultUsers = [
    { username: 'admin', password: 'admin123', role: 'superuser', createdAt: new Date().toISOString() }
  ];
  fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
  return defaultUsers;
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
let users = loadUsers();

// ===== SESSION STORE (in-memory) =====
const sessions = {};

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve file statis dari folder public
app.use(express.static(path.join(__dirname, '../public')));

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || !sessions[token]) {
    return res.status(401).json({ success: false, message: 'Tidak terautentikasi.' });
  }
  req.sessionUser = sessions[token];
  next();
}

function requireSuperuser(req, res, next) {
  if (req.sessionUser.role !== 'superuser') {
    return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya superuser.' });
  }
  next();
}

// =============================================
// AUTH ENDPOINTS
// =============================================

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.json({ success: false, message: 'Username dan password wajib diisi.' });
  }
  const user = users.find(u => u.username === username && u.password === password);
  if (!user) {
    return res.json({ success: false, message: 'Username atau password salah!' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { username: user.username, role: user.role };
  console.log(`✅ [LOGIN] ${user.username} (${user.role})`);
  res.json({ success: true, token, username: user.username, role: user.role });
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  const token = req.headers['x-session-token'];
  if (!token || !sessions[token]) {
    return res.json({ success: false, message: 'Token tidak valid.' });
  }
  res.json({ success: true, ...sessions[token] });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token && sessions[token]) {
    console.log(`👋 [LOGOUT] ${sessions[token].username}`);
    delete sessions[token];
  }
  res.json({ success: true });
});

// =============================================
// USER MANAGEMENT ENDPOINTS (Superuser Only)
// =============================================

// GET /api/users
app.get('/api/users', requireAuth, requireSuperuser, (req, res) => {
  res.json({
    success: true,
    data: users.map(u => ({ username: u.username, role: u.role, createdAt: u.createdAt }))
  });
});

// POST /api/users
app.post('/api/users', requireAuth, requireSuperuser, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.json({ success: false, message: 'Username dan password wajib diisi.' });
  }
  if (users.find(u => u.username === username)) {
    return res.json({ success: false, message: `Username "${username}" sudah terdaftar.` });
  }
  const validRoles = ['user', 'admin', 'superuser'];
  const newRole = validRoles.includes(role) ? role : 'user';
  users.push({ username, password, role: newRole, createdAt: new Date().toISOString() });
  saveUsers(users);
  console.log(`➕ [CREATE USER] ${username} (${newRole})`);
  res.json({ success: true, message: `Akun "${username}" berhasil dibuat.` });
});

// DELETE /api/users/:username
app.delete('/api/users/:username', requireAuth, requireSuperuser, (req, res) => {
  const { username } = req.params;
  const target = users.find(u => u.username === username);
  if (!target) {
    return res.json({ success: false, message: 'Akun tidak ditemukan.' });
  }
  if (target.role === 'superuser') {
    return res.json({ success: false, message: 'Tidak bisa menghapus akun superuser.' });
  }
  users = users.filter(u => u.username !== username);
  saveUsers(users);
  console.log(`🗑️ [DELETE USER] ${username}`);
  res.json({ success: true, message: `Akun "${username}" berhasil dihapus.` });
});

// =============================================
// KV STORE ENDPOINTS
// =============================================

app.get('/api/store', (req, res) => {
  res.json({ success: true, value: kvStore });
});

app.post('/api/store/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  kvStore[key] = value;
  saveStore(kvStore);
  res.json({ success: true });
});

// =============================================
// WAREHOUSE CONFIG
// =============================================
const BASE_URL = 'https://pdcgudang.et.r.appspot.com/v1';

const BITESHIP_API_KEY = process.env.BITESHIP_API_KEY || 'biteship_live.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiam50IiwidXNlcklkIjoiNmExYmY4NzRkZDIyMDU1ODRmMDg4ZDk0IiwiaWF0IjoxNzgzOTE4ODQ2fQ.Bbx33UZxpcN4IjxWWOlpQDQaJlPy-wSOPFjy46DCGkY';

const WAREHOUSES = [
  { id: 'pdc',    name: 'PDC Warehouse',   username: 'warehousepdc',  password: 'Restuibu123',    warehouse_id: '38' },
  { id: 'febri',  name: 'Febri Warehouse', username: 'febriwarehouse', password: 'Gudang02',       warehouse_id: '67' },
  { id: 'palem',  name: 'Palem Warehouse', username: 'palemwarehouse', password: 'Kitabisa123',    warehouse_id: '94' },
  { id: 'cemara', name: 'Cemara Warehouse',username: 'odiiza',         password: 'Disembodied38',  warehouse_id: '96' }
];

const tokenCache = {};
const dashboardCache = { inbound: null, outbound: null };
const lastCacheTime = { inbound: 0, outbound: 0 };
const CACHE_DURATION = 60 * 1000;

function getTodayTimestamps() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const endOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
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
      console.log(`✅ [WH LOGIN OK] ${wh.name}`);
      return token;
    }
  } catch (err) {
    console.error(`❌ [WH LOGIN FAIL] ${wh.name}:`, err.response?.data?.message || err.message);
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
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
  let totalInboundTrx = 0;
  let totalOutboundTrx = 0;
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
// DASHBOARD ENDPOINT
// =============================================
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
    console.error('Error dashboard:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// =============================================
// TRACKING AWB ENDPOINT
// =============================================
app.post('/api/track-awb-chunk', async (req, res) => {
  const { batchResi, kurir = 'jnt' } = req.body;
  if (!Array.isArray(batchResi) || batchResi.length === 0) {
    return res.json({ success: false, data: [] });
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
      let status = 'Unknown';
      let note = 'Data dimuat';
      if (data && data.success) {
        status = data.status || 'Unknown';
        const history = data.history || [];
        note = history.length > 0 ? history[history.length - 1].note : 'Data dimuat';
      } else {
        status = 'Gagal API';
        note = data.error || data.message || 'Gagal mendapatkan data';
      }
      return { resi: resiClean, status, note, success: true };
    } catch (err) {
      try {
        const fallbackRes = await axios.get(
          `https://api.biteship.com/v1/trackings/${resiClean}`,
          { headers: { 'Authorization': BITESHIP_API_KEY, 'Content-Type': 'application/json' }, timeout: 12000 }
        );
        const data = fallbackRes.data;
        const status = data.status || 'Unknown';
        const history = data.history || [];
        const note = history.length > 0 ? history[history.length - 1].note : 'Data dimuat';
        return { resi: resiClean, status, note, success: true };
      } catch (fallbackErr) {
        const noteErr = fallbackErr.response?.data?.message || fallbackErr.response?.data?.error || 'Gagal API / Resi Tidak Ditemukan';
        return { resi: resiClean, status: 'Gagal Cek', note: noteErr, success: false };
      }
    }
  });
  const results = await Promise.all(promises);
  res.json({ success: true, data: results.filter(Boolean) });
});

// =============================================
// FALLBACK — Serve index.html untuk SPA
// =============================================
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// =============================================
// START SERVER
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`✅ Server PDC Warehouse berjalan di port ${PORT}`);
  console.log(`📁 Data dir: ${DATA_DIR}`);
  console.log(`👤 Default login: admin / admin123`);
  console.log(`========================================`);
});

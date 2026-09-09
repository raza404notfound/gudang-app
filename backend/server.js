const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();

// =============================================
// PENYIMPANAN PERSISTENT (data umum, opsional)
// DATA_DIR diarahkan ke Railway Volume lewat env var DATA_DIR (contoh: /data)
// =============================================
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = path.join(DATA_DIR, 'store.json');

function loadStore() {
  if (fs.existsSync(STORE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    } catch (e) {
      console.error('Gagal membaca store.json, menggunakan store kosong:', e.message);
      return {};
    }
  }
  return {};
}
function saveStore(store) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}
let kvStore = loadStore();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// =============================================
// KONFIGURASI DARI ENVIRONMENT VARIABLES (Railway)
// TIDAK ADA CREDENTIAL YANG DITULIS LANGSUNG DI SINI.
// Semua nilai WAJIB diisi di Railway -> tab Variables.
// =============================================
const BITESHIP_API_KEY = process.env.BITESHIP_API_KEY || '';
const SHEET_SCRIPT_URL = process.env.SHEET_SCRIPT_URL || ''; // URL deploy Web App Apps Script (.../exec)
const SUPERUSER_USERNAME = process.env.SUPERUSER_USERNAME || 'raza404nf'; // default sesuai catatan project
const SUPERUSER_KEY = process.env.SUPERUSER_KEY || ''; // password superuser
const PASSWORD_SALT = process.env.PASSWORD_SALT || 'ganti-salt-ini-di-railway';

const BASE_URL = 'https://pdcgudang.et.r.appspot.com/v1';

const WAREHOUSES = [
  { id: 'pdc',    name: 'PDC Warehouse',    username: process.env.WH_PDC_USER    || '', password: process.env.WH_PDC_PASS    || '', warehouse_id: '38' },
  { id: 'febri',  name: 'Febri Warehouse',  username: process.env.WH_FEBRI_USER  || '', password: process.env.WH_FEBRI_PASS  || '', warehouse_id: '67' },
  { id: 'palem',  name: 'Palem Warehouse',  username: process.env.WH_PALEM_USER  || '', password: process.env.WH_PALEM_PASS  || '', warehouse_id: '94' },
  { id: 'cemara', name: 'Cemara Warehouse', username: process.env.WH_CEMARA_USER || '', password: process.env.WH_CEMARA_PASS || '', warehouse_id: '96' }
];

// Peringatan di log kalau ada env var penting yang belum diisi (bukan error fatal,
// supaya server tetap bisa jalan untuk fitur lain yang tidak butuh itu)
function warnIfMissing(name, val) {
  if (!val) console.warn(`⚠️  Environment variable "${name}" belum diisi di Railway.`);
}
warnIfMissing('BITESHIP_API_KEY', BITESHIP_API_KEY);
warnIfMissing('SHEET_SCRIPT_URL', SHEET_SCRIPT_URL);
warnIfMissing('SUPERUSER_KEY', SUPERUSER_KEY);
warnIfMissing('PASSWORD_SALT', PASSWORD_SALT !== 'ganti-salt-ini-di-railway' ? PASSWORD_SALT : '');
WAREHOUSES.forEach(wh => {
  warnIfMissing(`WH_${wh.id.toUpperCase()}_USER`, wh.username);
  warnIfMissing(`WH_${wh.id.toUpperCase()}_PASS`, wh.password);
});

// =============================================
// SESSION & AUTH (token disimpan di memory server)
// Catatan: saat Railway redeploy, semua session hilang (user perlu login ulang).
// Ini konsisten dengan cara kerja sebelumnya, bukan bug baru.
// =============================================
const sessions = {}; // token -> { username, role, createdAt }

function hashPassword(plain) {
  return crypto.createHash('sha256').update(plain + PASSWORD_SALT).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  const session = token && sessions[token];
  if (!session) return res.status(401).json({ success: false, message: 'Sesi tidak valid, silakan login ulang.' });
  req.session = session;
  next();
}

function requireSuperuser(req, res, next) {
  if (req.session.role !== 'superuser') {
    return res.status(403).json({ success: false, message: 'Hanya superuser yang boleh mengakses fitur ini.' });
  }
  next();
}

// Ambil daftar user dari Apps Script (tab _Akun)
async function fetchUsersFromSheet() {
  if (!SHEET_SCRIPT_URL) throw new Error('SHEET_SCRIPT_URL belum diatur di Railway.');
  const res = await axios.get(SHEET_SCRIPT_URL, { params: { action: 'getUsers' }, timeout: 15000 });
  if (!res.data || !res.data.success) throw new Error(res.data?.message || 'Gagal mengambil data akun.');
  return res.data.users || {};
}

// Simpan seluruh daftar user ke Apps Script (tab _Akun)
async function saveUsersToSheet(users) {
  if (!SHEET_SCRIPT_URL) throw new Error('SHEET_SCRIPT_URL belum diatur di Railway.');
  const res = await axios.post(SHEET_SCRIPT_URL, { action: 'saveUsers', users }, { timeout: 15000 });
  if (!res.data || !res.data.success) throw new Error(res.data?.message || 'Gagal menyimpan data akun.');
  return res.data;
}

// ---- POST /api/auth/login ----
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json({ success: false, message: 'Username & Password wajib diisi!' });
    }

    // Jalur bootstrap superuser lewat Environment Variable (tidak perlu ada di sheet dulu)
    if (SUPERUSER_KEY &&
        username === SUPERUSER_USERNAME && password === SUPERUSER_KEY) {
      const token = generateToken();
      sessions[token] = { username, role: 'superuser', createdAt: Date.now() };
      return res.json({ success: true, token, username, role: 'superuser' });
    }

    const users = await fetchUsersFromSheet();
    const account = users[username];
    if (!account || account.password !== hashPassword(password)) {
      return res.json({ success: false, message: 'Username atau Password salah!' });
    }

    const token = generateToken();
    sessions[token] = { username, role: account.role || 'user', createdAt: Date.now() };
    res.json({ success: true, token, username, role: account.role || 'user' });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal terhubung ke server akun.' });
  }
});

// ---- GET /api/auth/me ----
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ success: true, username: req.session.username, role: req.session.role });
});

// ---- POST /api/auth/logout ----
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers['x-session-token'];
  if (token) delete sessions[token];
  res.json({ success: true });
});

// ---- GET /api/users (daftar akun, khusus superuser) ----
app.get('/api/users', requireAuth, requireSuperuser, async (req, res) => {
  try {
    const users = await fetchUsersFromSheet();
    const data = Object.entries(users).map(([username, d]) => ({
      username, role: d.role || 'user', createdAt: d.createdAt || ''
    }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---- POST /api/users (buat akun baru, khusus superuser) ----
app.post('/api/users', requireAuth, requireSuperuser, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.json({ success: false, message: 'Username & Password wajib diisi!' });
    }
    const users = await fetchUsersFromSheet();
    if (users[username]) {
      return res.json({ success: false, message: 'Username sudah terdaftar!' });
    }
    users[username] = {
      password: hashPassword(password),
      role: role || 'user',
      createdAt: new Date().toISOString()
    };
    await saveUsersToSheet(users);
    res.json({ success: true, message: `Akun "${username}" berhasil dibuat.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---- DELETE /api/users/:username (hapus akun, khusus superuser) ----
app.delete('/api/users/:username', requireAuth, requireSuperuser, async (req, res) => {
  try {
    const { username } = req.params;
    const users = await fetchUsersFromSheet();
    if (!users[username]) {
      return res.json({ success: false, message: 'Akun tidak ditemukan.' });
    }
    delete users[username];
    await saveUsersToSheet(users);
    res.json({ success: true, message: `Akun "${username}" berhasil dihapus.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================================
// PROXY KE GOOGLE APPS SCRIPT (Sheet Tracking AWB)
// =============================================

// ---- GET /api/sheet/load ----
app.get('/api/sheet/load', requireAuth, async (req, res) => {
  try {
    if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum diatur di Railway.' });
    const { tanggal, gudang, filter, onlyPending } = req.query;
    const result = await axios.get(SHEET_SCRIPT_URL, {
      params: { action: 'load', tanggal, gudang, filter, onlyPending },
      timeout: 20000
    });
    res.json(result.data);
  } catch (err) {
    console.error('Sheet load error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal mengambil data dari Sheet.' });
  }
});

// ---- POST /api/sheet/sync ----
app.post('/api/sheet/sync', requireAuth, async (req, res) => {
  try {
    if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum diatur di Railway.' });
    const { tanggal, data } = req.body; // frontend mengirim field "data", Apps Script butuh "rows"
    const result = await axios.post(SHEET_SCRIPT_URL, {
      action: 'sync',
      tanggal,
      rows: data
    }, { timeout: 20000 });
    res.json(result.data);
  } catch (err) {
    console.error('Sheet sync error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal menyimpan data ke Sheet.' });
  }
});

// ---- GET /api/sheet/cancel-list (untuk fitur Lacak Cancel) ----
app.get('/api/sheet/cancel-list', requireAuth, async (req, res) => {
  try {
    if (!SHEET_SCRIPT_URL) return res.status(500).json({ success: false, message: 'SHEET_SCRIPT_URL belum diatur di Railway.' });
    const { tanggal, gudang } = req.query;
    const result = await axios.get(SHEET_SCRIPT_URL, {
      params: { action: 'cancelList', tanggal, gudang },
      timeout: 20000
    });
    res.json(result.data);
  } catch (err) {
    console.error('Cancel list error:', err.message);
    res.status(500).json({ success: false, message: 'Gagal mengambil data resi cancel.' });
  }
});

// =============================================
// DASHBOARD INBOUND / OUTBOUND (Warehouse Insight)
// =============================================
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
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'
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
    if (item.data?.inbound) totalInboundTrx += item.data.inbound.total_trx || 0;
    if (item.data?.outbound) totalOutboundTrx += item.data.outbound.total_trx || 0;
  });

  return {
    summary: { totalOutboundTrx, totalInboundTrx },
    warehouses: results,
    cached_at: new Date().toLocaleTimeString()
  };
}

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

// =============================================
// TRACKING BULK RESI (Biteship)
// =============================================
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
      const response = await axios.get(`https://api.biteship.com/v1/trackings/${resiClean}/couriers/${kurir}`, {
        headers: { 'Authorization': BITESHIP_API_KEY, 'Content-Type': 'application/json' },
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
      return { resi: resiClean, status, note, success: true };
    } catch (err) {
      try {
        const fallbackRes = await axios.get(`https://api.biteship.com/v1/trackings/${resiClean}`, {
          headers: { 'Authorization': BITESHIP_API_KEY, 'Content-Type': 'application/json' },
          timeout: 12000
        });
        const data = fallbackRes.data;
        const status = data.status || "Unknown";
        const history = data.history || [];
        const note = (history.length > 0) ? history[history.length - 1].note : "Data dimuat";
        return { resi: resiClean, status, note, success: true };
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
// PENYIMPANAN KV UMUM (opsional, untuk fitur lain di masa depan)
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

// Fallback route -> serve index.html (SPA)
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Server PDC Warehouse Admin berjalan di port ${PORT}`);
  console.log(`========================================`);
});

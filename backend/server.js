const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const app = express();

// ===== Penyimpanan Persistent (menggantikan localStorage & object in-memory) =====
// DATA_DIR diarahkan ke Railway Volume lewat env var DATA_DIR (contoh: /data)
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

// Mengarahkan file statis (HTML/CSS/JS Client) ke folder public di luar backend
app.use(express.static(path.join(__dirname, '../public')));

const BASE_URL = 'https://pdcgudang.et.r.appspot.com/v1';

// Konfigurasi API Key Biteship
const BITESHIP_API_KEY = process.env.BITESHIP_API_KEY;

const WAREHOUSES = [
  { id: 'pdc',    name: 'PDC Warehouse',    username: process.env.WH_PDC_USER,    password: process.env.WH_PDC_PASS,    warehouse_id: '38' },
  { id: 'febri',  name: 'Febri Warehouse',  username: process.env.WH_FEBRI_USER,  password: process.env.WH_FEBRI_PASS,  warehouse_id: '67' },
  { id: 'palem',  name: 'Palem Warehouse',  username: process.env.WH_PALEM_USER,  password: process.env.WH_PALEM_PASS,  warehouse_id: '94' },
  { id: 'cemara', name: 'Cemara Warehouse', username: process.env.WH_CEMARA_USER, password: process.env.WH_CEMARA_PASS, warehouse_id: '96' }
];

// Berhenti lebih awal kalau ada env var yang belum terpasang, supaya tidak
// gagal diam-diam saat request pertama.
const WAJIB = [
  'BITESHIP_API_KEY', 'SECURITY_PASSWORD',
  'WH_PDC_USER', 'WH_PDC_PASS',
  'WH_FEBRI_USER', 'WH_FEBRI_PASS',
  'WH_PALEM_USER', 'WH_PALEM_PASS',
  'WH_CEMARA_USER', 'WH_CEMARA_PASS'
];
const kurang = WAJIB.filter(k => !process.env[k]);
if (kurang.length) {
  console.error('Environment variable belum diisi:', kurang.join(', '));
  process.exit(1);
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

// Endpoint Backend Pelacakan Bulk Resi Biteship
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

// Endpoint Store: Ambil SEMUA data tersimpan sekaligus (dipanggil sekali saat halaman dibuka)
app.get('/api/store', (req, res) => {
  res.json({ success: true, value: kvStore });
});

// Endpoint Store: Simpan satu key (menggantikan localStorage.setItem)
app.post('/api/store/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  kvStore[key] = value;
  saveStore(kvStore);
  res.json({ success: true });
});

// ===== VERIFIKASI SANDI KEAMANAN =====
app.post('/api/verify-security', (req, res) => {
  const { password } = req.body || {};
  res.json({ valid: password === process.env.SECURITY_PASSWORD });
});

// ============================================================================
// BLOK FINAL — STOCK OPNAME (TANPA API KEY)
//
// CARA PAKAI:
//   Buka backend/server.js
//   HAPUS baris 268 sampai 348 (dari komentar "===== FITUR BARU: BARANG
//   BERMASALAH ..." sampai tepat SEBELUM komentar "// Fallback route")
//   TEMPEL seluruh isi file ini di posisi itu.
//
// PENTING: blok ini harus berada DI ATAS "app.get(/.*/)" (fallback route).
// Kalau ditaruh di bawahnya, semua request /api/opname/* akan dibalas
// index.html, bukan JSON.
//
// Syarat: spreadsheet di-share "Anyone with the link - Viewer".
// Tidak perlu API key, tidak perlu Google Cloud.
// ============================================================================

const Papa = require('papaparse');
const OPNAME_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1rEz_ZXSjjYaJolp62ilWd9LIdRey7Dszn5YSfHu69-M';

const CEK_MUNDUR_BULAN = 24;              // cek 2 tahun ke belakang
const CACHE_MS = 10 * 60 * 1000;          // cache daftar bulan 10 menit
let cacheMonths = { data: null, waktu: 0 };


// ---------------------------------------------------------------- helper ---

function sumNumbersInText(text) {
  if (!text) return 0;
  const matches = String(text).match(/-?\d+(\.\d+)?/g);
  if (!matches) return 0;
  return matches.reduce((sum, n) => sum + parseFloat(n), 0);
}

function toNumber(val) {
  if (val === undefined || val === null || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// Samakan nama kolom: buang spasi ganda, non-breaking space, beda kapital.
function normKey(k) {
  return String(k || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Ambil nilai kolom walau ejaan headernya sedikit beda.
function pick(row, ...candidates) {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const target = normKey(cand);
    const hit = keys.find(k => normKey(k) === target);
    if (hit !== undefined) return row[hit];
  }
  return '';
}

function gvizUrl(sheetName, range) {
  return `https://docs.google.com/spreadsheets/d/${OPNAME_SHEET_ID}/gviz/tq`
       + `?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`
       + (range ? `&range=${range}` : '');
}

// gviz balas CSV kalau tab ada, balas halaman HTML error kalau tidak ada.
async function tabAda(sheetName) {
  try {
    const res = await axios.get(gvizUrl(sheetName, 'A1:A1'), { timeout: 8000 });
    return !String(res.data || '').trim().startsWith('<');
  } catch (err) {
    return false;
  }
}

function kandidatBulan(jumlah) {
  const hasil = [];
  const now = new Date();
  for (let i = 0; i < jumlah; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    hasil.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return hasil;
}


// ----------------------------------------------------- daftar bulan (dropdown)

app.get('/api/opname/months', async (req, res) => {
  try {
    const paksa = req.query.refresh === '1';
    if (!paksa && cacheMonths.data && (Date.now() - cacheMonths.waktu) < CACHE_MS) {
      return res.json({ success: true, months: cacheMonths.data, _dariCache: true });
    }

    const kandidat = kandidatBulan(CEK_MUNDUR_BULAN);

    const cek = await Promise.all(
      kandidat.map(async (bulan) => ({ bulan, ada: await tabAda(`SO ${bulan}`) }))
    );

    const months = cek
      .filter(c => c.ada)
      .map(c => ({ value: c.bulan, label: `SO ${c.bulan}` }))
      .sort((a, b) => b.value.localeCompare(a.value));

    cacheMonths = { data: months, waktu: Date.now() };

    res.json({ success: true, months, _dicek: kandidat.length });
  } catch (err) {
    console.error('Gagal menyusun daftar bulan opname:', err.message);
    res.status(500).json({
      success: false,
      message: 'Gagal membaca spreadsheet. Pastikan sheet di-share "Anyone with the link - Viewer".'
    });
  }
});


// --------------------------------------------------- data barang bermasalah

app.get('/api/opname/data', async (req, res) => {
  const { month, team } = req.query;
  if (!month) return res.status(400).json({ success: false, message: 'Parameter month wajib diisi.' });

  const sheetName = `SO ${month}`;
  try {
    // Kolom sheet berakhir di T (Tgl Balancing), jadi range A5:T.
    const response = await axios.get(gvizUrl(sheetName, 'A5:T10000'), { timeout: 15000 });
    const body = String(response.data || '').trim();

    if (body.startsWith('<')) {
      return res.status(404).json({
        success: false,
        message: `Tab "${sheetName}" tidak bisa dibaca. Pastikan tab tersebut ada dan sheet bersifat publik.`
      });
    }

    const parsed = Papa.parse(body, { header: true, skipEmptyLines: true });

    const allTeams = new Set();
    let semua = parsed.data.map(row => {
      const sku = String(pick(row, 'SKU', 'Kode SKU') || '').trim();
      // Pakai kolom Tim (D) langsung; prefix SKU cuma cadangan.
      const teamCode = String(pick(row, 'Tim') || sku.split('-')[0] || '').trim();
      if (teamCode) allTeams.add(teamCode);

      const selisihAwal = toNumber(pick(row, 'Selisih Awal'));
      const balancing = sumNumbersInText(pick(row, 'Balancing'));

      return {
        sku,
        rak: pick(row, 'Rak') || '',
        tim: teamCode,
        qtySistem: toNumber(pick(row, 'Qty Sistem')),
        namaProduk: pick(row, 'Nama Produk') || '',
        totalReal: toNumber(pick(row, 'Total Real')),
        selisihAwal,
        balancing,
        sisaSelisih: Math.round((selisihAwal + balancing) * 100) / 100,
        status: pick(row, 'Status') || '',
        tglBalancing: pick(row, 'Tgl Balancing') || ''
      };
    }).filter(r => r.sku);

    // Hanya tampilkan yang punya selisih. Baris yang belum di-opname
    // (Selisih Awal masih kosong) tidak dihitung sebagai barang bermasalah.
    let rows = semua.filter(r => r.selisihAwal !== 0);
    if (team) rows = rows.filter(r => r.tim === team);

    res.json({
      success: true,
      sheetName,
      rows,
      allTeams: Array.from(allTeams).sort(),
      // Info diagnosa: bedakan "kode salah" dari "data belum diisi".
      _totalBarisTerbaca: semua.length,
      _headerTerbaca: parsed.meta.fields
    });
  } catch (err) {
    console.error(`Gagal mengambil data opname untuk ${sheetName}:`, err.message);
    res.status(404).json({
      success: false,
      message: `Data untuk "${sheetName}" tidak ditemukan.`
    });
  }
});


// Fallback route
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Server Proxy PDC berjalan di http://localhost:${PORT}`);
  console.log(`========================================`);
});

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Mengarahkan file statis (HTML/CSS/JS Client) ke folder public di luar backend
app.use(express.static(path.join(__dirname, '../public')));

const BASE_URL = 'https://pdcgudang.et.r.appspot.com/v1';

// Konfigurasi API Key Biteship
const BITESHIP_API_KEY = 'biteship_live.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJuYW1lIjoiam50IiwidXNlcklkIjoiNmExYmY4NzRkZDIyMDU1ODRmMDg4ZDk0IiwiaWF0IjoxNzgzOTE4ODQ2fQ.Bbx33UZxpcN4IjxWWOlpQDQaJlPy-wSOPFjy46DCGkY';

const WAREHOUSES = [
  { id: 'pdc', name: 'PDC Warehouse', username: 'warehousepdc', password: 'Restuibu123', warehouse_id: '38' },
  { id: 'febri', name: 'Febri Warehouse', username: 'febriwarehouse', password: 'Gudang02', warehouse_id: '67' },
  { id: 'palem', name: 'Palem Warehouse', username: 'palemwarehouse', password: 'Kitabisa123', warehouse_id: '94' },
  { id: 'cemara', name: 'Cemara Warehouse', username: 'odiiza', password: 'Disembodied38', warehouse_id: '96' }
];

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

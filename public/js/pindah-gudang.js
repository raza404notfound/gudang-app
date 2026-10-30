// pindah-gudang.js — Fitur Pindah Gudang
// Hitung stok per kode rak (contoh 0001A = shaf A1+A2+A3). Qty Real kosong = belum dihitung,
// lalu simpan ke Google Sheet "LAPORAN BARANG" lewat server Railway.
//
// Fitur utama:
// - Foto produk di setiap kartu, tombol cepat "Sesuai" untuk rak yang cocok
// - Draf otomatis di HP: angka yang diketik tidak hilang sampai berhasil tersimpan
// - Antrean simpan: klik cepat antar rak aman, dikirim berurutan & per paket
// - Coba ulang otomatis, tanda gagal di kartu
// - Sinkron berkala antar petugas tanpa mengganggu angka yang sedang diketik
// - Tanda "sedang dihitung oleh ..." dan peringatan sebelum menimpa hitungan orang lain
//
// Berdiri sendiri: tidak mengubah main.js, hanya memakai showToast, showConfirm,
// currentUserRole, dan PAGE_DATA_LOADERS yang sudah ada di main.js.

const PG_ASSET_BASE   = 'https://pdcgudang.et.r.appspot.com/v1/assets/get';
const PG_SINKRON_MS   = 60000;   // cadangan sinkron (perubahan utama datang realtime)
const PG_DETAK_MS     = 45000;   // perpanjang tanda "sedang dihitung"
const PG_PAKET_MAKS   = 10;      // maksimal rak per sekali kirim
const PG_KUNCI_ANTREAN = 'pg_antrean_v1';
const PG_KUNCI_DRAF    = 'pg_draf_v1';
const PG_KUNCI_PERANGKAT = 'pg_perangkat_v1';
const PG_KUNCI_CACHE  = 'pg_cache_v2';   // salinan data terakhir di HP, supaya halaman langsung tampil

const pgState = {
  rak: {},          // master dari CSV: { kode: { kode, items:[{id,nama,varian,img,lokasi[],qtyCsv}], totalCsv } }
  status: {},       // dari sheet: { kode: { status:'sesuai'|'selisih'|'sebagian', nSelisih, nBelum, petugas, waktu, versi } }
  sedang: {},       // { kode: { petugas, sejak } }
  sheetUrl: '',
  saya: '',
  sudahDimuat: false,
  sedangMuat: false,
  sinkronJalan: false,
  filter: 'semua',
  cari: '',
  tim: '',          // filter tim, contoh '12'
  rakInduk: '',     // filter rak, contoh '1201'
  blok: '',         // filter blok (kode rak lengkap), contoh '1201A'
  config: null,     // { scriptUrl, sheetUrl, role, saya }
  es: null,         // koneksi realtime (EventSource)
  dariCache: false,
  exportInfo: [],   // [{ label, waktuExport, baris }]
  exportTim: {},    // { tim: 'YYYY-MM-DD HH:MM' } export terbaru per tim
  // modal
  aktif: null,
  baris: [],
  modalVersi: '',
  modalDiubah: false,
  modalBaru: null,  // { petugas, waktu } bila rak ini disimpan orang lain saat modal terbuka
  tersimpan: {},    // { idProduk: qtyReal } yang sudah tersimpan di sheet untuk rak yang dibuka
  // antrean & draf
  antrean: [],
  draf: {},
  kirimJalan: false,
  coba: 0,
  konflik: {},      // { kode: { petugas, waktu } }
  tapYakin: {},     // { kode: timestamp } konfirmasi tombol Sesuai di kartu
  kartuHtml: {},
  timerSinkron: null,
  timerDetak: null,
  timerKirim: null
};

// Daftarkan ke router main.js supaya menu & refresh (#pindah-gudang) berfungsi
if (typeof PAGE_DATA_LOADERS !== 'undefined') {
  PAGE_DATA_LOADERS['stok-opname'] = () => pgInit();
}

// ============================================================
// HELPER
// ============================================================
function pgEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function pgToast(msg, type = 'info') {
  if (typeof showToast === 'function') showToast(pgEsc(msg), type);
  else alert(msg);
}
async function pgKonfirmasi(judul, pesan, tombol) {
  if (typeof showConfirm === 'function') return showConfirm(judul, pesan, tombol);
  return confirm(judul + '\n\n' + pesan);
}
function pgAngka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function pgJam(w) { const m = String(w || '').match(/(\d{2}:\d{2})\s*$/); return m ? m[1] : String(w || ''); }
function pgTim(id) { return String(id || '').split('-')[0].trim(); }
// Rak induk = kode rak tanpa huruf blok di belakang: 1201A → 1201, 0007DD → 0007
function pgRakInduk(kode) { return String(kode || '').replace(/[A-Z]+$/, '') || String(kode || ''); }
// SALAH RAK: kode tim di SKU harus sama dengan awalan kode rak.
// SKU 12-xxxx harus di rak 12xx, SKU 00-xxxx di rak 00xx, SKU T27-xxxx di rak 27xx.
function pgSalahRak(tim, kode) {
  const t = String(tim || '').replace(/\D/g, ''), k = String(kode || '').replace(/\D/g, '');
  if (!t || k.length < t.length) return false;
  return !k.startsWith(t);
}
// SKU label: 12-1202-V-38-5DD3-6163, SKU web: 12-1202-V-X-5DD3-6163.
// Segmen ke-4 = kode gudang (X, 38, 67, 94, 96, ...) → diabaikan saat mencocokkan.
function pgNormSku(id) {
  const p = String(id || '').trim().toUpperCase().split('-');
  if (p.length >= 5) p[3] = '*';
  return p.join('-');
}
// Teks pencarian yang memuat potongan SKU lengkap: ganti segmen ke-4 dengan *
function pgNormCari(q) {
  return String(q || '').toUpperCase().replace(/\b([A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+-)[A-Z0-9]+(?=-)/g, '$1*');
}
function pgCocokSku(id, q) {
  const u = String(id || '').toUpperCase();
  return u.includes(q) || pgNormSku(u).includes(pgNormCari(q));
}
function pgSuperuser() { return !!(pgState.config && pgState.config.role === 'superuser'); }
function pgKosong(v) { return v === null || v === undefined || v === '' || Number.isNaN(v); }

// Aturan kode rak: buang angka shaf di belakang. 0001A1 → 0001A, 0007DD1 → 0007DD
function pgKodeRak(lokasi) {
  return String(lokasi || '').trim().toUpperCase().replace(/\d+$/, '');
}

function pgBacaLokal(kunci, awal) {
  try { const v = localStorage.getItem(kunci); return v ? JSON.parse(v) : awal; } catch (e) { return awal; }
}
function pgTulisLokal(kunci, nilai) {
  try { localStorage.setItem(kunci, JSON.stringify(nilai)); } catch (e) { /* penyimpanan HP penuh / diblokir */ }
}

async function pgApi(url, opsi = {}) {
  const res = await fetch(url, {
    ...opsi,
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': localStorage.getItem('sessionToken') || ''
    }
  });
  if (res.status === 401) { const e = new Error('Sesi habis. Silakan login ulang.'); e.status = 401; throw e; }
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Respons server tidak valid.'); }
  if (!data.success) { const e = new Error(data.message || 'Permintaan gagal.'); e.status = res.status; throw e; }
  return data;
}

function pgHalamanAktif() {
  const el = document.getElementById('page-stok-opname');
  return !!(el && el.classList.contains('active'));
}

// ============================================================
// MUAT DATA
// ============================================================
function pgInit() {
  pgTampilkanTombolUpload();
  pgState.saya = pgState.saya || localStorage.getItem('sessionUser') || '';
  pgSiapkan();
}

async function pgSiapkan() {
  await pgAmbilConfig();
  pgMulaiRealtime();
  if (!pgState.sudahDimuat && !pgState.sedangMuat) {
    pgMuatDariCache();
    pgMuat();
  } else pgSinkron();
  pgMulaiSinkron();
  pgProsesAntrean();
  // Siapkan pemindai QR di belakang layar supaya tombol Scan langsung cepat
  setTimeout(() => { pgMuatLibQr().catch(() => {}); }, 1500);
}

function pgTampilkanTombolUpload() {
  const role = (typeof currentUserRole !== 'undefined' && currentUserRole) || localStorage.getItem('sessionRole') || '';
  const btn = document.getElementById('pg-btn-upload');
  if (btn) btn.style.display = role === 'superuser' ? 'inline-flex' : 'none';
}

// Alamat Apps Script (untuk baca langsung) + link sheet (khusus superuser)
async function pgAmbilConfig() {
  if (pgState.config) return pgState.config;
  try {
    pgState.config = await pgApi('/api/pindah/config');
    if (pgState.config.saya) pgState.saya = pgState.config.saya;
    if (pgState.config.namaPeta && typeof setNamaPeta === 'function') setNamaPeta(pgState.config.namaPeta);
  } catch (e) { pgState.config = { scriptUrl: '', sheetUrl: '' }; }
  const link = document.getElementById('pg-btn-sheet');
  if (link) {
    link.href = pgState.config.sheetUrl || '#';
    link.style.display = pgState.config.sheetUrl ? 'inline-flex' : 'none';
  }
  return pgState.config;
}

// BACA DATA: langsung WEB → SHEET (Apps Script), tanpa lewat server Railway.
// Bila gagal (jaringan / CORS), otomatis lewat server sebagai cadangan.
const PG_RUTE_CADANGAN = {
  pgLoad:   () => '/api/pindah/data',
  pgStatus: () => '/api/pindah/status',
  pgRak:    p => '/api/pindah/rak?kode=' + encodeURIComponent(p.kode || '')
};
async function pgBaca(action, params = {}) {
  // Data & status: dari memori bersama di server (cepat). Gagal → langsung ke sheet.
  if (action === 'pgLoad' || action === 'pgStatus') {
    try {
      const q = action === 'pgLoad' ? (params.segar ? '?segar=1' : '') : '?versi=' + encodeURIComponent(pgState.versi || 0);
      return await pgApi((action === 'pgLoad' ? '/api/pindah/data' : '/api/pindah/status') + q);
    } catch (e) {
      if (e.status === 401) throw e;
      console.warn('[Stok Opname] server gagal, baca langsung ke sheet:', e.message);
      pgState.versi = 0;
      params = {};
    }
  }
  const url = pgState.config && pgState.config.scriptUrl;
  if (url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
      const q = new URLSearchParams({ action, ...params, _: Date.now() });
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + q, { signal: ctrl.signal });
      const data = await res.json();
      if (data && data.success) return data;
      if (data && data.message) throw Object.assign(new Error(data.message), { dariSheet: true });
    } catch (e) {
      if (e.dariSheet) throw e;
      console.warn('[Stok Opname] baca langsung gagal, lewat server:', e.message);
    } finally { clearTimeout(t); }
  }
  return pgApi(PG_RUTE_CADANGAN[action](params));
}

// Tampilkan salinan terakhir dari HP dulu (instan), lalu perbarui dari sheet
function pgMuatDariCache() {
  const c = pgBacaLokal(PG_KUNCI_CACHE, null);
  if (!c || !Array.isArray(c.master) || !c.master.length) return false;
  pgSusunMaster(c.master);
  pgState.status = c.status || {};
  pgState.exportInfo = c.exportInfo || [];
  pgState.exportTim = c.exportTim || {};
  pgState.sudahDimuat = true;
  pgState.dariCache = true;
  pgRenderLabelExport();
  pgRenderChipFilter();
  pgRender();
  return true;
}
function pgSimpanCache(master) {
  pgTulisLokal(PG_KUNCI_CACHE, { master, status: pgState.status, exportInfo: pgState.exportInfo, exportTim: pgState.exportTim, versi: pgState.versi || 0, t: Date.now() });
}

async function pgMuat(segar) {
  pgState.sedangMuat = true;
  if (!pgState.sudahDimuat) pgSetStateBox('sync', 'Memuat data dari sheet LAPORAN BARANG...');
  const btn = document.getElementById('pg-btn-refresh');
  if (btn) btn.disabled = true;
  try {
    const data = await pgBaca('pgLoad', segar === true ? { segar: 1 } : {});
    pgSusunMaster(data.master || []);
    pgState.status   = data.status || {};
    pgState.versi    = data.versi || 0;
    pgState.exportInfo = data.exportInfo || [];
    pgState.exportTim  = data.exportTim || {};
    pgState.sudahDimuat = true;
    pgState.dariCache = false;
    pgSimpanCache(data.master || []);
    pgRenderLabelExport();
    pgRenderChipFilter();
    pgRender();
  } catch (err) {
    if (!pgState.sudahDimuat) pgSetStateBox('error', err.message);
    pgToast(err.message, 'error');
  } finally {
    pgState.sedangMuat = false;
    if (btn) btn.disabled = false;
    pgRender();
  }
}

// ============================================================
// REALTIME: tanda "sedang dihitung" & hasil simpan dari layar lain
// ============================================================
function pgMulaiRealtime() {
  if (pgState.es || typeof EventSource === 'undefined') return;
  const token = localStorage.getItem('sessionToken');
  if (!token) return;
  const es = new EventSource('/api/pindah/stream?token=' + encodeURIComponent(token));
  pgState.es = es;
  es.addEventListener('sedang', e => {
    try { pgState.sedang = JSON.parse(e.data) || {}; } catch (er) { return; }
    if (pgState.aktif) pgRenderInfoModal();
    pgRender();
  });
  es.addEventListener('simpan', e => {
    let d; try { d = JSON.parse(e.data); } catch (er) { return; }
    (d.hasil || []).forEach(h => {
      pgState.status[h.kodeRak] = { status: h.status, nSelisih: h.nSelisih, nBelum: h.nBelum, petugas: h.petugas,
        waktu: h.waktu, versi: h.versi, perangkat: h.perangkat, isi: h.isi, _t: Date.now() };
    });
    pgCekModalTerbaru();
    pgRender();
  });
  es.addEventListener('muatUlang', () => { pgToast('Data CSV baru diupload. Memuat ulang...', 'info'); pgMuat(); });
  es.addEventListener('hapusHitung', e => {
    let d; try { d = JSON.parse(e.data); } catch (er) { return; }
    if (d.jenis === 'tambahanUbah' || d.jenis === 'tambahanHapus') { pgSetelahTambahan(d); return; }
    if (d.oleh !== pgState.saya) {
      pgToast(d.jenis === 'rak' ? `Hitungan rak ${d.kodeRak} dihapus oleh ${pgNama(d.oleh)}.` : d.jenis === 'tim' ? `Hitungan Tim ${d.tim} di ${d.kodeRak} dihapus oleh ${pgNama(d.oleh)}.` : `Hitungan SKU ${d.id} (${d.kodeRak}) dihapus oleh ${pgNama(d.oleh)}.`, 'info');
    }
    pgSetelahHapus(d);
  });
  es.addEventListener('profil', async () => {
    if (typeof muatNamaPeta === 'function') { await muatNamaPeta(); pgState.kartuHtml = {}; const g = document.getElementById('pg-grid'); if (g) g.dataset.daftar = ''; pgRender(); if (pgState.aktif) pgRenderInfoModal(); }
  });
  es.addEventListener('open', () => { pgSetRealtime(true); if (pgState.sudahDimuat) pgSinkron(); });
  es.addEventListener('error', () => {
    pgSetRealtime(false);
    if (es.readyState === EventSource.CLOSED) {   // misal sesi habis: coba lagi 15 dtk lagi
      pgState.es = null;
      setTimeout(pgMulaiRealtime, 15000);
    }
  });
}
function pgSetRealtime(hidup) {
  const el = document.getElementById('pg-live');
  if (el) { el.classList.toggle('hidup', hidup); el.title = hidup ? 'Realtime tersambung' : 'Realtime terputus, menyambung ulang...'; }
}

// master: [[kodeRak, lokasi, idProduk, nama, varian, qty, kodeGambar, tim, labelExport, waktuExport], ...]
// Produk yang sama di beberapa shaf (misal XX01A1 & XX01A2) digabung jadi satu baris.
function pgSusunMaster(master) {
  const rak = {};
  master.forEach(r => {
    const kode = String(r[0] || '').trim();
    const id   = String(r[2] || '').trim();
    if (!kode || !id) return;
    if (!rak[kode]) rak[kode] = { kode, peta: {}, items: [], totalCsv: 0, tim: {}, export: {} };
    const g = rak[kode];
    const qty = Number(r[5]) || 0;
    if (!g.peta[id]) {
      g.peta[id] = { id, nama: String(r[3] || ''), varian: String(r[4] || ''), img: String(r[6] || ''), lokasi: [], qtyCsv: 0,
                     tim: String(r[7] || '') || pgTim(id), export: String(r[8] || '') };
      g.items.push(g.peta[id]);
    }
    const it = g.peta[id];
    it.qtyCsv += qty;
    const lok = String(r[1] || '').trim();
    if (lok && !it.lokasi.includes(lok)) it.lokasi.push(lok);
    if (lok) { it.lokQty = it.lokQty || {}; it.lokQty[lok] = (it.lokQty[lok] || 0) + qty; }
    g.totalCsv += qty;
    g.tim[it.tim] = true;
    if (it.export) g.export[it.export] = true;
  });
  // Tandai SKU yang nyasar ke rak tim lain
  Object.values(rak).forEach(g => {
    g.nyasar = g.items.filter(i => (i.salahRak = pgSalahRak(i.tim, g.kode)));
  });
  Object.values(rak).forEach(g => {
    g.items.sort((a, b) => (a.lokasi[0] || '').localeCompare(b.lokasi[0] || '') || a.nama.localeCompare(b.nama));
    // Foto untuk kartu: produk dengan stok terbanyak lebih dulu
    g.foto = g.items.filter(i => i.img).sort((a, b) => b.qtyCsv - a.qtyCsv).slice(0, 3).map(i => i.img);
    delete g.peta;
  });
  pgState.rak = rak;
}

// ============================================================
// SINKRON BERKALA (tidak pernah menyentuh angka yang sedang diketik)
// ============================================================
function pgMulaiSinkron() {
  if (pgState.timerSinkron) return;
  pgState.timerSinkron = setInterval(() => {
    if (!document.hidden && pgHalamanAktif()) pgSinkron();
  }, PG_SINKRON_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pgHalamanAktif()) { pgSinkron(); pgProsesAntrean(); }
  });
}

async function pgSinkron() {
  if (pgState.sinkronJalan || !pgState.sudahDimuat) return;
  pgState.sinkronJalan = true;
  const mulai = Date.now();
  try {
    const d = await pgBaca('pgStatus');
    if (d.sama) { pgState.sinkronJalan = false; return; }          // tidak ada perubahan: hampir 0 kuota
    let baru;
    if (d.ubah) {                                                   // hanya rak yang berubah
      baru = { ...pgState.status };
      Object.keys(d.ubah).forEach(k => { if (d.ubah[k]) baru[k] = d.ubah[k]; else delete baru[k]; });
    } else baru = d.status || {};
    // Hasil simpan lokal yang lebih baru dari permintaan ini tetap dipakai
    Object.keys(pgState.status).forEach(k => {
      const lama = pgState.status[k];
      if (lama && lama._t && lama._t > mulai) baru[k] = lama;
    });
    pgState.status = baru;
    if (d.versi) pgState.versi = d.versi;
    pgCekModalTerbaru();
    pgRender();
  } catch (e) {
    // diam saja, dicoba lagi di putaran berikutnya
  } finally {
    pgState.sinkronJalan = false;
  }
}

// ============================================================
// STATUS EFEKTIF (sheet + antrean lokal)
// ============================================================
function pgEntriAntrean(kode) { return pgState.antrean.find(e => e.kodeRak === kode); }

// Isi hitungan → ringkasan (ikut filter Tim bila aktif)
// isi: [[id, qtyWeb, qtyReal|'', rincian, nama], ...]
function pgRingkasIsi(kode, isi) {
  const g = pgState.rak[kode];
  const tim = pgState.tim;
  const items = g ? g.items.filter(i => !tim || i.tim === tim) : [];
  const simpan = {};
  let tambahan = 0, pcsTambahan = 0;
  (isi || []).forEach(r => {
    if (String(r[0]).startsWith('TAMBAHAN')) { if (!pgKosong(r[2]) && r[2] !== '') { tambahan++; pcsTambahan += Number(r[2]) || 0; } return; }
    simpan[r[0]] = r;
  });
  const h = { nProduk: items.length, pcs: 0, nKurang: 0, pcsKurang: 0, nLebih: 0, pcsLebih: 0, nBelum: 0, nSesuai: 0, ada: false };
  items.forEach(it => {
    h.pcs += it.qtyCsv;
    const r = simpan[it.id];
    if (!r || r[2] === '' || r[2] === null) { h.nBelum++; return; }
    h.ada = true;
    const d = Number(r[2]) - Number(r[1]);
    if (d < 0) { h.nKurang++; h.pcsKurang += d; } else if (d > 0) { h.nLebih++; h.pcsLebih += d; } else h.nSesuai++;
  });
  if (!tim && tambahan) { h.nLebih += tambahan; h.pcsLebih += pcsTambahan; h.ada = true; }
  h.status = !h.ada ? 'belum' : (h.nKurang || h.nLebih) ? 'selisih' : h.nBelum ? 'sebagian' : 'sesuai';
  h.nSelisih = h.nKurang + h.nLebih;
  return h;
}

function pgStatusEfektif(kode) {
  const e = pgEntriAntrean(kode);
  if (e) {
    const isi = (e.items || []).map(it => [it.id, it.qtyCsv, it.qtyKirim, it.rincian || '', it.nama]);
    return { ...pgRingkasIsi(kode, isi), antre: e.gagal ? 'gagal' : 'menyimpan', pesan: e.pesan };
  }
  if (pgState.konflik[kode]) return { status: 'konflik', ...pgState.konflik[kode] };
  const s = pgState.status[kode];
  if (!s) return { status: 'belum' };
  const dasar = { petugas: s.petugas, waktu: s.waktu };
  if (Array.isArray(s.isi)) {
    const h = pgRingkasIsi(kode, s.isi);
    if (s.perluCek && h.ada) h.status = 'ulang';
    return { ...h, ...dasar };
  }
  if (s.perluCek) return { status: 'ulang', nSelisih: s.nSelisih, nBelum: s.nBelum, ...dasar };
  return { status: s.status, nSelisih: s.nSelisih, nBelum: s.nBelum, ...dasar };
}

function pgSedangLain(kode) {
  const daftar = [].concat(pgState.sedang[kode] || []);
  return daftar.find(s => s && s.petugas && (s.perangkat ? s.perangkat !== PG_PERANGKAT : s.petugas !== pgState.saya)) || null;
}
// Nama tampilan (username login → nama yang diatur di Pengaturan)
function pgNama(u) { return typeof namaTampil === 'function' ? namaTampil(u) : (u || ''); }
function pgSiapa(petugas) { return petugas === pgState.saya ? 'akun Anda di perangkat lain' : pgNama(petugas); }
function pgLabelSedang(s) {
  if (!s) return '';
  if (s.petugas === pgState.saya) return 'Sedang dihitung di perangkat lain' + (s.jenis ? ' (' + s.jenis + ')' : '');
  return 'Sedang dihitung ' + pgNama(s.petugas);
}
// Apakah simpanan terakhir rak ini berasal dari perangkat ini
function pgDariSaya(s) {
  return !!s && s.petugas === pgState.saya && (!s.perangkat || s.perangkat === PG_PERANGKAT);
}

// ============================================================
// RENDER GRID
// ============================================================
function pgSetStateBox(ikon, pesan) {
  const grid = document.getElementById('pg-grid');
  if (!grid) return;
  grid.dataset.daftar = '';
  pgState.kartuHtml = {};
  grid.innerHTML = `<div class="pg-state-box">
      <span class="material-symbols-outlined ${ikon === 'sync' ? 'pg-putar' : ''}">${ikon}</span>
      <p>${pgEsc(pesan)}</p>
    </div>`;
}

function pgSemuaKode() {
  const set = new Set([...Object.keys(pgState.rak), ...Object.keys(pgState.status)]);
  return [...set].sort();
}

function pgRender() {
  if (!document.getElementById('pg-grid')) return;
  const semua = pgSemuaKode();
  let nSesuai = 0, nSelisih = 0, nSebagian = 0;
  semua.forEach(k => {
    const s = pgStatusEfektif(k);
    if (s.status === 'sesuai') nSesuai++;
    if (s.status === 'selisih') nSelisih++;
    if (s.status === 'sebagian') nSebagian++;
  });
  const selesai = nSesuai + nSelisih + nSebagian;
  const persen = semua.length ? Math.round(selesai / semua.length * 100) : 0;

  document.getElementById('pg-n-total').innerText   = pgAngka(semua.length);
  document.getElementById('pg-n-selesai').innerText = pgAngka(selesai);
  document.getElementById('pg-n-sesuai').innerText  = pgAngka(nSesuai);
  document.getElementById('pg-n-selisih').innerText = pgAngka(nSelisih);
  document.getElementById('pg-n-sebagian').innerText = pgAngka(nSebagian);
  document.getElementById('pg-progress-bar').style.width = persen + '%';
  document.getElementById('pg-progress-label').innerText = `${persen}% kode rak sudah dihitung` +
    (pgState.dariCache || pgState.sedangMuat ? ' · memperbarui dari sheet…' : '');
  pgRenderRingkasAtas();
  pgUpdateBarAntrean();
  pgRenderChipNyasar();
  pgIsiJumlahStatus(semua);

  if (!pgState.sudahDimuat) return;
  if (!semua.length) {
    pgSetStateBox('upload_file', 'Belum ada data. Upload CSV stok terlebih dahulu (tombol Upload CSV, khusus superuser).');
    return;
  }

  const cari = pgState.cari.trim().toUpperCase();
  const tampil = semua.filter(k => {
    if (pgState.tim) {
      const g = pgState.rak[k];
      if (!g || !g.tim[pgState.tim]) return false;
    }
    if (pgState.rakInduk && pgRakInduk(k) !== pgState.rakInduk) return false;
    if (pgState.blok && k !== pgState.blok) return false;
    if (pgState.filter === 'nyasar') {
      const g = pgState.rak[k];
      if (!g || !g.nyasar.length) return false;
    } else if (pgState.filter !== 'semua') {
      const st = pgStatusEfektif(k).status;
      const cocok = pgState.filter === 'belum' ? (st === 'belum' || st === 'konflik' || st === 'sebagian') : st === pgState.filter;
      if (!cocok) return false;
    }
    if (!cari) return true;
    if (k.includes(cari)) return true;
    const g = pgState.rak[k];
    return g ? g.items.some(i => i.nama.toUpperCase().includes(cari) || pgCocokSku(i.id, cari)) : false;
  });

  if (!tampil.length) {
    pgSetStateBox('search_off', 'Tidak ada kode rak yang cocok dengan filter.');
    return;
  }

  const grid = document.getElementById('pg-grid');
  const ae = document.activeElement;
  const fokusKode = null;
  const daftar = tampil.join(',');

  const perInduk = {};
  tampil.forEach(k => { (perInduk[pgRakInduk(k)] = perInduk[pgRakInduk(k)] || []).push(k); });
  if (grid.dataset.daftar !== daftar) {
    // Susunan kartu berubah (filter / cari / data baru): bangun ulang, dikelompokkan per rak induk
    pgState.kartuHtml = {};
    let indukLalu = null;
    grid.innerHTML = tampil.map(k => {
      const html = pgKartuHtml(k);
      pgState.kartuHtml[k] = html;
      const ind = pgRakInduk(k);
      const judul = ind !== indukLalu ? `<div class="pg-grup" data-grup="${pgEsc(ind)}">${pgGrupIsi(ind, perInduk[ind])}</div>` : '';
      indukLalu = ind;
      return judul + html;
    }).join('');
    grid.dataset.daftar = daftar;

  } else {
    // Hanya kartu yang berubah yang diganti; kartu yang sedang diketik dibiarkan
    tampil.forEach(k => {
      if (k === fokusKode) return;
      const html = pgKartuHtml(k);
      if (pgState.kartuHtml[k] === html) return;
      const el = grid.querySelector(`.pg-card[data-kode="${CSS.escape(k)}"]`);
      if (el) { el.outerHTML = html; pgState.kartuHtml[k] = html; }
    });
    grid.querySelectorAll('.pg-grup').forEach(el => {
      const ind = el.dataset.grup;
      if (perInduk[ind]) { const isi = pgGrupIsi(ind, perInduk[ind]); if (el.innerHTML !== isi) el.innerHTML = isi; }
    });
  }
}

// Chip status "Salah Rak" (hanya tampil bila ada SKU nyasar)
function pgRenderChipNyasar() {
  const el = document.getElementById('pg-chip-nyasar');
  if (!el) return;
  let nRak = 0, nSku = 0;
  Object.values(pgState.rak).forEach(g => { if (g.nyasar && g.nyasar.length) { nRak++; nSku += g.nyasar.length; } });
  el.style.display = nRak ? '' : 'none';
  el.innerHTML = `<span class="material-symbols-outlined">priority_high</span>Salah Rak <small>${nSku}</small>`;
  el.title = `${nSku} SKU berada di rak tim lain (${nRak} kode rak)`;
  if (!nRak && pgState.filter === 'nyasar') pgSetFilter('semua', document.querySelector('.pg-chip[data-f="semua"]'));
}

// Judul kelompok: "Rak 1201 · 4 blok · 2 selesai"
function pgGrupIsi(induk, kodes) {
  const selesai = kodes.filter(k => { const s = pgStatusEfektif(k); return (s.status === 'sesuai' || s.status === 'selisih') && !s.nBelum; }).length;
  return `<span>Rak ${pgEsc(induk)}</span><small>${kodes.length} blok · ${selesai} selesai</small>`;
}

function pgRenderKartu(kode) {
  const grid = document.getElementById('pg-grid');
  const el = grid && grid.querySelector(`.pg-card[data-kode="${CSS.escape(kode)}"]`);
  if (!el) return;
  const html = pgKartuHtml(kode);
  el.outerHTML = html;
  pgState.kartuHtml[kode] = html;
}

function pgKartuHtml(k) {
  const g = pgState.rak[k];
  const s = pgStatusEfektif(k);
  const lain = pgSedangLain(k);
  const filterTim = pgState.tim;
  const itemsTim = g ? g.items.filter(i => !filterTim || i.tim === filterTim) : [];
  const nProduk = itemsTim.length;
  const total   = itemsTim.reduce((t, i) => t + i.qtyCsv, 0);
  const kEsc = pgEsc(k);

  let kelas = s.status, badge = { belum: 'Belum', sesuai: 'Sesuai', selisih: 'Selisih', konflik: 'Bentrok', ulang: 'Cek Ulang', sebagian: 'Sebagian' }[s.status] || 'Belum';
  if (s.antre === 'menyimpan') { kelas = 'menyimpan'; badge = 'Menyimpan…'; }
  if (s.antre === 'gagal')     { kelas = 'gagal';     badge = 'Gagal'; }

  const foto = g && g.foto && g.foto.length
    ? `<div class="pg-foto">${g.foto.map(id =>
        `<img loading="lazy" src="${PG_ASSET_BASE}?id=${encodeURIComponent(id)}&thumbnail=true" alt="" onerror="this.style.visibility='hidden'">`).join('')}
        ${nProduk > g.foto.length ? `<span class="pg-foto-lagi">+${nProduk - g.foto.length}</span>` : ''}</div>`
    : '';

  let foot = '';
  if (s.antre === 'gagal') {
    foot = `<div class="pg-card-info merah">Gagal simpan. <button class="pg-link" onclick="event.stopPropagation(); pgUlangi('${kEsc}')">Ulangi</button></div>`;
  } else if (s.antre === 'menyimpan') {
    foot = `<div class="pg-card-info amber"><span class="material-symbols-outlined pg-putar">sync</span>Mengirim ke sheet…</div>`;
  } else if (s.status === 'konflik') {
    foot = `<div class="pg-card-info merah">Sudah disimpan ${pgEsc(pgSiapa(s.petugas))} pukul ${pgEsc(pgJam(s.waktu))}. Buka untuk cek.</div>`;
  }
  // Keterangan ringkas: ▼ kurang (merah) · ▲ lebih (hijau) · ⏳ belum (oranye) · ✓ pas (biru) · 👤 sedang dihitung (ungu)
  const ket = [];
  if (s.status === 'ulang') ket.push(`<span class="pg-k-ulang">↻ cek ulang</span>`);
  const sudahHitung = ['sesuai', 'selisih', 'sebagian', 'ulang'].includes(s.status) || s.antre === 'menyimpan';
  if (sudahHitung) {
    if (s.nKurang) ket.push(`<span class="pg-k-kurang">▼${s.nKurang} (${s.pcsKurang})</span>`);
    if (s.nLebih)  ket.push(`<span class="pg-k-lebih">▲${s.nLebih} (+${s.pcsLebih})</span>`);
    if (s.nKurang === undefined && s.nSelisih) ket.push(`<span class="pg-k-kurang">▼▲${s.nSelisih}</span>`);
    if (s.nBelum)  ket.push(`<span class="pg-k-belum">⏳${s.nBelum}</span>`);
    if (s.status === 'sesuai') ket.push(`<span class="pg-k-pas">✓ pas semua</span>`);
  }
  if (lain) ket.push(`<span class="pg-k-sedang">👤 ${pgEsc(pgLabelSedang(lain).replace(/^Sedang dihitung\s*/, 'dihitung '))}</span>`);
  if (ket.length) foot += `<div class="pg-ket">${ket.join('')}</div>`;
  // Garis progres: biru pas · hijau lebih · merah kurang · oranye belum
  if (nProduk) {
    const nPas = s.nSesuai !== undefined ? s.nSesuai : (s.status === 'sesuai' ? nProduk : 0);
    const nL = s.nLebih || 0, nK = s.nKurang || 0;
    const nB = s.nKurang !== undefined ? s.nBelum || 0 : Math.max(0, nProduk - nPas - nL - nK);
    const tot = Math.max(1, nPas + nL + nK + nB);
    const w = n => (n / tot * 100).toFixed(1) + '%';
    foot += `<div class="pg-bar-kartu"><i class="pas" style="width:${w(nPas)}"></i><i class="lebih" style="width:${w(nL)}"></i><i class="kurang" style="width:${w(nK)}"></i><i class="belum" style="width:${w(nB)}"></i></div>`;
  }
  const nyasar = g && g.nyasar ? g.nyasar.filter(i => !filterTim || i.tim === filterTim) : [];
  const timNyasar = [...new Set(nyasar.map(i => i.tim))].map(t => 'Tim ' + t).join(', ');

  const pudar = s.status === 'sesuai' && !s.antre && !lain;
  return `<div class="pg-card pg-card-${kelas}${lain ? ' pg-card-dipegang' : ''}${nyasar.length ? ' pg-card-nyasar' : ''}${pudar ? ' pg-card-pudar' : ''}" data-kode="${kEsc}" onclick="pgBukaRak('${kEsc}')">
      <div class="pg-card-top">
        <span class="pg-card-kode">${kEsc}${nyasar.length ? `<span class="pg-nyasar-n" title="${nyasar.length} SKU salah rak (${pgEsc(timNyasar)})">!${nyasar.length}</span>` : ''}</span>
        <span class="pg-badge pg-badge-${kelas}">${badge}</span>
      </div>
      ${foto}
      <div class="pg-card-meta">${pgAngka(nProduk)} produk · ${pgAngka(total)} pcs</div>
      ${foot}
    </div>`;
}

// Label sumber data, contoh: "17 Okt 2026 07:38 · Semua Tim"
function pgRenderLabelExport() {
  const el = document.getElementById('pg-label-export');
  if (!el) return;
  if (!pgState.exportInfo.length) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = `<span class="pg-label-judul"><span class="material-symbols-outlined">description</span>Data CSV</span>
    <span class="pg-label-isi">${pgState.exportInfo.map(e => `<span>${pgEsc(e.label)}</span>`).join('')}</span>`;
}

// Filter bertingkat: TIM → RAK (1201, 1202, ...) → BLOK (1201A, 1201B, ...)
function pgUrutAngka(a, b) {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b);
}
function pgRenderChipFilter() {
  const semuaRak = Object.values(pgState.rak);
  const timHit = {};
  semuaRak.forEach(g => Object.keys(g.tim).forEach(t => { timHit[t] = (timHit[t] || 0) + 1; }));
  if (pgState.tim && !timHit[pgState.tim]) { pgState.tim = ''; pgState.rakInduk = ''; pgState.blok = ''; }

  const lolosTim = semuaRak.filter(g => !pgState.tim || g.tim[pgState.tim]);
  const rakHit = {};
  lolosTim.forEach(g => { const r = pgRakInduk(g.kode); rakHit[r] = (rakHit[r] || 0) + 1; });
  if (pgState.rakInduk && !rakHit[pgState.rakInduk]) { pgState.rakInduk = ''; pgState.blok = ''; }

  const blokList = pgState.rakInduk ? lolosTim.filter(g => pgRakInduk(g.kode) === pgState.rakInduk).map(g => g.kode).sort() : [];
  if (pgState.blok && !blokList.includes(pgState.blok)) pgState.blok = '';

  // Dropdown Tim / Rak / Blok (gaya sama dengan Opname WEB)
  const skuRak = {};
  lolosTim.forEach(g => { const r = pgRakInduk(g.kode); skuRak[r] = (skuRak[r] || 0) + (g.items ? g.items.length : 0); });
  const opsi = (v, label, meta) => `<option value="${pgEsc(v)}"${meta ? ` data-meta="${pgEsc(meta)}"` : ''}>${pgEsc(label)}</option>`;
  const pilih = (id, label, fn, judul, cari, isi, nilai, mati) => {
    const el = document.getElementById(id);
    if (!el) return;
    const html = `<span class="pg-chip-label">${label}</span><select class="op-pilih pg-pilih" data-hapus data-judul="${judul}"${cari ? ' data-cari data-cari-teks="Cari nama rak…"' : ''}${mati ? ' disabled' : ''} onchange="${fn}(this.value)">${isi}</select>`;
    el.style.display = '';
    const sel = el.querySelector('select');
    if (el._html === html && sel) { if (sel.value !== nilai) sel.value = nilai; return; }
    el._html = html;
    el.innerHTML = html;
    const baru = el.querySelector('select');
    baru.value = nilai;
    if (typeof opDD === "function") opDD(baru);
  };
  pilih('pg-chip-tim', 'Tim', 'pgSetTim', 'Pilih tim', false,
    opsi('', 'Semua tim', semuaRak.length + ' rak') + Object.keys(timHit).sort(pgUrutAngka).map(t => opsi(t, 'Tim ' + t, timHit[t] + ' rak')).join(''), pgState.tim);
  pilih('pg-chip-rak', 'Rak', 'pgSetRak', 'Pilih rak', true,
    opsi('', 'Semua rak', lolosTim.length + ' blok') + Object.keys(rakHit).sort(pgUrutAngka).map(r => opsi(r, r, `${rakHit[r]} blok · ${skuRak[r] || 0} SKU`)).join(''), pgState.rakInduk);
  pilih('pg-chip-blok', 'Blok', 'pgSetBlok', 'Pilih blok', false,
    blokList.length ? opsi('', 'Semua blok', blokList.length + ' blok') + blokList.map(k => { const g = pgState.rak[k]; return opsi(k, k, (g && g.items ? g.items.length : 0) + ' SKU'); }).join('')
                    : opsi('', 'Pilih rak dulu'), pgState.blok, !blokList.length);
  pgRenderRingkasAtas();
}
function pgSetTim(t)  { pgState.tim = t; pgState.rakInduk = ''; pgState.blok = ''; pgRenderChipFilter(); pgRender(); }
function pgSetRak(r)  { pgState.rakInduk = r; pgState.blok = ''; pgRenderChipFilter(); pgRender(); }
function pgSetBlok(b) { pgState.blok = b; pgRenderChipFilter(); pgRender(); }

function pgSetFilter(f, el) {
  pgState.filter = f;
  document.querySelectorAll('.pg-status-baris .pg-chip').forEach(c => c.classList.remove('aktif'));
  if (el) el.classList.add('aktif');
  pgRender();
}
// Jumlah per status (ikut filter Tim/Rak/Blok) — tampil di panel kiri laptop
function pgIsiJumlahStatus(semua) {
  const n = { semua: 0, belum: 0, sesuai: 0, selisih: 0, ulang: 0 };
  semua.forEach(k => {
    if (pgState.tim) { const g = pgState.rak[k]; if (!g || !g.tim[pgState.tim]) return; }
    if (pgState.rakInduk && pgRakInduk(k) !== pgState.rakInduk) return;
    if (pgState.blok && k !== pgState.blok) return;
    n.semua++;
    const st = pgStatusEfektif(k).status;
    if (st === 'belum' || st === 'konflik' || st === 'sebagian') n.belum++;
    else if (n[st] != null) n[st]++;
  });
  document.querySelectorAll('.pg-status-baris .pg-chip[data-f]').forEach(c => {
    const f = c.dataset.f;
    if (n[f] == null) return;
    let el = c.querySelector('.pg-n');
    if (!el) { el = document.createElement('small'); el.className = 'pg-n'; c.appendChild(el); }
    el.textContent = pgAngka(n[f]);
  });
}
function pgResetFilter() {
  pgState.tim = ''; pgState.rakInduk = ''; pgState.blok = '';
  const c = document.getElementById('pg-cari'); if (c) c.value = '';
  pgState.cari = '';
  pgRenderChipFilter();
  pgSetFilter('semua', document.querySelector('.pg-status-baris .pg-chip[data-f="semua"]'));
}
// Laptop (≥1100px): tombol Live/Panduan/Sheet/Muat ulang/Upload pindah ke kanan atas; HP tetap di tempat lama
(function pgPindahAksi() {
  const mq = window.matchMedia('(min-width: 1100px)');
  function pindah() {
    const aksi = document.querySelector('#page-stok-opname .pg-aksi');
    const kanan = document.getElementById('pg-kanan-atas');
    const atas = document.querySelector('#page-stok-opname .pg-toolbar-atas');
    if (!aksi || !kanan || !atas) return;
    const tujuan = mq.matches ? kanan : atas;
    if (aksi.parentNode !== tujuan) tujuan.appendChild(aksi);
  }
  if (mq.addEventListener) mq.addEventListener('change', pindah); else mq.addListener(pindah);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pindah); else pindah();
})();
function pgCari(v) { pgState.cari = v || ''; if (pgState.sudahDimuat) pgRender(); }

// ============================================================
// ANTREAN SIMPAN
// ============================================================
function pgSimpanAntrean() { pgTulisLokal(PG_KUNCI_ANTREAN, pgState.antrean); }
function pgSimpanDraf()    { pgTulisLokal(PG_KUNCI_DRAF, pgState.draf); }

function pgAntre(entri) {
  const nBelum   = entri.items.filter(i => pgKosong(i.qtyKirim)).length;
  const nSelisih = entri.items.filter(i => !pgKosong(i.qtyKirim) && Number(i.qtyKirim) !== Number(i.qtyCsv)).length;
  entri.prediksi = { status: nSelisih ? 'selisih' : (nBelum ? 'sebagian' : 'sesuai'), nSelisih, nBelum };
  entri.gagal = false;
  entri.pesan = '';
  entri.t = Date.now();
  const idx = pgState.antrean.findIndex(e => e.kodeRak === entri.kodeRak);
  if (idx >= 0) pgState.antrean[idx] = entri; else pgState.antrean.push(entri);
  delete pgState.konflik[entri.kodeRak];
  pgSimpanAntrean();
  pgRender();
  pgProsesAntrean();
}

async function pgProsesAntrean() {
  if (pgState.kirimJalan) return;
  clearTimeout(pgState.timerKirim);
  const siap = pgState.antrean.filter(e => !e.gagal);
  if (!siap.length) return;
  if (navigator.onLine === false) {
    pgState.timerKirim = setTimeout(pgProsesAntrean, 5000);
    return;
  }
  pgState.kirimJalan = true;
  pgUpdateBarAntrean();
  const paket = siap.slice(0, PG_PAKET_MAKS);
  let jeda = 300;
  try {
    const data = await pgApi('/api/pindah/simpan', {
      method: 'POST',
      body: JSON.stringify({ perangkat: PG_PERANGKAT, raks: paket.map(e => ({
        kodeRak: e.kodeRak, items: e.items, versiDasar: e.versiDasar || '', paksa: !!e.paksa
      })) })
    });
    pgState.coba = 0;
    let nKonflik = 0;
    (data.hasil || []).forEach(h => {
      const entri = paket.find(e => e.kodeRak === h.kodeRak);
      const masihSama = entri && pgState.antrean.includes(entri);   // belum diganti versi lebih baru
      if (h.ok) {
        pgState.status[h.kodeRak] = { status: h.status, nSelisih: h.nSelisih, nBelum: h.nBelum,
          petugas: h.petugas, waktu: h.waktu, versi: h.versi, perangkat: h.perangkat || PG_PERANGKAT, isi: h.isi, _t: Date.now() };
        if (entri && pgState.aktif === h.kodeRak && Array.isArray(entri.items)) {
          pgState.tersimpan = {};
          entri.items.forEach(it => { if (!pgKosong(it.qtyKirim) && !String(it.id).startsWith('TAMBAHAN')) pgState.tersimpan[it.id] = it.qtyKirim; });
          pgTampilTombolHapusRak();
          if (!pgState.modalDiubah) pgRenderBaris();
        }
        if (masihSama) {
          pgState.antrean = pgState.antrean.filter(e => e !== entri);
          delete pgState.draf[h.kodeRak];
        } else {
          const baru = pgEntriAntrean(h.kodeRak);
          if (baru) baru.versiDasar = h.versi;
        }
      } else if (h.konflik) {
        nKonflik++;
        pgState.konflik[h.kodeRak] = { petugas: h.petugas, waktu: h.waktu };
        if (masihSama) {
          pgState.antrean = pgState.antrean.filter(e => e !== entri);
          // Simpan hitungan kita sebagai draf supaya bisa dicek dan disimpan ulang
          pgDrafDariEntri(entri);
        }
      } else if (masihSama) {
        entri.gagal = true;
        entri.pesan = h.message || 'Gagal simpan.';
      }
    });
    const c = pgBacaLokal(PG_KUNCI_CACHE, null);
    if (c && c.master) pgSimpanCache(c.master);
    if (nKonflik) pgToast(`${nKonflik} rak sudah disimpan petugas lain. Buka kartunya untuk cek sebelum menimpa.`, 'warning');
  } catch (err) {
    pgState.coba++;
    if (err.status === 401 || pgState.coba >= 3) {
      paket.forEach(e => { if (pgState.antrean.includes(e)) { e.gagal = true; e.pesan = err.message; } });
      pgState.coba = 0;
      pgToast(`Gagal menyimpan ${paket.length} rak: ${err.message}`, 'error');
    } else {
      jeda = 3000 * Math.pow(2, pgState.coba - 1);   // 3 detik, lalu 6 detik
    }
  } finally {
    pgState.kirimJalan = false;
    pgSimpanAntrean();
    pgSimpanDraf();
    pgRender();
    if (pgState.antrean.some(e => !e.gagal)) pgState.timerKirim = setTimeout(pgProsesAntrean, jeda);
  }
}

function pgDrafDariEntri(e) {
  const qty = {};
  const tambahan = [];
  e.items.forEach(it => {
    if (String(it.id) === 'TAMBAHAN') tambahan.push({ nama: it.nama, qty: it.qtyKirim });
    else qty[it.id] = it.qtyKirim;
  });
  pgState.draf[e.kodeRak] = { qty, tambahan, t: Date.now() };
}

function pgUlangi(kode) {
  const e = pgEntriAntrean(kode);
  if (!e) return;
  e.gagal = false; e.pesan = '';
  pgState.coba = 0;
  pgSimpanAntrean();
  pgRender();
  pgProsesAntrean();
}

function pgUlangiSemua() {
  pgState.antrean.forEach(e => { e.gagal = false; e.pesan = ''; });
  pgState.coba = 0;
  pgSimpanAntrean();
  pgRender();
  pgProsesAntrean();
}

function pgUpdateBarAntrean() {
  const bar = document.getElementById('pg-bar-antrean');
  if (!bar) return;
  const nGagal = pgState.antrean.filter(e => e.gagal).length;
  const nTunggu = pgState.antrean.length - nGagal;
  if (!pgState.antrean.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.className = 'pg-bar-antrean' + (nGagal ? ' ada-gagal' : '');
  bar.innerHTML = `
    ${nTunggu ? `<span><span class="material-symbols-outlined pg-putar">sync</span>${nTunggu} rak menunggu tersimpan</span>` : ''}
    ${nGagal ? `<span class="pg-teks-merah">${nGagal} rak gagal tersimpan</span>
      <button class="pg-btn" onclick="pgUlangiSemua()"><span class="material-symbols-outlined">replay</span>Coba lagi semua</button>` : ''}
    <span class="pg-muted pg-bar-catatan">Jangan tutup halaman sampai selesai</span>`;
}

// ============================================================
// MODAL HITUNG PER KODE RAK
// ============================================================
async function pgBukaRak(kode) {
  pgState.aktif = kode;
  pgState.modalDiubah = false;
  pgState.modalBaru = null;
  delete pgState.tapYakin[kode];
  const g = pgState.rak[kode];
  const d = pgState.draf[kode];
  const s = pgState.status[kode];
  pgState.modalVersi = s?.versi || '';

  // Isi awal: dari draf bila ada, kalau tidak dari daftar CSV (kosong)
  pgState.baris = pgBarisDariMaster(g, d && d.qty ? d.qty : null, d && d.parts);
  if (d && Array.isArray(d.tambahan)) d.tambahan.forEach(t => pgState.baris.push(pgBarisTambahan(t.nama, t.qty, kode, t.parts, t.varian)));
  const cariRak = document.getElementById('pg-cari-rak');
  if (cariRak) cariRak.value = '';

  document.getElementById('pg-modal-kode').innerText = kode;
  pgState.tersimpan = {};
  pgTampilTombolHapusRak();
  document.getElementById('pg-tambah-nama').value = '';
  document.getElementById('pg-tambah-qty').value = '';
  pgRenderInfoModal();
  pgRenderBaris();
  document.getElementById('pg-modal-overlay').classList.add('tampil');
  document.body.style.overflow = 'hidden';

  // Tanda "sedang dihitung" + perpanjang tiap menit
  pgTandai(kode, 'buka');
  if (pgState.sorotId) { const sid = pgState.sorotId; pgState.sorotId = ''; setTimeout(() => pgSorotBaris(sid), 60); }
  clearInterval(pgState.timerDetak);
  pgState.timerDetak = setInterval(() => { if (pgState.aktif === kode) pgTandai(kode, 'detak'); }, PG_DETAK_MS);

  // Ambil isi terbaru dari sheet bila rak ini sudah pernah dihitung (tanpa menimpa draf)
  pgState.tampilSemuaTim = false;
  let perluServer = s || pgState.konflik[kode];
  const pakaiDraf = !!(d && d.qty);
  if (s && Array.isArray(s.isi) && !pgState.konflik[kode]) {
    // Hitungan tersimpan sudah ada di HP (ikut terunduh & diperbarui realtime) → langsung tampil
    const qty = {}, parts = {}, tambahan = [];
    s.isi.forEach(r => {
      if (String(r[0]).startsWith('TAMBAHAN')) tambahan.push({ nama: r[4], qty: r[2] === '' ? null : r[2], parts: r[3], varian: r[5] || '' });
      else { qty[r[0]] = r[2] === '' ? null : r[2]; parts[r[0]] = r[3]; if (r[2] !== '' && r[2] !== null) pgState.tersimpan[r[0]] = r[2]; }
    });
    if (!pakaiDraf) {
      pgState.baris = pgBarisDariMaster(g, qty, parts);
      tambahan.forEach(t => pgState.baris.push(pgBarisTambahan(t.nama, t.qty, kode, t.parts, t.varian)));
    }
    pgRenderBaris();
    perluServer = false;
  } else if (perluServer && !pakaiDraf) {
    document.getElementById('pg-baris').classList.add('pg-memuat');   // kunci kotak, jangan tampil "kosong"
  }
  if (perluServer) {
    if (!pakaiDraf) pgSetInfo('memuat', 'Memuat hitungan tersimpan...');
    try {
      const r = await pgBaca('pgRak', { kode });
      if (pgState.aktif !== kode) return;
      const qty = {}, parts = {};
      const tambahan = [];
      (r.items || []).forEach(it => {
        if (String(it.id).startsWith('TAMBAHAN')) tambahan.push({ nama: it.nama, qty: it.qtyKirim, parts: it.rincian, varian: it.varian || '' });
        else { qty[it.id] = pgKosong(it.qtyKirim) ? null : it.qtyKirim; parts[it.id] = it.rincian; }
      });
      Object.keys(qty).forEach(k => { if (!pgKosong(qty[k])) pgState.tersimpan[k] = qty[k]; });
      document.getElementById('pg-baris').classList.remove('pg-memuat');
      if (pakaiDraf || pgState.modalDiubah) { pgRenderBaris(); pgRenderInfoModal(); return; }
      pgState.baris = pgBarisDariMaster(g, qty, parts);
      tambahan.forEach(t => pgState.baris.push(pgBarisTambahan(t.nama, t.qty, kode, t.parts, t.varian)));
      pgState.modalVersi = r.versi || pgState.modalVersi;
      pgRenderBaris();
    } catch (err) {
      document.getElementById('pg-baris').classList.remove('pg-memuat');
      if (pgState.aktif === kode) pgToast('Gagal memuat hitungan tersimpan: ' + err.message, 'error');
    }
    if (pgState.aktif === kode) pgRenderInfoModal();
  }
}

function pgBarisDariMaster(g, qty, parts) {
  return (g ? g.items : []).map(i => {
    const q = qty && !pgKosong(qty[i.id]) ? Number(qty[i.id]) : null;
    return {
      id: i.id, nama: i.nama, varian: i.varian, img: i.img,
      lokasi: i.lokasi.join(', '), lokList: i.lokasi.slice(), lokQty: i.lokQty || {},
      qtyCsv: i.qtyCsv, qtyKirim: q, parts: pgPartsAwal(parts && parts[i.id], q),
      tambahan: false, tim: i.tim, export: i.export, salahRak: !!i.salahRak
    };
  });
}
// Rincian 3 kotak: "1+0+" <-> [1, 0, null]. Data lama tanpa rincian -> [qty, null, null]
function pgPartsAwal(p, q) {
  let a = Array.isArray(p) ? p.slice(0, 3) : (typeof p === 'string' && p.includes('+') ? p.split('+') : null);
  if (a) a = a.map(v => (v === '' || v === null || v === undefined) ? null : Math.max(0, Math.floor(Number(v)) || 0));
  if (!a || a.every(v => v === null)) a = [pgKosong(q) ? null : q, null, null];
  while (a.length < 3) a.push(null);
  return a;
}
function pgRincian(parts) { return parts.some(v => v !== null) ? parts.map(v => v === null ? '' : v).join('+') : ''; }

function pgBarisTambahan(nama, qty, kode, parts, varian) {
  const q = pgKosong(qty) ? null : Number(qty);
  return { id: 'TAMBAHAN-' + Math.random().toString(36).slice(2, 8), nama, varian: varian || '', img: '', lokasi: kode, lokList: [kode], lokQty: {},
           qtyCsv: 0, qtyKirim: q, parts: pgPartsAwal(parts, q), tambahan: true, tim: '', export: '' };
}

function pgSetInfo(jenis, teks) {
  const el = document.getElementById('pg-modal-info');
  if (!el) return;
  if (!teks) { el.style.display = 'none'; return; }
  el.className = 'pg-modal-info ' + jenis;
  el.innerHTML = teks;
  el.style.display = 'block';
}

function pgRenderInfoModal() {
  const kode = pgState.aktif;
  if (!kode) return;
  const pesan = [];
  let jenis = 'biasa';
  const s = pgState.status[kode];
  const lain = pgSedangLain(kode);
  const e = pgEntriAntrean(kode);
  const k = pgState.konflik[kode] || pgState.modalBaru;

  if (s && s.perluCek && !k) { jenis = 'oranye'; pesan.push('<b>Qty Web berubah</b> setelah rak ini dihitung (ada upload CSV baru). Cek ulang Qty Real lalu simpan.'); }
  if (k) { jenis = 'merah'; pesan.push(`Rak ini sudah disimpan oleh <b>${pgEsc(pgSiapa(k.petugas))}</b> pukul ${pgEsc(pgJam(k.waktu))}. Kalau Anda simpan, hitungan itu akan ditimpa.`); }
  if (e && e.gagal) { jenis = 'merah'; pesan.push(`Simpanan terakhir gagal: ${pgEsc(e.pesan)}. Tekan Simpan untuk mencoba lagi.`); }
  else if (e) { jenis = jenis === 'merah' ? jenis : 'amber'; pesan.push('Hitungan rak ini sedang dikirim ke sheet.'); }
  if (lain) { jenis = jenis === 'merah' ? jenis : 'amber'; pesan.push(`<b class="pg-teks-ungu">👤 ${pgEsc(pgLabelSedang(lain))}</b>. Pastikan rak ini tidak dihitung dua kali.`); }
  if (pgState.draf[kode] && pgState.draf[kode].qty) pesan.push('Angka di bawah dari draf di HP ini (belum tersimpan ke sheet).');
  else if (s && !k) pesan.push(`Sudah dihitung oleh ${pgEsc(pgNama(s.petugas))} pukul ${pgEsc(pgJam(s.waktu))}. Simpan lagi akan memperbarui data.`);

  const g = pgState.rak[kode];
  const labels = g ? Object.keys(g.export) : [];
  document.getElementById('pg-modal-sub').innerText = labels.length
    ? 'Qty Web dari export ' + labels.join(' & ')
    : 'Hitung semua shaf rak ini, lalu isi Qty Real.';
  pgSetInfo(jenis, pesan.join('<br>'));
}

// Dipanggil saat sinkron: beri tahu bila rak yang sedang dibuka disimpan orang lain
function pgCekModalTerbaru() {
  const kode = pgState.aktif;
  if (!kode) return;
  const s = pgState.status[kode];
  if (s && s.versi && s.versi !== pgState.modalVersi && !pgDariSaya(s)) {
    pgState.modalBaru = { petugas: s.petugas, waktu: s.waktu };
  }
  pgRenderInfoModal();
}

function pgTutupModal(e) {
  if (e && e.target && e.target.id !== 'pg-modal-overlay') return;
  const kode = pgState.aktif;
  document.getElementById('pg-modal-overlay').classList.remove('tampil');
  document.body.style.overflow = '';
  clearInterval(pgState.timerDetak);
  pgState.aktif = null;
  if (kode) { pgTandai(kode, 'tutup'); pgRenderKartu(kode); }
}

function pgTandai(kode, aksi) {
  fetch('/api/pindah/tandai', {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('sessionToken') || '' },
    body: JSON.stringify({ kodeRak: kode, aksi, perangkat: PG_PERANGKAT, jenis: PG_JENIS })
  }).catch(() => {});
}

function pgRenderBaris() {
  const wrap = document.getElementById('pg-baris');
  if (!pgState.baris.length) {
    wrap.innerHTML = '<div class="pg-state-box kecil"><p>Tidak ada produk tercatat di kode rak ini.</p></div>';
  } else {
    wrap.innerHTML = pgState.baris.map((b, i) => {
      const img = b.img
        ? `<img class="pg-thumb pg-thumb-klik" loading="lazy" onclick="pgLihatFoto(${i})" src="${PG_ASSET_BASE}?id=${encodeURIComponent(b.img)}&thumbnail=true" onerror="this.outerHTML='<div class=&quot;pg-thumb pg-thumb-kosong&quot;><span class=&quot;material-symbols-outlined&quot;>image_not_supported</span></div>'">`
        : `<div class="pg-thumb pg-thumb-kosong"><span class="material-symbols-outlined">${b.tambahan ? 'add_box' : 'image_not_supported'}</span></div>`;
      const multi = !b.tambahan && b.lokList.length > 1;
      // SKU: kode tim di depan diberi warna (12-1202-... -> [12]-1202-...)
      let sku = '';
      if (!b.tambahan) {
        const t = String(b.tim || ''), id = String(b.id);
        sku = t && id.startsWith(t) ? `<b class="pg-sku-tim">${pgEsc(t)}</b>${pgEsc(id.slice(t.length))}` : pgEsc(id);
      }
      const lokHtml = multi
        ? `<div class="pg-shaf">${b.lokList.map(l => `<span class="pg-sh"><b>${pgEsc(l)}</b><i>Web ${pgAngka(b.lokQty[l] || 0)}</i></span>`).join('')}</div>`
        : `<div class="pg-lok">${pgEsc(b.lokasi)}</div>`;
      const tersimpan = !b.tambahan && !pgKosong(pgState.tersimpan[b.id]);
      const tombol = b.tambahan
        ? `<button type="button" class="pg-del" title="Buang barang tambahan" onclick="pgHapusTambahan(${i})"><span class="material-symbols-outlined">close</span></button>`
        : `<button type="button" class="pg-del" ${tersimpan ? `title="Hapus hitungan tersimpan" onclick="pgMintaHapus('sku', ${i})"` : 'disabled title="Belum ada hitungan tersimpan"'}><span class="material-symbols-outlined">delete</span></button>`;
      const kotak = [0, 1, 2].map(k => `<input type="number" inputmode="numeric" min="0" class="pg-input pg-in3" data-i="${i}" data-k="${k}" value="${b.parts[k] === null ? '' : b.parts[k]}" oninput="pgUbahPart(${i}, ${k}, this.value)" onkeydown="pgEnterBerikut(event, ${i})">`).join('<span class="pg-plus">+</span>');
      const timLain = pgState.tim && !pgState.tampilSemuaTim && !b.tambahan && b.tim !== pgState.tim;
      return `<div class="pg-baris pg-bx${b.salahRak ? ' pg-baris-nyasar' : ''}${timLain ? ' pg-sembunyi-tim' : ''}" id="pg-baris-${i}" data-cari="${pgEsc((b.id + ' ' + pgNormSku(b.id) + ' ' + b.nama + ' ' + b.lokasi).toUpperCase())}">
          <div class="pg-info">
            ${img}
            <div class="pg-info-teks">
              ${b.tambahan ? '<div class="pg-sku2"><span class="pg-tag-tambahan">Tidak ada di web</span></div>'
                : `<div class="pg-sku2"><span class="pg-sku-teks">${sku}</span>${multi ? `<span class="pg-multi">⚠ ${b.lokList.length} shaf</span>` : ''}</div>`}
              ${lokHtml}
              <div class="pg-nama2">${pgEsc(b.nama)}${b.varian ? ` · ${pgEsc(b.varian)}` : ''}</div>
              ${b.salahRak ? `<div class="pg-tag-nyasar"><span class="material-symbols-outlined">warning</span>Salah rak: SKU Tim ${pgEsc(b.tim)} ada di rak ${pgEsc(pgState.aktif || '')}</div>` : ''}
            </div>
          </div>
          <div class="pg-hitung">
            <div class="pg-web-box"><small>WEB</small><b>${pgAngka(b.qtyCsv)}</b></div>
            <div class="pg-kotak3">${kotak}</div>
            <div class="pg-tot"><span>Real</span><b id="pg-tot-${i}">–</b></div>
            <span class="pg-hasil" id="pg-selisih-${i}">BELUM</span>
            ${tombol}
          </div>
        </div>`;
    }).join('');
  }
  // Info filter tim di atas daftar
  if (pgState.tim) {
    const nTim = pgState.baris.filter(b => !b.tambahan && b.tim === pgState.tim).length;
    const nSku = pgState.baris.filter(b => !b.tambahan).length;
    if (nTim < nSku) wrap.insertAdjacentHTML('afterbegin', `<div class="pg-tim-info">
        <span>${pgState.tampilSemuaTim ? 'Semua tim ditampilkan' : `Hanya <b>Tim ${pgEsc(pgState.tim)}</b> · ${nTim} dari ${nSku} SKU`}</span>
        <button type="button" onclick="pgToggleSemuaTim()">${pgState.tampilSemuaTim ? 'Hanya Tim ' + pgEsc(pgState.tim) : 'Tampilkan semua'}</button></div>`);
  }
  pgState.baris.forEach((_, i) => pgUpdateSelisih(i));
  pgUpdateRingkasModal();
  const c = document.getElementById('pg-cari-rak');
  if (c && c.value) pgCariDiRak(c.value);
}

function pgDrafModal() {
  const kode = pgState.aktif;
  if (!kode) return;
  pgState.modalDiubah = true;
  const qty = {};
  const tambahan = [];
  const parts = {};
  pgState.baris.forEach(b => {
    if (b.tambahan) tambahan.push({ nama: b.nama, qty: b.qtyKirim, parts: b.parts, varian: b.varian || '' });
    else { qty[b.id] = b.qtyKirim; parts[b.id] = b.parts; }
  });
  pgState.draf[kode] = { qty, parts, tambahan, t: Date.now() };
  pgSimpanDraf();
}

function pgUbahPart(i, k, v) {
  const b = pgState.baris[i];
  if (!b) return;
  b.parts[k] = v === '' ? null : Math.max(0, Math.floor(Number(v)) || 0);
  b.qtyKirim = b.parts.every(x => x === null) ? null : b.parts.reduce((t, x) => t + (x || 0), 0);
  pgUpdateSelisih(i);
  pgUpdateRingkasModal();
  pgDrafModal();
}

function pgToggleSemuaTim() { pgState.tampilSemuaTim = !pgState.tampilSemuaTim; pgRenderBaris(); }
// Baris yang termasuk tampilan sekarang (ikut filter tim)
function pgBarisTampil() {
  return pgState.baris.filter(b => !pgState.tim || pgState.tampilSemuaTim || b.tambahan || b.tim === pgState.tim);
}

function pgUpdateSelisih(i) {
  const b = pgState.baris[i];
  const el = document.getElementById('pg-selisih-' + i);
  const row = document.getElementById('pg-baris-' + i);
  if (!el || !row) return;
  const tot = document.getElementById('pg-tot-' + i);
  if (tot) tot.innerText = pgKosong(b.qtyKirim) ? '–' : pgAngka(b.qtyKirim);
  row.classList.remove('pg-ok', 'pg-kurang', 'pg-lebih');
  el.className = 'pg-hasil';
  if (pgKosong(b.qtyKirim)) { el.textContent = 'BELUM'; return; }
  const d = b.qtyKirim - b.qtyCsv;
  if (d === 0) { el.textContent = '✓ PAS'; el.classList.add('pas'); row.classList.add('pg-ok'); }
  else if (d < 0) { el.textContent = 'KURANG ' + d; el.classList.add('kurang'); row.classList.add('pg-kurang'); }
  else { el.textContent = 'LEBIH +' + d; el.classList.add('lebih'); row.classList.add('pg-lebih'); }
}

function pgUpdateRingkasModal() {
  const lingkup = pgBarisTampil();
  const kosong  = lingkup.filter(b => pgKosong(b.qtyKirim)).length;
  const selisih = lingkup.filter(b => !pgKosong(b.qtyKirim) && b.qtyKirim !== b.qtyCsv).length;
  const total   = lingkup.reduce((s, b) => s + (Number(b.qtyKirim) || 0), 0);
  const totCsv  = lingkup.reduce((s, b) => s + (Number(b.qtyCsv) || 0), 0);
  document.getElementById('pg-modal-ringkas').innerHTML =
    `<span>${pgAngka(lingkup.length)} produk</span>
     <span>Qty Web <b>${pgAngka(totCsv)}</b> pcs</span>
     <span>Qty Real <b>${pgAngka(total)}</b> pcs</span>
     ${kosong ? `<span class="pg-teks-amber">${kosong} belum dihitung</span>` : ''}
     ${selisih ? `<span class="pg-teks-merah">${selisih} selisih</span>` : (kosong ? '' : '<span class="pg-teks-biru">Semua sesuai</span>')}`;
}

function pgEnterBerikut(e, i) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  let n = i + 1, next = null;
  while (n < pgState.baris.length && !next) {   // lewati baris yang disembunyikan pencarian
    const el = document.querySelector(`.pg-input[data-i="${n}"][data-k="0"]`);
    if (el && el.offsetParent !== null) next = el;
    n++;
  }
  if (next) { next.focus(); next.select(); }
  else document.getElementById('pg-btn-simpan').focus();
}

async function pgKosongkan() {
  const ok = await pgKonfirmasi('Kosongkan', 'Semua angka Qty Real dan barang tambahan di rak ini akan dihapus dari draf.', 'Ya, Kosongkan');
  if (!ok) return;
  pgState.baris = pgState.baris.filter(b => !b.tambahan);
  pgState.baris.forEach(b => { b.qtyKirim = null; b.parts = [null, null, null]; });
  delete pgState.draf[pgState.aktif];
  pgSimpanDraf();
  pgState.modalDiubah = true;
  pgRenderBaris();
  pgRenderInfoModal();
}

function pgTambahBarang() {
  const nama = document.getElementById('pg-tambah-nama').value.trim();
  const qty  = Math.floor(Number(document.getElementById('pg-tambah-qty').value));
  if (!nama) { pgToast('Isi nama atau kode barang yang ditemukan.', 'warning'); return; }
  if (!qty || qty < 1) { pgToast('Isi jumlah barang (minimal 1).', 'warning'); return; }
  pgState.baris.push(pgBarisTambahan(nama, qty, pgState.aktif));
  document.getElementById('pg-tambah-nama').value = '';
  document.getElementById('pg-tambah-qty').value = '';
  pgRenderBaris();
  pgDrafModal();
}

function pgHapusTambahan(i) {
  pgState.baris.splice(i, 1);
  pgRenderBaris();
  pgDrafModal();
}

async function pgSimpan() {
  const kode = pgState.aktif;
  if (!kode) return;
  // Qty Real kosong = belum dihitung. Boleh disimpan, asal minimal satu produk sudah diisi.
  const kosong = pgState.baris.filter(b => pgKosong(b.qtyKirim));
  if (kosong.length === pgState.baris.length) {
    pgToast('Belum ada Qty Real yang diisi. Isi minimal satu produk (isi 0 kalau barangnya tidak ada).', 'warning');
    document.querySelector('.pg-input[data-i="0"]')?.focus();
    return;
  }

  // Konfirmasi hanya bila perlu: ada selisih, ada yang belum dihitung, atau akan menimpa hitungan orang lain
  const daftarSelisih = pgBarisTampil().filter(b => !pgKosong(b.qtyKirim) && b.qtyKirim !== b.qtyCsv)
    .sort((a, b) => Math.abs(b.qtyKirim - b.qtyCsv) - Math.abs(a.qtyKirim - a.qtyCsv));
  const selisih = daftarSelisih.length;
  const bentrok = pgState.konflik[kode] || pgState.modalBaru;
  if (selisih || kosong.length || bentrok) {
    let pesan = `Kode rak ${kode}: ${pgState.baris.length} produk.`;
    if (selisih) {
      // Tampilkan selisih terbesar supaya salah ketik (misal 36 padahal 3) mudah terlihat
      pesan += ` Ada ${selisih} produk selisih, terbesar:\n` + daftarSelisih.slice(0, 3).map(b => {
        const d = b.qtyKirim - b.qtyCsv;
        const nama = b.nama.length > 34 ? b.nama.slice(0, 33) + '…' : b.nama;
        return `• ${nama}: Web ${b.qtyCsv} → Real ${b.qtyKirim} (${d > 0 ? '+' : ''}${d})`;
      }).join('\n') + (selisih > 3 ? `\n…dan ${selisih - 3} lainnya.` : '') + '\n';
    }
    if (kosong.length) pesan += `\n${kosong.length} produk masih kosong dan dicatat "Belum Dihitung".`;
    if (bentrok) pesan += `\nRak ini sudah disimpan oleh ${pgSiapa(bentrok.petugas)} pukul ${pgJam(bentrok.waktu)} dan akan ditimpa.`;
    const ok = await pgKonfirmasi('Simpan Hitungan', pesan, bentrok ? 'Ya, Timpa' : 'Ya, Simpan');
    if (!ok) return;
  }

  pgDrafModal();   // pastikan draf terbaru tersimpan sampai pengiriman berhasil
  const items = pgState.baris.map(b => ({
    id: b.tambahan ? 'TAMBAHAN' : b.id,
    lokasi: b.lokasi, nama: b.nama, varian: b.varian || '',
    qtyCsv: Number(b.qtyCsv) || 0, qtyKirim: pgKosong(b.qtyKirim) ? '' : Number(b.qtyKirim), export: b.export || '',
    rincian: pgRincian(b.parts)
  }));
  items.forEach(it => { if (it.id === 'TAMBAHAN') it.id = 'TAMBAHAN'; });
  const versiDasar = pgState.modalVersi;
  pgTutupModal();
  pgAntre({ kodeRak: kode, items, versiDasar, paksa: !!bentrok });
}

// ============================================================
// PANDUAN
// ============================================================
function pgTogglePanduan(e) {
  if (e) e.stopPropagation();
  const el = document.getElementById('pg-panduan');
  el.classList.toggle('tampil');
}
document.addEventListener('click', e => {
  const el = document.getElementById('pg-panduan');
  if (el && el.classList.contains('tampil') && !el.contains(e.target) && !e.target.closest('#pg-btn-panduan')) {
    el.classList.remove('tampil');
  }
});

// ============================================================
// UPLOAD CSV (admin & superuser)
// ============================================================
function pgPilihCsv() { document.getElementById('pg-file-csv').click(); }

// Parser CSV sederhana: mendukung tab, koma, titik koma, dan tanda kutip
function pgParseCsv(teks) {
  teks = teks.replace(/^﻿/, '');
  const barisPertama = teks.split(/\r?\n/, 1)[0] || '';
  const pemisah = barisPertama.includes('\t') ? '\t' : (barisPertama.split(';').length > barisPertama.split(',').length ? ';' : ',');
  const hasil = []; let baris = []; let sel = ''; let kutip = false;
  for (let i = 0; i < teks.length; i++) {
    const c = teks[i];
    if (kutip) {
      if (c === '"' && teks[i + 1] === '"') { sel += '"'; i++; }
      else if (c === '"') kutip = false;
      else sel += c;
    } else if (c === '"') kutip = true;
    else if (c === pemisah) { baris.push(sel); sel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && teks[i + 1] === '\n') i++;
      baris.push(sel); sel = '';
      if (baris.some(x => x.trim() !== '')) hasil.push(baris);
      baris = [];
    } else sel += c;
  }
  baris.push(sel);
  if (baris.some(x => x.trim() !== '')) hasil.push(baris);
  return hasil;
}

const PG_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pgPad = n => String(n).padStart(2, '0');

// Waktu export dari nama file, contoh rack_sku_stock_17_10_2026_T_07_38.csv → "2026-10-17 07:38"
function pgWaktuDariNamaFile(nama) {
  const m = String(nama || '').match(/(\d{1,2})_(\d{1,2})_(\d{4})_T_(\d{1,2})_(\d{2})/i);
  if (!m) return '';
  const [, d, mo, y, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return '';
  return `${y}-${pgPad(mo)}-${pgPad(d)} ${pgPad(h)}:${pgPad(mi)}`;
}
function pgWaktuSekarang() {
  const n = new Date();
  return `${n.getFullYear()}-${pgPad(n.getMonth() + 1)}-${pgPad(n.getDate())} ${pgPad(n.getHours())}:${pgPad(n.getMinutes())}`;
}
// "2026-10-17 07:38" → "17 Okt 2026 07:38"
function pgFormatWaktu(w) {
  const m = String(w || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  return m ? `${Number(m[3])} ${PG_BULAN[Number(m[2]) - 1]} ${m[1]} ${m[4]}:${m[5]}` : String(w || '');
}

async function pgUploadCsv(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let rows;
  try { rows = pgParseCsv(await file.text()); }
  catch (e) { pgToast('File tidak bisa dibaca.', 'error'); return; }
  if (rows.length < 2) { pgToast('CSV kosong.', 'error'); return; }

  // Catatan: di export ini kolom "SKU" berisi lokasi rak (0001A1),
  // sedangkan kolom "Rack" berisi ID produk (diawali kode tim, contoh 93-...).
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = n => head.indexOf(n);
  const iLok = col('sku'), iId = col('rack'), iQty = col('quantity');
  const iNama = col('product name'), iVar = col('varian'), iImg = col('image');
  if (iLok < 0 || iId < 0 || iQty < 0) {
    pgToast('Kolom Rack, SKU, dan Quantity tidak ditemukan. Pastikan file dari export rack_sku_stock.', 'error');
    return;
  }

  const data = []; let dilewati = 0;
  rows.slice(1).forEach(r => {
    const lokasi = String(r[iLok] || '').trim();
    const id = String(r[iId] || '').trim();
    const qty = Number(String(r[iQty] || '').trim());
    if (!lokasi || !id || !Number.isFinite(qty) || /test/i.test(lokasi)) { dilewati++; return; }
    data.push([pgKodeRak(lokasi), lokasi, id,
      iNama >= 0 ? String(r[iNama] || '').trim() : '',
      iVar  >= 0 ? String(r[iVar]  || '').trim() : '',
      qty,
      iImg  >= 0 ? String(r[iImg]  || '').trim() : '',
      pgTim(id)]);
  });
  if (!data.length) { pgToast('Tidak ada baris yang valid di CSV.', 'error'); return; }

  // Tim di file vs tim yang sudah ada → upload penuh atau per tim
  const timFile = [...new Set(data.map(d => d[7]))].sort();
  const timAda = new Set();
  Object.values(pgState.rak).forEach(g => Object.keys(g.tim).forEach(t => timAda.add(t)));
  const semua = !timAda.size || [...timAda].every(t => timFile.includes(t));

  // Label export: "17 Okt 2026 07:38 · Tim 93"
  let waktuExport = pgWaktuDariNamaFile(file.name);
  const dariUpload = !waktuExport;
  if (dariUpload) waktuExport = pgWaktuSekarang();
  const label = `${pgFormatWaktu(waktuExport)} · ${semua ? 'Semua Tim' : 'Tim ' + timFile.join(', ')}${dariUpload ? ' (waktu upload)' : ''}`;

  // Peringatan supaya tidak salah pilih file
  const peringatan = [];
  if (!dariUpload && waktuExport.slice(0, 10) !== pgWaktuSekarang().slice(0, 10)) {
    peringatan.push(`File ini export ${pgFormatWaktu(waktuExport)}, BUKAN hari ini.`);
  }
  const lebihBaru = timFile.filter(t => pgState.exportTim[t] && pgState.exportTim[t] > waktuExport);
  if (lebihBaru.length) {
    peringatan.push(`Data tim ${lebihBaru.join(', ')} di sheet lebih baru (${pgFormatWaktu(pgState.exportTim[lebihBaru[0]])}) daripada file ini.`);
  }

  const nRak  = new Set(data.map(d => d[0])).size;
  const total = data.reduce((s, d) => s + d[5], 0);
  let pesan = (peringatan.length ? 'PERHATIAN: ' + peringatan.join(' ') + '\n\n' : '') +
    `Label: ${label}\n${pgAngka(data.length)} baris, ${pgAngka(nRak)} kode rak, ${pgAngka(total)} pcs.`;
  if (dilewati) pesan += ` ${pgAngka(dilewati)} baris dilewati (uji coba / tidak lengkap).`;
  pesan += semua
    ? '\nSemua data CSV diganti. Data lama dipindah ke Arsip CSV.'
    : `\nHanya data tim ${timFile.join(', ')} yang diganti, tim lain tetap. Data lama dipindah ke Arsip CSV.`;
  if (Object.keys(pgState.status).length) pesan += '\nRak yang sudah dihitung dan Qty Web-nya berubah akan ditandai "Cek Ulang".';
  const ok = await pgKonfirmasi(peringatan.length ? 'Periksa File CSV' : 'Upload CSV Stok', pesan, 'Ya, Upload');
  if (!ok) return;

  const btn = document.getElementById('pg-btn-upload');
  btn.disabled = true;
  pgSetStateBox('sync', 'Mengirim CSV ke sheet...');
  try {
    const res = await pgApi('/api/pindah/upload', { method: 'POST', body: JSON.stringify({
      rows: data, mode: semua ? 'semua' : 'tim', label, waktuExport, namaFile: file.name }) });
    pgToast(res.message || 'CSV berhasil diupload.', (res.perluCek || []).length ? 'warning' : 'success');
    pgState.sudahDimuat = false;
    await pgMuat();
  } catch (err) {
    pgToast(err.message, 'error');
    pgRender();
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// IDENTITAS PERANGKAT — supaya satu akun di beberapa HP tetap terbedakan
// ============================================================
function pgJenisPerangkat() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'HP Android' : 'Tablet Android';
  return 'Laptop/PC';
}
const PG_PERANGKAT = (() => {
  let id = '';
  try { id = localStorage.getItem(PG_KUNCI_PERANGKAT) || ''; } catch (e) {}
  if (!id) {
    id = 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { localStorage.setItem(PG_KUNCI_PERANGKAT, id); } catch (e) {}
  }
  return id;
})();
const PG_JENIS = pgJenisPerangkat();

// ============================================================
// AWAL: pulihkan antrean & draf dari HP, pasang pengaman
// ============================================================
pgState.antrean = pgBacaLokal(PG_KUNCI_ANTREAN, []);
pgState.draf    = pgBacaLokal(PG_KUNCI_DRAF, {});
if (!Array.isArray(pgState.antrean)) pgState.antrean = [];
// Draf lebih dari 3 hari dianggap basi
Object.keys(pgState.draf).forEach(k => {
  if (!pgState.draf[k] || Date.now() - (pgState.draf[k].t || 0) > 3 * 24 * 3600 * 1000) delete pgState.draf[k];
});

window.addEventListener('beforeunload', e => {
  if (pgState.antrean.length) { e.preventDefault(); e.returnValue = ''; }
});
window.addEventListener('online', () => pgProsesAntrean());
// Tab ditutup saat kartu terbuka: lepas tanda "sedang dihitung" supaya layar lain langsung tahu
window.addEventListener('pagehide', () => { if (pgState.aktif) pgTandai(pgState.aktif, 'tutup'); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pgState.aktif) pgTutupModal();
});

// Lanjutkan antrean yang tertinggal (misal HP sempat ter-refresh) walau belum membuka menu ini
if (pgState.antrean.length) setTimeout(() => { if (localStorage.getItem('sessionToken')) pgProsesAntrean(); }, 3000);


// ============================================================
// HAPUS HITUNGAN per rak / per SKU (khusus superuser, wajib password)
// Daftar SKU dari CSV TIDAK ikut terhapus — hanya Qty Real yang sudah disimpan.
// ============================================================
function pgTampilTombolHapusRak() {
  const btn = document.getElementById('pg-btn-hapus-rak');
  if (btn) btn.style.display = pgSuperuser() && pgState.aktif && pgState.status[pgState.aktif] ? '' : 'none';
}

// Dipanggil setelah hapus berhasil (di perangkat sendiri maupun dari realtime)
// Barang tambahan diedit / dihapus dari Opname WEB
function pgSetelahTambahan(h) {
  const kode = h.kodeRak;
  if (h.kembaliBelum) delete pgState.status[kode];
  else if (h.status) pgState.status[kode] = { ...h.status, _t: Date.now() };
  delete pgState.konflik[kode];
  if (pgState.aktif === kode) {
    if (!pgState.modalDiubah) {
      pgState.modalVersi = (pgState.status[kode] && pgState.status[kode].versi) || '';
      delete pgState.draf[kode];
      pgSimpanDraf();
      pgTutupModal();
      pgBukaRak(kode);
    } else {
      pgSetInfo('merah', `Barang tambahan di rak ini baru saja ${h.jenis === 'tambahanHapus' ? 'dihapus' : 'diubah'} oleh <b>${pgEsc(pgNama(h.oleh))}</b>. Angka di layar Anda belum disimpan.`);
    }
  }
  pgRender();
}
function pgSetelahHapus(h) {
  const kode = h.kodeRak;
  if (h.kembaliBelum || h.jenis === 'rak') delete pgState.status[kode];
  else if (h.status) pgState.status[kode] = { ...h.status, _t: Date.now() };
  delete pgState.konflik[kode];

  if (pgState.aktif === kode) {
    if (h.jenis === 'rak' || h.kembaliBelum) pgState.tersimpan = {};
    else delete pgState.tersimpan[h.id];
    pgState.modalVersi = (pgState.status[kode] && pgState.status[kode].versi) || '';
    pgState.modalBaru = null;
    if (h.oleh === pgState.saya || !pgState.modalDiubah) {
      // Kosongkan angka di layar sesuai yang dihapus
      if (h.jenis === 'rak') {
        pgState.baris = pgState.baris.filter(b => !b.tambahan);
        pgState.baris.forEach(b => { b.qtyKirim = null; b.parts = [null, null, null]; });
        delete pgState.draf[kode];
      } else {
        const kena = b => h.jenis === 'tim' ? (!b.tambahan && b.tim === h.tim) : b.id === h.id;
        pgState.baris.forEach(b => { if (kena(b)) { b.qtyKirim = null; b.parts = [null, null, null]; delete pgState.tersimpan[b.id]; } });
        const d = pgState.draf[kode];
        if (d && d.qty) delete d.qty[h.id];
        if (d && d.parts) delete d.parts[h.id];
      }
      pgSimpanDraf();
      pgRenderBaris();
    } else {
      pgSetInfo('merah', `Hitungan ${h.jenis === 'rak' ? 'rak ini' : 'SKU ' + pgEsc(h.id)} baru saja dihapus oleh <b>${pgEsc(pgNama(h.oleh))}</b>. Angka di layar Anda belum disimpan.`);
    }
    pgTampilTombolHapusRak();
    if (h.oleh === pgState.saya || !pgState.modalDiubah) pgRenderInfoModal();
  } else if (h.oleh === pgState.saya) {
    if (h.jenis === 'rak') delete pgState.draf[kode];
    else if (pgState.draf[kode] && pgState.draf[kode].qty) delete pgState.draf[kode].qty[h.id];
    pgSimpanDraf();
  }
  pgRender();
}

// Hapus per SKU: semua akun. Hapus satu rak: superuser. Cukup konfirmasi "Ya".
async function pgMintaHapus(jenis, i) {
  const kode = pgState.aktif;
  if (!kode) return;
  if (jenis === 'rak' && !pgSuperuser()) { pgToast('Hapus hitungan satu rak hanya untuk superuser.', 'error'); return; }
  if (pgEntriAntrean(kode)) { pgToast('Rak ini masih menunggu tersimpan. Tunggu selesai dulu.', 'warning'); return; }
  const s = pgState.status[kode];
  const oleh = s ? `\n\nDihitung oleh ${s.petugas === pgState.saya ? 'Anda' : pgNama(s.petugas)} pukul ${pgJam(s.waktu)}.` : '';
  let target, pesan;
  if (jenis === 'rak' && pgState.tim) {
    const n = pgState.baris.filter(b => !b.tambahan && b.tim === pgState.tim && !pgKosong(pgState.tersimpan[b.id])).length;
    const nLain = Object.keys(pgState.tersimpan).length - n;
    target = { jenis: 'tim', kodeRak: kode, id: '', tim: pgState.tim };
    pesan = `${n} SKU Tim ${pgState.tim} di ${kode} akan dikosongkan.` + (nLain > 0 ? ` Hitungan tim lain (${nLain} SKU) tetap aman.` : '') + oleh;
    const ok = await pgKonfirmasi(`Yakin hapus hitungan Tim ${pgState.tim} di ${kode}?`, pesan, 'Ya, Hapus');
    if (ok) pgJalankanHapus(target);
    return;
  } else if (jenis === 'rak') {
    target = { jenis, kodeRak: kode, id: '' };
    pesan = `Semua Qty Real yang tersimpan di ${kode} akan dikosongkan dan kartu kembali "Belum".${oleh}`;
  } else {
    const b = pgState.baris[i];
    if (!b || pgKosong(pgState.tersimpan[b.id])) return;
    target = { jenis, kodeRak: kode, id: b.id };
    pesan = `${b.nama}\n${b.id}\nQty Real tersimpan: ${pgState.tersimpan[b.id]} → dikosongkan ("Belum Dihitung").${oleh}`;
  }
  const ok = await pgKonfirmasi(jenis === 'rak' ? 'Yakin hapus hitungan rak ' + kode + '?' : 'Yakin hapus hitungan ini?', pesan, 'Ya, Hapus');
  if (ok) pgJalankanHapus(target);
}

async function pgJalankanHapus(target) {
  try {
    const r = await pgApi('/api/pindah/hapus', { method: 'POST', body: JSON.stringify(target) });
    pgToast(r.message || 'Hitungan dihapus.', 'success');
    pgSetelahHapus({ ...target, oleh: pgState.saya, status: r.status, kembaliBelum: r.kembaliBelum });
  } catch (err) {
    pgToast(err.message, 'error');
  }
}

// ============================================================
// PRATINJAU FOTO PRODUK: thumbnail langsung tampil besar, lalu diganti versi tajam
// ============================================================
function pgLihatFoto(i) {
  const b = pgState.baris[i];
  if (!b || !b.img) return;
  const id = encodeURIComponent(b.img);
  const kecil = `${PG_ASSET_BASE}?id=${id}&thumbnail=true`, besar = `${PG_ASSET_BASE}?id=${id}`;
  const el = document.createElement('div');
  el.className = 'pg-foto-besar';
  el.innerHTML = `<img src="${kecil}" alt=""><div class="pg-foto-ket"><b>${pgEsc(b.nama)}</b><span>${pgEsc(b.id)}</span></div>
    <button type="button" aria-label="Tutup"><span class="material-symbols-outlined">close</span></button>`;
  el.addEventListener('click', () => el.remove());
  document.body.appendChild(el);
  const full = new Image();
  full.onload = () => { const im = el.querySelector('img'); if (im) im.src = besar; };
  full.src = besar;
}

// ============================================================
// AKHIR FILE

// ============================================================
// CARI DI DALAM RAK
// ============================================================
function pgCariDiRak(v) {
  const q = String(v || '').trim().toUpperCase();
  let n = 0;
  document.querySelectorAll('#pg-baris .pg-bx').forEach(el => {
    const isi = el.dataset.cari || '';
    const cocok = !q || isi.includes(q) || isi.includes(pgNormCari(q));
    el.classList.toggle('pg-sembunyi', !cocok);
    if (cocok) n++;
  });
  const info = document.getElementById('pg-cari-rak-info');
  if (info) info.textContent = q ? (n ? n + ' cocok' : 'Tidak ada') : '';
}

function pgSorotBaris(id) {
  const i = pgState.baris.findIndex(b => b.id === id);
  if (i < 0) return false;
  const c = document.getElementById('pg-cari-rak');
  if (c && c.value) { c.value = ''; pgCariDiRak(''); }
  const row = document.getElementById('pg-baris-' + i);
  if (!row) return false;
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.remove('pg-sorot'); void row.offsetWidth; row.classList.add('pg-sorot');
  const inp = row.querySelector('.pg-input[data-k="0"]');
  if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 350);
  return true;
}

// ============================================================
// SCAN QR LABEL (kamera HP)
// ============================================================
const PG_QR_LIB = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
let pgScanner = null, pgScanMode = 'cari', pgScanSelesai = false;

function pgMuatLibQr() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((ok, gagal) => {
    const sc = document.createElement('script');
    sc.src = PG_QR_LIB; sc.onload = ok; sc.onerror = () => gagal(new Error('Gagal memuat pemindai QR. Cek internet.'));
    document.head.appendChild(sc);
  });
}

// Flash: default nyala. Bila dimatikan, tetap mati selama sesi login ini (token sama).
const PG_KUNCI_FLASH = 'pg_flash_off_v1';
const PG_KUNCI_KAMERA = 'pg_kamera_v1';   // ID lensa utama yang sudah dipilih di HP ini
function pgFlashMati() { try { return localStorage.getItem(PG_KUNCI_FLASH) === (localStorage.getItem('sessionToken') || '-'); } catch (e) { return false; } }
function pgSetFlashMati(mati) {
  try { if (mati) localStorage.setItem(PG_KUNCI_FLASH, localStorage.getItem('sessionToken') || '-'); else localStorage.removeItem(PG_KUNCI_FLASH); } catch (e) {}
}

// Pilih lensa belakang UTAMA (hindari ultra-wide / tele / macro)
async function pgPilihKamera() {
  let cams = [];
  try { cams = await Html5Qrcode.getCameras(); } catch (e) { return null; }
  const belakang = cams.filter(c => /back|rear|belakang|environment|facing back/i.test(c.label || ''));
  const daftar = (belakang.length ? belakang : cams).filter(c => !/ultra|uw|tele|macro|depth|0\.5|wide angle/i.test(c.label || '') || /dual wide/i.test(c.label || ''));
  const kandidat = daftar.length ? daftar : (belakang.length ? belakang : cams);
  // Android: "camera2 0, facing back" = lensa utama → ambil nomor kamera terkecil
  const nomor = c => { const m = String(c.label || '').match(/camera\s*2?\s*(\d+)/i); return m ? Number(m[1]) : 99; };
  kandidat.sort((a, b) => nomor(a) - nomor(b));
  const ios = kandidat.find(c => /^back camera$/i.test(c.label || ''));
  return (ios || kandidat[0] || {}).id || null;
}

async function pgBukaScan(mode) {
  pgScanMode = mode; pgScanSelesai = false;
  pgTutupScan();
  const box = document.createElement('div');
  box.id = 'pg-scan';
  box.className = 'pg-scan';
  box.innerHTML = `
    <div class="pg-scan-atas"><span>Arahkan ke QR label barang</span>
      <button type="button" onclick="pgTutupScan()" aria-label="Tutup"><span class="material-symbols-outlined">close</span></button></div>
    <div id="pg-scan-video" class="pg-scan-video"></div>
    <div class="pg-scan-kontrol">
      <button type="button" id="pg-scan-flash" class="pg-scan-flash" style="display:none;" onclick="pgToggleFlash()">
        <span class="material-symbols-outlined">flashlight_on</span><small>Flash ON</small></button>
    </div>
    <p class="pg-scan-msg" id="pg-scan-msg">Menyalakan kamera…</p>`;
  document.body.appendChild(box);
  const pesan = t => { const m = document.getElementById('pg-scan-msg'); if (m) m.textContent = t; };
  try {
    await pgMuatLibQr();
    if (!document.getElementById('pg-scan')) return;
    pgScanner = new Html5Qrcode('pg-scan-video', {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    });
    const lebar = Math.min(280, Math.floor(window.innerWidth * 0.72));
    const mulai = async camId => {
      // 1280x720 + fokus otomatis: cukup tajam untuk label, kamera menyala lebih cepat dari 1920x1080
      const video = { width: { ideal: 1280 }, height: { ideal: 720 }, advanced: [{ focusMode: 'continuous' }] };
      if (camId) video.deviceId = { exact: camId }; else video.facingMode = 'environment';
      await pgScanner.start(camId || { facingMode: 'environment' },
        { fps: 15, qrbox: { width: lebar, height: lebar }, videoConstraints: video },
        teks => { if (!pgScanSelesai) { pgScanSelesai = true; pgBip(); pgHasilScan(teks); } }, () => {});
    };
    let camId = null;
    try { camId = localStorage.getItem(PG_KUNCI_KAMERA); } catch (e) {}
    try {
      if (!camId) {
        camId = await pgPilihKamera();
        if (camId) try { localStorage.setItem(PG_KUNCI_KAMERA, camId); } catch (e) {}
      }
      if (!document.getElementById('pg-scan')) { pgTutupScan(); return; }
      await mulai(camId);
    } catch (e1) {
      // ID lensa tersimpan sudah tidak berlaku (ganti HP / izin direset): pilih ulang sekali
      try { localStorage.removeItem(PG_KUNCI_KAMERA); } catch (e) {}
      if (!document.getElementById('pg-scan') || /Permission|NotAllowed/i.test(String(e1))) throw e1;
      camId = await pgPilihKamera();
      if (camId) try { localStorage.setItem(PG_KUNCI_KAMERA, camId); } catch (e) {}
      await mulai(camId);
    }
    pesan('Lensa utama · QR terbaca otomatis.');
    pgSiapkanFlash();
  } catch (err) {
    pesan(/Permission|NotAllowed/i.test(String(err)) ? 'Izin kamera ditolak. Izinkan kamera di pengaturan browser lalu buka lagi.'
      : (err.message || String(err) || 'Kamera tidak bisa dibuka.'));
  }
}

function pgTorch() {
  try { const f = pgScanner && pgScanner.getRunningTrackCameraCapabilities().torchFeature(); return f && f.isSupported() ? f : null; }
  catch (e) { return null; }
}
async function pgSiapkanFlash() {
  const f = pgTorch();
  const btn = document.getElementById('pg-scan-flash');
  if (!f || !btn) return;            // iPhone / kamera tanpa flash: tombol disembunyikan
  btn.style.display = '';
  const nyala = !pgFlashMati();
  try { await f.apply(nyala); } catch (e) {}
  pgTampilFlash(nyala);
}
async function pgToggleFlash() {
  const f = pgTorch();
  if (!f) return;
  const nyala = !(f.value() === true);
  try { await f.apply(nyala); } catch (e) { return; }
  pgSetFlashMati(!nyala);
  pgTampilFlash(nyala);
}
function pgTampilFlash(nyala) {
  const btn = document.getElementById('pg-scan-flash');
  if (!btn) return;
  btn.classList.toggle('nyala', nyala);
  btn.innerHTML = `<span class="material-symbols-outlined">${nyala ? 'flashlight_on' : 'flashlight_off'}</span><small>Flash ${nyala ? 'ON' : 'OFF'}</small>`;
}

function pgTutupScan() {
  const el = document.getElementById('pg-scan');
  const s = pgScanner; pgScanner = null;
  if (s) { try { s.stop().catch(() => {}).finally(() => { try { s.clear(); } catch (e) {} }); } catch (e) {} }
  if (el) el.remove();
}

function pgBip() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 1100; g.gain.value = 0.15; o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + 0.12);
  } catch (e) {}
  if (navigator.vibrate) navigator.vibrate(60);
}

// Isi QR bisa berupa SKU, link, atau teks lain: cari SKU yang dikenal di dalamnya
function pgCocokkanKode(teks) {
  const t = String(teks || '').trim().toUpperCase();
  if (!t) return null;
  const petaId = {};
  Object.values(pgState.rak).forEach(g => g.items.forEach(it => { const k = pgNormSku(it.id); (petaId[k] = petaId[k] || []).push({ kode: g.kode, id: it.id }); }));
  if (petaId[pgNormSku(t)]) return { jenis: 'sku', hasil: petaId[pgNormSku(t)] };
  const potong = t.split(/[^A-Z0-9-]+/).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const p of potong) if (petaId[pgNormSku(p)]) return { jenis: 'sku', hasil: petaId[pgNormSku(p)] };
  for (const p of potong) {   // mungkin kode shaf (0004C1) atau kode rak (0004C)
    const k = pgKodeRak(p);
    if (pgState.rak[p]) return { jenis: 'rak', kode: p };
    if (pgState.rak[k]) return { jenis: 'rak', kode: k };
  }
  return null;
}

function pgHasilScan(teks) {
  const c = pgCocokkanKode(teks);
  const msg = document.getElementById('pg-scan-msg');
  if (!c) {
    if (msg) msg.textContent = `"${String(teks).slice(0, 40)}" tidak ada di data CSV. Arahkan ke label lain.`;
    setTimeout(() => { pgScanSelesai = false; }, 1500);   // jeda supaya label yang sama tidak terbaca berulang
    return;
  }
  pgTutupScan();
  if (c.jenis === 'rak') {
    if (pgState.aktif !== c.kode) { if (pgState.aktif) pgTutupModal(); pgBukaRak(c.kode); }
    return;
  }
  const daftar = c.hasil;
  if (pgScanMode === 'rak' && pgState.aktif) {
    const di = daftar.find(h => h.kode === pgState.aktif);
    if (di) { pgSorotBaris(di.id); return; }
    pgSetInfo('merah', `<b>Barang nyasar:</b> ${pgEsc(daftar[0].id)} terdaftar di <b>${pgEsc(daftar.map(h => h.kode).join(', '))}</b>, bukan di ${pgEsc(pgState.aktif)}.`);
    pgToast(`SKU ini terdaftar di ${daftar.map(h => h.kode).join(', ')}, bukan ${pgState.aktif}.`, 'error');
    return;
  }
  const tuju = daftar[0];
  if (daftar.length > 1) pgToast(`SKU ini ada di ${daftar.length} rak: ${daftar.map(h => h.kode).join(', ')}. Membuka ${tuju.kode}.`, 'info');
  if (pgState.aktif === tuju.kode) { pgSorotBaris(tuju.id); return; }
  if (pgState.aktif) pgTutupModal();
  pgState.sorotId = tuju.id;
  pgBukaRak(tuju.kode);
}

// ============================================================
// BAGIAN ATAS RINGKAS (HP): terbuka saat diketuk, ringkas lagi saat layar digulir
// ============================================================
function pgToggleLipat(bagian) {
  const st = document.querySelector('#page-stok-opname .pg-sticky');
  if (!st) return;
  const kelas = 'buka-' + bagian;
  st.classList.toggle(kelas);
  pgState.lipatY = pgPosisiGulir();
}
function pgPosisiGulir() {
  const el = document.scrollingElement || document.documentElement;
  const main = document.querySelector('.main-content');
  return (el ? el.scrollTop : 0) + (main ? main.scrollTop : 0);
}
document.addEventListener('scroll', e => {
  const st = document.querySelector('#page-stok-opname .pg-sticky');
  if (!st || !(st.classList.contains('buka-filter') || st.classList.contains('buka-detail'))) return;
  const t = e.target;
  if (t && t.nodeType === 1 && (t.closest('.pg-chip-geser') || t.closest('#pg-modal-overlay') || t.closest('.pg-sticky'))) return;
  if (Math.abs(pgPosisiGulir() - (pgState.lipatY || 0)) > 40) st.classList.remove('buka-filter', 'buka-detail');
}, true);

function pgRenderRingkasAtas() {
  const f = document.getElementById('pg-filter-ringkas-teks');
  if (f) {
    const bag = [];
    if (pgState.tim) bag.push('Tim ' + pgState.tim);
    if (pgState.rakInduk) bag.push(pgState.rakInduk);
    if (pgState.blok) bag.push(pgState.blok);
    f.innerHTML = bag.length ? 'Filter: <b>' + bag.map(pgEsc).join(' › ') + '</b>' : 'Filter: <b>Semua Tim & Rak</b>';
  }
  const m = document.getElementById('pg-mini-teks');
  if (m) {
    const total = document.getElementById('pg-n-total')?.innerText || '0';
    const sel = document.getElementById('pg-n-selesai')?.innerText || '0';
    const sls = document.getElementById('pg-n-selisih')?.innerText || '0';
    const lebar = document.getElementById('pg-progress-bar')?.style.width || '0%';
    m.innerHTML = `<b>${sel}/${total}</b> rak dihitung${sls !== '0' ? ` · <span class="pg-teks-merah"><b>${sls}</b> selisih</span>` : ''}
      <div class="pg-mini-prog"><i style="width:${lebar}"></i></div>`;
  }
}

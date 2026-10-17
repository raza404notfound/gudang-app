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
const PG_SINKRON_MS   = 30000;   // sinkron status antar petugas
const PG_DETAK_MS     = 60000;   // perpanjang tanda "sedang dihitung"
const PG_PAKET_MAKS   = 10;      // maksimal rak per sekali kirim
const PG_KUNCI_ANTREAN = 'pg_antrean_v1';
const PG_KUNCI_DRAF    = 'pg_draf_v1';
const PG_KUNCI_PERANGKAT = 'pg_perangkat_v1';

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
  tim: '',          // filter tim ('' = semua)
  blok: '',         // filter blok ('' = semua)
  exportInfo: [],   // [{ label, waktuExport, baris }]
  exportTim: {},    // { tim: 'YYYY-MM-DD HH:MM' } export terbaru per tim
  // modal
  aktif: null,
  baris: [],
  modalVersi: '',
  modalDiubah: false,
  modalBaru: null,  // { petugas, waktu } bila rak ini disimpan orang lain saat modal terbuka
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
function pgBlok(kode) { const m = String(kode || '').match(/[A-Z]+$/); return m ? m[0] : 'Lain'; }
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
      'x-session-token': sessionStorage.getItem('sessionToken') || ''
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
  pgState.saya = pgState.saya || sessionStorage.getItem('sessionUser') || '';
  if (!pgState.sudahDimuat && !pgState.sedangMuat) pgMuat();
  else pgSinkron();
  pgMulaiSinkron();
  pgProsesAntrean();
}

function pgTampilkanTombolUpload() {
  const role = (typeof currentUserRole !== 'undefined' && currentUserRole) || sessionStorage.getItem('sessionRole') || '';
  const btn = document.getElementById('pg-btn-upload');
  if (btn) btn.style.display = role === 'superuser' ? 'inline-flex' : 'none';
}

async function pgMuat() {
  pgState.sedangMuat = true;
  pgSetStateBox('sync', 'Memuat data dari sheet LAPORAN BARANG...');
  const btn = document.getElementById('pg-btn-refresh');
  if (btn) btn.disabled = true;
  try {
    const data = await pgApi('/api/pindah/data');
    pgSusunMaster(data.master || []);
    pgState.status   = data.status || {};
    pgState.sedang   = data.sedang || {};
    pgState.sheetUrl = data.url || '';
    pgState.exportInfo = data.exportInfo || [];
    pgState.exportTim  = data.exportTim || {};
    if (data.saya) pgState.saya = data.saya;
    pgState.sudahDimuat = true;
    const link = document.getElementById('pg-btn-sheet');
    if (link) {
      link.href = pgState.sheetUrl || '#';
      link.style.display = pgState.sheetUrl ? 'inline-flex' : 'none';
    }
    pgRenderLabelExport();
    pgRenderChipFilter();
    pgRender();
  } catch (err) {
    pgSetStateBox('error', err.message);
    pgToast(err.message, 'error');
  } finally {
    pgState.sedangMuat = false;
    if (btn) btn.disabled = false;
  }
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
    g.totalCsv += qty;
    g.tim[it.tim] = true;
    if (it.export) g.export[it.export] = true;
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
    const d = await pgApi('/api/pindah/status');
    const baru = d.status || {};
    // Hasil simpan lokal yang lebih baru dari permintaan ini tetap dipakai
    Object.keys(pgState.status).forEach(k => {
      const lama = pgState.status[k];
      if (lama && lama._t && lama._t > mulai) baru[k] = lama;
    });
    pgState.status = baru;
    pgState.sedang = d.sedang || {};
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

function pgStatusEfektif(kode) {
  const e = pgEntriAntrean(kode);
  if (e) return { status: e.prediksi.status, nSelisih: e.prediksi.nSelisih, nBelum: e.prediksi.nBelum, antre: e.gagal ? 'gagal' : 'menyimpan', pesan: e.pesan };
  if (pgState.konflik[kode]) return { status: 'konflik', ...pgState.konflik[kode] };
  const s = pgState.status[kode];
  if (s && s.perluCek) return { status: 'ulang', nSelisih: s.nSelisih, nBelum: s.nBelum, petugas: s.petugas, waktu: s.waktu };
  if (s) return { status: s.status, nSelisih: s.nSelisih, nBelum: s.nBelum, petugas: s.petugas, waktu: s.waktu };
  return { status: 'belum' };
}

// Penanda dari perangkat lain (termasuk akun yang sama di HP lain)
function pgSedangLain(kode) {
  const daftar = [].concat(pgState.sedang[kode] || []);
  return daftar.find(s => s && s.petugas && (s.perangkat ? s.perangkat !== PG_PERANGKAT : s.petugas !== pgState.saya)) || null;
}
function pgSiapa(petugas) { return petugas === pgState.saya ? 'akun Anda di perangkat lain' : petugas; }
function pgLabelSedang(s) {
  if (!s) return '';
  if (s.petugas === pgState.saya) return 'Sedang dihitung di perangkat lain' + (s.jenis ? ' (' + s.jenis + ')' : '');
  return 'Sedang dihitung ' + s.petugas;
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
  document.getElementById('pg-progress-label').innerText = `${persen}% kode rak sudah dihitung`;
  pgUpdateBarAntrean();

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
    if (pgState.blok && pgBlok(k) !== pgState.blok) return false;
    if (pgState.filter !== 'semua') {
      const st = pgStatusEfektif(k).status;
      const cocok = pgState.filter === 'belum' ? (st === 'belum' || st === 'konflik' || st === 'sebagian') : st === pgState.filter;
      if (!cocok) return false;
    }
    if (!cari) return true;
    if (k.includes(cari)) return true;
    const g = pgState.rak[k];
    return g ? g.items.some(i => i.nama.toUpperCase().includes(cari) || i.id.toUpperCase().includes(cari)) : false;
  });

  if (!tampil.length) {
    pgSetStateBox('search_off', 'Tidak ada kode rak yang cocok dengan filter.');
    return;
  }

  const grid = document.getElementById('pg-grid');
  const ae = document.activeElement;
  const fokusKode = null;
  const daftar = tampil.join(',');

  if (grid.dataset.daftar !== daftar) {
    // Susunan kartu berubah (filter / cari / data baru): bangun ulang
    pgState.kartuHtml = {};
    grid.innerHTML = tampil.map(k => {
      const html = pgKartuHtml(k);
      pgState.kartuHtml[k] = html;
      return html;
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
  }
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
  const nProduk = g ? g.items.length : 0;
  const total   = g ? g.totalCsv : 0;
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
  } else if (s.status === 'ulang') {
    foot = `<div class="pg-card-info oranye"><span class="material-symbols-outlined">update</span>Qty Web berubah setelah dihitung. Buka untuk cek ulang.</div>`;
  } else if (s.status === 'konflik') {
    foot = `<div class="pg-card-info merah">Sudah disimpan ${pgEsc(pgSiapa(s.petugas))} pukul ${pgEsc(pgJam(s.waktu))}. Buka untuk cek.</div>`;
  } else if (s.status === 'sesuai' || s.status === 'selisih' || s.status === 'sebagian') {
    const isi = [];
    if (s.nSelisih) isi.push(`<span class="pg-teks-merah">${s.nSelisih} produk selisih</span>`);
    if (s.nBelum) isi.push(`<span class="pg-teks-amber">${s.nBelum} belum dihitung</span>`);
    if (!isi.length) isi.push(`<span class="pg-teks-hijau"><span class="material-symbols-outlined">check_circle</span>Semua sesuai</span>`);
    foot = `<div class="pg-card-foot">${isi.join('')}</div>`;
  }
  if (lain) {
    foot += `<div class="pg-card-info amber"><span class="material-symbols-outlined">person</span>${pgEsc(pgLabelSedang(lain))}</div>`;
  }

  // Tombol cepat: hanya untuk rak yang belum dihitung, tidak sedang dipegang orang lain
  let cepat = '';
  if (s.status === 'belum' && !s.antre && !lain && g && g.items.length) {
    const yakin = !!pgState.tapYakin[k];
    cepat = `<div class="pg-cepat" onclick="event.stopPropagation()">
        <button class="pg-cepat-btn ${yakin ? 'yakin' : ''}" onclick="pgCepatSesuai('${kEsc}')">
          <span class="material-symbols-outlined">${yakin ? 'touch_app' : 'check'}</span>${yakin ? 'Tap lagi untuk simpan' : 'Semua sesuai'}
        </button>
      </div>`;
  }

  return `<div class="pg-card pg-card-${kelas}${lain ? ' pg-card-dipegang' : ''}" data-kode="${kEsc}" onclick="pgBukaRak('${kEsc}')">
      <div class="pg-card-top">
        <span class="pg-card-kode">${kEsc}</span>
        <span class="pg-badge pg-badge-${kelas}">${badge}</span>
      </div>
      ${foto}
      <div class="pg-card-meta">${pgAngka(nProduk)} produk · ${pgAngka(total)} pcs</div>
      ${foot}
      ${cepat}
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

// Chip Tim dan Blok dibuat otomatis dari data
function pgRenderChipFilter() {
  const timHit = {}, blokHit = {};
  Object.values(pgState.rak).forEach(g => {
    Object.keys(g.tim).forEach(t => { timHit[t] = (timHit[t] || 0) + 1; });
    const b = pgBlok(g.kode);
    blokHit[b] = (blokHit[b] || 0) + 1;
  });
  const urutTim = Object.keys(timHit).sort((a, b) => {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na && nb) return Number(a) - Number(b);
    if (na !== nb) return na ? -1 : 1;
    return a.localeCompare(b);
  });
  const urutBlok = Object.keys(blokHit).sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (pgState.tim && !timHit[pgState.tim]) pgState.tim = '';
  if (pgState.blok && !blokHit[pgState.blok]) pgState.blok = '';
  const chip = (fn, nilai, label, n, aktif) =>
    `<button class="pg-chip-kecil ${aktif ? 'aktif' : ''}" onclick="${fn}('${pgEsc(nilai)}')">${pgEsc(label)}${n !== null ? `<small>${n}</small>` : ''}</button>`;
  const elT = document.getElementById('pg-chip-tim');
  const elB = document.getElementById('pg-chip-blok');
  if (elT) elT.innerHTML = `<span class="pg-chip-label">Tim</span>` + chip('pgSetTim', '', 'Semua', null, !pgState.tim) +
    urutTim.map(t => chip('pgSetTim', t, t, timHit[t], pgState.tim === t)).join('');
  if (elB) elB.innerHTML = `<span class="pg-chip-label">Blok</span>` + chip('pgSetBlok', '', 'Semua', null, !pgState.blok) +
    urutBlok.map(b => chip('pgSetBlok', b, b, blokHit[b], pgState.blok === b)).join('');
}
function pgSetTim(t)  { pgState.tim = t;  pgRenderChipFilter(); pgRender(); }
function pgSetBlok(b) { pgState.blok = b; pgRenderChipFilter(); pgRender(); }

function pgSetFilter(f, el) {
  pgState.filter = f;
  document.querySelectorAll('.pg-chip').forEach(c => c.classList.remove('aktif'));
  if (el) el.classList.add('aktif');
  pgRender();
}
function pgCari(v) { pgState.cari = v || ''; if (pgState.sudahDimuat) pgRender(); }

// ============================================================
// TOMBOL CEPAT DI KARTU
// ============================================================
function pgCepatSesuai(kode) {
  const g = pgState.rak[kode];
  if (!g) return;
  // Tap pertama = minta yakin, tap kedua dalam 3 detik = simpan
  if (!pgState.tapYakin[kode]) {
    pgState.tapYakin[kode] = Date.now();
    pgRenderKartu(kode);
    setTimeout(() => {
      if (pgState.tapYakin[kode] && Date.now() - pgState.tapYakin[kode] >= 2900) {
        delete pgState.tapYakin[kode];
        pgRenderKartu(kode);
      }
    }, 3000);
    return;
  }
  delete pgState.tapYakin[kode];
  const items = g.items.map(i => ({
    id: i.id, lokasi: i.lokasi.join(', '), nama: i.nama, varian: i.varian,
    qtyCsv: i.qtyCsv, qtyKirim: i.qtyCsv, export: i.export
  }));
  pgAntre({ kodeRak: kode, items, versiDasar: pgState.status[kode]?.versi || '', paksa: false });
}

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
          petugas: h.petugas, waktu: h.waktu, versi: h.versi, perangkat: h.perangkat || PG_PERANGKAT, _t: Date.now() };
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
  pgState.baris = pgBarisDariMaster(g, d && d.qty ? d.qty : null);
  if (d && Array.isArray(d.tambahan)) d.tambahan.forEach(t => pgState.baris.push(pgBarisTambahan(t.nama, t.qty, kode)));

  document.getElementById('pg-modal-kode').innerText = kode;
  document.getElementById('pg-tambah-nama').value = '';
  document.getElementById('pg-tambah-qty').value = '';
  pgRenderInfoModal();
  pgRenderBaris();
  document.getElementById('pg-modal-overlay').classList.add('tampil');
  document.body.style.overflow = 'hidden';

  // Tanda "sedang dihitung" + perpanjang tiap menit
  pgTandai(kode, 'buka');
  clearInterval(pgState.timerDetak);
  pgState.timerDetak = setInterval(() => { if (pgState.aktif === kode) pgTandai(kode, 'buka'); }, PG_DETAK_MS);

  // Ambil isi terbaru dari sheet bila rak ini sudah pernah dihitung (tanpa menimpa draf)
  const perluServer = s || pgState.konflik[kode];
  if (perluServer && !(d && d.qty)) {
    pgSetInfo('memuat', 'Memuat hitungan tersimpan...');
    try {
      const r = await pgApi('/api/pindah/rak?kode=' + encodeURIComponent(kode));
      if (pgState.aktif !== kode || pgState.modalDiubah) return;
      const qty = {};
      const tambahan = [];
      (r.items || []).forEach(it => {
        if (String(it.id).startsWith('TAMBAHAN')) tambahan.push({ nama: it.nama, qty: it.qtyKirim });
        else qty[it.id] = pgKosong(it.qtyKirim) ? null : it.qtyKirim;
      });
      pgState.baris = pgBarisDariMaster(g, qty);
      tambahan.forEach(t => pgState.baris.push(pgBarisTambahan(t.nama, t.qty, kode)));
      pgState.modalVersi = r.versi || pgState.modalVersi;
      pgRenderBaris();
    } catch (err) {
      if (pgState.aktif === kode) pgToast('Gagal memuat hitungan tersimpan: ' + err.message, 'error');
    }
    if (pgState.aktif === kode) pgRenderInfoModal();
  }
}

function pgBarisDariMaster(g, qty) {
  return (g ? g.items : []).map(i => ({
    id: i.id, nama: i.nama, varian: i.varian, img: i.img,
    lokasi: i.lokasi.join(', '),
    qtyCsv: i.qtyCsv,
    qtyKirim: qty && !pgKosong(qty[i.id]) ? Number(qty[i.id]) : null,
    tambahan: false, tim: i.tim, export: i.export
  }));
}
function pgBarisTambahan(nama, qty, kode) {
  return { id: 'TAMBAHAN-' + Math.random().toString(36).slice(2, 8), nama, varian: '', img: '', lokasi: kode,
           qtyCsv: 0, qtyKirim: pgKosong(qty) ? null : Number(qty), tambahan: true, tim: '', export: '' };
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
  if (lain) { jenis = jenis === 'merah' ? jenis : 'amber'; pesan.push(`<b>${pgEsc(pgLabelSedang(lain))}</b>. Pastikan rak ini tidak dihitung dua kali.`); }
  if (pgState.draf[kode] && pgState.draf[kode].qty) pesan.push('Angka di bawah dari draf di HP ini (belum tersimpan ke sheet).');
  else if (s && !k) pesan.push(`Sudah dihitung oleh ${pgEsc(s.petugas)} pukul ${pgEsc(pgJam(s.waktu))}. Simpan lagi akan memperbarui data.`);

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
  pgApi('/api/pindah/tandai', { method: 'POST', body: JSON.stringify({ kodeRak: kode, aksi, perangkat: PG_PERANGKAT, jenis: PG_JENIS }) }).catch(() => {});
}

function pgRenderBaris() {
  const wrap = document.getElementById('pg-baris');
  if (!pgState.baris.length) {
    wrap.innerHTML = '<div class="pg-state-box kecil"><p>Tidak ada produk tercatat di kode rak ini.</p></div>';
  } else {
    wrap.innerHTML = pgState.baris.map((b, i) => {
      const img = b.img
        ? `<img class="pg-thumb" loading="lazy" src="${PG_ASSET_BASE}?id=${encodeURIComponent(b.img)}&thumbnail=true" onerror="this.outerHTML='<div class=&quot;pg-thumb pg-thumb-kosong&quot;><span class=&quot;material-symbols-outlined&quot;>image_not_supported</span></div>'">`
        : `<div class="pg-thumb pg-thumb-kosong"><span class="material-symbols-outlined">${b.tambahan ? 'add_box' : 'image_not_supported'}</span></div>`;
      const timPilih = pgState.tim && b.tim === pgState.tim;
      return `<div class="pg-baris${timPilih ? ' pg-baris-tim' : ''}" id="pg-baris-${i}">
          ${img}
          <div class="pg-baris-info">
            <div class="pg-baris-nama">${pgEsc(b.nama)}${b.varian ? ` <span class="pg-muted">· ${pgEsc(b.varian)}</span>` : ''}</div>
            <div class="pg-baris-sub">${b.tambahan ? '<span class="pg-tag-tambahan">Tidak ada di web</span>' : pgEsc(b.lokasi)}${b.tim ? ` <span class="pg-tag-tim${timPilih ? ' pilih' : ''}">Tim ${pgEsc(b.tim)}</span>` : ''}</div>
          </div>
          <div class="pg-baris-angka">
            <div class="pg-catatan"><span>Qty Web</span><b>${pgAngka(b.qtyCsv)}</b></div>
            <input type="number" inputmode="numeric" min="0" class="pg-input" data-i="${i}"
              value="${pgKosong(b.qtyKirim) ? '' : b.qtyKirim}"
              placeholder="Real" oninput="pgUbahQty(${i}, this.value)" onkeydown="pgEnterBerikut(event, ${i})">
            <div class="pg-selisih" id="pg-selisih-${i}"></div>
            ${b.tambahan ? `<button class="pg-hapus" title="Hapus" onclick="pgHapusTambahan(${i})"><span class="material-symbols-outlined">close</span></button>` : ''}
          </div>
        </div>`;
    }).join('');
  }
  pgState.baris.forEach((_, i) => pgUpdateSelisih(i));
  pgUpdateRingkasModal();
}

// Simpan isi modal sebagai draf di HP (dipanggil setiap ada perubahan)
function pgDrafModal() {
  const kode = pgState.aktif;
  if (!kode) return;
  pgState.modalDiubah = true;
  const qty = {};
  const tambahan = [];
  pgState.baris.forEach(b => {
    if (b.tambahan) tambahan.push({ nama: b.nama, qty: b.qtyKirim });
    else qty[b.id] = b.qtyKirim;
  });
  pgState.draf[kode] = { qty, tambahan, t: Date.now() };
  pgSimpanDraf();
}

function pgUbahQty(i, v) {
  pgState.baris[i].qtyKirim = v === '' ? null : Math.max(0, Math.floor(Number(v)));
  pgUpdateSelisih(i);
  pgUpdateRingkasModal();
  pgDrafModal();
}


function pgUpdateSelisih(i) {
  const b = pgState.baris[i];
  const el = document.getElementById('pg-selisih-' + i);
  const row = document.getElementById('pg-baris-' + i);
  if (!el || !row) return;
  row.classList.remove('pg-ok', 'pg-kurang', 'pg-lebih');
  if (pgKosong(b.qtyKirim)) { el.innerHTML = ''; return; }
  const d = b.qtyKirim - b.qtyCsv;
  if (d === 0) { el.innerHTML = '<span class="material-symbols-outlined">check_circle</span>'; row.classList.add('pg-ok'); }
  else { el.innerText = (d > 0 ? '+' : '') + d; row.classList.add(d < 0 ? 'pg-kurang' : 'pg-lebih'); }
}

function pgUpdateRingkasModal() {
  const kosong  = pgState.baris.filter(b => pgKosong(b.qtyKirim)).length;
  const selisih = pgState.baris.filter(b => !pgKosong(b.qtyKirim) && b.qtyKirim !== b.qtyCsv).length;
  const total   = pgState.baris.reduce((s, b) => s + (Number(b.qtyKirim) || 0), 0);
  const totCsv  = pgState.baris.reduce((s, b) => s + (Number(b.qtyCsv) || 0), 0);
  document.getElementById('pg-modal-ringkas').innerHTML =
    `<span>${pgAngka(pgState.baris.length)} produk</span>
     <span>Qty Web <b>${pgAngka(totCsv)}</b> pcs</span>
     <span>Qty Real <b>${pgAngka(total)}</b> pcs</span>
     ${kosong ? `<span class="pg-teks-amber">${kosong} belum dihitung</span>` : ''}
     ${selisih ? `<span class="pg-teks-merah">${selisih} selisih</span>` : (kosong ? '' : '<span class="pg-teks-hijau">Semua sesuai</span>')}`;
}

function pgEnterBerikut(e, i) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const next = document.querySelector(`.pg-input[data-i="${i + 1}"]`);
  if (next) { next.focus(); next.select(); }
  else document.getElementById('pg-btn-simpan').focus();
}

function pgIsiSemuaSesuai() {
  pgState.baris.forEach(b => { if (!b.tambahan) b.qtyKirim = b.qtyCsv; });
  pgRenderBaris();
  pgDrafModal();
}

async function pgKosongkan() {
  const ok = await pgKonfirmasi('Kosongkan', 'Semua angka Qty Real dan barang tambahan di rak ini akan dihapus dari draf.', 'Ya, Kosongkan');
  if (!ok) return;
  pgState.baris = pgState.baris.filter(b => !b.tambahan);
  pgState.baris.forEach(b => { b.qtyKirim = null; });
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
  const daftarSelisih = pgState.baris.filter(b => !pgKosong(b.qtyKirim) && b.qtyKirim !== b.qtyCsv)
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
    qtyCsv: Number(b.qtyCsv) || 0, qtyKirim: pgKosong(b.qtyKirim) ? '' : Number(b.qtyKirim), export: b.export || ''
  }));
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
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pgState.aktif) pgTutupModal();
});

// Lanjutkan antrean yang tertinggal (misal HP sempat ter-refresh) walau belum membuka menu ini
if (pgState.antrean.length) setTimeout(() => { if (sessionStorage.getItem('sessionToken')) pgProsesAntrean(); }, 3000);

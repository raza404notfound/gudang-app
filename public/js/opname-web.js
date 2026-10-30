// opname-web.js — Menu "Opname WEB"
// Tampilan dan fitur sama dengan menu "Opname Sheet" (Pusat Inventory),
// tetapi datanya dibaca dari sheet LAPORAN BARANG (hasil menu Stok Opname):
//   Qty sistem  = Qty Web        Total Real = Qty Real terakhir
//   Real 1/2/3  = 3 hitungan terakhir di bulan itu (dari tab Riwayat Hitung)
//   Personil    = petugas yang terakhir menyimpan
// Termasuk lihat & input Barang Rusak (disimpan di tab "Barang Rusak").

const OW_ASSET_BASE  = 'https://pdcgudang.et.r.appspot.com/v1/assets/get';
const OW_PER_HALAMAN = 60;
const OW_NAMA_BULAN  = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

let owSemuaData    = [];
let owDataFilter   = [];
let owHalamanAkt   = 1;
let owStatusAkt    = 'Semua';
let owSesiAktif    = '';
let owSudahInit    = false;
let owPersonilList = [];
let owPersonilAktif = '';
let owPersonilIdx  = -1;
let owViewMode     = 'grid';
let owRusakAktif   = null;

if (typeof PAGE_DATA_LOADERS !== 'undefined') {
  PAGE_DATA_LOADERS['opname-web'] = () => owInit();
}

// ---------- Helper ----------
function owEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function owNamaBulan(sesi) {
  const m = String(sesi || '').match(/(\d{4})-(\d{2})/);
  return m ? `${OW_NAMA_BULAN[Number(m[2]) - 1]} ${m[1]}` : sesi;
}
async function owApi(url, opsi = {}) {
  const res = await fetch(url, { ...opsi, headers: { 'Content-Type': 'application/json', 'x-session-token': sessionStorage.getItem('sessionToken') || '' } });
  if (res.status === 401) throw new Error('Sesi habis. Silakan login ulang.');
  const data = await res.json().catch(() => ({ success: false, message: 'Respons server tidak valid.' }));
  if (!data.success) throw new Error(data.message || 'Permintaan gagal.');
  return data;
}
function owCari(kunci) { return owSemuaData.find(r => r.kunci === kunci); }

// ---------- Tampilan grid / list & status ----------
function owSetView(mode) {
  owViewMode = mode;
  document.getElementById('ow-btn-grid').classList.toggle('aktif', mode === 'grid');
  document.getElementById('ow-btn-list').classList.toggle('aktif', mode === 'list');
  owRenderTabel();
}
function owSetStatus(status, el) {
  owStatusAkt  = status;
  owHalamanAkt = 1;
  document.querySelectorAll('#page-opname-web .pi-chip').forEach(c => c.className = 'pi-chip');
  el.classList.add('aktif-' + status);
  owFilter();
}

// ---------- Autocomplete personil ----------
function owPersonilInput() {
  const q  = (document.getElementById('ow-personil-input').value || '').toLowerCase().trim();
  const dd = document.getElementById('ow-personil-dropdown');
  owPersonilIdx = -1;
  if (!q) {
    owPersonilAktif = '';
    document.getElementById('ow-personil-input').style.borderColor = '';
    dd.style.display = 'none';
    owFilter(); return;
  }
  const hits = owPersonilList.filter(n => n.toLowerCase().includes(q));
  if (!hits.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = hits.map((nama, i) => {
    const idxH = nama.toLowerCase().indexOf(q);
    const hl = idxH >= 0 ? owEsc(nama.slice(0, idxH)) + '<b style="color:#8a6d1f;">' + owEsc(nama.slice(idxH, idxH + q.length)) + '</b>' + owEsc(nama.slice(idxH + q.length)) : owEsc(nama);
    return `<div class="so-personil-item" data-nama="${owEsc(nama)}" data-idx="${i}"
      style="padding:8px 13px;cursor:pointer;font-size:13px;color:#334155;border-bottom:1px solid #f8fafc;transition:background .1s;"
      onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
      onclick="owPersonilPilih(this.dataset.nama)">${hl}</div>`;
  }).join('');
  dd.style.display = '';
  setTimeout(() => document.addEventListener('click', owPersonilTutupDd, { once: true }), 0);
}
function owPersonilKeydown(e) {
  const dd = document.getElementById('ow-personil-dropdown');
  const items = dd.querySelectorAll('.so-personil-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); owPersonilIdx = Math.min(owPersonilIdx + 1, items.length - 1); owPersonilHighlight(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); owPersonilIdx = Math.max(owPersonilIdx - 1, 0); owPersonilHighlight(items); }
  else if (e.key === 'Enter') { e.preventDefault(); if (owPersonilIdx >= 0 && items[owPersonilIdx]) owPersonilPilih(items[owPersonilIdx].dataset.nama); }
  else if (e.key === 'Escape') owPersonilTutupDd();
}
function owPersonilHighlight(items) {
  items.forEach((el, i) => { el.style.background = i === owPersonilIdx ? '#faf6ec' : ''; el.style.color = i === owPersonilIdx ? '#8a6d1f' : '#334155'; });
  if (items[owPersonilIdx]) items[owPersonilIdx].scrollIntoView({ block: 'nearest' });
}
function owPersonilPilih(nama) {
  owPersonilAktif = nama;
  const input = document.getElementById('ow-personil-input');
  input.value = nama; input.style.borderColor = '#475569';
  document.getElementById('ow-personil-dropdown').style.display = 'none';
  owFilter();
}
function owPersonilTutupDd(e) {
  const wrap = document.getElementById('ow-personil-wrap');
  if (e && wrap && wrap.contains(e.target)) return;
  document.getElementById('ow-personil-dropdown').style.display = 'none';
}

// ---------- Muat data ----------
async function owInit() {
  const role = (typeof currentUserRole !== 'undefined' && currentUserRole) || sessionStorage.getItem('sessionRole') || '';
  const btnRh = document.getElementById('ow-btn-riwayat-hapus');
  if (btnRh) btnRh.style.display = role === 'superuser' ? '' : 'none';
  if (owSudahInit) { owSegarDiam(); return; }
  owSudahInit = true;
  await owMuat('');
}
// Buka ulang menu: data lama tetap tampil, cek perubahan di belakang layar
async function owSegarDiam() {
  const bulan = owSesiAktif, ke = owMuatKe;
  try {
    const data = await owApi('/api/pindah/opname?bulan=' + encodeURIComponent(bulan || ''));
    if (ke !== owMuatKe || bulan !== owSesiAktif) return;
    owCacheTulis(bulan, data);
    if (JSON.stringify(data.rows) !== JSON.stringify(owSemuaData)) owTerapkan(data, true);
  } catch (e) {}
}

// Cache perangkat: tampil instan dari data terakhir, lalu diperbarui diam-diam di belakang
const OW_CACHE = 'ow_cache_v1';
function owCacheBaca(bulan) {
  try { const c = JSON.parse(localStorage.getItem(OW_CACHE) || '{}'); return c[bulan || ''] || null; } catch (e) { return null; }
}
function owCacheTulis(bulan, data) {
  try {
    const c = JSON.parse(localStorage.getItem(OW_CACHE) || '{}');
    const isi = { daftarBulan: data.daftarBulan, bulan: data.bulan, rows: data.rows, personil: data.personil };
    const baru = { '': c[''] && c[''].bulan === data.bulan ? isi : c[''] };   // simpan maksimal 2 kunci supaya ringan
    baru[bulan || ''] = isi;
    if (!bulan) baru[data.bulan || ''] = isi;
    localStorage.setItem(OW_CACHE, JSON.stringify(baru));
  } catch (e) { try { localStorage.removeItem(OW_CACHE); } catch (x) {} }
}
function owTerapkan(data, pertahankanFilter) {
  const sel = document.getElementById('ow-sesi-select');
  sel.innerHTML = '<option value="">— Pilih Bulan SO —</option>' +
    (data.daftarBulan || []).map(b => `<option value="${owEsc(b)}">${owEsc(owNamaBulan(b))}</option>`).join('');
  sel.value = data.bulan || '';
  owSesiAktif = data.bulan || '';
  owSemuaData = data.rows || [];
  owPersonilList = data.personil || [];
  opIsiTim('ow-tim', owSemuaData);
  owHitungStats();
  owFilter();   // filter/cari yang sedang diketik tetap dipakai
}
let owMuatKe = 0;
async function owMuat(bulan, segar) {
  const sel = document.getElementById('ow-sesi-select');
  const ke = ++owMuatKe;
  const cache = segar ? null : owCacheBaca(bulan);
  owReset();
  if (cache) owTerapkan(cache);
  else { sel.disabled = true; owTampilLoading('Memuat data dari sheet LAPORAN BARANG...'); }
  try {
    const data = await owApi('/api/pindah/opname?bulan=' + encodeURIComponent(bulan || '') + (segar ? '&segar=1' : ''));
    if (ke !== owMuatKe) return;
    owCacheTulis(bulan, data);
    const sama = cache && JSON.stringify(cache.rows) === JSON.stringify(data.rows) &&
      JSON.stringify(cache.daftarBulan) === JSON.stringify(data.daftarBulan);
    if (!sama) owTerapkan(data, !!cache);
  } catch (err) {
    if (ke !== owMuatKe) return;
    if (!cache) { owSudahInit = false; owTampilPesan('error', err.message || 'Gagal memuat data.'); }
  } finally {
    if (ke === owMuatKe) sel.disabled = false;
  }
}

function owGantiSesi() {
  const sesi = document.getElementById('ow-sesi-select').value;
  if (!sesi) return;
  owMuat(sesi);
}

function owReset() {
  owSemuaData = []; owDataFilter = []; owHalamanAkt = 1; owStatusAkt = 'Semua'; owPersonilAktif = '';
  document.querySelectorAll('#page-opname-web .pi-chip').forEach(c => c.className = 'pi-chip');
  document.getElementById('ow-chip-Semua').classList.add('aktif-Semua');
  ['ow-cari', 'ow-rak-filter', 'ow-personil-input', 'ow-personil', 'ow-tim'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ow-personil-input').style.borderColor = '';
  document.getElementById('ow-personil-dropdown').style.display = 'none';
  document.getElementById('ow-stats').style.display    = 'none';
  document.getElementById('ow-info-bar').style.display = 'none';
  document.getElementById('ow-pager').style.display    = 'none';
  document.getElementById('ow-view-container').style.display = 'none';
}

// ---------- Filter & urutan ----------
function owFilter() {
  // Pilihan Rak & Personil ikut Tim yang dipilih
  const lolosTim = owSemuaData.filter(r => opCocokTim('ow-tim', r));
  opIsiRak('ow-rak-filter', lolosTim);
  opIsiPersonil('ow-personil', owPersonilList, lolosTim, owPersonilAktif);
  if (owPersonilAktif && document.getElementById('ow-personil').value !== owPersonilAktif) owPersonilAktif = '';
  const cari       = (document.getElementById('ow-cari').value || '').toLowerCase();
  const rak        = (document.getElementById('ow-rak-filter').value || '').toLowerCase();
  const personilKw = (owPersonilAktif || '').toLowerCase();
  const sort       = document.getElementById('ow-sort-select').value;

  owDataFilter = owSemuaData.filter(r => {
    if (owStatusAkt !== 'Semua' && r.status !== owStatusAkt) return false;
    if (rak && String(r.rak).toLowerCase() !== rak) return false;
    if (personilKw && !String(r.personil || '').toLowerCase().includes(personilKw)) return false;
    if (!opCocokTim('ow-tim', r)) return false;
    if (cari && !(r.sku + ' ' + r.namaProduk).toLowerCase().includes(cari)) return false;
    return true;
  });

  const statusOrder = { 'Minus': 0, 'Plus': 1, 'Balance': 2, 'Belum': 3 };
  owDataFilter.sort((a, b) => {
    if (sort === 'rak')          return opBandingRak(a, b);
    if (sort === 'qty-desc')     return (b.qtySistem || 0) - (a.qtySistem || 0);
    if (sort === 'qty-asc')      return (a.qtySistem || 0) - (b.qtySistem || 0);
    if (sort === 'nama')         return String(a.namaProduk).localeCompare(String(b.namaProduk));
    if (sort === 'selisih-desc') return Math.abs(b.selisih || 0) - Math.abs(a.selisih || 0);
    if (sort === 'status')       return (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
    return 0;
  });

  owHalamanAkt = 1;
  owRenderTabel();
  owUpdateInfoBar();
  owTampilKirimTim();
}
function owPilihPersonil(nama) {
  owPersonilAktif = nama || '';
  document.getElementById('ow-personil-input').value = owPersonilAktif;
  owFilter();
}
function owPersonilChip(nama) {
  if (nama === owPersonilAktif) { document.getElementById('ow-personil-input').value = ''; owPersonilInput(); }
  else owPersonilPilih(nama);
}
function owResetFilter() {
  ['ow-cari', 'ow-rak-filter', 'ow-personil-input', 'ow-personil', 'ow-tim'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('ow-personil-input').style.borderColor = '';
  document.getElementById('ow-sort-select').value = 'rak';
  owPersonilAktif = '';
  owSetStatus('Semua', document.getElementById('ow-chip-Semua'));
}

// ---------- Render ----------
function owRenderTabel() {
  const container = document.getElementById('ow-view-container');
  const stateBox  = document.getElementById('ow-state-box');
  const pager     = document.getElementById('ow-pager');

  if (!owDataFilter.length) {
    container.style.display = 'none';
    pager.style.display = 'none';
    owTampilPesan('empty', owSemuaData.length ? 'Tidak ada data yang sesuai filter.' : 'Belum ada data. Upload CSV di menu Stok Opname.');
    return;
  }
  stateBox.style.display = 'none';
  container.style.display = '';

  const total  = owDataFilter.length;
  const maxHal = Math.ceil(total / OW_PER_HALAMAN);
  owHalamanAkt = Math.min(owHalamanAkt, maxHal);
  const mulai  = (owHalamanAkt - 1) * OW_PER_HALAMAN;
  const slice  = owDataFilter.slice(mulai, mulai + OW_PER_HALAMAN);

  // Satu tampilan: tabel di laptop, kartu di HP (lihat opname-ui.js)
  container.className = 'op-wrap';
  container.innerHTML = opDaftarHtml(slice, { id: 'ow', status: r => r.status || 'Belum' });

  if (maxHal > 1) {
    pager.style.display = '';
    document.getElementById('ow-pager-info').textContent  = `${owHalamanAkt} / ${maxHal}`;
    document.getElementById('ow-pager-count').textContent = `${mulai + 1}–${Math.min(mulai + OW_PER_HALAMAN, total)} dari ${total}`;
    document.getElementById('ow-btn-prev').disabled = owHalamanAkt <= 1;
    document.getElementById('ow-btn-next').disabled = owHalamanAkt >= maxHal;
  } else {
    pager.style.display = 'none';
  }
}

function owSelisihHtml(r, kecil) {
  if (r.selisih === '' || r.selisih === 0) return '';
  const fs = kecil ? 'font-size:11px;' : 'font-size:11px;';
  return r.selisih < 0
    ? `<span style="${fs}color:#be123c;font-weight:700;">▼${r.selisih}</span>`
    : `<span style="${fs}color:#2563eb;font-weight:700;">▲+${r.selisih}</span>`;
}
function owKunciEnc(r) { return encodeURIComponent(r.kunci); }

function owRenderCard(r) {
  const foto = r.kodeGambar
    ? `<img class="pi-card-img" loading="lazy" src="${OW_ASSET_BASE}?id=${encodeURIComponent(r.kodeGambar)}&thumbnail=true" onerror="this.outerHTML='<div class=\\'pi-card-img-placeholder\\'><span class=\\'material-symbols-outlined\\' style=\\'font-size:36px;\\'>image_not_supported</span></div>'">`
    : `<div class="pi-card-img-placeholder"><span class="material-symbols-outlined" style="font-size:36px;">image_not_supported</span></div>`;
  return `<div class="pi-card" onclick="owOpenDetail('${owKunciEnc(r)}')">
    ${foto}
    <span class="pi-status-badge pi-badge-${r.status}">${r.status}</span>
    ${r.perluCek ? '<span class="ow-badge-cek" title="Qty Web berubah setelah dihitung">Cek Ulang</span>' : ''}
    <div class="pi-card-body">
      <div class="pi-card-name">${owEsc(r.namaProduk)}</div>
      <div class="pi-card-sku">${owEsc(r.sku)}</div>
      <div class="pi-card-meta">
        <div>
          <div class="pi-card-qty">${r.qtySistem}</div>
          <div style="font-size:9px;color:#94a3b8;">qty web</div>
        </div>
        <div style="text-align:right;">
          <div class="pi-card-rak" title="${owEsc(r.lokasi)}">${owEsc(r.rak)}</div>
          <div style="margin-top:2px;">${owSelisihHtml(r)}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function owRenderListItem(r) {
  const foto = r.kodeGambar
    ? `<img class="pi-list-thumb" loading="lazy" src="${OW_ASSET_BASE}?id=${encodeURIComponent(r.kodeGambar)}&thumbnail=true" onerror="this.outerHTML='<div class=\\'pi-list-thumb-ph\\'><span class=\\'material-symbols-outlined\\' style=\\'font-size:22px;\\'>image_not_supported</span></div>'">`
    : `<div class="pi-list-thumb-ph"><span class="material-symbols-outlined" style="font-size:22px;">image_not_supported</span></div>`;
  return `<div class="pi-list-item" onclick="owOpenDetail('${owKunciEnc(r)}')">
    ${foto}
    <div class="pi-list-info">
      <div class="pi-list-name">${owEsc(r.namaProduk)}</div>
      <div class="pi-list-sub">${owEsc(r.sku)}</div>
      <div class="pi-list-rak">Rak: <b>${owEsc(r.rak)}</b> · Tim: ${owEsc(r.tim || '—')} · <span class="pi-status-badge pi-badge-${r.status}" style="position:static;display:inline-block;">${r.status}</span> ${owSelisihHtml(r)}${r.perluCek ? ' <span class="ow-badge-cek" style="position:static;">Cek Ulang</span>' : ''}</div>
    </div>
    <div class="pi-list-qty">${r.qtySistem}</div>
  </div>`;
}

// ---------- Detail produk ----------
function owOpenDetail(kunciEnc) {
  const row = owCari(decodeURIComponent(kunciEnc));
  const overlay = document.getElementById('ow-detail-overlay');
  const content = document.getElementById('ow-detail-content');
  if (!row) return;

  const imgEl = document.getElementById('ow-detail-img');
  if (row.kodeGambar) { imgEl.src = `${OW_ASSET_BASE}?id=${encodeURIComponent(row.kodeGambar)}&thumbnail=true`; imgEl.style.display = ''; }
  else imgEl.style.display = 'none';
  document.getElementById('ow-detail-nama').textContent = row.namaProduk;
  document.getElementById('ow-detail-sku').textContent  = row.sku;

  const norm = row.status;
  const badgeColor = { 'Balance': '#dcfce7', 'Plus': '#dbeafe', 'Minus': '#fee2e2', 'Belum': '#f1f5f9' };
  const badgeText  = { 'Balance': '#15803d', 'Plus': '#1d4ed8', 'Minus': '#be123c', 'Belum': '#334155' };
  document.getElementById('ow-detail-meta').innerHTML = `
    <span style="background:${badgeColor[norm] || '#f1f5f9'};color:${badgeText[norm] || '#475569'};border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">${norm}</span>
    <span style="font-size:11px;color:#94a3b8;">Rak: <b style="color:#f8fafc;">${owEsc(row.rak)}</b></span>
    <span style="font-size:11px;color:#94a3b8;">Tim: <b style="color:#f8fafc;">${owEsc(row.tim || '—')}</b></span>
    <span style="font-size:11px;color:#94a3b8;">Web: <b style="color:#475569;">${row.qtySistem}</b></span>
    <span style="font-size:11px;color:#94a3b8;">Real: <b style="color:#f8fafc;">${row.totalReal === '' ? 'Belum' : row.totalReal}</b></span>
    ${row.selisih !== '' && row.selisih !== 0 ? `<span style="font-size:11px;font-weight:700;color:${row.selisih < 0 ? '#fca5a5' : '#93c5fd'}">Selisih: ${row.selisih > 0 ? '+' : ''}${row.selisih}</span>` : ''}`;

  const sel = row.selisih === '' ? '—'
    : row.selisih < 0 ? `<span style="color:#be123c;font-weight:700;">${row.selisih}</span>`
    : row.selisih > 0 ? `<span style="color:#2563eb;font-weight:700;">+${row.selisih}</span>`
    : '<span style="color:#94a3b8;">0</span>';
  const v = x => x !== '' && x !== undefined ? x : '—';

  content.innerHTML = `
    <table class="pi-riwayat-tbl">
      <thead>
        <tr>
          <th>Tim</th><th>Personil</th>
          <th style="text-align:right;">Real 1</th><th style="text-align:right;">Real 2</th><th style="text-align:right;">Real 3</th>
          <th style="text-align:right;">Total Real</th><th style="text-align:right;">Selisih</th>
          <th>Status</th><th style="text-align:center;">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="font-weight:700;color:#1e293b;">${owEsc(row.tim || '—')}</td>
          <td>
            <div style="font-weight:600;color:#334155;">${owEsc(row.personil || '—')}</div>
            <div style="font-size:10px;color:#94a3b8;">${owEsc(row.waktu || '')}</div>
          </td>
          <td style="text-align:right;font-family:monospace;color:#475569;">${v(row.real1)}</td>
          <td style="text-align:right;font-family:monospace;color:#475569;">${v(row.real2)}</td>
          <td style="text-align:right;font-family:monospace;color:#475569;">${v(row.real3)}</td>
          <td style="text-align:right;font-weight:700;color:#1e293b;">${row.totalReal === '' ? '<span style="color:#94a3b8;font-style:italic;font-size:11px;">Belum</span>' : row.totalReal}</td>
          <td style="text-align:right;">${sel}</td>
          <td><span style="background:${badgeColor[norm] || '#f1f5f9'};color:${badgeText[norm] || '#475569'};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;">${norm}</span></td>
          <td style="text-align:center;">
            <button onclick="owOpenActions('${owKunciEnc(row)}')"
              style="border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;padding:3px 10px;cursor:pointer;font-size:13px;color:#64748b;font-weight:700;"
              onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#f8fafc'"
              title="Barang rusak: lihat & laporkan">···</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="ow-detail-info">
      <div><b>Lokasi:</b> ${owEsc(row.lokasi || row.rak)}</div>
      <div><b>Export CSV:</b> ${owEsc(row.export || '—')}</div>
      ${row.perluCek ? '<div class="ow-teks-oranye"><b>Cek ulang:</b> Qty Web rak ini berubah setelah dihitung. Hitung ulang di menu Stok Opname.</div>' : ''}
      ${row.tambahan ? '<div class="ow-teks-oranye">Barang ini tidak ada di CSV (ditambahkan saat hitung).</div>' : ''}
    </div>
    ${row.catatan ? `<div style="padding:12px 14px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;"><b>Catatan penerima:</b> ${owEsc(row.catatan)}</div>` : ''}
    ${row.riwayat && row.riwayat.length ? `
      <div style="padding:12px 14px;border-top:1px solid #f1f5f9;">
        <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Riwayat Hitung ${owEsc(owNamaBulan(owSesiAktif))}</div>
        ${row.riwayat.slice().reverse().map(h => `
          <div class="ow-riwayat-baris">
            <div><b>${h.qtyReal === '' ? 'Belum dihitung' : h.qtyReal}</b> <span class="ow-muted">dari Qty Web ${h.qtyWeb}</span> · ${owEsc(h.petugas)}</div>
            <div class="ow-muted">${owEsc(h.waktu)}${h.export ? ' · ' + owEsc(h.export) : ''}</div>
          </div>`).join('')}
      </div>` : ''}`;
  overlay.classList.add('open');
}

function owTutupDetail(e) {
  if (e && e.target !== document.getElementById('ow-detail-overlay')) return;
  document.getElementById('ow-detail-overlay').classList.remove('open');
}

// ---------- Barang rusak ----------
async function owOpenActions(kunciEnc) {
  const row = owCari(decodeURIComponent(kunciEnc));
  if (!row) return;
  owRusakAktif = row;
  opRusakSiapkan('ow', { nama: row.namaProduk, sku: row.sku, rak: row.lokasi || row.rak, qty: row.qtySistem });
  try {
    const data = await owApi(`/api/pindah/rusak?id=${encodeURIComponent(row.sku)}&bulan=${encodeURIComponent(owSesiAktif)}`);
    if (owRusakAktif === row) opRusakRiwayat('ow', data.rows || []);
  } catch (e) {
    if (owRusakAktif === row) opRusakRiwayat('ow', null, true);
  }
}

function owTutupRusakModal(e) {
  if (e && e.target !== document.getElementById('ow-rusak-modal')) return;
  document.getElementById('ow-rusak-modal').style.display = 'none';
}

async function owSimpanRusak() {
  const row = owRusakAktif;
  const msg = document.getElementById('ow-rusak-msg');
  const btn = document.getElementById('ow-rusak-btn');
  if (!row) return;
  const f = opRusakAmbil('ow');
  if (!f) return;
  const ok = typeof showConfirm === 'function'
    ? await showConfirm('Tambahkan Kerusakan', `${row.namaProduk || row.sku}: ${f.qty} pcs (${f.jenis}). Simpan?`, 'Ya, Simpan')
    : confirm('Simpan laporan kerusakan?');
  if (!ok) return;
  btn.disabled = true; btn.textContent = 'Menyimpan...'; msg.textContent = '';
  try {
    await owApi('/api/pindah/rusak', { method: 'POST', body: JSON.stringify({
      id: row.sku, nama: row.namaProduk, kodeRak: row.rak, bulan: owSesiAktif, jumlah: f.qty, keterangan: f.keterangan }) });
    if (typeof showToast === 'function') showToast('Laporan kerusakan tersimpan.', 'success');
    owOpenActions(owKunciEnc(row));
  } catch (e) {
    msg.style.color = '#d1646c'; msg.textContent = e.message || 'Gagal menyimpan.';
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan';
  }
}

// ---------- Info, stats, pager, lightbox ----------
function owHalamanNav(arah) {
  owHalamanAkt += arah;
  owRenderTabel();
  document.getElementById('ow-scroll-area').scrollTo({ top: 0, behavior: 'smooth' });
}
function owHitungStats() {
  const h = { Balance: 0, Plus: 0, Minus: 0, Belum: 0 };
  owSemuaData.forEach(r => { if (h[r.status] !== undefined) h[r.status]++; else h.Belum++; });
  document.getElementById('ow-n-balance').textContent = h.Balance;
  document.getElementById('ow-n-plus').textContent    = h.Plus;
  document.getElementById('ow-n-minus').textContent   = h.Minus;
  document.getElementById('ow-n-belum').textContent   = h.Belum;
  opIsiChip('ow', h);
}
function owUpdateInfoBar() {
  document.getElementById('ow-info-total').textContent  = owSemuaData.length;
  document.getElementById('ow-info-tampil').textContent = owDataFilter.length;
  document.getElementById('ow-info-sesi').textContent   = owSesiAktif + ' · ' + opTimLabel(owDataFilter).pendek;
  document.getElementById('ow-info-bar').style.display  = '';
}
function owTampilLoading(pesan) {
  const box = document.getElementById('ow-state-box');
  box.innerHTML = `<span class="material-symbols-outlined" style="animation:spin 1s linear infinite;">sync</span><p>${owEsc(pesan)}</p>`;
  box.style.display = '';
  document.getElementById('ow-view-container').style.display = 'none';
  document.getElementById('ow-pager').style.display = 'none';
}
function owTampilPesan(tipe, pesan) {
  const box = document.getElementById('ow-state-box');
  box.innerHTML = `<span class="material-symbols-outlined">${tipe === 'error' ? 'error' : 'search_off'}</span><p>${owEsc(pesan)}</p>`;
  box.style.display = '';
  document.getElementById('ow-view-container').style.display = 'none';
  document.getElementById('ow-pager').style.display = 'none';
}
function owCloseLightbox() {
  document.getElementById('ow-lightbox').classList.remove('open');
  document.getElementById('ow-lightbox-img').src = '';
}

// ---------- Ekspor .xlsx (panel Unduh / Bagikan ke WA) ----------
function owEkspor() {
  const filterRak = document.getElementById('ow-rak-filter').value || '';
  const cari = document.getElementById('ow-cari').value || '';
  const label = { Semua: 'Semua', Minus: 'Kurang', Plus: 'Lebih', Balance: 'Sesuai', Belum: 'Belum' };
  opBukaEkspor({
    sumber: 'Opname WEB', sesi: owSesiAktif, bulanLabel: owNamaBulan(owSesiAktif) || owSesiAktif,
    rows: owDataFilter.slice(), status: r => r.status || 'Belum',
    filterStatus: label[owStatusAkt] || owStatusAkt, filterRak, filterPersonil: owPersonilAktif ? opNama(owPersonilAktif) : '', cari,
    sesudah: () => opKirimSheet('WEB ' + (owSesiAktif || ''), `Ekspor Opname WEB | Sesi: ${owSesiAktif || '-'} | Filter: ${owStatusAkt}`,
      owDataFilter.map(r => [r.sku || '', r.namaProduk || '', r.totalReal === '' ? '' : Number(r.totalReal), r.selisih === '' ? '' : Number(r.selisih)]))
  });
}

// ---------- Export lama (CSV) — tidak dipakai lagi oleh tombol, disimpan untuk cadangan ----------
async function owExportCSV() {
  if (!owDataFilter.length) return showToast('Tidak ada data untuk diekspor.', 'error');
  const now = new Date();
  const tgl = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const jam = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const filterStatus   = owStatusAkt || 'Semua';
  const filterPersonil = owPersonilAktif || '-';
  const filterRak      = document.getElementById('ow-rak-filter').value || '-';
  const filterCari     = document.getElementById('ow-cari').value || '-';
  const esc = v => { const s = String(v == null ? '' : v).replace(/"/g, '""'); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s; };

  const total   = owDataFilter.length;
  const minus   = owDataFilter.filter(r => Number(r.selisih) < 0 && r.selisih !== '').length;
  const plus    = owDataFilter.filter(r => Number(r.selisih) > 0).length;
  const balance = owDataFilter.filter(r => r.selisih === 0).length;
  const belum   = owDataFilter.filter(r => r.selisih === '').length;

  const sheetName = 'WEB ' + (owSesiAktif || `SO ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const badgeText = `Ekspor: ${tgl} ${jam}  |  Sumber: Opname WEB  |  Sesi: ${owSesiAktif || '-'}  |  Filter: ${filterStatus}  |  Personil: ${filterPersonil}  |  Rak: ${filterRak}`;
  const sheetRows = owDataFilter.map(r => [r.sku || '', r.namaProduk || '', r.totalReal === '' ? '' : Number(r.totalReal), r.selisih === '' ? '' : Number(r.selisih)]);

  if (typeof SO_SHEET_GAS_URL !== 'undefined') {
    showToast('⏳ Mengirim ke Google Sheets...', 'info');
    try {
      const resp = await fetch(SO_SHEET_GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'exportSO', sheetName, badgeText, rows: sheetRows }) });
      const result = await resp.json();
      if (result.success) showToast(`✅ ${total} produk berhasil masuk ke sheet "${sheetName}"`, 'success');
      else showToast(`⚠️ Gagal ke Sheets: ${result.error || result.message || 'Unknown error'}`, 'error');
    } catch (err) {
      showToast(`⚠️ Gagal menghubungi Sheets: ${err.message}`, 'error');
    }
  }

  const csvRows = [];
  csvRows.push(['LAPORAN STOCK OPNAME (WEB) — PDC WAREHOUSE']);
  csvRows.push(['Sesi SO', owSesiAktif || '-']);
  csvRows.push(['Tanggal Ekspor', `${tgl} ${jam}`]);
  csvRows.push(['Filter Status', filterStatus]);
  csvRows.push(['Filter Personil', filterPersonil]);
  csvRows.push(['Filter Rak', filterRak]);
  csvRows.push(['Kata Cari', filterCari]);
  csvRows.push([]);
  csvRows.push(['RINGKASAN']);
  csvRows.push(['Total Produk Ditampilkan', total]);
  csvRows.push(['Minus (kurang)', minus]);
  csvRows.push(['Plus (lebih)', plus]);
  csvRows.push(['Balance (pas)', balance]);
  csvRows.push(['Belum diopname', belum]);
  csvRows.push([]);
  csvRows.push(['No', 'ID Produk', 'Nama Produk', 'Qty Web', 'Qty Real', 'Selisih', 'Status', 'Kode Rak', 'Lokasi', 'Tim', 'Personil', 'Waktu', 'Export CSV', 'Catatan Penerima']);
  owDataFilter.forEach((r, i) => {
    const selisihVal = r.selisih === '' ? 'Belum' : Number(r.selisih) > 0 ? `+${r.selisih}` : String(r.selisih);
    csvRows.push([i + 1, r.sku, r.namaProduk, r.qtySistem, r.totalReal, selisihVal, r.status, r.rak, r.lokasi, r.tim, r.personil, r.waktu, r.export, r.catatan]);
  });
  const csv  = csvRows.map(r => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `OpnameWEB_${(owSesiAktif || 'export').replace(/\s+/g, '_')}_${filterStatus}_${now.toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


// ============================================================
// RIWAYAT HAPUS HITUNGAN (khusus superuser) — siapa menghapus hitungan siapa
// ============================================================
let owRhData = [];
async function owBukaRiwayatHapus() {
  owTutupRiwayatHapus();
  const box = document.createElement('div');
  box.id = 'ow-rh';
  box.className = 'ow-rh-latar';
  box.innerHTML = `<div class="ow-rh">
      <div class="ow-rh-head"><b>Riwayat Hapus Hitungan</b>
        <button type="button" onclick="owTutupRiwayatHapus()" aria-label="Tutup"><span class="material-symbols-outlined">close</span></button></div>
      <input type="text" id="ow-rh-cari" placeholder="Cari nama, rak, SKU, produk..." oninput="owRenderRiwayatHapus()">
      <div id="ow-rh-isi" class="ow-rh-isi"><p class="ow-rh-kosong">Memuat...</p></div>
    </div>`;
  box.addEventListener('click', e => { if (e.target === box) owTutupRiwayatHapus(); });
  document.body.appendChild(box);
  try {
    const d = await owApi('/api/pindah/hapus-riwayat');
    owRhData = d.rows || [];
    owRenderRiwayatHapus();
  } catch (err) {
    document.getElementById('ow-rh-isi').innerHTML = `<p class="ow-rh-kosong">${owEsc(err.message)}</p>`;
  }
}
function owNama(u) { return typeof namaTampil === 'function' ? namaTampil(u) : u; }
function owTutupRiwayatHapus() { const el = document.getElementById('ow-rh'); if (el) el.remove(); }
// Kelompokkan: satu kali hapus (orang + jenis + rak + waktu yang sama) = satu kartu.
// Catatan ganda (hapus tertekan 2×, data sama persis) cukup tampil sekali dengan tanda "2×".
function owKelompokHapus(rows) {
  const grup = [], peta = {};
  rows.forEach(r => {
    const k = [r.oleh, r.jenis, r.kodeRak, String(r.waktu).slice(0, 16)].join('|');
    let g = peta[k];
    if (!g) { g = peta[k] = { oleh: r.oleh, jenis: r.jenis, kodeRak: r.kodeRak, waktu: r.waktu, alasan: r.alasan, item: [], tanda: {}, kali: 1 }; grup.push(g); }
    const ki = [r.lokasi, r.id, r.qtyReal, r.qtyWeb].join('|');
    if (g.tanda[ki]) { g.tanda[ki].n++; g.kali = Math.max(g.kali, g.tanda[ki].n); return; }
    const it = { ...r, n: 1 };
    g.tanda[ki] = it; g.item.push(it);
    if (!g.alasan && r.alasan) g.alasan = r.alasan;
  });
  // Kartu yang isinya sama persis & berdekatan (≤10 menit) = hapus dobel → digabung
  const menit = w => { const m = String(w).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : 0; };
  const sidik = g => [g.oleh, g.jenis, g.kodeRak, g.item.map(i => [i.lokasi, i.id, i.qtyReal].join(':')).sort().join(',')].join('|');
  const hasil = [];
  grup.forEach(g => {
    const lalu = hasil[hasil.length - 1];
    if (lalu && sidik(lalu) === sidik(g) && Math.abs(menit(lalu.waktu) - menit(g.waktu)) <= 10) { lalu.kali += g.kali; return; }
    hasil.push(g);
  });
  return hasil;
}
function owWaktuPendek(w) {
  const m = String(w || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/);
  return m ? `${+m[3]} ${OP_BULAN[+m[2] - 1].slice(0, 3)} · ${m[4]}` : String(w || '');
}
function owRenderRiwayatHapus() {
  const el = document.getElementById('ow-rh-isi');
  if (!el) return;
  const q = (document.getElementById('ow-rh-cari')?.value || '').trim().toUpperCase();
  const grup = owKelompokHapus(owRhData).filter(g => !q || [owNama(g.oleh), g.oleh, g.kodeRak, g.jenis,
    ...g.item.map(i => [i.id, i.nama, i.lokasi, i.petugas, owNama(i.petugas)].join(' '))].join(' ').toUpperCase().includes(q));
  if (!grup.length) { el.innerHTML = `<p class="ow-rh-kosong">${q ? 'Tidak ada yang cocok.' : 'Belum ada hitungan yang dihapus.'}</p>`; return; }
  const pcs = v => v === '' || v == null ? '—' : `${Number(v).toLocaleString('id-ID')} pcs`;
  el.innerHTML = grup.map(g => {
    const siapa = `<b>${owEsc(owNama(g.oleh) || '—')}</b>`;
    const kali = g.kali > 1 ? `<span class="rh-kali" title="Tercatat ${g.kali} kali (data sama)">${g.kali}×</span>` : '';
    const petugas = [...new Set(g.item.map(i => i.petugas).filter(Boolean).map(owNama))].join(', ') || '—';
    const satu = g.item.length === 1 && !/Rak|Tim/.test(g.jenis);
    let tag, judul, sub, daftar = '';
    if (satu) {
      const i = g.item[0];
      tag = '<span class="rh-tag sku">1 SKU</span>';
      judul = `${siapa} menghapus hitungan <b>${owEsc(i.nama || i.id)}</b>`;
      sub = `Rak ${owEsc(i.lokasi || g.kodeRak)} · Real ${pcs(i.qtyReal)} (Web ${owEsc(i.qtyWeb)}) · yang menghitung: ${owEsc(petugas)}`;
    } else {
      const tim = (g.jenis.match(/Tim\s+(\S+)/) || [])[1];
      const rak = /Rak/.test(g.jenis);
      tag = tim ? `<span class="rh-tag">TIM ${owEsc(tim)}</span>` : rak ? '<span class="rh-tag">SATU RAK</span>' : `<span class="rh-tag sku">${g.item.length} SKU</span>`;
      judul = tim ? `${siapa} menghapus hitungan Tim ${owEsc(tim)} di rak <b>${owEsc(g.kodeRak)}</b>`
            : rak ? `${siapa} menghapus hitungan rak <b>${owEsc(g.kodeRak)}</b>`
            : `${siapa} menghapus hitungan ${g.item.length} SKU di rak <b>${owEsc(g.kodeRak)}</b>`;
      sub = `${g.item.length} SKU · yang menghitung: ${owEsc(petugas)}`;
      daftar = `<div class="rh-list">${g.item.map(i => `<div><span>${owEsc(i.nama || i.id)} <code>· ${owEsc(i.lokasi || '')}</code></span><span>${pcs(i.qtyReal)}</span></div>`).join('')}</div>`;
    }
    return `<div class="rh-item"><div class="rh-1"><div>${tag}${judul}${kali}</div><span>${owEsc(owWaktuPendek(g.waktu))}</span></div>
      <div class="rh-2">${sub}</div>${g.alasan ? `<div class="rh-2">Alasan: ${owEsc(g.alasan)}</div>` : ''}${daftar}</div>`;
  }).join('');
}

// ============================================================
// KIRIM HASIL TIM 00 KE SHEET KEDUA (akun Google lain) — khusus superuser
// Data = semua produk Tim 00 pada Bulan SO yang dipilih (status/rak/cari tidak ikut).
// Format & grup kolom sama persis dengan file Ekspor. Tiap kirim = halaman (tab) baru.
// ============================================================
const OW_TIM_KHUSUS = '00';
let owKtData = null;
function owSuperuser() {
  return ((typeof currentUserRole !== 'undefined' && currentUserRole) || sessionStorage.getItem('sessionRole') || '') === 'superuser';
}
function owTampilKirimTim() {
  const b = document.getElementById('ow-kirim-tim');
  if (!b) return;
  const tampil = document.getElementById('ow-tim').value === OW_TIM_KHUSUS && owSuperuser();
  b.style.display = tampil ? '' : 'none';
  if (tampil) document.getElementById('ow-kirim-tim-info').textContent = `bulan ${owNamaBulan(owSesiAktif) || owSesiAktif} · halaman baru`;
}
function owTutupKirimTim() { const el = document.getElementById('pg-kt'); if (el) el.remove(); }
function owNamaHalamanAwal() {
  const w = new Date(Date.now() + 7 * 3600 * 1000), p = n => String(n).padStart(2, '0');
  return `Opname Tim ${OW_TIM_KHUSUS} - ${w.getUTCDate()} ${OP_BULAN[w.getUTCMonth()].slice(0, 3)} ${w.getUTCFullYear()} ${p(w.getUTCHours())}.${p(w.getUTCMinutes())}`;
}
async function owBukaKirimTim() {
  if (!owSuperuser()) { if (typeof showToast === 'function') showToast('Kirim ke sheet Tim 00 khusus superuser.', 'error'); return; }
  owTutupKirimTim();
  const rows = owSemuaData.filter(r => String(r.tim || '').trim() === OW_TIM_KHUSUS);
  const d = owKtData = opDataEkspor({ sumber: 'Opname WEB', sesi: owSesiAktif, bulanLabel: owNamaBulan(owSesiAktif) || owSesiAktif,
    rows, status: r => r.status || 'Belum', filterStatus: 'Semua' });
  const angka = v => Number(v || 0).toLocaleString('id-ID');
  const kv = (l, v) => `<div class="rk-kv"><span>${l}</span><b>${v}</b></div>`;
  const el = document.createElement('div');
  el.id = 'pg-kt'; el.className = 'pg-kt-latar';
  el.onclick = e => { if (e.target === el) owTutupKirimTim(); };
  el.innerHTML = `<div class="rk-kotak"><div class="rk-head"><b>Kirim hasil Tim ${OW_TIM_KHUSUS}</b><button type="button" onclick="owTutupKirimTim()">✕</button></div>
    <div class="rk-isi"><div class="rk-info">
      ${kv('Bulan SO', owEsc(d.meta[1][1]))}
      ${kv('SKU Tim ' + OW_TIM_KHUSUS, angka(rows.length))}
      ${kv('Sudah dihitung', angka(rows.length - d.hit.Belum))}
      ${kv('Kurang · Lebih · Sesuai', `<span class="pg-t-k">${angka(d.hit.Minus)}</span> · <span class="pg-t-l">${angka(d.hit.Plus)}</span> · <span class="pg-t-s">${angka(d.hit.Balance)}</span>`)}
      <div id="pg-kt-terakhir">${kv('Terakhir dikirim', '<span class="rk-muat">memeriksa…</span>')}</div></div>
      <label class="pg-kt-lbl" for="pg-kt-nama">Nama halaman baru di sheet</label>
      <input type="text" id="pg-kt-nama" maxlength="90" value="${owEsc(owNamaHalamanAwal())}">
      <div class="pg-kt-dua"><span>✓ <b>LAPORAN BARANG</b><small>otomatis tiap simpan</small></span><span>⇪ <b>Sheet kedua</b><small>lewat tombol ini</small></span></div>
      <div id="pg-kt-msg" class="rusak-form-msg"></div>
      <div class="pg-kt-aksi"><button type="button" class="pg-kt-batal" onclick="owTutupKirimTim()">Batal</button>
        <button type="button" class="rk-simpan" id="pg-kt-kirim" disabled onclick="owKirimTim()">Kirim sekarang</button></div>
    </div></div>`;
  document.body.appendChild(el);
  const msg = document.getElementById('pg-kt-msg');
  let cfg;
  try { cfg = await owApi('/api/pindah/kirim-tim/info'); } catch (e) { cfg = { siap: false, pesan: e.message }; }
  if (!document.getElementById('pg-kt')) return;
  document.getElementById('pg-kt-terakhir').innerHTML = kv('Terakhir dikirim', cfg.terakhir ? owEsc(cfg.terakhir.nama + ' · ' + cfg.terakhir.waktu) : '—');
  if (!cfg.siap) { msg.style.color = '#d1646c'; msg.textContent = cfg.pesan || 'Sheet kedua belum disambungkan.'; return; }
  if (!rows.length) { msg.style.color = '#d1646c'; msg.textContent = `Belum ada data Tim ${OW_TIM_KHUSUS} di bulan ini.`; return; }
  document.getElementById('pg-kt-kirim').disabled = false;
}
async function owKirimTim() {
  const d = owKtData, btn = document.getElementById('pg-kt-kirim'), msg = document.getElementById('pg-kt-msg');
  const nama = (document.getElementById('pg-kt-nama').value || '').trim();
  if (!d) return;
  if (!nama) { msg.style.color = '#d1646c'; msg.textContent = 'Nama halaman wajib diisi.'; return; }
  btn.disabled = true; btn.textContent = 'Mengirim…'; msg.textContent = '';
  try {
    const r = await owApi('/api/pindah/kirim-tim', { method: 'POST', body: JSON.stringify({
      namaHalaman: nama, meta: d.meta, header: d.header, lebar: d.lebar, baris: d.baris.map(b => b.isi), status: d.baris.map(b => b.n) }) });
    msg.style.color = '#2e8b57';
    msg.innerHTML = `Terkirim ke halaman <b>${owEsc(r.namaHalaman)}</b>${r.url ? ` · <a href="${owEsc(r.url)}" target="_blank" rel="noopener">Buka sheet</a>` : ''}`;
    btn.textContent = 'Terkirim ✓';
    if (typeof showToast === 'function') showToast(`Hasil Tim ${OW_TIM_KHUSUS} terkirim ke sheet kedua.`, 'success');
  } catch (e) {
    msg.style.color = '#d1646c'; msg.textContent = e.message || 'Gagal mengirim.';
    btn.disabled = false; btn.textContent = 'Kirim sekarang';
  }
}

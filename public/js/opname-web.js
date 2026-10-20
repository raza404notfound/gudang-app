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
    const hl = idxH >= 0 ? owEsc(nama.slice(0, idxH)) + '<b style="color:#e11d48;">' + owEsc(nama.slice(idxH, idxH + q.length)) + '</b>' + owEsc(nama.slice(idxH + q.length)) : owEsc(nama);
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
  items.forEach((el, i) => { el.style.background = i === owPersonilIdx ? '#fff1f2' : ''; el.style.color = i === owPersonilIdx ? '#e11d48' : '#334155'; });
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
  if (owSudahInit) return;
  owSudahInit = true;
  await owMuat('');
}

async function owMuat(bulan) {
  const sel = document.getElementById('ow-sesi-select');
  sel.disabled = true;
  owReset();
  owTampilLoading('Memuat data dari sheet LAPORAN BARANG...');
  try {
    const data = await owApi('/api/pindah/opname?bulan=' + encodeURIComponent(bulan || ''));
    sel.innerHTML = '<option value="">— Pilih Bulan SO —</option>' +
      (data.daftarBulan || []).map(b => `<option value="${owEsc(b)}">${owEsc(owNamaBulan(b))}</option>`).join('');
    sel.value = data.bulan || '';
    owSesiAktif = data.bulan || '';
    owSemuaData = data.rows || [];
    owPersonilList = data.personil || [];
    owHitungStats();
    owFilter();
  } catch (err) {
    owSudahInit = false;
    owTampilPesan('error', err.message || 'Gagal memuat data.');
  } finally {
    sel.disabled = false;
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
  ['ow-cari', 'ow-rak-filter', 'ow-personil-input'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ow-personil-input').style.borderColor = '';
  document.getElementById('ow-personil-dropdown').style.display = 'none';
  document.getElementById('ow-stats').style.display    = 'none';
  document.getElementById('ow-info-bar').style.display = 'none';
  document.getElementById('ow-pager').style.display    = 'none';
  document.getElementById('ow-view-container').style.display = 'none';
}

// ---------- Filter & urutan ----------
function owFilter() {
  const cari       = (document.getElementById('ow-cari').value || '').toLowerCase();
  const rak        = (document.getElementById('ow-rak-filter').value || '').toLowerCase();
  const personilKw = (owPersonilAktif || '').toLowerCase();
  const sort       = document.getElementById('ow-sort-select').value;

  owDataFilter = owSemuaData.filter(r => {
    if (owStatusAkt !== 'Semua' && r.status !== owStatusAkt) return false;
    if (rak && !(String(r.rak) + ' ' + String(r.lokasi)).toLowerCase().includes(rak)) return false;
    if (personilKw && !String(r.personil || '').toLowerCase().includes(personilKw)) return false;
    if (cari && !(r.sku + ' ' + r.namaProduk).toLowerCase().includes(cari)) return false;
    return true;
  });

  const statusOrder = { 'Minus': 0, 'Plus': 1, 'Balance': 2, 'Belum': 3 };
  owDataFilter.sort((a, b) => {
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

  if (owViewMode === 'grid') {
    container.className = 'pi-grid';
    container.innerHTML = slice.map(owRenderCard).join('');
  } else {
    container.className = 'pi-list';
    container.innerHTML = slice.map(owRenderListItem).join('');
  }

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
  const modal = document.getElementById('ow-rusak-modal');
  const body  = document.getElementById('ow-rusak-modal-body');
  document.getElementById('ow-rusak-modal-judul').textContent = row.namaProduk || row.sku;
  document.getElementById('ow-rusak-qty').value = '';
  document.getElementById('ow-rusak-ket').value = '';
  document.getElementById('ow-rusak-msg').textContent = '';
  body.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px 0;"><span class="material-symbols-outlined" style="font-size:32px;animation:spin 1s linear infinite;display:block;margin-bottom:8px;">sync</span>Memuat data...</div>';
  modal.style.display = 'flex';

  const fotoHtml = row.kodeGambar
    ? `<img src="${OW_ASSET_BASE}?id=${encodeURIComponent(row.kodeGambar)}&thumbnail=true" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;background:#f1f5f9;" onerror="this.style.display='none'">`
    : `<div style="width:60px;height:60px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="material-symbols-outlined" style="color:#cbd5e1;font-size:24px;">image_not_supported</span></div>`;
  const kepala = `<div style="display:flex;gap:12px;align-items:center;padding:0 0 14px;border-bottom:1px solid #f1f5f9;margin-bottom:14px;">${fotoHtml}<div style="min-width:0;"><div style="font-size:12px;font-weight:700;color:#1e293b;line-height:1.3;">${owEsc(row.namaProduk)}</div><div style="font-size:11px;color:#94a3b8;margin-top:2px;font-family:monospace;">${owEsc(row.sku)} · ${owEsc(row.rak)}</div></div></div>`;
  try {
    const data = await owApi(`/api/pindah/rusak?id=${encodeURIComponent(row.sku)}&bulan=${encodeURIComponent(owSesiAktif)}`);
    const rows = data.rows || [];
    if (!rows.length) {
      body.innerHTML = kepala + `<div style="text-align:center;padding:20px 0;"><span class="material-symbols-outlined" style="font-size:40px;color:#d1d5db;display:block;margin-bottom:10px;">check_circle</span><p style="color:#64748b;font-size:13px;font-weight:600;">Belum pernah dilaporkan rusak</p></div>`;
      return;
    }
    const latest = rows[0], history = rows.slice(1);
    body.innerHTML = kepala + `
      <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;"><span style="font-size:11px;font-weight:700;color:#e11d48;text-transform:uppercase;letter-spacing:.4px;">Laporan Terbaru</span><span style="font-size:11px;color:#94a3b8;">${owEsc(latest.dicatatPada || '-')}</span></div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:26px;font-weight:800;color:#be123c;">${latest.jumlahRusak}</span><span style="font-size:12px;color:#64748b;">pcs rusak</span></div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span class="material-symbols-outlined" style="font-size:14px;color:#64748b;">person</span><span style="font-size:12px;font-weight:600;color:#334155;">${owEsc(latest.oleh || '—')}</span><span style="font-size:11px;color:#94a3b8;">· ${owEsc(latest.sesi || '')}</span></div>
        ${latest.keterangan ? `<div style="font-size:12px;color:#64748b;background:#fff;border-radius:6px;padding:8px 10px;border:1px solid #f1f5f9;">${owEsc(latest.keterangan)}</div>` : ''}
      </div>
      ${history.length ? `<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Riwayat Sebelumnya</div><div style="max-height:140px;overflow-y:auto;">${history.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border:1px solid #f1f5f9;border-radius:7px;margin-bottom:5px;background:#fafafa;"><div><span style="font-weight:700;color:#be123c;">${r.jumlahRusak} pcs</span><span style="font-size:11px;color:#64748b;margin-left:6px;">· ${owEsc(r.oleh || '—')} · ${owEsc(r.sesi || '')}</span>${r.keterangan ? `<div style="font-size:11px;color:#94a3b8;">${owEsc(r.keterangan)}</div>` : ''}</div><span style="font-size:10px;color:#94a3b8;">${owEsc(r.dicatatPada || '')}</span></div>`).join('')}</div>` : ''}`;
  } catch (e) {
    body.innerHTML = kepala + '<div style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat data.</div>';
  }
}

function owTutupRusakModal(e) {
  if (e && e.target !== document.getElementById('ow-rusak-modal')) return;
  document.getElementById('ow-rusak-modal').style.display = 'none';
}

async function owSimpanRusak() {
  const row = owRusakAktif;
  const qty = parseInt(document.getElementById('ow-rusak-qty').value);
  const ket = document.getElementById('ow-rusak-ket').value.trim();
  const msg = document.getElementById('ow-rusak-msg');
  const btn = document.getElementById('ow-rusak-btn');
  if (!row) return;
  if (!qty || qty < 1) { msg.style.color = '#ef4444'; msg.textContent = 'Jumlah rusak wajib diisi (min. 1 pcs).'; return; }
  const ok = typeof showConfirm === 'function'
    ? await showConfirm('Laporkan Barang Rusak', `${row.namaProduk || row.sku}: ${qty} pcs rusak. Simpan laporan?`, 'Ya, Simpan')
    : confirm('Simpan laporan barang rusak?');
  if (!ok) return;
  btn.disabled = true; btn.textContent = 'Menyimpan...'; msg.textContent = '';
  try {
    await owApi('/api/pindah/rusak', { method: 'POST', body: JSON.stringify({
      id: row.sku, nama: row.namaProduk, kodeRak: row.rak, bulan: owSesiAktif, jumlah: qty, keterangan: ket }) });
    if (typeof showToast === 'function') showToast('Laporan barang rusak tersimpan.', 'success');
    owOpenActions(owKunciEnc(row));
  } catch (e) {
    msg.style.color = '#ef4444'; msg.textContent = e.message || 'Gagal menyimpan.';
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan Laporan Rusak';
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
  document.getElementById('ow-stats').style.display   = '';
}
function owUpdateInfoBar() {
  document.getElementById('ow-info-total').textContent  = owSemuaData.length;
  document.getElementById('ow-info-tampil').textContent = owDataFilter.length;
  document.getElementById('ow-info-sesi').textContent   = owSesiAktif;
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

// ---------- Export (sama seperti Opname Sheet: kirim ke sheet + unduh CSV) ----------
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
      <input type="text" id="ow-rh-cari" placeholder="Cari penghapus, petugas, rak, SKU..." oninput="owRenderRiwayatHapus()">
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
function owRenderRiwayatHapus() {
  const el = document.getElementById('ow-rh-isi');
  if (!el) return;
  const q = (document.getElementById('ow-rh-cari')?.value || '').trim().toUpperCase();
  const rows = owRhData.filter(r => !q || [r.oleh, r.petugas, r.kodeRak, r.id, r.nama, r.lokasi].join(' ').toUpperCase().includes(q));
  if (!rows.length) { el.innerHTML = '<p class="ow-rh-kosong">Belum ada hitungan yang dihapus.</p>'; return; }
  el.innerHTML = rows.map(r => `<div class="ow-rh-item">
      <div class="ow-rh-a"><span class="ow-rh-jenis ${r.jenis === 'Hitungan Rak' ? 'rak' : ''}">${owEsc(r.jenis)}</span><span>${owEsc(r.waktu)}</span></div>
      <div class="ow-rh-b"><b>${owEsc(r.kodeRak)}</b> ${r.lokasi ? '· ' + owEsc(r.lokasi) : ''} · <code>${owEsc(r.id)}</code></div>
      <div class="ow-rh-c">${owEsc(r.nama)}</div>
      <div class="ow-rh-d">Dihapus oleh <b>${owEsc(owNama(r.oleh))}</b> · dihitung oleh <b>${owEsc(r.petugas ? owNama(r.petugas) : '-')}</b> · Web ${r.qtyWeb} · Real dihapus <b>${r.qtyReal === '' ? '-' : r.qtyReal}</b>${r.alasan ? ' · ' + owEsc(r.alasan) : ''}</div>
    </div>`).join('');
}

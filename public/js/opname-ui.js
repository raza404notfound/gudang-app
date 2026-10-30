// opname-ui.js — tampilan bersama untuk menu "Opname WEB" (ow) dan "Opname Sheet" (so)
//  - Daftar produk: tabel di laptop, kartu di HP (satu markup, CSS yang menyesuaikan)
//  - Menu ⋮ per produk: Lihat riwayat · Input barang rusak · Detail produk
//  - Riwayat perubahan qty lengkap (Opname WEB)
//  - Ekspor .xlsx (kolom detail dikelompokkan & tersembunyi) + Unduh / Bagikan ke WA

const OP_STATUS = {
  Minus:   { label: 'Kurang', kls: 'k' },
  Plus:    { label: 'Lebih',  kls: 'l' },
  Balance: { label: 'Sesuai', kls: 's' },
  Belum:   { label: 'Belum',  kls: 'b' }
};
const OP_BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const opBaris = { ow: [], so: [] };   // baris yang sedang tampil per halaman (dipakai menu ⋮)

function opEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function opStatusTeks(norm, selisih) {
  const st = OP_STATUS[norm] || OP_STATUS.Belum;
  if (norm === 'Belum') return { teks: 'Belum', kls: 'b' };
  if (norm === 'Balance') return { teks: 'Sesuai ✓', kls: 's' };
  const n = Number(selisih);
  return { teks: `${n > 0 ? '+' : ''}${n} ${st.label}`, kls: st.kls };
}
function opBandingRak(a, b) {
  const k = (x, y) => String(x || '').localeCompare(String(y || ''), 'id', { numeric: true, sensitivity: 'base' });
  return k(a.rak, b.rak) || k(a.lokasi, b.lokasi) || k(a.namaProduk, b.namaProduk);
}
function opNama(u) { return typeof namaTampil === 'function' ? namaTampil(u) : u; }

// ---------- Daftar produk ----------
// cfg: { id: 'ow'|'so', status: r => 'Minus'|'Plus'|'Balance'|'Belum' }
function opDaftarHtml(rows, cfg) {
  opBaris[cfg.id] = rows;
  const kepala = `<div class="op-hdr"><span>Rak</span><span>Produk</span><span>SKU</span><span class="n">Web</span><span class="n">Real</span><span class="n">Status</span><span>Personil</span><span></span></div>`;
  const isi = rows.map((r, i) => {
    const norm = cfg.status(r);
    const st = opStatusTeks(norm, r.selisih);
    const real = r.totalReal === '' || r.totalReal === undefined || r.totalReal === null ? '–' : r.totalReal;
    const per = r.personil ? opNama(r.personil) : '';
    return `<div class="op-row op-${st.kls}" onclick="opKlik('${cfg.id}',${i})">
      <span class="op-rak">${opEsc(r.rak || '—')}</span>
      <span class="op-nm" title="${opEsc(r.namaProduk)}">${opEsc(r.namaProduk)}</span>
      <span class="op-sku${r.sku === 'TAMBAHAN' && !r.skuTambahan ? ' op-sku-tb' : ''}">${opEsc(r.sku === 'TAMBAHAN' ? (r.skuTambahan || 'TAMBAHAN') : r.sku)}</span>
      <span class="op-per">${opEsc(per)}</span>
      <div class="op-q">
        <div class="op-web"><i>WEB</i><b>${r.qtySistem ?? ''}</b></div>
        <div class="op-real"><i>REAL</i><b>${real}</b></div>
        <div class="op-st op-t-${st.kls}">${opEsc(st.teks)}</div>
      </div>
      <button class="op-dot" title="Menu" onclick="event.stopPropagation();opMenu(event,'${cfg.id}',${i})">⋮</button>
    </div>`;
  }).join('');
  return `<div class="op-daftar">${kepala}${isi}</div>`;
}

function opKlik(id, i) {
  const r = opBaris[id][i];
  if (!r) return;
  if (id === 'ow') opRiwayatOw(r);
  else opBukaDetailSo(r);
}
function opEncSo(r) {
  return encodeURIComponent(JSON.stringify({ sku: r.sku, nama: r.namaProduk, sesi: typeof soSesiAktif !== 'undefined' ? soSesiAktif : '', kodeGambar: r.kodeGambar || '' }));
}
function opBukaDetailSo(r) { if (typeof piOpenDetail === 'function') piOpenDetail(opEncSo(r)); }

// ---------- Menu ⋮ ----------
function opTutupMenu() { const m = document.getElementById('op-menu'); if (m) m.remove(); }
function opMenu(e, id, i) {
  opTutupMenu();
  const r = opBaris[id][i];
  if (!r) return;
  const item = (ikon, teks, aksi, kls = '') => `<button class="${kls}" onclick="opTutupMenu();${aksi}"><span class="material-symbols-outlined">${ikon}</span>${teks}</button>`;
  const su = ((typeof currentUserRole !== 'undefined' && currentUserRole) || sessionStorage.getItem('sessionRole') || '') === 'superuser';
  const isi = id === 'ow' && r.sku === 'TAMBAHAN'
    ? item('history', 'Lihat riwayat', `opRiwayatOw(opBaris.ow[${i}])`) +
      item('edit', 'Edit barang tambahan', `owEditTambahan(opBaris.ow[${i}])`) +
      (su ? item('delete', 'Hapus barang tambahan', `owHapusTambahan(opBaris.ow[${i}])`, 'bahaya') : '')
    : id === 'ow'
    ? item('history', 'Lihat riwayat', `opRiwayatOw(opBaris.ow[${i}])`) +
      item('report', 'Input barang rusak', `owOpenActions(encodeURIComponent(opBaris.ow[${i}].kunci))`, 'bahaya') +
      item('info', 'Detail produk', `owOpenDetail(encodeURIComponent(opBaris.ow[${i}].kunci))`)
    : item('history', 'Lihat riwayat', `opBukaDetailSo(opBaris.so[${i}])`) +
      item('report', 'Input barang rusak', `soOpenActions(opEncSo(opBaris.so[${i}]))`, 'bahaya');
  const m = document.createElement('div');
  m.id = 'op-menu';
  m.className = 'op-menu';
  m.innerHTML = isi;
  document.body.appendChild(m);
  const b = e.currentTarget.getBoundingClientRect();
  const lebar = 210, tinggi = m.offsetHeight;
  let top = b.bottom + 4, left = Math.min(b.right - lebar, window.innerWidth - lebar - 8);
  if (top + tinggi > window.innerHeight - 8) top = b.top - tinggi - 4;
  m.style.top = Math.max(8, top) + 'px';
  m.style.left = Math.max(8, left) + 'px';
  setTimeout(() => document.addEventListener('click', opTutupMenu, { once: true }), 0);
}
window.addEventListener('scroll', opTutupMenu, true);

// ---------- Riwayat perubahan qty (Opname WEB) ----------
function opWaktu(w) {
  const m = String(w || '').match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return opEsc(w || '');
  return `${Number(m[3])} ${OP_BULAN[Number(m[2]) - 1].slice(0, 3)} ${m[4]}:${m[5]}`;
}
function opTutupModal() { const m = document.getElementById('op-modal'); if (m) m.remove(); }
function opRiwayatOw(r) {
  if (!r) return;
  opTutupModal();
  const riw = (r.riwayat || []).slice();
  const aktif = riw.filter(h => !h.dihapus);
  const terakhir = aktif[aktif.length - 1];
  const sel = r.selisih === '' ? '–' : (r.selisih > 0 ? '+' : '') + r.selisih;
  const selKls = r.selisih === '' ? '' : r.selisih < 0 ? 'op-t-k' : r.selisih > 0 ? 'op-t-l' : 'op-t-s';
  const baris = riw.map((h, i) => ({ h, no: i + 1 })).reverse().map(({ h, no }) => {
    const s = h.qtyReal - h.qtyWeb;
    const stH = s === 0 ? { teks: 'Sesuai', kls: 's' } : s < 0 ? { teks: `${s} Kurang`, kls: 'k' } : { teks: `+${s} Lebih`, kls: 'l' };
    const dari = h.dari === '' || h.dari === undefined ? '<i>baru</i>' : `${h.dari}<i>→</i>`;
    const kini = h === terakhir;
    return `<tr class="${h.dihapus ? 'hapus' : kini ? 'kini' : ''}">
      <td class="no">${no}</td>
      <td class="w">${opWaktu(h.waktu)}${kini ? ' <span class="op-tag">TERAKHIR</span>' : ''}<small>${opEsc(opNama(h.petugas) || '—')} · web ${h.qtyWeb}</small></td>
      <td class="ch">${dari}${h.qtyReal}</td>
      <td class="st">${h.dihapus ? `<span class="op-dtag">dihapus · ${opEsc(opNama(h.dihapus.oleh) || '')}</span>` : `<span class="op-t-${stH.kls}">${stH.teks}</span>`}</td>
    </tr>`;
  }).join('');
  const bulan = typeof owSesiAktif !== 'undefined' ? owNamaBulan(owSesiAktif) : '';
  const el = document.createElement('div');
  el.id = 'op-modal';
  el.className = 'op-modal';
  el.onclick = e => { if (e.target === el) opTutupModal(); };
  el.innerHTML = `<div class="op-modal-kotak">
    <div class="op-modal-hd">
      <div class="op-modal-t1"><span class="op-rak">${opEsc(r.rak)}</span><b>${opEsc(r.namaProduk)}</b><button onclick="opTutupModal()">✕</button></div>
      <span class="op-sku">${opEsc(r.sku)}</span>
      <div class="op-ringkas">
        <div><span>QTY WEB</span><b>${r.qtySistem}</b></div>
        <div><span>REAL TERAKHIR</span><b>${r.totalReal === '' ? '–' : r.totalReal}</b></div>
        <div><span>SELISIH</span><b class="${selKls}">${sel}</b></div>
        <div><span>DIHITUNG</span><b>${aktif.length}×</b></div>
      </div>
    </div>
    <div class="op-modal-judul">Riwayat perubahan — ${opEsc(bulan)}</div>
    <div class="op-modal-isi">${riw.length ? `<table class="op-riw"><thead><tr><th>#</th><th>Waktu · Petugas</th><th>Perubahan Real</th><th>Status</th></tr></thead><tbody>${baris}</tbody></table>`
      : '<div class="op-kosong">Belum ada hitungan di bulan ini.</div>'}</div>
    <div class="op-modal-ft">"Perubahan real" = qty real sebelumnya → qty real baru. Baris abu dicoret = hitungan yang dihapus.</div>
  </div>`;
  document.body.appendChild(el);
}

// ---------- Chip status dengan jumlah ----------
function opIsiChip(prefix, h) {
  const label = { Semua: 'Semua', Minus: 'Kurang', Plus: 'Lebih', Balance: 'Sesuai', Belum: 'Belum' };
  const total = h.Balance + h.Plus + h.Minus + h.Belum;
  Object.keys(label).forEach(k => {
    const el = document.getElementById(`${prefix}-chip-${k}`);
    if (el) el.innerHTML = `${label[k]}<b>${k === 'Semua' ? total : h[k]}</b>`;
  });
}
function opTimLabel(rows) {
  const t = [...new Set(rows.map(r => String(r.tim || '').trim()).filter(Boolean))].sort();
  if (t.length === 1) return { pendek: 'Tim ' + t[0], panjang: 'Tim ' + t[0] };
  if (!t.length) return { pendek: 'Semua Tim', panjang: 'Semua tim' };
  return { pendek: 'Semua Tim', panjang: `Semua tim (${t.slice(0, 12).join(', ')}${t.length > 12 ? ', …' : ''})` };
}
function opToggleFilter(btn) {
  const tb = btn.closest('.pi-toolbar');
  if (tb) tb.classList.toggle('op-filter-buka');
}
// Pilihan Tim diambil dari data bulan yang sedang dibuka (pilihan lama dipertahankan bila masih ada)
function opIsiTim(selId, rows) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const n = {};
  rows.forEach(r => { const t = String(r.tim || '').trim(); if (t) n[t] = (n[t] || 0) + 1; });
  const tim = Object.keys(n).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  opIsiPilihan(sel, `<option value="" data-meta="${rows.length} SKU">Semua tim</option>` +
    tim.map(t => `<option value="${opEsc(t)}" data-meta="${n[t]} SKU">Tim ${opEsc(t)}</option>`).join(''), tim);
}
// Isi <select> hanya bila daftarnya berubah; pilihan lama dipertahankan bila masih ada
function opIsiPilihan(sel, html, nilaiAda) {
  const pilih = sel.value;
  if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
  sel.value = nilaiAda.includes(pilih) ? pilih : '';
}
// Rak: "0001A · 2 SKU / 5.610 PCS" (ikut filter Tim)
function opIsiRak(selId, rows) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const g = {};
  rows.forEach(r => { const k = String(r.rak || '').trim(); if (!k) return; const x = g[k] = g[k] || { n: 0, pcs: 0 }; x.n++; x.pcs += Number(r.qtySistem) || 0; });
  const rak = Object.keys(g).sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
  const angka = v => Number(v).toLocaleString('id-ID');
  opIsiPilihan(sel, `<option value="" data-meta="${angka(rows.length)} SKU">Semua rak</option>` +
    rak.map(k => `<option value="${opEsc(k)}" data-meta="${g[k].n} SKU / ${angka(g[k].pcs)} PCS">${opEsc(k)}</option>`).join(''), rak);
}
// Personil: nama tampilan + jumlah SKU yang dihitung (ikut filter Tim)
function opIsiPersonil(selId, list, rows, aktif) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const n = {};
  list.forEach(p => { const k = p.toLowerCase(); n[p] = rows.filter(r => String(r.personil || '').toLowerCase().includes(k)).length; });
  const ada = list.filter(p => n[p] > 0 || p === aktif);
  opIsiPilihan(sel, '<option value="">Semua personil</option>' +
    ada.map(p => `<option value="${opEsc(p)}" data-meta="${n[p]} SKU">${opEsc(opNama(p))}</option>`).join(''), ada);
  if (aktif && sel.value !== aktif && ada.includes(aktif)) sel.value = aktif;
}
function opCocokTim(selId, r) {
  const v = (document.getElementById(selId) || {}).value || '';
  return !v || String(r.tim || '').trim() === v;
}
// Chip personil di panel kiri (laptop). Klik lagi chip yang aktif = batal.
function opIsiPersonilChip(boxId, list, aktif, fnPilih) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = list.map(n =>
    `<button type="button" class="op-pchip${n === aktif ? ' aktif' : ''}" data-n="${opEsc(n)}" onclick="${fnPilih}(this.dataset.n)">${opEsc(n)}</button>`).join('');
}

// ---------- Ekspor .xlsx ----------
let opExcelJs = null;
function opMuatExcelJs() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (opExcelJs) return opExcelJs;
  opExcelJs = new Promise((ok, gagal) => {
    const s = document.createElement('script');
    s.src = '/vendor/exceljs.min.js';
    s.onload = () => window.ExcelJS ? ok(window.ExcelJS) : gagal(new Error('Pustaka Excel gagal dimuat.'));
    s.onerror = () => { opExcelJs = null; gagal(new Error('Pustaka Excel gagal dimuat. Cek koneksi.')); };
    document.head.appendChild(s);
  });
  return opExcelJs;
}

// info: { sumber, sesi, bulanLabel, rows, status: r=>norm, filterStatus, filterRak, filterPersonil, cari }
// Isi ekspor (dipakai file .xlsx DAN kirim ke sheet Tim 00 supaya formatnya sama persis)
function opDataEkspor(info) {
  const rows = info.rows;
  const hit = { Minus: 0, Plus: 0, Balance: 0, Belum: 0 };
  rows.forEach(r => { const n = info.status(r); hit[n] = (hit[n] || 0) + 1; });
  const sekarang = new Date(Date.now() + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const tglJam = `${sekarang.getUTCDate()} ${OP_BULAN[sekarang.getUTCMonth()].slice(0, 3)} ${sekarang.getUTCFullYear()} ${pad(sekarang.getUTCHours())}:${pad(sekarang.getUTCMinutes())} WIB`;
  const tgl = `${sekarang.getUTCDate()} ${OP_BULAN[sekarang.getUTCMonth()].slice(0, 3)} ${sekarang.getUTCFullYear()}`;
  const tim = opTimLabel(rows);
  const oleh = (typeof namaTampil === 'function' ? namaTampil(sessionStorage.getItem('sessionUser') || '') : '') || sessionStorage.getItem('sessionUser') || '';
  const meta = [
    [`EKSPOR STOK OPNAME — ${info.sumber.toUpperCase()}`],
    ['Bulan / Sesi SO', info.bulanLabel + (info.sesi && info.sesi !== info.bulanLabel ? `  (${info.sesi})` : '')],
    ['Filter Tim', tim.panjang],
    ['Filter Status', info.filterStatus || 'Semua'],
    ['Filter Rak / Personil / Cari', [info.filterRak, info.filterPersonil, info.cari].filter(x => x && x !== '-').join(' · ') || '—'],
    ['Diekspor', `${tglJam}${oleh ? ' · ' + oleh : ''}`],
    [],
    ['RINGKASAN'],
    ['Total produk', rows.length],
    ['Kurang (minus)', hit.Minus],
    ['Lebih (plus)', hit.Plus],
    ['Sesuai (balance)', hit.Balance],
    ['Belum dihitung', hit.Belum],
    []
  ];
  const header = ['SKU (ID Produk)', 'Nama Produk', 'Qty Web', 'Qty Real', 'Selisih', 'Status', 'Kode Rak', 'Lokasi', 'Tim', 'Personil', 'Waktu Hitung', 'Export CSV'];
  const baris = rows.map(r => {
    const n = info.status(r);
    const real = r.totalReal === '' || r.totalReal === undefined || r.totalReal === null ? '' : Number(r.totalReal);
    const sel = r.selisih === '' || r.selisih === undefined || r.selisih === null ? '' : Number(r.selisih);
    return { n, isi: [String(r.sku || ''), String(r.namaProduk || ''), Number(r.qtySistem) || 0, real, sel,
      (OP_STATUS[n] || OP_STATUS.Belum).label, String(r.rak || ''), String(r.lokasi || ''), String(r.tim || ''),
      r.personil ? String(opNama(r.personil)) : '', String(r.waktu || ''), String(r.export || '')] };
  });
  return { meta, header, baris, hit, tim, tgl, lebar: [26, 38, 10, 10, 9, 13, 11, 22, 8, 16, 17, 30] };
}
const OP_WARNA = { Minus: 'FFD1646C', Plus: 'FF2F6FD6', Balance: 'FF2E8B57', Belum: 'FF64748B' };

async function opBuatXlsx(info) {
  const ExcelJS = await opMuatExcelJs();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDC TOOLS';
  const ws = wb.addWorksheet('Opname', { views: [{ state: 'frozen', ySplit: 15 }], properties: { outlineLevelCol: 1 } });
  const d = opDataEkspor(info);
  const rows = info.rows, hit = d.hit, tim = d.tim;
  ws.columns = d.lebar.map((w, i) => ({ width: w, outlineLevel: i >= 6 ? 1 : 0, hidden: i >= 6 }));
  d.meta.forEach(m => ws.addRow(m));
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A8').font = { bold: true };
  ws.getCell('B3').font = { bold: true };
  ws.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } };
  for (let i = 2; i <= 13; i++) ws.getCell('A' + i).font = { color: { argb: 'FF4B5563' } };

  const kepala = ws.addRow(d.header);
  kepala.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFE9C46A' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    c.alignment = { vertical: 'middle' };
  });
  const warna = OP_WARNA;
  d.baris.forEach(({ n, isi }) => {
    const sel = isi[4];
    const baris = ws.addRow(isi);
    [1, 7, 8, 9].forEach(k => { baris.getCell(k).numFmt = '@'; });   // teks: tidak berubah jadi 1.00E+01 / Tim 0
    baris.getCell(6).font = { bold: true, color: { argb: warna[n] || warna.Belum } };
    if (sel !== '' && sel !== 0) baris.getCell(5).font = { color: { argb: sel < 0 ? warna.Minus : warna.Plus } };
  });
  ws.autoFilter = { from: { row: 15, column: 1 }, to: { row: 15 + rows.length, column: 12 } };

  const buf = await wb.xlsx.writeBuffer();
  const tgl = d.tgl;
  const nama = `Ekspor Opname ${info.bulanLabel} - ${tim.pendek} - ${tgl}${info.sumber === 'Opname Sheet' ? ' (Sheet)' : ''}.xlsx`.replace(/[\\/:*?"<>|]/g, '-');
  return { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nama, hit, tim };
}

function opTutupEkspor() { const el = document.getElementById('op-ekspor'); if (el) el.remove(); }
async function opBukaEkspor(info) {
  if (!info.rows.length) { if (typeof showToast === 'function') showToast('Tidak ada data untuk diekspor.', 'error'); return; }
  opTutupEkspor();
  const el = document.createElement('div');
  el.id = 'op-ekspor';
  el.className = 'op-modal op-sheet';
  el.onclick = e => { if (e.target === el) opTutupEkspor(); };
  el.innerHTML = `<div class="op-modal-kotak"><div class="op-grab"></div><h4>Ekspor Opname</h4>
    <div class="op-file"><div class="op-xl">XLSX</div><div><div class="op-fn">Menyiapkan file…</div><div class="op-fs"></div></div></div>
    <div class="op-rk"></div>
    <div class="op-aksi"><button class="op-a1" disabled>⬇ Unduh</button><button class="op-a2" disabled style="display:none">↗ Bagikan ke WA</button></div>
    <div class="op-msg"></div></div>`;
  document.body.appendChild(el);
  try {
    const hasil = await opBuatXlsx(info);
    const file = new File([hasil.blob], hasil.nama, { type: hasil.blob.type });
    el.querySelector('.op-fn').textContent = hasil.nama;
    el.querySelector('.op-fs').textContent = `Filter: ${hasil.tim.panjang} · ${info.filterStatus || 'Semua'} status · ${info.rows.length} produk`;
    el.querySelector('.op-rk').innerHTML = `<div><b class="op-t-k">${hasil.hit.Minus}</b>Kurang</div><div><b class="op-t-l">${hasil.hit.Plus}</b>Lebih</div><div><b class="op-t-s">${hasil.hit.Balance}</b>Sesuai</div><div><b>${hasil.hit.Belum}</b>Belum</div>`;
    const unduh = el.querySelector('.op-a1'), bagi = el.querySelector('.op-a2');
    unduh.disabled = false;
    unduh.onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(hasil.blob);
      a.download = hasil.nama;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      bagi.style.display = '';
      bagi.disabled = false;
      bagi.onclick = async () => {
        try { await navigator.share({ files: [file], title: hasil.nama }); }
        catch (e) { if (e && e.name !== 'AbortError') el.querySelector('.op-msg').textContent = 'Gagal membagikan. Pakai tombol Unduh.'; }
      };
    } else {
      el.querySelector('.op-aksi').classList.add('satu');
    }
    if (typeof info.sesudah === 'function') info.sesudah();
  } catch (e) {
    el.querySelector('.op-fn').textContent = 'Gagal membuat file';
    el.querySelector('.op-msg').textContent = e.message || String(e);
  }
}

// Salinan ke Google Sheets (perilaku lama tombol Export tetap dipertahankan, berjalan di belakang)
function opKirimSheet(sheetName, badgeText, rows) {
  if (typeof SO_SHEET_GAS_URL === 'undefined') return;
  fetch(SO_SHEET_GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'exportSO', sheetName, badgeText, rows }) }).catch(() => {});
}

// ---------- Modal "Tambahkan Kerusakan" (tanpa foto supaya cepat) ----------
function opRusakSiapkan(pre, info) {
  ['jenis', 'qty', 'ket'].forEach(k => { const el = document.getElementById(`${pre}-rusak-${k}`); if (el) el.value = ''; });
  document.getElementById(`${pre}-rusak-msg`).textContent = '';
  const kv = (l, v, mono) => `<div class="rk-kv"><span>${l}</span><b${mono ? ' class="rk-mono"' : ''}>${opEsc(v === '' || v == null ? '—' : v)}</b></div>`;
  document.getElementById(`${pre}-rusak-modal-body`).innerHTML =
    kv('Nama produk', info.nama) + kv('SKU', info.sku, true) + kv('Rak', info.rak, true) +
    kv('Qty Web', info.qty === '' || info.qty == null ? '' : Number(info.qty).toLocaleString('id-ID') + ' pcs', true);
  document.getElementById(`${pre}-rusak-riw`).innerHTML = '<span class="rk-muat">Memuat riwayat rusak…</span>';
  document.getElementById(`${pre}-rusak-modal`).style.display = 'flex';
}
// rows: [{ jumlahRusak, oleh, dicatatPada, keterangan, sesi }] terbaru di depan
function opRusakRiwayat(pre, rows, gagal) {
  const el = document.getElementById(`${pre}-rusak-riw`);
  if (!el) return;
  if (gagal) { el.innerHTML = '<span class="rk-muat">Riwayat rusak gagal dimuat.</span>'; return; }
  if (!rows || !rows.length) { el.innerHTML = '<span class="rk-muat">Belum pernah dilaporkan rusak.</span>'; return; }
  const t = rows[0];
  const tgl = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${+m[3]} ${OP_BULAN[+m[2] - 1].slice(0, 3)}` : String(s || ''); };
  el.innerHTML = `<div class="rk-riw-atas"><span>Pernah rusak: <b>${rows.length}×</b> · terakhir ${opEsc(t.jumlahRusak)} pcs (${opEsc(tgl(t.dicatatPada))})</span>
      <button type="button" onclick="this.closest('.rk-riw').classList.toggle('buka')"><span class="rk-t1">Lihat ▾</span><span class="rk-t2">Tutup ▴</span></button></div>
    <div class="rk-riw-list">${rows.map(r => `<div><span><b>${opEsc(r.jumlahRusak)} pcs</b> · ${opEsc(opNama(r.oleh || '—'))}${r.keterangan ? ' · ' + opEsc(r.keterangan) : ''}</span><i>${opEsc(r.dicatatPada || '')}</i></div>`).join('')}</div>`;
}
// Ambil isian form. Jenis + catatan digabung ke Keterangan (kolom sheet tidak berubah)
function opRusakAmbil(pre) {
  const jenis = document.getElementById(`${pre}-rusak-jenis`).value;
  const qty = parseInt(document.getElementById(`${pre}-rusak-qty`).value, 10);
  const catatan = document.getElementById(`${pre}-rusak-ket`).value.trim();
  const msg = document.getElementById(`${pre}-rusak-msg`);
  const salah = !jenis ? 'Pilih jenis kerusakan.' : !(qty >= 1) ? 'Jumlah kerusakan wajib diisi (min. 1 pcs).' : !catatan ? 'Catatan wajib diisi.' : '';
  msg.style.color = '#d1646c'; msg.textContent = salah;
  if (salah) return null;
  return { qty, keterangan: `${jenis} – ${catatan}`, jenis };
}


// =====================================================================
// DROPDOWN SERAGAM — menggantikan tampilan <select> bawaan browser.
// <select> asli tetap ada (tersembunyi) sebagai sumber nilai, jadi onchange & .value lama tetap jalan.
//   class="op-pilih"   → otomatis diganti saat halaman dimuat
//   data-cari          → ada kolom cari di daftar
//   data-hapus         → pilihan aktif berwarna krem + tombol ✕ (kembali ke "Semua")
//   data-judul="..."   → judul daftar di HP
//   option[data-meta]  → teks kecil di kanan (mis. "2 SKU / 160 PCS")
// =====================================================================
const opNilaiAsli = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
function opDD(sel) {
  if (!sel) return null;
  if (sel._dd) return sel._dd;
  const dd = document.createElement('div');
  dd.className = 'op-dd ' + [...sel.classList].filter(c => c !== 'op-pilih').join(' ');
  dd.id = sel.id ? sel.id + '-dd' : '';
  dd.innerHTML = '<button type="button" class="op-dd-btn"><span class="op-dd-label"></span><span class="op-dd-meta"></span>' +
    '<span class="op-dd-x" title="Hapus pilihan">✕</span><span class="op-dd-panah"></span></button>';
  sel.classList.add('op-dd-asli');
  sel.after(dd);
  sel._dd = dd;
  Object.defineProperty(sel, 'value', { configurable: true,
    get() { return opNilaiAsli.get.call(this); },
    set(v) { opNilaiAsli.set.call(this, v); opDDLabel(this); } });
  new MutationObserver(() => opDDLabel(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  dd.querySelector('.op-dd-btn').addEventListener('click', e => {
    if (sel.disabled) return;
    if (e.target.closest('.op-dd-x')) { e.stopPropagation(); opDDPilih(sel, ''); return; }
    if (opDDAktif && opDDAktif.sel === sel) opDDTutup(); else opDDBuka(sel);
  });
  opDDLabel(sel);
  return dd;
}
function opDDLabel(sel) {
  const dd = sel._dd;
  if (!dd) return;
  const o = sel.options[sel.selectedIndex];
  dd.querySelector('.op-dd-label').textContent = o ? o.textContent : '';
  dd.querySelector('.op-dd-meta').textContent = o && o.value !== '' ? (o.dataset.meta || '') : '';
  const terisi = sel.hasAttribute('data-hapus') && opNilaiAsli.get.call(sel) !== '';
  dd.classList.toggle('terisi', terisi);
  dd.classList.toggle('mati', sel.disabled);
}
let opDDAktif = null;
function opDDTutup() {
  if (!opDDAktif) return;
  opDDAktif.el.remove();
  if (opDDAktif.latar) opDDAktif.latar.remove();
  if (opDDAktif.sel._dd) opDDAktif.sel._dd.classList.remove('buka');
  opDDAktif = null;
}
function opDDPilih(sel, v) {
  opDDTutup();
  if (opNilaiAsli.get.call(sel) === v) return;
  sel.value = v;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
function opDDBuka(sel) {
  opDDTutup();
  const dd = sel._dd, btn = dd.querySelector('.op-dd-btn');
  const hp = window.matchMedia('(max-width: 760px)').matches;
  const pakaiKosong = sel.hasAttribute('data-hapus');
  const opsi = [...sel.options].filter(o => o.value !== '' || pakaiKosong);
  const nilai = opNilaiAsli.get.call(sel);
  const el = document.createElement('div');
  el.className = 'op-dd-pop' + (hp ? ' op-dd-sheet' : '');
  el.innerHTML = (hp ? `<div class="op-dd-grab"></div><div class="op-dd-judul">${opEsc(sel.dataset.judul || '')}</div>` : '') +
    (sel.hasAttribute('data-cari') ? `<div class="op-dd-cari"><input type="text" placeholder="${opEsc(sel.dataset.cariTeks || 'Cari…')}" autocomplete="off"></div>` : '') +
    `<div class="op-dd-list">${opsi.map((o, i) => `<button type="button" class="op-dd-it${o.value === nilai ? ' aktif' : ''}" data-i="${i}">
      <span>${opEsc(o.textContent)}</span><small>${opEsc(o.dataset.meta || '')}</small></button>`).join('')}
      <div class="op-dd-kosong" style="display:none">Tidak ditemukan</div></div>`;
  let latar = null;
  if (hp) {
    latar = document.createElement('div');
    latar.className = 'op-dd-latar';
    latar.onclick = opDDTutup;
    document.body.appendChild(latar);
  }
  document.body.appendChild(el);
  if (!hp) {
    const r = btn.getBoundingClientRect();
    const lebar = Math.max(r.width, 230);
    const bawah = window.innerHeight - r.bottom - 12, atas = r.top - 12;
    const naik = bawah < 240 && atas > bawah;
    el.style.width = lebar + 'px';
    el.style.left = Math.min(r.left, window.innerWidth - lebar - 8) + 'px';
    el.style.maxHeight = Math.min(360, naik ? atas : bawah) + 'px';
    if (naik) el.style.bottom = (window.innerHeight - r.top + 4) + 'px'; else el.style.top = (r.bottom + 4) + 'px';
  }
  dd.classList.add('buka');
  opDDAktif = { sel, el, latar };
  el.querySelectorAll('.op-dd-it').forEach(b => b.onclick = () => opDDPilih(sel, opsi[+b.dataset.i].value));
  const aktif = el.querySelector('.op-dd-it.aktif');
  if (aktif) aktif.scrollIntoView({ block: 'nearest' });
  const cari = el.querySelector('.op-dd-cari input');
  if (cari) {
    cari.oninput = () => {
      const q = cari.value.trim().toLowerCase();
      let ada = 0;
      el.querySelectorAll('.op-dd-it').forEach(b => { const ok = !q || b.textContent.toLowerCase().includes(q); b.style.display = ok ? '' : 'none'; if (ok) ada++; });
      el.querySelector('.op-dd-kosong').style.display = ada ? 'none' : '';
    };
    cari.onkeydown = e => {
      if (e.key === 'Enter') { const b = [...el.querySelectorAll('.op-dd-it')].find(x => x.style.display !== 'none'); if (b) b.click(); }
      if (e.key === 'Escape') opDDTutup();
    };
    if (!hp) setTimeout(() => cari.focus(), 0);
  }
}
document.addEventListener('mousedown', e => {
  if (!opDDAktif || window.matchMedia('(max-width: 760px)').matches) return;
  if (opDDAktif.el.contains(e.target) || (opDDAktif.sel._dd && opDDAktif.sel._dd.contains(e.target))) return;
  opDDTutup();
}, true);
document.addEventListener('scroll', e => { if (opDDAktif && !opDDAktif.el.contains(e.target) && !window.matchMedia('(max-width: 760px)').matches) opDDTutup(); }, true);
window.addEventListener('resize', () => { if (opDDAktif && !window.matchMedia('(max-width: 760px)').matches) opDDTutup(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') opDDTutup(); });
function opDDSemua(akar) { (akar || document).querySelectorAll('select.op-pilih').forEach(opDD); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => opDDSemua()); else opDDSemua();

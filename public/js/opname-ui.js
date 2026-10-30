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
      <span class="op-sku">${opEsc(r.sku)}</span>
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
  const isi = id === 'ow'
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
async function opBuatXlsx(info) {
  const ExcelJS = await opMuatExcelJs();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'PDC TOOLS';
  const ws = wb.addWorksheet('Opname', { views: [{ state: 'frozen', ySplit: 15 }], properties: { outlineLevelCol: 1 } });
  const lebar = [26, 38, 10, 10, 9, 13, 11, 22, 8, 16, 17, 30];
  ws.columns = lebar.map((w, i) => ({ width: w, outlineLevel: i >= 6 ? 1 : 0, hidden: i >= 6 }));

  const rows = info.rows;
  const hit = { Minus: 0, Plus: 0, Balance: 0, Belum: 0 };
  rows.forEach(r => { const n = info.status(r); hit[n] = (hit[n] || 0) + 1; });
  const sekarang = new Date(Date.now() + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const tglJam = `${sekarang.getUTCDate()} ${OP_BULAN[sekarang.getUTCMonth()].slice(0, 3)} ${sekarang.getUTCFullYear()} ${pad(sekarang.getUTCHours())}:${pad(sekarang.getUTCMinutes())} WIB`;
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
  meta.forEach(m => ws.addRow(m));
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A8').font = { bold: true };
  ws.getCell('B3').font = { bold: true };
  ws.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } };
  for (let i = 2; i <= 13; i++) ws.getCell('A' + i).font = { color: { argb: 'FF4B5563' } };

  const kepala = ws.addRow(['SKU (ID Produk)', 'Nama Produk', 'Qty Web', 'Qty Real', 'Selisih', 'Status', 'Kode Rak', 'Lokasi', 'Tim', 'Personil', 'Waktu Hitung', 'Export CSV']);
  kepala.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFE9C46A' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    c.alignment = { vertical: 'middle' };
  });
  const warna = { Minus: 'FFD1646C', Plus: 'FF2F6FD6', Balance: 'FF2E8B57', Belum: 'FF64748B' };
  rows.forEach(r => {
    const n = info.status(r);
    const real = r.totalReal === '' || r.totalReal === undefined || r.totalReal === null ? '' : Number(r.totalReal);
    const sel = r.selisih === '' || r.selisih === undefined || r.selisih === null ? '' : Number(r.selisih);
    const baris = ws.addRow([String(r.sku || ''), String(r.namaProduk || ''), Number(r.qtySistem) || 0, real, sel,
      (OP_STATUS[n] || OP_STATUS.Belum).label, String(r.rak || ''), String(r.lokasi || ''), String(r.tim || ''),
      r.personil ? String(opNama(r.personil)) : '', String(r.waktu || ''), String(r.export || '')]);
    [1, 7, 8, 9].forEach(k => { baris.getCell(k).numFmt = '@'; });   // teks: tidak berubah jadi 1.00E+01 / Tim 0
    baris.getCell(6).font = { bold: true, color: { argb: warna[n] || warna.Belum } };
    if (sel !== '' && sel !== 0) baris.getCell(5).font = { color: { argb: sel < 0 ? warna.Minus : warna.Plus } };
  });
  ws.autoFilter = { from: { row: 15, column: 1 }, to: { row: 15 + rows.length, column: 12 } };

  const buf = await wb.xlsx.writeBuffer();
  const tgl = `${sekarang.getUTCDate()} ${OP_BULAN[sekarang.getUTCMonth()].slice(0, 3)} ${sekarang.getUTCFullYear()}`;
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

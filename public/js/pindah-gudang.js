// pindah-gudang.js — Fitur Pindah Gudang
// Hitung stok per kode rak (contoh 0001A = shaf A1+A2+A3), catat koli,
// lalu simpan ke Google Sheet "LAPORAN BARANG" lewat server Railway.
// Berdiri sendiri: tidak mengubah main.js, hanya memakai showToast, showConfirm,
// currentUserRole, dan PAGE_DATA_LOADERS yang sudah ada di main.js.

const PG_ASSET_BASE = 'https://pdcgudang.et.r.appspot.com/v1/assets/get';

const pgState = {
  rak: {},          // { '0001A': { kode, items: [{id,nama,varian,img,lokasi[],qtyCsv}], totalCsv } }
  hitung: {},       // { '0001A': { items:[{id,lokasi,nama,varian,qtyCsv,qtyKirim}], petugas, waktu } }
  koli: {},         // { '0001A': 3 }
  sheetUrl: '',
  sudahDimuat: false,
  sedangMuat: false,
  filter: 'semua',
  cari: '',
  aktif: null,      // kode rak yang sedang dibuka di modal
  baris: [],        // isi modal: [{id,nama,varian,img,lokasi,qtyCsv,qtyKirim,tambahan}]
  simpanJalan: false
};

// Daftarkan ke router main.js supaya menu & refresh (#pindah-gudang) berfungsi
if (typeof PAGE_DATA_LOADERS !== 'undefined') {
  PAGE_DATA_LOADERS['pindah-gudang'] = () => pgInit();
}

// ---------- Helper ----------
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

// Aturan kode rak: buang angka shaf di belakang. 0001A1 → 0001A, 0007DD1 → 0007DD
function pgKodeRak(lokasi) {
  return String(lokasi || '').trim().toUpperCase().replace(/\d+$/, '');
}

async function pgApi(url, opsi = {}) {
  const res = await fetch(url, {
    ...opsi,
    headers: {
      'Content-Type': 'application/json',
      'x-session-token': sessionStorage.getItem('sessionToken') || ''
    }
  });
  if (res.status === 401) throw new Error('Sesi habis. Silakan login ulang.');
  let data;
  try { data = await res.json(); } catch (e) { throw new Error('Respons server tidak valid.'); }
  if (!data.success) throw new Error(data.message || 'Permintaan gagal.');
  return data;
}

// ---------- Muat data ----------
function pgInit() {
  pgTampilkanTombolUpload();
  if (!pgState.sudahDimuat && !pgState.sedangMuat) pgMuat();
}

function pgTampilkanTombolUpload() {
  const role = (typeof currentUserRole !== 'undefined' && currentUserRole) || sessionStorage.getItem('sessionRole') || '';
  const btn = document.getElementById('pg-btn-upload');
  if (btn) btn.style.display = (role === 'admin' || role === 'superuser') ? 'inline-flex' : 'none';
}

async function pgMuat() {
  pgState.sedangMuat = true;
  pgSetStateBox('sync', 'Memuat data dari sheet LAPORAN BARANG...');
  const btn = document.getElementById('pg-btn-refresh');
  if (btn) btn.disabled = true;
  try {
    const data = await pgApi('/api/pindah/data');
    pgSusunMaster(data.master || []);
    pgState.hitung   = data.hitung || {};
    pgState.koli     = data.koli || {};
    pgState.sheetUrl = data.url || '';
    pgState.sudahDimuat = true;
    const link = document.getElementById('pg-btn-sheet');
    if (link) {
      link.href = pgState.sheetUrl || '#';
      link.style.display = pgState.sheetUrl ? 'inline-flex' : 'none';
    }
    pgRender();
  } catch (err) {
    pgSetStateBox('error', err.message);
    pgToast(err.message, 'error');
  } finally {
    pgState.sedangMuat = false;
    if (btn) btn.disabled = false;
  }
}

// master: [[kodeRak, lokasi, idProduk, nama, varian, qty, kodeGambar], ...]
// Produk yang sama di beberapa shaf (misal XX01A1 & XX01A2) digabung jadi satu baris.
function pgSusunMaster(master) {
  const rak = {};
  master.forEach(r => {
    const kode = String(r[0] || '').trim();
    const id   = String(r[2] || '').trim();
    if (!kode || !id) return;
    if (!rak[kode]) rak[kode] = { kode, peta: {}, items: [], totalCsv: 0 };
    const g = rak[kode];
    const qty = Number(r[5]) || 0;
    if (!g.peta[id]) {
      g.peta[id] = { id, nama: String(r[3] || ''), varian: String(r[4] || ''), img: String(r[6] || ''), lokasi: [], qtyCsv: 0 };
      g.items.push(g.peta[id]);
    }
    const it = g.peta[id];
    it.qtyCsv += qty;
    const lok = String(r[1] || '').trim();
    if (lok && !it.lokasi.includes(lok)) it.lokasi.push(lok);
    g.totalCsv += qty;
  });
  Object.values(rak).forEach(g => {
    g.items.sort((a, b) => (a.lokasi[0] || '').localeCompare(b.lokasi[0] || '') || a.nama.localeCompare(b.nama));
    delete g.peta;
  });
  pgState.rak = rak;
}

function pgStatusRak(kode) {
  const h = pgState.hitung[kode];
  if (!h) return 'belum';
  return h.items.some(i => Number(i.qtyKirim) !== Number(i.qtyCsv)) ? 'selisih' : 'sesuai';
}

// ---------- Render grid ----------
function pgSetStateBox(ikon, pesan) {
  const grid = document.getElementById('pg-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="pg-state-box">
      <span class="material-symbols-outlined ${ikon === 'sync' ? 'pg-putar' : ''}">${ikon}</span>
      <p>${pgEsc(pesan)}</p>
    </div>`;
}

function pgSemuaKode() {
  const set = new Set([...Object.keys(pgState.rak), ...Object.keys(pgState.hitung)]);
  return [...set].sort();
}

function pgRender() {
  const semua = pgSemuaKode();
  let nSesuai = 0, nSelisih = 0, totalKoli = 0;
  semua.forEach(k => {
    const s = pgStatusRak(k);
    if (s === 'sesuai') nSesuai++;
    if (s === 'selisih') nSelisih++;
    totalKoli += Number(pgState.koli[k] || 0);
  });
  const selesai = nSesuai + nSelisih;
  const persen = semua.length ? Math.round(selesai / semua.length * 100) : 0;

  document.getElementById('pg-n-total').innerText   = pgAngka(semua.length);
  document.getElementById('pg-n-selesai').innerText = pgAngka(selesai);
  document.getElementById('pg-n-sesuai').innerText  = pgAngka(nSesuai);
  document.getElementById('pg-n-selisih').innerText = pgAngka(nSelisih);
  document.getElementById('pg-n-koli').innerText    = pgAngka(totalKoli);
  document.getElementById('pg-progress-bar').style.width = persen + '%';
  document.getElementById('pg-progress-label').innerText = `${persen}% kode rak sudah dihitung`;

  if (!semua.length) {
    pgSetStateBox('upload_file', 'Belum ada data. Upload CSV stok terlebih dahulu (tombol Upload CSV, khusus admin).');
    return;
  }

  const cari = pgState.cari.trim().toUpperCase();
  const tampil = semua.filter(k => {
    if (pgState.filter !== 'semua' && pgStatusRak(k) !== pgState.filter) return false;
    if (!cari) return true;
    if (k.includes(cari)) return true;
    const g = pgState.rak[k];
    return g ? g.items.some(i => i.nama.toUpperCase().includes(cari) || i.id.toUpperCase().includes(cari)) : false;
  });

  if (!tampil.length) {
    pgSetStateBox('search_off', 'Tidak ada kode rak yang cocok dengan filter.');
    return;
  }

  const labelStatus = { belum: 'Belum', sesuai: 'Sesuai', selisih: 'Selisih' };
  document.getElementById('pg-grid').innerHTML = tampil.map(k => {
    const g = pgState.rak[k];
    const s = pgStatusRak(k);
    const nProduk = g ? g.items.length : (pgState.hitung[k]?.items.length || 0);
    const total   = g ? g.totalCsv : 0;
    const koli    = pgState.koli[k];
    let nSel = 0;
    if (s === 'selisih') nSel = pgState.hitung[k].items.filter(i => Number(i.qtyKirim) !== Number(i.qtyCsv)).length;
    return `<button class="pg-card pg-card-${s}" onclick="pgBukaRak('${pgEsc(k)}')">
        <div class="pg-card-top">
          <span class="pg-card-kode">${pgEsc(k)}</span>
          <span class="pg-badge pg-badge-${s}">${labelStatus[s]}</span>
        </div>
        <div class="pg-card-meta">${pgAngka(nProduk)} produk · ${pgAngka(total)} pcs</div>
        <div class="pg-card-foot">
          ${koli ? `<span><span class="material-symbols-outlined">inventory_2</span>${pgAngka(koli)} koli</span>` : '<span class="pg-muted">Belum ada koli</span>'}
          ${nSel ? `<span class="pg-teks-merah">${nSel} produk selisih</span>` : ''}
        </div>
      </button>`;
  }).join('');
}

function pgSetFilter(f, el) {
  pgState.filter = f;
  document.querySelectorAll('.pg-chip').forEach(c => c.classList.remove('aktif'));
  if (el) el.classList.add('aktif');
  pgRender();
}
function pgCari(v) { pgState.cari = v || ''; if (pgState.sudahDimuat) pgRender(); }

// ---------- Modal hitung ----------
function pgBukaRak(kode) {
  pgState.aktif = kode;
  const g = pgState.rak[kode];
  const h = pgState.hitung[kode];
  const tersimpan = {};
  (h?.items || []).forEach(i => { tersimpan[i.id] = i; });

  pgState.baris = (g ? g.items : []).map(i => ({
    id: i.id, nama: i.nama, varian: i.varian, img: i.img,
    lokasi: i.lokasi.join(', '),
    qtyCsv: i.qtyCsv,
    qtyKirim: tersimpan[i.id] ? Number(tersimpan[i.id].qtyKirim) : null,
    tambahan: false
  }));
  // Barang tambahan yang dulu dicatat tapi tidak ada di CSV
  (h?.items || []).forEach(i => {
    if (!g || !g.items.some(x => x.id === i.id)) {
      pgState.baris.push({ id: i.id, nama: i.nama, varian: i.varian || '', img: '', lokasi: i.lokasi || kode,
        qtyCsv: Number(i.qtyCsv) || 0, qtyKirim: Number(i.qtyKirim), tambahan: true });
    }
  });

  document.getElementById('pg-modal-kode').innerText = kode;
  document.getElementById('pg-modal-sub').innerText = h
    ? `Sudah dihitung oleh ${h.petugas || '-'} · ${h.waktu || ''}. Simpan lagi akan menimpa data lama.`
    : 'Hitung barang di semua shaf rak ini, lalu isi jumlah nyata.';
  document.getElementById('pg-koli').value = pgState.koli[kode] || '';
  document.getElementById('pg-tambah-nama').value = '';
  document.getElementById('pg-tambah-qty').value = '';
  pgRenderBaris();
  document.getElementById('pg-modal-overlay').classList.add('tampil');
  document.body.style.overflow = 'hidden';
}

function pgTutupModal(e) {
  if (e && e.target && e.target.id !== 'pg-modal-overlay') return;
  document.getElementById('pg-modal-overlay').classList.remove('tampil');
  document.body.style.overflow = '';
  pgState.aktif = null;
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
      return `<div class="pg-baris" id="pg-baris-${i}">
          ${img}
          <div class="pg-baris-info">
            <div class="pg-baris-nama">${pgEsc(b.nama)}${b.varian ? ` <span class="pg-muted">· ${pgEsc(b.varian)}</span>` : ''}</div>
            <div class="pg-baris-sub">${b.tambahan ? '<span class="pg-tag-tambahan">Tidak ada di CSV</span>' : pgEsc(b.lokasi)}</div>
          </div>
          <div class="pg-baris-angka">
            <div class="pg-catatan"><span>Catatan</span><b>${pgAngka(b.qtyCsv)}</b></div>
            <input type="number" inputmode="numeric" min="0" class="pg-input" data-i="${i}"
              value="${b.qtyKirim === null || b.qtyKirim === undefined || Number.isNaN(b.qtyKirim) ? '' : b.qtyKirim}"
              placeholder="Nyata" oninput="pgUbahQty(${i}, this.value)" onkeydown="pgEnterBerikut(event, ${i})">
            <div class="pg-selisih" id="pg-selisih-${i}"></div>
            ${b.tambahan ? `<button class="pg-hapus" title="Hapus" onclick="pgHapusTambahan(${i})"><span class="material-symbols-outlined">close</span></button>` : ''}
          </div>
        </div>`;
    }).join('');
  }
  pgState.baris.forEach((_, i) => pgUpdateSelisih(i));
  pgUpdateRingkasModal();
}

function pgUbahQty(i, v) {
  pgState.baris[i].qtyKirim = v === '' ? null : Math.max(0, Math.floor(Number(v)));
  pgUpdateSelisih(i);
  pgUpdateRingkasModal();
}

function pgUpdateSelisih(i) {
  const b = pgState.baris[i];
  const el = document.getElementById('pg-selisih-' + i);
  const row = document.getElementById('pg-baris-' + i);
  if (!el || !row) return;
  row.classList.remove('pg-ok', 'pg-kurang', 'pg-lebih');
  if (b.qtyKirim === null || b.qtyKirim === undefined || Number.isNaN(b.qtyKirim)) { el.innerHTML = ''; return; }
  const d = b.qtyKirim - b.qtyCsv;
  if (d === 0) { el.innerHTML = '<span class="material-symbols-outlined">check_circle</span>'; row.classList.add('pg-ok'); }
  else { el.innerText = (d > 0 ? '+' : '') + d; row.classList.add(d < 0 ? 'pg-kurang' : 'pg-lebih'); }
}

function pgUpdateRingkasModal() {
  const kosong  = pgState.baris.filter(b => b.qtyKirim === null || b.qtyKirim === undefined || Number.isNaN(b.qtyKirim)).length;
  const selisih = pgState.baris.filter(b => b.qtyKirim !== null && b.qtyKirim !== undefined && b.qtyKirim !== b.qtyCsv).length;
  const total   = pgState.baris.reduce((s, b) => s + (Number(b.qtyKirim) || 0), 0);
  const totCsv  = pgState.baris.reduce((s, b) => s + (Number(b.qtyCsv) || 0), 0);
  document.getElementById('pg-modal-ringkas').innerHTML =
    `<span>${pgAngka(pgState.baris.length)} produk</span>
     <span>Catatan <b>${pgAngka(totCsv)}</b> pcs</span>
     <span>Dihitung <b>${pgAngka(total)}</b> pcs</span>
     ${kosong ? `<span class="pg-teks-amber">${kosong} belum diisi</span>` : ''}
     ${selisih ? `<span class="pg-teks-merah">${selisih} selisih</span>` : (kosong ? '' : '<span class="pg-teks-hijau">Semua sesuai</span>')}`;
}

function pgEnterBerikut(e, i) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const next = document.querySelector(`.pg-input[data-i="${i + 1}"]`);
  if (next) { next.focus(); next.select(); }
  else document.getElementById('pg-koli').focus();
}

function pgIsiSemuaSesuai() {
  pgState.baris.forEach(b => { if (!b.tambahan) b.qtyKirim = b.qtyCsv; });
  pgRenderBaris();
}

function pgKosongkan() {
  pgState.baris = pgState.baris.filter(b => !b.tambahan);
  pgState.baris.forEach(b => { b.qtyKirim = null; });
  pgRenderBaris();
}

function pgTambahBarang() {
  const nama = document.getElementById('pg-tambah-nama').value.trim();
  const qty  = Math.floor(Number(document.getElementById('pg-tambah-qty').value));
  if (!nama) { pgToast('Isi nama atau kode barang yang ditemukan.', 'warning'); return; }
  if (!qty || qty < 1) { pgToast('Isi jumlah barang (minimal 1).', 'warning'); return; }
  pgState.baris.push({ id: 'TAMBAHAN-' + Date.now(), nama, varian: '', img: '', lokasi: pgState.aktif,
    qtyCsv: 0, qtyKirim: qty, tambahan: true });
  document.getElementById('pg-tambah-nama').value = '';
  document.getElementById('pg-tambah-qty').value = '';
  pgRenderBaris();
}

function pgHapusTambahan(i) {
  pgState.baris.splice(i, 1);
  pgRenderBaris();
}

async function pgSimpan() {
  if (pgState.simpanJalan) return;
  const kode = pgState.aktif;
  const kosong = pgState.baris.filter(b => b.qtyKirim === null || b.qtyKirim === undefined || Number.isNaN(b.qtyKirim));
  if (kosong.length) {
    pgToast(`${kosong.length} produk belum diisi jumlah nyatanya. Isi 0 kalau barangnya tidak ada.`, 'warning');
    const idx = pgState.baris.indexOf(kosong[0]);
    document.querySelector(`.pg-input[data-i="${idx}"]`)?.focus();
    return;
  }
  const koli = Math.floor(Number(document.getElementById('pg-koli').value));
  if (!koli || koli < 1) {
    pgToast('Isi jumlah koli (karung) untuk kode rak ini.', 'warning');
    document.getElementById('pg-koli').focus();
    return;
  }

  const selisih = pgState.baris.filter(b => b.qtyKirim !== b.qtyCsv).length;
  const sudahAda = !!pgState.hitung[kode];
  let pesan = `Kode rak ${kode}: ${pgState.baris.length} produk, ${koli} koli.`;
  if (selisih) pesan += ` Ada ${selisih} produk selisih.`;
  if (sudahAda) pesan += ' Data hitung sebelumnya akan ditimpa.';
  const ok = await pgKonfirmasi('Simpan Hitungan', pesan, 'Ya, Simpan');
  if (!ok) return;

  const btn = document.getElementById('pg-btn-simpan');
  pgState.simpanJalan = true;
  btn.disabled = true; btn.innerText = 'Menyimpan...';
  try {
    const items = pgState.baris.map(b => ({
      id: b.tambahan ? 'TAMBAHAN' : b.id,
      lokasi: b.lokasi, nama: b.nama, varian: b.varian || '',
      qtyCsv: Number(b.qtyCsv) || 0, qtyKirim: Number(b.qtyKirim) || 0
    }));
    const data = await pgApi('/api/pindah/simpan', { method: 'POST', body: JSON.stringify({ kodeRak: kode, koli, items }) });
    pgState.hitung[kode] = {
      items: items.map((it, i) => ({ ...it, id: it.id === 'TAMBAHAN' ? 'TAMBAHAN-' + i : it.id })),
      petugas: data.oleh, waktu: data.waktu
    };
    pgState.koli[kode] = koli;
    pgToast(`Kode rak ${kode} tersimpan ke sheet.`, 'success');
    pgTutupModal();
    pgRender();
  } catch (err) {
    pgToast(err.message, 'error');
  } finally {
    pgState.simpanJalan = false;
    btn.disabled = false; btn.innerText = 'Simpan ke Sheet';
  }
}

// ---------- Upload CSV (admin & superuser) ----------
function pgPilihCsv() { document.getElementById('pg-file-csv').click(); }

// Parser CSV sederhana: mendukung tab, koma, titik koma, dan tanda kutip
function pgParseCsv(teks) {
  teks = teks.replace(/^\uFEFF/, '');
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

async function pgUploadCsv(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  let rows;
  try { rows = pgParseCsv(await file.text()); }
  catch (e) { pgToast('File tidak bisa dibaca.', 'error'); return; }
  if (rows.length < 2) { pgToast('CSV kosong.', 'error'); return; }

  // Catatan: di export ini kolom "SKU" berisi lokasi rak (0001A1),
  // sedangkan kolom "Rack" berisi ID produk.
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
      iImg  >= 0 ? String(r[iImg]  || '').trim() : '']);
  });
  if (!data.length) { pgToast('Tidak ada baris yang valid di CSV.', 'error'); return; }

  const nRak  = new Set(data.map(d => d[0])).size;
  const total = data.reduce((s, d) => s + d[5], 0);
  const nHitung = Object.keys(pgState.hitung).length;
  let pesan = `${pgAngka(data.length)} baris, ${pgAngka(nRak)} kode rak, ${pgAngka(total)} pcs.`;
  if (dilewati) pesan += ` ${pgAngka(dilewati)} baris dilewati (data uji coba atau tidak lengkap).`;
  pesan += ' Tab "Data CSV" di sheet akan diganti dengan file ini.';
  if (nHitung) pesan += ` PERHATIAN: ${nHitung} kode rak sudah dihitung. Hasil hitungnya tetap tersimpan, tapi angka catatan bisa berbeda dengan CSV baru.`;
  const ok = await pgKonfirmasi('Upload CSV Stok', pesan, 'Ya, Upload');
  if (!ok) return;

  const btn = document.getElementById('pg-btn-upload');
  btn.disabled = true;
  pgSetStateBox('sync', 'Mengirim CSV ke sheet...');
  try {
    const res = await pgApi('/api/pindah/upload', { method: 'POST', body: JSON.stringify({ rows: data }) });
    pgToast(res.message || 'CSV berhasil diupload.', 'success');
    pgState.sudahDimuat = false;
    await pgMuat();
  } catch (err) {
    pgToast(err.message, 'error');
    pgRender();
  } finally {
    btn.disabled = false;
  }
}

// Tutup modal dengan tombol Esc
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && pgState.aktif) pgTutupModal();
});

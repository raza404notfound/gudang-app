// pecah-rak.js — Menu "Pecah Rak": rencana pembagian SKU ke rak supaya muatan atas rak seimbang
// Aturan: 1 SKU = 1 slot (maks N pcs), sisanya ditaruh di atas rak. Varian satu barang tidak dipencar ke rak lain.
const prState = {
  rows: [],        // [tim, id, lokasi, qty, nama, varian, gambar, diupload, oleh, namaFile]
  setel: {},       // { tim: { rak:[], tingkat:'A,B,C,D', shaf:3, sku:5, pcs:5, batas:'', pisah:[] } }
  tim: '',
  tab: 'ringkasan',
  filterRak: '',
  rankMode: 'sku',
  sudah: false,
  timerSetel: null
};

if (typeof PAGE_DATA_LOADERS !== 'undefined') PAGE_DATA_LOADERS['pecah-rak'] = () => prInit();

function prEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function prAngka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function prToast(m, t = 'info') { if (typeof showToast === 'function') showToast(prEsc(m), t); else alert(m); }
async function prApi(url, opsi = {}) {
  const res = await fetch(url, { ...opsi, headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('sessionToken') || '' } });
  const d = await res.json().catch(() => ({ success: false, message: 'Respons server tidak valid.' }));
  if (!d.success) throw new Error(d.message || 'Permintaan gagal.');
  return d;
}

// ============================================================
// MUAT, UPLOAD, HAPUS, SETELAN
// ============================================================
async function prInit() {
  if (!prState.sudah) await prMuat();
  else { prRender(); prMuat(); }   // buka ulang: tampil dulu, cek perubahan diam-diam
}
// Cache perangkat: tampil instan dari data terakhir, diperbarui di belakang layar
const PR_CACHE = 'pr_cache_v1';
function prTerapkan(d) {
  prState.rows = d.rows || [];
  prState.setel = d.setel || {};
  prState.sudah = true;
  const tims = prDaftarTim();
  if (!tims.includes(prState.tim)) prState.tim = tims[0] || '';
  prRender();
}
async function prMuat(segar) {
  const isi = document.getElementById('pr-isi');
  let cache = null;
  if (!prState.sudah) { try { cache = JSON.parse(localStorage.getItem(PR_CACHE) || 'null'); } catch (e) {} }
  if (cache) prTerapkan(cache);
  else if (isi && !prState.sudah) isi.innerHTML = '<div class="pr-kosong">Memuat data…</div>';
  try {
    const d = await prApi('/api/pecah/data' + (segar ? '?segar=1' : ''));
    const baru = { rows: d.rows || [], setel: d.setel || {} };
    try { localStorage.setItem(PR_CACHE, JSON.stringify(baru)); } catch (e) { try { localStorage.removeItem(PR_CACHE); } catch (x) {} }
    const lama = JSON.stringify({ rows: prState.rows, setel: prState.setel });
    if (!prState.sudah || lama !== JSON.stringify(baru)) prTerapkan(baru);
  } catch (err) {
    if (isi && !prState.sudah) isi.innerHTML = `<div class="pr-kosong">${prEsc(err.message)}</div>`;
  }
}
function prDaftarTim() {
  const t = {};
  prState.rows.forEach(r => { t[r[0]] = (t[r[0]] || 0) + 1; });
  return Object.keys(t).sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b)) ? a - b : a.localeCompare(b));
}

function prPilihCsv() { document.getElementById('pr-file').click(); }
async function prUpload(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const teks = await file.text();
  const baris = (typeof pgParseCsv === 'function' ? pgParseCsv(teks) : teks.split(/\r?\n/).map(l => l.split('\t')));
  if (baris.length < 2) { prToast('CSV kosong atau formatnya tidak dikenali.', 'error'); return; }
  const head = baris[0].map(h => String(h).trim().toLowerCase());
  const kol = nama => head.findIndex(h => nama.some(n => h === n));
  let iRack = kol(['rack']), iSku = kol(['sku']);
  const iQty = kol(['quantity', 'qty', 'jumlah']), iNama = kol(['product name', 'nama produk', 'nama']);
  const iVar = kol(['varian', 'variant']), iImg = kol(['image', 'gambar', 'kode gambar']);
  if (iRack < 0 || iSku < 0 || iQty < 0) { prToast('Kolom Rack / SKU / Quantity tidak ditemukan di CSV.', 'error'); return; }
  // Di export PDC kolom "Rack" berisi ID produk dan "SKU" berisi lokasi. Kalau terbalik, tukar otomatis.
  const contoh = baris.slice(1, 20).map(r => String(r[iRack] || ''));
  if (!contoh.some(v => v.includes('-'))) { const t = iRack; iRack = iSku; iSku = t; }
  const rows = baris.slice(1).map(r => {
    const id = String(r[iRack] || '').trim();
    return [id.split('-')[0].trim(), id, String(r[iSku] || '').trim().toUpperCase(), Math.max(0, parseInt(r[iQty], 10) || 0),
      iNama >= 0 ? String(r[iNama] || '').trim() : '', iVar >= 0 ? String(r[iVar] || '').trim() : '', iImg >= 0 ? String(r[iImg] || '').trim() : ''];
  }).filter(r => r[1] && r[3] > 0);
  if (!rows.length) { prToast('Tidak ada baris dengan qty di CSV ini.', 'error'); return; }
  const tims = [...new Set(rows.map(r => r[0]))].sort();
  const ok = typeof showConfirm === 'function'
    ? await showConfirm('Upload CSV Pecah Rak', `${rows.length} baris untuk Tim ${tims.join(', ')}. Data lama tim tersebut akan diganti. Data Stok Opname tidak terpengaruh.`, 'Ya, Upload')
    : confirm('Upload?');
  if (!ok) return;
  const btn = document.getElementById('pr-btn-upload');
  if (btn) { btn.disabled = true; btn.textContent = 'Mengupload…'; }
  try {
    const d = await prApi('/api/pecah/upload', { method: 'POST', body: JSON.stringify({ rows, namaFile: file.name }) });
    prToast(d.message, 'success');
    prState.tim = tims[0];
    prState.sudah = false;
    await prMuat();
  } catch (err) { prToast(err.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = '<span class="material-symbols-outlined">upload_file</span><span>Upload CSV</span>'; } }
}

async function prHapusCsv(semua) {
  const tim = semua ? '' : prState.tim;
  const ok = typeof showConfirm === 'function'
    ? await showConfirm(semua ? 'Hapus semua data Pecah Rak?' : `Hapus data CSV Tim ${tim}?`,
        'Data ini hanya untuk perencanaan rak (bukan Stok Opname). Setelan rak tetap disimpan.', 'Ya, Hapus')
    : confirm('Hapus?');
  if (!ok) return;
  try {
    const d = await prApi('/api/pecah/hapus', { method: 'POST', body: JSON.stringify({ tim }) });
    prToast(d.message, 'success');
    prState.sudah = false;
    await prMuat();
  } catch (err) { prToast(err.message, 'error'); }
}

function prSetelan(tim) {
  const s = prState.setel[tim] || {};
  let rak = Array.isArray(s.rak) ? s.rak : null;
  if (!rak) {   // default: rak yang sekarang dipakai tim ini (4 karakter depan lokasi)
    rak = [...new Set(prState.rows.filter(r => r[0] === tim && r[2]).map(r => r[2].replace(/[A-Z]+\d*$/, '') || r[2].slice(0, 4)))].sort();
  }
  return { rak, tingkat: s.tingkat || 'A,B,C,D', shaf: Number(s.shaf) || 3, sku: Number(s.sku) || 5, pcs: Number(s.pcs) || 5,
    batas: s.batas === undefined ? '' : s.batas, pisah: Array.isArray(s.pisah) ? s.pisah : [] };
}
function prUbahSetel(kunci, nilai) {
  const s = prSetelan(prState.tim);
  if (['shaf', 'sku', 'pcs'].includes(kunci)) nilai = Math.max(1, Math.min(50, parseInt(nilai, 10) || 1));
  if (kunci === 'batas') nilai = nilai === '' ? '' : Math.max(0, parseInt(nilai, 10) || 0);
  if (kunci === 'tingkat') nilai = String(nilai).toUpperCase().replace(/[^A-Z,\s]/g, '');
  s[kunci] = nilai;
  prState.setel[prState.tim] = s;
  prRender(true);
  clearTimeout(prState.timerSetel);
  const tim = prState.tim;
  prState.timerSetel = setTimeout(() => {
    prApi('/api/pecah/setel', { method: 'POST', body: JSON.stringify({ tim, setel: prState.setel[tim] }) }).catch(e => prToast('Setelan gagal disimpan: ' + e.message, 'error'));
  }, 800);
}
function prTambahRak() {
  const inp = document.getElementById('pr-rak-baru');
  const kode = String(inp.value || '').trim().toUpperCase();
  if (!kode) return;
  const s = prSetelan(prState.tim);
  kode.split(/[\s,]+/).filter(Boolean).forEach(k => { if (!s.rak.includes(k)) s.rak.push(k); });
  inp.value = '';
  prUbahSetel('rak', s.rak);
}
function prHapusRak(kode) {
  const s = prSetelan(prState.tim);
  prUbahSetel('rak', s.rak.filter(k => k !== kode));
}
function prTogglePisah(key) {
  const s = prSetelan(prState.tim);
  const p = new Set(s.pisah);
  p.has(key) ? p.delete(key) : p.add(key);
  prUbahSetel('pisah', [...p]);
}

// ============================================================
// HITUNG RENCANA
// ============================================================
function prNorm(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }

function prHitung(tim) {
  const st = prSetelan(tim);
  const tingkat = st.tingkat.split(/[\s,]+/).filter(Boolean);
  const cap = Math.max(1, tingkat.length * st.shaf * st.sku);
  // 1. SKU (gabung baris lokasi yang sama ID-nya)
  const peta = {};
  prState.rows.filter(r => r[0] === tim).forEach(r => {
    const s = peta[r[1]] || (peta[r[1]] = { id: r[1], nama: r[4], varian: r[5], img: r[6], qty: 0, lokasi: [] });
    s.qty += Number(r[3]) || 0;
    if (r[2] && !s.lokasi.includes(r[2])) s.lokasi.push(r[2]);
  });
  const skus = Object.values(peta).filter(s => s.qty > 0);
  skus.forEach(s => { s.slot = Math.min(s.qty, st.pcs); s.atas = Math.max(0, s.qty - st.pcs); });
  // 2. Kelompok barang (varian satu model tidak dipencar)
  const kunciDash = new Set();
  skus.forEach(s => { const n = prNorm(s.nama); if (n.includes(' - ')) kunciDash.add(n.split(' - ')[0].trim()); });
  const dash = [...kunciDash].filter(k => k.split(' ').length >= 2).sort((a, b) => b.length - a.length);
  const pisah = new Set(st.pisah);
  const grup = {};
  skus.forEach(s => {
    const n = prNorm(s.nama) || s.id;
    let k = n.includes(' - ') ? n.split(' - ')[0].trim() : (dash.find(d => n.startsWith(d + ' ')) || n);
    s.grup = k;
    if (pisah.has(k)) k = k + ' #' + s.id;
    (grup[k] = grup[k] || { kunci: s.grup, items: [], atas: 0, qty: 0 }).items.push(s);
    grup[k].atas += s.atas; grup[k].qty += s.qty;
  });
  const daftarGrup = Object.values(grup);
  // 3. Rak
  const nSku = skus.length;
  const totalAtas = skus.reduce((t, s) => t + s.atas, 0);
  const totalPcs = skus.reduce((t, s) => t + s.qty, 0);
  const minRak = Math.ceil(nSku / cap) || 0;
  const raks = (st.rak.length ? st.rak : []).map(k => ({ kode: k, items: [], used: 0, atas: 0, pcs: 0, tambahan: false }));
  const jRak = Math.max(raks.length, 1);
  const rekBatas = totalAtas ? Math.ceil(totalAtas / Math.max(raks.length || minRak, 1) * 1.1 / 10) * 10 : 0;
  const batas = st.batas === '' ? 0 : Number(st.batas);
  const tanda = [];
  let nTambahan = 0;
  const rakBaru = () => { nTambahan++; const r = { kode: 'TAMBAHAN ' + nTambahan, items: [], used: 0, atas: 0, pcs: 0, tambahan: true }; raks.push(r); return r; };
  const skor = (r, atasMasuk) => (r.atas + atasMasuk) / (totalAtas || 1) + r.used / (nSku || 1) + (batas && r.atas + atasMasuk > batas ? 10 : 0);
  const taruh = (r, items) => items.forEach(s => { r.items.push(s); r.used++; r.atas += s.atas; r.pcs += s.qty; });
  daftarGrup.sort((a, b) => b.atas - a.atas || b.items.length - a.items.length).forEach(g => {
    let sisa = g.items.slice().sort((a, b) => prNorm(a.nama).localeCompare(prNorm(b.nama)));
    if (sisa.length > cap) tanda.push(`Barang "${g.kunci}" punya ${sisa.length} SKU, lebih dari kapasitas 1 rak (${cap}) — terpaksa dibagi ke beberapa rak.`);
    while (sisa.length) {
      const potong = sisa.slice(0, cap);
      const atasPotong = potong.reduce((t, s) => t + s.atas, 0);
      let cocok = raks.filter(r => cap - r.used >= potong.length);
      let r;
      if (cocok.length) r = cocok.sort((a, b) => skor(a, atasPotong) - skor(b, atasPotong))[0];
      else {
        const ada = raks.filter(x => cap - x.used > 0).sort((a, b) => (cap - b.used) - (cap - a.used));
        if (ada.length && potong.length > 1 && cap - ada[0].used >= 1 && raks.length >= minRak) {
          r = ada[0];
          const muat = potong.slice(0, cap - r.used);
          taruh(r, muat);
          tanda.push(`Barang "${g.kunci}" tidak muat utuh di satu rak — sebagian di ${r.kode}.`);
          sisa = sisa.slice(muat.length);
          continue;
        }
        r = rakBaru();
      }
      taruh(r, potong);
      sisa = sisa.slice(potong.length);
    }
  });
  // 4. Slot di dalam rak: varian berurutan, tingkat → shaf
  raks.forEach(r => {
    r.items.sort((a, b) => a.grup.localeCompare(b.grup) || prNorm(a.nama).localeCompare(prNorm(b.nama)));
    r.shaf = [];
    r.items.forEach((s, i) => {
      const ns = Math.floor(i / st.sku);
      const kode = r.tambahan ? `${r.kode} · ${tingkat[Math.floor(ns / st.shaf)] || '?'}${(ns % st.shaf) + 1}` : `${r.kode}${tingkat[Math.floor(ns / st.shaf)] || '?'}${(ns % st.shaf) + 1}`;
      s.slotBaru = kode; s.rakBaru = r.kode;
      if (!r.shaf.length || r.shaf[r.shaf.length - 1].kode !== kode) r.shaf.push({ kode, items: [] });
      r.shaf[r.shaf.length - 1].items.push(s);
    });
  });
  if (nTambahan) tanda.unshift(`Rak yang tersedia kurang. Butuh ${nTambahan} rak lagi — ditandai "TAMBAHAN". Tambahkan nomor rak di pengaturan.`);
  if (batas) raks.filter(r => r.atas > batas).forEach(r => tanda.push(`Atas rak ${r.kode} ${r.atas} pcs melebihi batas ${batas} pcs.`));
  const gabungan = Object.values(daftarGrup.reduce((m, g) => { (m[g.kunci] = m[g.kunci] || { kunci: g.kunci, n: 0 }).n += g.items.length; return m; }, {}))
    .filter(g => g.n > 1).sort((a, b) => b.n - a.n);
  return { st, tingkat, cap, skus, raks, nSku, totalAtas, totalPcs, minRak, rekBatas, batas, tanda, gabungan, jRak };
}

// ============================================================
// TAMPILAN
// ============================================================
function prSetTim(t) { prState.tim = t; prState.filterRak = ''; prRender(); }
function prSetTab(t) { prState.tab = t; prRender(true); }

function prRender(hanyaIsi) {
  const isi = document.getElementById('pr-isi');
  if (!isi) return;
  const tims = prDaftarTim();
  const chipTim = document.getElementById('pr-tim');
  if (chipTim) chipTim.innerHTML = tims.length ? tims.map(t => `<button class="pr-chip ${t === prState.tim ? 'aktif' : ''}" onclick="prSetTim('${prEsc(t)}')">Tim ${prEsc(t)}</button>`).join('') : '';
  const btnHapus = document.getElementById('pr-aksi-hapus');
  if (btnHapus) btnHapus.style.display = tims.length ? '' : 'none';
  if (!tims.length) {
    isi.innerHTML = `<div class="pr-kosong"><span class="material-symbols-outlined">shelves</span>
      <p>Belum ada data. Upload CSV export stok rak (format sama dengan Stok Opname) untuk mulai merencanakan pecah rak.</p>
      <p class="pr-muted">Data ini terpisah dari Stok Opname dan bisa dihapus kapan saja.</p></div>`;
    return;
  }
  const h = prHitung(prState.tim);
  prState.hasil = h;
  const info = prState.rows.find(r => r[0] === prState.tim) || [];
  const fokus = document.activeElement && document.activeElement.id;
  isi.innerHTML = prHtmlSetel(h, info) + prHtmlStat(h) + (h.tanda.length ? `<div class="pr-tanda">${h.tanda.map(t => `<div>⚠ ${prEsc(t)}</div>`).join('')}</div>` : '') +
    `<div class="pr-tabs">${[['ringkasan', 'Ringkasan'], ['ranking', 'Ranking'], ['saran', 'Saran isi per rak'], ['tabel', 'Tabel penempatan']]
      .map(([k, l]) => `<button class="pr-chip ${prState.tab === k ? 'aktif' : ''}" onclick="prSetTab('${k}')">${l}</button>`).join('')}</div>` +
    ({ ringkasan: prHtmlRingkasan, ranking: prHtmlRanking, saran: prHtmlSaran, tabel: prHtmlTabel }[prState.tab] || prHtmlRingkasan)(h);
  if (fokus) { const el = document.getElementById(fokus); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') { const n = el.value.length; el.setSelectionRange(n, n); } } }
}

function prHtmlSetel(h, info) {
  const st = h.st;
  return `<div class="pr-kartu pr-setel">
    <div class="pr-setel-rak">
      <label>Rak yang tersedia <span class="pr-muted">(kustom, ${st.rak.length} rak)</span></label>
      <div class="pr-rak-chips">${st.rak.map(k => `<span class="pr-rak">${prEsc(k)}<button onclick="prHapusRak('${prEsc(k)}')" title="Hapus">×</button></span>`).join('')}
        <input id="pr-rak-baru" placeholder="+ nomor rak" onkeydown="if(event.key==='Enter'){event.preventDefault();prTambahRak()}">
        <button class="pr-btn-kecil" onclick="prTambahRak()">Tambah</button></div>
    </div>
    <div><label>Tingkat</label><input id="pr-in-tingkat" class="pr-in" value="${prEsc(st.tingkat)}" onchange="prUbahSetel('tingkat', this.value)"></div>
    <div><label>Shaf / tingkat</label><input id="pr-in-shaf" class="pr-in" type="number" min="1" value="${st.shaf}" onchange="prUbahSetel('shaf', this.value)"></div>
    <div><label>SKU / shaf</label><input id="pr-in-sku" class="pr-in" type="number" min="1" value="${st.sku}" onchange="prUbahSetel('sku', this.value)"></div>
    <div><label>Pcs / slot</label><input id="pr-in-pcs" class="pr-in" type="number" min="1" value="${st.pcs}" onchange="prUbahSetel('pcs', this.value)"></div>
    <div><label>Batas atas rak (pcs)</label><input id="pr-in-batas" class="pr-in" type="number" min="0" placeholder="kosong = bebas" value="${st.batas}" onchange="prUbahSetel('batas', this.value)">
      ${h.rekBatas ? `<button class="pr-rek" onclick="prUbahSetel('batas', ${h.rekBatas})" title="Pakai rekomendasi">Rekomendasi: <b>${prAngka(h.rekBatas)} pcs</b></button>` : ''}</div>
    <div class="pr-setel-info">1 rak = ${h.tingkat.length} tingkat × ${st.shaf} shaf × ${st.sku} SKU = <b>${h.cap} slot</b>${info[7] ? ` · CSV diupload ${prEsc(info[7])}${info[8] ? ' oleh ' + prEsc(info[8]) : ''}` : ''}</div>
  </div>`;
}

function prHtmlStat(h) {
  const rakNyata = h.raks.filter(r => !r.tambahan);
  const tambahan = h.raks.length - rakNyata.length;
  const rata = h.raks.length ? Math.round(h.totalAtas / h.raks.length) : 0;
  return `<div class="pr-stat">
    <div class="pr-kartu"><b>${prAngka(h.nSku)}</b><span>SKU</span></div>
    <div class="pr-kartu"><b>${prAngka(h.totalPcs)}</b><span>total pcs</span></div>
    <div class="pr-kartu ${tambahan ? 'merah' : ''}"><b>${prAngka(h.minRak)} rak</b><span>minimal dibutuhkan · tersedia ${rakNyata.length}${tambahan ? ` · <b>kurang ${tambahan}</b>` : ''}</span></div>
    <div class="pr-kartu"><b>${prAngka(h.totalAtas)}</b><span>pcs naik ke atas rak</span></div>
    <div class="pr-kartu"><b>±${prAngka(rata)}</b><span>atas rak per rak</span></div>
  </div>`;
}

function prHtmlRingkasan(h) {
  const maks = Math.max(1, ...h.raks.map(r => r.pcs));
  const atasArr = h.raks.map(r => r.atas);
  const beda = atasArr.length ? Math.max(...atasArr) - Math.min(...atasArr) : 0;
  const baris = h.raks.map(r => {
    const slot = r.pcs - r.atas;
    return `<div class="pr-rr ${r.tambahan ? 'tambahan' : ''}" title="${prEsc(r.kode)}: ${r.used} SKU, isi slot ${slot} pcs, atas rak ${r.atas} pcs">
      <span class="pr-rr-kode">${prEsc(r.kode)}</span>
      <div class="pr-bar"><i class="a" style="width:${(slot / maks * 100).toFixed(1)}%"></i><i class="b ${h.batas && r.atas > h.batas ? 'lewat' : ''}" style="width:${(r.atas / maks * 100).toFixed(1)}%"></i></div>
      <span class="pr-rr-v">${r.used}/${h.cap} SKU · atas <b>${prAngka(r.atas)}</b></span></div>`;
  }).join('');
  const gab = h.gabungan.length ? `<div class="pr-kartu"><h3>Barang yang digabung (varian 1 rak) <small>${h.gabungan.length} barang · ketuk "Pisahkan" kalau salah gabung</small></h3>
      <div class="pr-gab">${h.gabungan.map(g => `<div><span>${prEsc(g.kunci)} <small>${g.n} SKU</small></span><button class="pr-btn-kecil" onclick="prTogglePisah('${prEsc(g.kunci).replace(/'/g, "\\'")}')">Pisahkan</button></div>`).join('')}</div>
      ${h.st.pisah.length ? `<div class="pr-muted" style="margin-top:6px">Dipisahkan: ${h.st.pisah.map(k => `<button class="pr-btn-kecil" onclick="prTogglePisah('${prEsc(k).replace(/'/g, "\\'")}')">${prEsc(k)} ↺</button>`).join(' ')}</div>` : ''}</div>` : '';
  return `<div class="pr-dua">
    <div class="pr-kartu"><h3>Keseimbangan per rak <small>diurutkan otomatis</small></h3>
      <div class="pr-legend"><i class="a"></i>isi slot<i class="b"></i>atas rak</div>${baris}
      <div class="pr-ok">${beda <= Math.max(20, h.totalAtas * 0.1) ? '✓ Seimbang' : 'Hampir seimbang'}: selisih atas rak antar rak ${prAngka(beda)} pcs. Varian satu barang tetap di rak yang sama.</div></div>
    ${gab}</div>`;
}

function prHtmlRanking(h) {
  let daftar;
  if (prState.rankMode === 'barang') {
    const m = {};
    h.skus.forEach(s => { const g = m[s.grup] || (m[s.grup] = { nama: s.grup, qty: 0, atas: 0, n: 0, rak: new Set() }); g.qty += s.qty; g.atas += s.atas; g.n++; g.rak.add(s.rakBaru); });
    daftar = Object.values(m).map(g => ({ nama: g.nama, sub: `${g.n} varian · rak ${[...g.rak].join(', ')}`, qty: g.qty, atas: g.atas }));
  } else daftar = h.skus.map(s => ({ nama: s.nama, sub: `${s.id} · ${s.slotBaru}`, qty: s.qty, atas: s.atas }));
  daftar.sort((a, b) => b.qty - a.qty);
  const top = daftar.slice(0, 30), maks = Math.max(1, top[0] ? top[0].qty : 1);
  return `<div class="pr-kartu"><h3>Ranking ${prState.rankMode === 'barang' ? 'barang (gabungan varian)' : 'SKU'} terbanyak <small>Top ${top.length} dari ${daftar.length}</small></h3>
    <div class="pr-tabs kecil"><button class="pr-chip ${prState.rankMode === 'sku' ? 'aktif' : ''}" onclick="prState.rankMode='sku';prRender(true)">Per SKU</button>
      <button class="pr-chip ${prState.rankMode === 'barang' ? 'aktif' : ''}" onclick="prState.rankMode='barang';prRender(true)">Per barang</button>
      <button class="pr-btn-kecil" onclick="prEksporRanking()">⬇ Ekspor ranking (CSV)</button></div>
    <div class="pr-legend"><i class="a"></i>di slot<i class="b"></i>sisa → atas rak</div>
    ${top.map((d, i) => `<div class="pr-rk" title="${prEsc(d.nama)}: ${d.qty} pcs (atas rak ${d.atas})"><span class="pr-no ${i < 3 ? 'top' : ''}">${i + 1}</span>
      <div class="pr-nm"><b>${prEsc(d.nama)}</b><small>${prEsc(d.sub)}</small></div>
      <div class="pr-bar"><i class="a" style="width:${((d.qty - d.atas) / maks * 100).toFixed(1)}%"></i><i class="b" style="width:${(d.atas / maks * 100).toFixed(1)}%"></i></div>
      <span class="pr-qty">${prAngka(d.qty)}</span></div>`).join('')}</div>`;
}

function prHtmlSaran(h) {
  return `<div class="pr-aksi-baris"><button class="pr-btn-kecil" onclick="prEksporRencana()">⬇ Ekspor semua rak (CSV)</button>
      <button class="pr-btn-kecil merah" onclick="prCetak()">🖨 Cetak daftar kerja</button></div>
    <div class="pr-grid-rak">${h.raks.map(r => `<div class="pr-rak-kol ${r.tambahan ? 'tambahan' : ''}">
      <div class="pr-rak-hd"><b>${prEsc(r.kode)}</b><span>${r.used} SKU · ${prAngka(r.pcs)} pcs</span></div>
      <div class="pr-rak-atas">Atas rak: <b>${prAngka(r.atas)} pcs</b><span class="pr-pb"><i style="width:${Math.min(100, r.atas / Math.max(1, h.batas || h.rekBatas || r.atas) * 100).toFixed(0)}%"></i></span></div>
      ${r.shaf.map(sh => `<div class="pr-sh"><div class="pr-sh-kode">${prEsc(sh.kode)}</div>
        ${sh.items.map(s => `<div class="pr-it"><span class="pr-it-nm" title="${prEsc(s.id)}">${prEsc(s.nama)}</span><span class="pr-it-q">${s.slot}</span><span class="pr-it-a">${s.atas ? '+' + s.atas : ''}</span></div>`).join('')}</div>`).join('')}
      <div class="pr-rak-ft"><button onclick="prEksporRencana('${prEsc(r.kode)}')">⬇ Ekspor</button><button onclick="prCetak('${prEsc(r.kode)}')">🖨 Cetak</button></div>
    </div>`).join('')}</div>
    <div class="pr-muted" style="margin-top:8px">Angka hitam = pcs di slot (maks ${h.st.pcs}) · <b>+angka</b> = sisa yang ditaruh di atas rak.</div>`;
}

function prHtmlTabel(h) {
  const list = h.skus.filter(s => !prState.filterRak || s.rakBaru === prState.filterRak)
    .sort((a, b) => String(a.slotBaru).localeCompare(String(b.slotBaru)));
  return `<div class="pr-kartu"><div class="pr-aksi-baris" style="margin-top:0">
      <select class="pr-in" style="width:auto" onchange="prState.filterRak=this.value;prRender(true)"><option value="">Semua rak</option>
        ${h.raks.map(r => `<option value="${prEsc(r.kode)}" ${prState.filterRak === r.kode ? 'selected' : ''}>${prEsc(r.kode)}</option>`).join('')}</select>
      <span class="pr-muted">${list.length} SKU</span>
      <button class="pr-btn-kecil" onclick="prEksporRencana(prState.filterRak)">⬇ Ekspor (CSV)</button></div>
    <div class="pr-tabel-wrap"><table class="pr-tabel"><thead><tr><th>Slot baru</th><th>SKU</th><th>Nama</th><th class="n">Qty</th><th class="n">Isi slot</th><th class="n">Atas rak</th><th>Lokasi sekarang</th></tr></thead>
    <tbody>${list.map(s => `<tr><td><b>${prEsc(s.slotBaru)}</b></td><td><code>${prEsc(s.id)}</code></td><td>${prEsc(s.nama)}</td><td class="n">${s.qty}</td><td class="n">${s.slot}</td><td class="n">${s.atas || '–'}</td><td class="pr-muted">${prEsc(s.lokasi.join(', '))}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// ============================================================
// EKSPOR CSV & CETAK
// ============================================================
function prUnduhCsv(namaFile, baris) {
  // Pemisah ";" + BOM supaya rapi saat dibuka di Excel bahasa Indonesia
  const sel = v => { const t = String(v ?? ''); return /[;"\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const isi = '\uFEFF' + baris.map(r => r.map(sel).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([isi], { type: 'text/csv;charset=utf-8' }));
  a.download = namaFile;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function prTgl() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function prEksporRencana(rak) {
  const h = prState.hasil; if (!h) return;
  const list = h.skus.filter(s => !rak || s.rakBaru === rak).sort((a, b) => String(a.slotBaru).localeCompare(String(b.slotBaru)));
  prUnduhCsv(`rencana-pecah-rak_tim${prState.tim}${rak ? '_' + rak : ''}_${prTgl()}.csv`,
    [['Rak Baru', 'Slot Baru', 'SKU', 'Nama Produk', 'Varian', 'Qty Total', 'Isi Slot', 'Atas Rak', 'Lokasi Sekarang', 'Kelompok Barang', 'Cek']]
      .concat(list.map(s => [s.rakBaru, s.slotBaru, s.id, s.nama, s.varian, s.qty, s.slot, s.atas, s.lokasi.join(', '), s.grup, ''])));
}
function prEksporRingkasan() {
  const h = prState.hasil; if (!h) return;
  prUnduhCsv(`ringkasan-pecah-rak_tim${prState.tim}_${prTgl()}.csv`,
    [['Rak', 'Jumlah SKU', 'Kapasitas Slot', 'Total Pcs', 'Isi Slot (pcs)', 'Atas Rak (pcs)', 'Batas Atas Rak', 'Status']]
      .concat(h.raks.map(r => [r.kode, r.used, h.cap, r.pcs, r.pcs - r.atas, r.atas, h.batas || '', r.tambahan ? 'Rak tambahan (belum tersedia)' : (h.batas && r.atas > h.batas ? 'Melebihi batas' : 'OK')])));
}
function prEksporRanking() {
  const h = prState.hasil; if (!h) return;
  const list = h.skus.slice().sort((a, b) => b.qty - a.qty);
  prUnduhCsv(`ranking-sku_tim${prState.tim}_${prTgl()}.csv`,
    [['Peringkat', 'SKU', 'Nama Produk', 'Kelompok Barang', 'Qty', 'Isi Slot', 'Atas Rak', 'Slot Baru']]
      .concat(list.map((s, i) => [i + 1, s.id, s.nama, s.grup, s.qty, s.slot, s.atas, s.slotBaru])));
}
function prCetak(rak) {
  const h = prState.hasil; if (!h) return;
  const raks = h.raks.filter(r => !rak || r.kode === rak);
  const w = window.open('', '_blank');
  if (!w) { prToast('Izinkan pop-up untuk mencetak.', 'error'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Daftar kerja pecah rak · Tim ${prEsc(prState.tim)}</title><style>
    body{font-family:Arial,sans-serif;font-size:12px;margin:16px;color:#000}h2{margin:18px 0 4px;font-size:18px}
    table{width:100%;border-collapse:collapse;margin-bottom:6px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}
    td.n{text-align:right}.rak{page-break-after:always}.rak:last-child{page-break-after:auto}small{color:#555}</style></head><body>
    ${raks.map(r => `<div class="rak"><h2>Rak ${prEsc(r.kode)} <small>· ${r.used} SKU · ${r.pcs} pcs · atas rak ${r.atas} pcs</small></h2>
      <table><tr><th>Slot</th><th>SKU</th><th>Nama</th><th>Isi slot</th><th>Atas rak</th><th>Lokasi sekarang</th><th>✓</th></tr>
      ${r.items.map(s => `<tr><td><b>${prEsc(s.slotBaru)}</b></td><td>${prEsc(s.id)}</td><td>${prEsc(s.nama)}</td><td class="n">${s.slot}</td><td class="n">${s.atas || ''}</td><td>${prEsc(s.lokasi.join(', '))}</td><td style="width:24px"></td></tr>`).join('')}</table></div>`).join('')}
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

// dashboard.js — Dashboard Gudang (5 gudang)
// Chip per gudang, rentang tanggal + tombol cepat, panel Inbound & Outbound,
// dan rata-rata waktu perubahan status (API process_time) per gudang + gabungan.

const DB_GUDANG = [
  { id: 'pdc',    nama: 'PDC Warehouse' },
  { id: 'febri',  nama: 'Febri Warehouse' },
  { id: 'palem',  nama: 'Palem Warehouse' },
  { id: 'cemara', nama: 'Cemara Warehouse' },
  { id: 'sakura', nama: 'Sakura Warehouse' }
];

const DB_URUT_INBOUND  = ['Inbound OTW', 'Inbound Diterima', 'Retur Diproses', 'Retur Selesai', 'Batal'];
const DB_URUT_OUTBOUND = ['Menunggu Diproses', 'Sedang Diambil', 'Siap Dikemas', 'Sedang Dikemas', 'Selesai Dikemas', 'Diserahkan ke Kurir', 'Batal'];

const DB_NAMA_STATUS = {
  created: 'Menunggu Diproses', picking: 'Sedang Diambil', picked: 'Siap Dikemas',
  packing: 'Sedang Dikemas', packing_completed: 'Selesai Dikemas', completed: 'Diserahkan ke Kurir'
};
// Tahap utama yang ditampilkan (urutan alur gudang). Tahap lain bisa dibuka lewat "Tampilkan semua tahap".
const DB_TAHAP_UTAMA = [
  'created_to_picking', 'picking_to_picked', 'picked_to_packing', 'packing_to_packing_completed',
  'picked_to_packing_completed', 'picking_to_packing_completed', 'packing_completed_to_completed'
];
const DB_TAHAP_TOTAL = 'created_to_completed';

const dbState = {
  gudang: 'semua',
  dari: '', sampai: '',
  preset: 'hari',
  data: null,
  memuat: false,
  semuaTahap: false,
  timer: null
};

// ---------- Helper ----------
function dbEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dbAngka(n) { return Number(n || 0).toLocaleString('id-ID'); }
function dbTglWIB(offsetHari = 0) {
  const d = new Date(Date.now() + 7 * 3600 * 1000 - offsetHari * 86400000);
  return d.toISOString().slice(0, 10);
}
function dbLabelTahap(kunci) {
  const [a, b] = kunci.split('_to_');
  return `${DB_NAMA_STATUS[a] || a} → ${DB_NAMA_STATUS[b] || b}`;
}
// detik → "22 menit 52 detik" / "1 jam 5 menit" / "2 hari 3 jam"
function dbDurasi(detik) {
  if (!detik || detik <= 0) return '—';
  const s = Math.round(detik);
  const h = Math.floor(s / 86400), j = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), d = s % 60;
  if (h) return `${h} hari ${j} jam`;
  if (j) return `${j} jam ${m} menit`;
  if (m) return `${m} menit ${d} detik`;
  return `${d} detik`;
}

// Petakan status mentah API ke nama yang dipakai di web (sama dengan dashboard lama)
function dbPetakan(list, tipe) {
  const hasil = {};
  let nOngoing = 0, nCompleted = 0;
  (Array.isArray(list) ? list : []).forEach(item => {
    const raw = String(item.status || '').toLowerCase();
    const trx = Number(item.transaction_count) || 0;
    const pcs = Number(item.item_count) || Number(item.total_item_count) || 0;
    let nama;
    if (raw === 'cancel' || raw === 'cancelled') nama = 'Batal';
    else if (tipe === 'outbound') {
      nama = ({ waiting: 'Menunggu Diproses', created: 'Menunggu Diproses', picking: 'Sedang Diambil', picked: 'Siap Dikemas',
        ready_to_pack: 'Siap Dikemas', packing: 'Sedang Dikemas', packing_completed: 'Selesai Dikemas',
        delivered: 'Diserahkan ke Kurir', completed: 'Diserahkan ke Kurir' })[raw] || raw;
    } else {
      const jenis = String(item.type || item.inbound_type || item.category || item.sub_type || item.title || item.name || item.source || '').toLowerCase();
      const retur = /retur|return|customer|buyer/.test(jenis) || item.is_retur === true || item.is_return === true;
      const normal = /supplier|inbound|vendor|po/.test(jenis);
      if (raw === 'received') nama = 'Inbound Diterima';
      else if (raw === 'retur_proses' || raw === 'retur_ongoing') nama = 'Retur Diproses';
      else if (raw === 'retur_selesai' || raw === 'retur_completed') nama = 'Retur Selesai';
      else if (raw === 'ongoing') nama = retur ? 'Retur Diproses' : normal ? 'Inbound OTW' : (++nOngoing === 1 ? 'Inbound OTW' : 'Retur Diproses');
      else if (raw === 'completed') nama = retur ? 'Retur Selesai' : normal ? 'Inbound Diterima' : (++nCompleted === 1 ? 'Inbound Diterima' : 'Retur Selesai');
      else nama = raw || 'Lainnya';
    }
    const t = hasil[nama] || (hasil[nama] = { trx: 0, pcs: 0 });
    t.trx += trx; t.pcs += pcs;
  });
  return hasil;
}

// ---------- Muat data ----------
function loadDashboard() {
  if (!dbState.dari) dbPilihPreset('hari', null, true);
  dbRenderChip();
  dbMuat();
  clearInterval(dbState.timer);
  // Segarkan otomatis tiap 60 detik bila rentangnya memuat hari ini dan halaman sedang dibuka
  dbState.timer = setInterval(() => {
    const aktif = document.getElementById('page-dashboard')?.classList.contains('active');
    if (aktif && !document.hidden && dbState.sampai === dbTglWIB(0)) dbMuat(true);
  }, 60000);
}

async function dbMuat(diam = false) {
  if (dbState.memuat) return;
  const dari = document.getElementById('db-dari').value;
  const sampai = document.getElementById('db-sampai').value;
  if (!dari || !sampai) return dbPesan('error', 'Isi tanggal Dari dan Sampai.');
  if (sampai < dari) return dbPesan('error', 'Tanggal "Sampai" tidak boleh lebih awal dari "Dari".');
  dbState.dari = dari; dbState.sampai = sampai;
  dbState.memuat = true;
  const btn = document.getElementById('db-btn-muat');
  btn.disabled = true;
  if (!diam) dbPesan('memuat', 'Memuat data 5 gudang...');
  try {
    const res = await fetch(`/api/dashboard/gudang?dari=${dari}&sampai=${sampai}`, {
      headers: { 'x-session-token': sessionStorage.getItem('sessionToken') || '' }
    });
    const data = await res.json().catch(() => ({ success: false, message: 'Respons server tidak valid.' }));
    if (!data.success) throw new Error(data.message || 'Gagal memuat.');
    dbState.data = data;
    const gagal = data.gudang.filter(g => g.error && g.error.length);
    if (gagal.length) dbPesan('peringatan', 'Sebagian data tidak termuat: ' + gagal.map(g => `${g.name} (${g.error.join('; ')})`).join(' · '));
    else dbPesan('ok', `Berhasil dimuat (${dari === sampai ? dari : dari + ' s/d ' + sampai}) · diperbarui ${String(data.diambil).slice(-5)} WIB`);
    dbRender();
  } catch (err) {
    dbPesan('error', err.message);
  } finally {
    dbState.memuat = false;
    btn.disabled = false;
  }
}

function dbPesan(jenis, teks) {
  const el = document.getElementById('db-pesan');
  el.className = 'db-pesan ' + jenis;
  el.innerHTML = (jenis === 'memuat' ? '<span class="material-symbols-outlined db-putar">sync</span>' : '') + dbEsc(teks);
}

// ---------- Filter ----------
function dbPilihGudang(id) {
  dbState.gudang = id;
  dbRenderChip();
  dbRender();
}
function dbRenderChip() {
  const el = document.getElementById('db-chip-gudang');
  if (!el) return;
  el.innerHTML = [{ id: 'semua', nama: 'Semua Gudang' }].concat(DB_GUDANG).map(g =>
    `<button class="db-chip ${dbState.gudang === g.id ? 'aktif' : ''}" onclick="dbPilihGudang('${g.id}')">${dbEsc(g.nama)}</button>`).join('');
}
function dbPilihPreset(p, el, tanpaMuat) {
  const hari = { hari: 0, kemarin: 1, minggu: 6, '2minggu': 13, bulan: 29, '2bulan': 59, '3bulan': 89, '6bulan': 179, tahun: 364 }[p];
  const sampai = p === 'kemarin' ? dbTglWIB(1) : dbTglWIB(0);
  const dari = dbTglWIB(hari);
  dbState.preset = p;
  document.getElementById('db-dari').value = dari;
  document.getElementById('db-sampai').value = sampai;
  document.querySelectorAll('.db-preset').forEach(b => b.classList.toggle('aktif', b.dataset.p === p));
  if (!tanpaMuat) dbMuat();
}
function dbTanggalManual() {
  dbState.preset = '';
  document.querySelectorAll('.db-preset').forEach(b => b.classList.remove('aktif'));
}
function dbToggleTahap() { dbState.semuaTahap = !dbState.semuaTahap; dbRender(); }

// ---------- Render ----------
function dbGudangTerpilih() {
  const g = dbState.data ? dbState.data.gudang : [];
  return dbState.gudang === 'semua' ? g : g.filter(x => x.id === dbState.gudang);
}

function dbRender() {
  if (!dbState.data) return;
  const terpilih = dbGudangTerpilih();
  const namaPilihan = dbState.gudang === 'semua' ? 'Semua Gudang' : (DB_GUDANG.find(g => g.id === dbState.gudang)?.nama || '');
  document.getElementById('db-info').innerHTML =
    `<b>${dbEsc(namaPilihan)}</b> · ${dbState.dari === dbState.sampai ? dbEsc(dbState.dari) : dbEsc(dbState.dari + ' s/d ' + dbState.sampai)}`;

  // Gabungkan inbound & outbound dari gudang terpilih
  const inb = {}, out = {};
  const perGudang = {};
  terpilih.forEach(g => {
    const pi = dbPetakan(g.inbound, 'inbound'), po = dbPetakan(g.outbound, 'outbound');
    Object.keys(pi).forEach(k => { const t = inb[k] || (inb[k] = { trx: 0, pcs: 0 }); t.trx += pi[k].trx; t.pcs += pi[k].pcs; });
    Object.keys(po).forEach(k => { const t = out[k] || (out[k] = { trx: 0, pcs: 0 }); t.trx += po[k].trx; t.pcs += po[k].pcs; });
    perGudang[g.id] = { pi, po };
  });
  document.getElementById('db-panel-inbound').innerHTML  = dbPanelStatus('Inbound', 'inbound', inb, DB_URUT_INBOUND);
  document.getElementById('db-panel-outbound').innerHTML = dbPanelStatus('Outbound', 'outbound', out, DB_URUT_OUTBOUND);
  dbRenderRingkasGudang(perGudang);
  dbRenderWaktu(terpilih, perGudang);
}

function dbTotal(map) {
  let trx = 0, pcs = 0;
  Object.keys(map).forEach(k => { if (k !== 'Batal') { trx += map[k].trx; pcs += map[k].pcs; } });
  return { trx, pcs };
}

function dbPanelStatus(judul, tipe, map, urutan) {
  const total = dbTotal(map);
  const kunci = urutan.filter(k => map[k]).concat(Object.keys(map).filter(k => !urutan.includes(k)));
  const baris = kunci.length ? kunci.map(k => {
    const v = map[k];
    const pct = total.trx ? (v.trx / total.trx * 100) : 0;
    return `<div class="db-baris">
        <div class="db-baris-nama">${k === 'Batal' ? '<span class="db-batal">Batal</span>' : dbEsc(k)}</div>
        <div class="db-baris-angka">${dbAngka(v.trx)} trx · ${dbAngka(v.pcs)} pcs</div>
        <div class="db-bar"><div class="db-bar-isi ${tipe}" style="width:${Math.min(pct, 100).toFixed(1)}%"></div></div>
        <div class="db-baris-pct">${pct.toFixed(1)}%</div>
      </div>`;
  }).join('') : '<div class="db-kosong">Tidak ada data</div>';
  return `<div class="db-panel-judul"><span class="db-titik ${tipe}"></span>${judul}</div>
    ${baris}
    <div class="db-panel-total"><span>Total</span><b>${dbAngka(total.trx)} trx · ${dbAngka(total.pcs)} pcs</b></div>`;
}

// Kartu kecil per gudang (hanya saat "Semua Gudang"), bisa diklik untuk pindah gudang
function dbRenderRingkasGudang(perGudang) {
  const el = document.getElementById('db-ringkas-gudang');
  if (dbState.gudang !== 'semua') { el.style.display = 'none'; return; }
  el.style.display = 'grid';
  el.innerHTML = DB_GUDANG.map(g => {
    const d = perGudang[g.id];
    const err = dbState.data.gudang.find(x => x.id === g.id)?.error || [];
    const ti = d ? dbTotal(d.pi) : { trx: 0 }, to = d ? dbTotal(d.po) : { trx: 0 };
    const kurir = d && d.po['Diserahkan ke Kurir'] ? d.po['Diserahkan ke Kurir'].trx : 0;
    const pctKurir = to.trx ? Math.round(kurir / to.trx * 100) : 0;
    return `<button class="db-mini" onclick="dbPilihGudang('${g.id}')">
        <div class="db-mini-nama">${dbEsc(g.nama)}${err.length ? ' <span class="db-mini-err" title="' + dbEsc(err.join('; ')) + '">!</span>' : ''}</div>
        <div class="db-mini-angka"><span class="inbound">${dbAngka(ti.trx)}</span> in · <span class="outbound">${dbAngka(to.trx)}</span> out</div>
        <div class="db-mini-sub">${pctKurir}% outbound sudah ke kurir</div>
      </button>`;
  }).join('');
}

function dbRenderWaktu(terpilih, perGudang) {
  const el = document.getElementById('db-panel-waktu');
  const tahap = (dbState.semuaTahap
    ? Object.keys(Object.assign({}, ...terpilih.map(g => g.prosesWaktu || {}))).filter(k => k !== DB_TAHAP_TOTAL)
    : DB_TAHAP_UTAMA);
  const nilai = (g, k) => Number(g.prosesWaktu && g.prosesWaktu[k]) || 0;
  // Hanya tampilkan tahap yang punya data di salah satu gudang terpilih
  const tampil = tahap.filter(k => terpilih.some(g => nilai(g, k) > 0)).concat([DB_TAHAP_TOTAL]);

  // Rata-rata gabungan: ditimbang jumlah order yang sudah diserahkan ke kurir di tiap gudang
  const bobot = g => (perGudang[g.id]?.po['Diserahkan ke Kurir']?.trx) || 0;
  const gabungan = k => {
    const ada = terpilih.filter(g => nilai(g, k) > 0);
    if (!ada.length) return 0;
    const totalBobot = ada.reduce((s, g) => s + bobot(g), 0);
    if (!totalBobot) return ada.reduce((s, g) => s + nilai(g, k), 0) / ada.length;
    return ada.reduce((s, g) => s + nilai(g, k) * bobot(g), 0) / totalBobot;
  };

  const tombol = `<button class="db-link" onclick="dbToggleTahap()">${dbState.semuaTahap ? 'Tampilkan tahap utama' : 'Tampilkan semua tahap'}</button>`;
  if (dbState.gudang !== 'semua') {
    const g = terpilih[0];
    el.innerHTML = `<div class="db-panel-judul"><span class="db-titik waktu"></span>Rata-rata Waktu Perubahan Status ${tombol}</div>
      ${!g || !g.prosesWaktu ? '<div class="db-kosong">Data waktu belum tersedia</div>' : tampil.map(k =>
        `<div class="db-waktu-baris ${k === DB_TAHAP_TOTAL ? 'total' : ''}"><span>${dbLabelTahap(k)}</span><b>${dbDurasi(nilai(g, k))}</b></div>`).join('')}`;
    return;
  }
  // Semua gudang: tabel tahap × gudang + kolom gabungan
  el.innerHTML = `<div class="db-panel-judul"><span class="db-titik waktu"></span>Rata-rata Waktu Perubahan Status ${tombol}</div>
    <div class="db-tabel-wrap"><table class="db-tabel">
      <thead><tr><th>Tahap</th>${DB_GUDANG.map(g => `<th>${dbEsc(g.nama.replace(' Warehouse', ''))}</th>`).join('')}<th class="gab">Gabungan</th></tr></thead>
      <tbody>${tampil.map(k => `<tr class="${k === DB_TAHAP_TOTAL ? 'total' : ''}">
          <td>${dbLabelTahap(k)}</td>
          ${DB_GUDANG.map(gd => { const g = terpilih.find(x => x.id === gd.id); return `<td>${g ? dbDurasi(nilai(g, k)) : '—'}</td>`; }).join('')}
          <td class="gab">${dbDurasi(gabungan(k))}</td>
        </tr>`).join('')}</tbody>
    </table></div>
    <div class="db-catatan">Gabungan = rata-rata kelima gudang, ditimbang jumlah order yang sudah diserahkan ke kurir. "—" berarti tidak ada data pada tahap itu.</div>`;
}

// pengaturan.js — Menu "Pengaturan": nama tampilan, No HP, foto profil (semua akun)
let setFotoBaru = '';   // '' = tidak berubah, 'HAPUS' = hapus foto, dataURL = foto baru

async function setInit() {
  const msg = document.getElementById('set-msg');
  if (msg) msg.textContent = '';
  document.getElementById('set-username').value = sessionStorage.getItem('sessionUser') || '';
  setFotoBaru = '';
  const d = await muatProfilSaya();
  if (!d) { if (msg) { msg.style.color = '#dc2626'; msg.textContent = 'Gagal memuat profil.'; } return; }
  document.getElementById('set-nama').value = d.nama || '';
  document.getElementById('set-hp').value = d.hp || '';
  setTampilFoto(d.foto, d.nama || d.username);
}

function setTampilFoto(foto, nama) {
  const el = document.getElementById('set-avatar');
  if (!el) return;
  el.innerHTML = foto ? `<img src="${foto}" alt="">` : `<span>${inisial(nama || 'U')}</span>`;
  document.getElementById('set-btn-hapus-foto').style.display = foto ? '' : 'none';
}

// Foto dikecilkan di HP dulu (maks 200px, JPEG) supaya ringan & cepat
function setPilihFoto(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  if (!/^image\//.test(file.type)) { showToast('Pilih file gambar.', 'error'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const sisi = Math.min(img.width, img.height), ukuran = 200;
    const c = document.createElement('canvas');
    c.width = ukuran; c.height = ukuran;
    c.getContext('2d').drawImage(img, (img.width - sisi) / 2, (img.height - sisi) / 2, sisi, sisi, 0, 0, ukuran, ukuran);
    let q = 0.8, data = c.toDataURL('image/jpeg', q);
    while (data.length > 40000 && q > 0.3) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
    URL.revokeObjectURL(url);
    setFotoBaru = data;
    setTampilFoto(data, document.getElementById('set-nama').value);
  };
  img.onerror = () => { URL.revokeObjectURL(url); showToast('Gambar tidak bisa dibaca.', 'error'); };
  img.src = url;
}

function setHapusFoto() {
  setFotoBaru = 'HAPUS';
  setTampilFoto('', document.getElementById('set-nama').value);
}

async function setSimpan() {
  const btn = document.getElementById('set-btn-simpan'), msg = document.getElementById('set-msg');
  const nama = document.getElementById('set-nama').value.trim();
  if (nama.length < 3) { msg.style.color = '#dc2626'; msg.textContent = 'Nama tampilan minimal 3 huruf.'; return; }
  btn.disabled = true; btn.textContent = 'Menyimpan...'; msg.textContent = '';
  try {
    const r = await fetch('/api/profil', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionStorage.getItem('sessionToken') || '' },
      body: JSON.stringify({ nama, hp: document.getElementById('set-hp').value.trim(), foto: setFotoBaru }) });
    const d = await r.json();
    if (!d.success) throw new Error(d.message || 'Gagal menyimpan.');
    setFotoBaru = '';
    msg.style.color = '#16a34a'; msg.textContent = d.message || 'Tersimpan.';
    await muatNamaPeta();
    await muatProfilSaya();
  } catch (err) {
    msg.style.color = '#dc2626'; msg.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Simpan Perubahan';
  }
}

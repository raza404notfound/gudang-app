// main.js — PDC Warehouse Admin

// Variabel global yang diperlukan
let lastFetchTimeInbound  = null;
let lastFetchTimeOutbound = null;

let allTrackedData = [];

    const WAREHOUSE_LIST = [
      { id: 'pdc', name: 'PDC WAREHOUSE' },
      { id: 'febri', name: 'FEBRI WAREHOUSE' },
      { id: 'palem', name: 'PALEM WAREHOUSE' },
      { id: 'cemara', name: 'CEMARA WAREHOUSE' },
      { id: 'sakura', name: 'SAKURA WAREHOUSE' }
    ];

    const INBOUND_STATUS_MAP = {
      'ongoing': 'Inbound OTW',
      'received': 'Inbound Diterima',
      'retur_proses': 'Retur Diproses',
      'completed': 'Retur Selesai',
      'cancel': 'Batal'
    };

    const OUTBOUND_STATUS_MAP = {
      'waiting': 'Menunggu Diproses',
      'picking': 'Sedang Diambil',
      'picked': 'Siap Dikemas',
      'ready_to_pack': 'Siap Dikemas',
      'packing': 'Sedang Dikemas',
      'packing_completed': 'Selesai Dikemas',
      'delivered': 'Diserahkan Kurir',
      'completed': 'Diserahkan Kurir',
      'cancel': 'Batal'
    };

    // =============================================
    // AUTH — Server-based (Railway), bukan localStorage
    // =============================================
    let currentSessionToken = sessionStorage.getItem('sessionToken') || null;
    let currentUserRole = sessionStorage.getItem('sessionRole') || null;

    async function handleAuth(event) {
      event.preventDefault();
      const userVal = document.getElementById('auth-username').value.trim();
      const passVal = document.getElementById('auth-password').value.trim();
      if (!userVal || !passVal) return showToast('Username & Password wajib diisi!', 'warning');

      const btn = document.getElementById('auth-submit-btn');
      btn.disabled = true;
      btn.innerText = 'Memproses...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: userVal, password: passVal })
        });
        const data = await res.json();

        if (data.success) {
          sessionStorage.setItem('sessionToken', data.token);
          sessionStorage.setItem('aktifTerakhir', String(Date.now()));
          sessionStorage.setItem('sessionUser', data.username);
          sessionStorage.setItem('sessionRole', data.role);
          currentSessionToken = data.token;
          currentUserRole = data.role;
          location.reload();
        } else {
          alert(data.message || 'Username atau Password salah!');
        }
      } catch (err) {
        showToast('Gagal terhubung ke server. Coba lagi.', 'error');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Masuk →';
      }
    }

    function toggleLoginPassword() {
      const input = document.getElementById('auth-password');
      const icon = document.querySelector('#toggle-pass-icon .material-symbols-outlined');
      if (input.type === 'password') {
        input.type = 'text';
        icon.innerText = 'visibility_off';
      } else {
        input.type = 'password';
        icon.innerText = 'visibility';
      }
    }

    function showPageLoading(show) {
      const el = document.getElementById('page-loading');
      if (!el) return;
      if (show) el.classList.remove('hidden');
      else el.classList.add('hidden');
    }

    // =============================================
    // NAMA TAMPILAN & PROFIL (username login → nama yang diatur di Pengaturan)
    // =============================================
    let NAMA_PETA = {};
    try { NAMA_PETA = JSON.parse(localStorage.getItem('nama_peta_v1') || '{}') || {}; } catch (e) {}
    function setNamaPeta(peta) {
      NAMA_PETA = peta || {};
      try { localStorage.setItem('nama_peta_v1', JSON.stringify(NAMA_PETA)); } catch (e) {}
    }
    function namaTampil(u) {
      const k = String(u || '').trim().toLowerCase();
      return NAMA_PETA[k] || u || '';
    }
    async function muatNamaPeta() {
      try {
        const r = await fetch('/api/profil/peta', { headers: { 'x-session-token': sessionStorage.getItem('sessionToken') || '' } });
        const d = await r.json();
        if (d.success) setNamaPeta(d.peta);
      } catch (e) {}
    }
    function inisial(nama) {
      const p = String(nama || 'U').trim().split(/\s+/);
      return ((p[0] || 'U')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
    }
    function tampilProfilSidebar(nama, foto) {
      const n = document.getElementById('user-name-display');
      const a = document.getElementById('user-avatar');
      if (n) n.innerText = nama;
      const sub = document.getElementById('user-sub-display');
      if (sub) sub.innerText = '@' + (sessionStorage.getItem('sessionUser') || '');
      if (a) {
        if (foto) { a.innerHTML = ''; const img = document.createElement('img'); img.src = foto; img.alt = ''; img.className = 'avatar-foto'; a.appendChild(img); }
        else a.innerText = inisial(nama);
      }
    }
    async function muatProfilSaya() {
      try {
        const c = JSON.parse(localStorage.getItem('profil_saya_v1') || 'null');
        if (c && c.username === sessionStorage.getItem('sessionUser')) tampilProfilSidebar(c.nama || c.username, c.foto);
      } catch (e) {}
      try {
        const r = await fetch('/api/profil/saya', { headers: { 'x-session-token': sessionStorage.getItem('sessionToken') || '' } });
        const d = await r.json();
        if (!d.success) return null;
        tampilProfilSidebar(d.nama || d.username, d.foto);
        try { localStorage.setItem('profil_saya_v1', JSON.stringify({ username: d.username, nama: d.nama, foto: d.foto })); } catch (e) {}
        return d;
      } catch (e) { return null; }
    }

    // Simpan token baru yang dikirim server (diperbarui otomatis tiap 15 menit selama dipakai)
    // + versi web: kalau server sudah di-deploy ulang, halaman dimuat ulang diam-diam saat pindah menu
    // + sesi ditolak server (401): langsung ke halaman login, tidak tertahan dengan data lama
    let versiWebAwal = null, perluMuatUlang = false;
    (function () {
      const fetchAsli = window.fetch.bind(window);
      window.fetch = async function (...arg) {
        const res = await fetchAsli(...arg);
        try {
          const baru = res.headers.get('x-sesi-baru');
          if (baru && sessionStorage.getItem('sessionToken')) {
            sessionStorage.setItem('sessionToken', baru);
            if (typeof currentSessionToken !== 'undefined') currentSessionToken = baru;
          }
          const versi = res.headers.get('x-versi-web');
          if (versi) {
            if (!versiWebAwal) versiWebAwal = versi;
            else if (versi !== versiWebAwal) perluMuatUlang = true;
          }
          const url = String(arg[0] && arg[0].url ? arg[0].url : arg[0] || '');
          if (res.status === 401 && url.startsWith('/api/') && !url.startsWith('/api/auth/login') && sessionStorage.getItem('sessionToken')) {
            tampilLogin();
          }
        } catch (e) {}
        return res;
      };
    })();
    function muatUlangBilaPerlu() {
      if (perluMuatUlang) { perluMuatUlang = false; location.reload(); return true; }
      return false;
    }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') muatUlangBilaPerlu(); });

    // Logout otomatis bila 1,5 jam tidak ada sentuhan sama sekali — dicek saat halaman di-refresh / dibuka ulang
    const BATAS_DIAM = 90 * 60 * 1000;
    let catatAktifTerakhir = 0;
    function catatAktif() {
      const now = Date.now();
      if (now - catatAktifTerakhir < 15000) return;   // cukup dicatat tiap 15 detik
      catatAktifTerakhir = now;
      try { if (sessionStorage.getItem('sessionToken')) sessionStorage.setItem('aktifTerakhir', String(now)); } catch (e) {}
    }
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(ev => window.addEventListener(ev, catatAktif, { passive: true, capture: true }));

    function tampilLogin() {
      sessionStorage.clear();
      document.documentElement.classList.remove('ada-sesi');
      showPageLoading(false);
      document.getElementById('auth-modal').style.display = 'flex';
    }

    function terapkanSesi(username, role) {
      currentUserRole = role;
      sessionStorage.setItem('sessionRole', role);
      sessionStorage.setItem('sessionUser', username);
      document.getElementById('user-name-display').innerText = username.toUpperCase();
      document.getElementById('user-avatar').innerText       = username.charAt(0).toUpperCase();
      document.getElementById('nav-kelola-akun').style.display = role === 'superuser' ? 'flex' : 'none';
    }

    async function checkAuthStatus() {
      const token     = sessionStorage.getItem('sessionToken');
      const savedUser = sessionStorage.getItem('sessionUser');

      // Tidak ada sesi sama sekali → tampil login langsung
      if (!token || !savedUser) { tampilLogin(); return; }

      // 1,5 jam tanpa sentuhan → sesi diakhiri saat refresh (tanpa pesan)
      const aktif = Number(sessionStorage.getItem('aktifTerakhir') || 0);
      if (aktif && Date.now() - aktif > BATAS_DIAM) {
        fetch('/api/auth/logout', { method: 'POST', headers: { 'x-session-token': token } }).catch(() => {});
        tampilLogin();
        return;
      }
      sessionStorage.setItem('aktifTerakhir', String(Date.now()));

      // Ada sesi → langsung buka halaman terakhir (tanpa menunggu server), verifikasi di belakang
      currentSessionToken = token;
      document.getElementById('auth-modal').style.display = 'none';
      terapkanSesi(savedUser, sessionStorage.getItem('sessionRole') || 'user');
      showPageLoading(false);
      initRouterFromHash();
      startRealtimeTimer();
      muatNamaPeta();
      muatProfilSaya();

      // Verifikasi token ke server. Kalau internet/server sedang putus, coba lagi — JANGAN langsung logout.
      for (let coba = 1; coba <= 5; coba++) {
        try {
          const res = await fetch('/api/auth/me', { headers: { 'x-session-token': sessionStorage.getItem('sessionToken') || token } });
          if (res.status === 401) { tampilLogin(); return; }       // sesi memang habis / dicabut
          const data = await res.json();
          if (data.success) {
            if (data.role !== sessionStorage.getItem('sessionRole') || data.username !== savedUser) terapkanSesi(data.username, data.role);
            return;
          }
        } catch (err) {
          console.warn('Cek sesi gagal (percobaan ' + coba + '):', err.message);
        }
        await new Promise(r => setTimeout(r, coba * 2000));
      }
    }

    async function logout() {
      const token = sessionStorage.getItem('sessionToken');
      if (token) {
        try {
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'x-session-token': token }
          });
        } catch (e) {}
      }
      sessionStorage.clear();
      location.reload();
    }

    // =============================================
    // KELOLA AKUN — Hanya superuser
    // =============================================
    async function loadUserList() {
      const token = sessionStorage.getItem('sessionToken');
      const tbody = document.getElementById('user-list-body');
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px;">Memuat data...</td></tr>';

      try {
        const res = await fetch('/api/users', { headers: { 'x-session-token': token } });
        const data = await res.json();

        if (!data.success) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:20px;">${data.message}</td></tr>`;
          return;
        }

        tbody.innerHTML = data.data.map(u => `
          <tr>
            <td style="font-weight:600;color:#1e293b;">${u.nama ? `${u.nama}<div style="font-size:11px;font-weight:400;color:#94a3b8;">login: ${u.username}</div>` : u.username}</td>
            <td><span style="background:${u.role==='superuser'?'#f1f5f9':u.role==='admin'?'#f1f5f9':'#f0fdf4'};color:${u.role==='superuser'?'#334155':u.role==='admin'?'#475569':'#15803d'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${u.role === 'superuser' ? 'Superuser' : u.role === 'admin' ? 'Admin' : 'User'}</span></td>
            <td style="color:#64748b;font-size:12px;">${u.createdAt && !isNaN(new Date(u.createdAt)) ? new Date(u.createdAt).toLocaleDateString('id-ID') : '-'}</td>
            <td style="white-space:nowrap;">
              <button onclick="kaUbahNama('${u.username}', '${(u.nama || '').replace(/'/g, '')}')" class="ka-btn-sandi" title="Ubah nama tampilan"><span class="material-symbols-outlined">badge</span>Nama</button>
              ${u.role !== 'superuser' ? `<button onclick="kaBukaGantiSandi('${u.username}')" class="ka-btn-sandi" title="Ganti sandi"><span class="material-symbols-outlined">key</span>Ganti Sandi</button>
              <button onclick="deleteUser('${u.username}')" style="background:#fee2e2;color:#ef4444;border:none;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Hapus</button>` : '<span style="color:#cbd5e1;font-size:11px;">—</span>'}
            </td>
          </tr>
        `).join('');
      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat data akun.</td></tr>';
      }
    }

    async function handleCreateUser(event) {
      event.preventDefault();
      const token = sessionStorage.getItem('sessionToken');
      const username = document.getElementById('new-username').value.trim();
      const password = document.getElementById('new-password').value.trim();
      const role = document.getElementById('new-role').value;
      const btn = document.getElementById('btn-create-user');
      const msgEl = document.getElementById('create-user-msg');

      if (!username || !password) return;

      btn.disabled = true;
      btn.innerText = 'Menyimpan...';
      msgEl.innerText = '';

      try {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': token },
          body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (data.success) {
          msgEl.style.color = '#16a34a';
          msgEl.innerText = data.message;
          document.getElementById('new-username').value = '';
          document.getElementById('new-password').value = '';
          loadUserList();
        } else {
          msgEl.style.color = '#ef4444';
          msgEl.innerText = data.message;
        }
      } catch (err) {
        msgEl.style.color = '#ef4444';
        msgEl.innerText = 'Gagal terhubung ke server.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Buat Akun';
      }
    }

    // ---- Lihat sandi (ikon mata) ----
    function kaToggleMata(idInput, btn) {
      const el = document.getElementById(idInput);
      if (!el) return;
      const lihat = el.type === 'password';
      el.type = lihat ? 'text' : 'password';
      btn.querySelector('.material-symbols-outlined').textContent = lihat ? 'visibility_off' : 'visibility';
      btn.title = lihat ? 'Sembunyikan sandi' : 'Lihat sandi';
      el.focus();
    }

    // ---- Ganti / reset sandi akun (superuser) ----
    function kaSandiAcak() {
      const huruf = 'abcdefghjkmnpqrstuvwxyz', angka = '23456789';
      const ambil = (set, n) => Array.from(crypto.getRandomValues(new Uint32Array(n))).map(x => set[x % set.length]).join('');
      return ambil(huruf, 5) + ambil(angka, 3);
    }

    function kaBukaGantiSandi(username) {
      kaTutupGantiSandi();
      const box = document.createElement('div');
      box.id = 'ka-modal-sandi';
      box.className = 'ka-modal-latar';
      box.innerHTML = `
        <div class="ka-modal" role="dialog" aria-modal="true">
          <h3>Ganti Sandi</h3>
          <p class="ka-modal-sub">Akun <b>${username}</b>. Sandi lama tidak bisa dilihat (tersimpan terenkripsi), jadi buat sandi baru lalu berikan ke orangnya.</p>
          <label>Sandi baru</label>
          <div class="ka-sandi-wrap">
            <input id="ka-sandi-baru" type="text" minlength="6" autocomplete="new-password" placeholder="minimal 6 karakter">
            <button type="button" class="ka-mata" onclick="kaToggleMata('ka-sandi-baru', this)" title="Sembunyikan sandi"><span class="material-symbols-outlined">visibility_off</span></button>
          </div>
          <button type="button" class="ka-link" onclick="document.getElementById('ka-sandi-baru').value = kaSandiAcak()">
            <span class="material-symbols-outlined">casino</span>Buat sandi acak</button>
          <p id="ka-sandi-msg" class="ka-modal-msg"></p>
          <div class="ka-modal-aksi">
            <button type="button" class="ka-btn-batal" onclick="kaTutupGantiSandi()">Batal</button>
            <button type="button" class="ka-btn-simpan" id="ka-btn-simpan-sandi" onclick="kaSimpanSandi('${username}')">Simpan Sandi</button>
          </div>
        </div>`;
      box.addEventListener('click', e => { if (e.target === box) kaTutupGantiSandi(); });
      document.body.appendChild(box);
      const inp = document.getElementById('ka-sandi-baru');
      inp.value = kaSandiAcak();
      inp.focus(); inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') kaSimpanSandi(username); if (e.key === 'Escape') kaTutupGantiSandi(); });
    }

    // Superuser mengubah nama tampilan akun lain (antisipasi nama asal-asalan)
    function kaUbahNama(username, namaLama) {
      kaTutupGantiSandi();
      const box = document.createElement('div');
      box.id = 'ka-modal-sandi';
      box.className = 'ka-modal-latar';
      box.innerHTML = `<div class="ka-modal" role="dialog" aria-modal="true">
          <h3>Ubah Nama Tampilan</h3>
          <p class="ka-modal-sub">Akun login <b>${username}</b>. Nama ini tampil di semua riwayat & laporan (data lama ikut diperbarui).</p>
          <label>Nama tampilan</label>
          <input id="ka-nama-baru" type="text" maxlength="40" placeholder="contoh: Budi Santoso" style="width:100%;font-family:inherit;">
          <p id="ka-sandi-msg" class="ka-modal-msg"></p>
          <div class="ka-modal-aksi">
            <button type="button" class="ka-btn-batal" onclick="kaTutupGantiSandi()">Batal</button>
            <button type="button" class="ka-btn-simpan" id="ka-btn-simpan-nama">Simpan</button>
          </div></div>`;
      box.addEventListener('click', e => { if (e.target === box) kaTutupGantiSandi(); });
      document.body.appendChild(box);
      const inp = document.getElementById('ka-nama-baru');
      inp.value = namaLama || '';
      inp.focus();
      document.getElementById('ka-btn-simpan-nama').onclick = async () => {
        const btn = document.getElementById('ka-btn-simpan-nama'), msg = document.getElementById('ka-sandi-msg');
        btn.disabled = true; btn.textContent = 'Menyimpan...';
        try {
          const r = await fetch(`/api/profil/${encodeURIComponent(username)}`, { method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': sessionStorage.getItem('sessionToken') },
            body: JSON.stringify({ nama: inp.value.trim() }) });
          const d = await r.json();
          if (!d.success) throw new Error(d.message);
          kaTutupGantiSandi();
          showToast(d.message || 'Nama tersimpan.', 'success');
          await muatNamaPeta();
          loadUserList();
        } catch (err) {
          msg.style.color = '#ef4444'; msg.textContent = err.message || 'Gagal menyimpan.';
          btn.disabled = false; btn.textContent = 'Simpan';
        }
      };
    }

    function kaTutupGantiSandi() {
      const m = document.getElementById('ka-modal-sandi');
      if (m) m.remove();
    }

    async function kaSimpanSandi(username) {
      const inp = document.getElementById('ka-sandi-baru');
      const msg = document.getElementById('ka-sandi-msg');
      const btn = document.getElementById('ka-btn-simpan-sandi');
      const sandi = inp.value.trim();
      if (sandi.length < 6) { msg.style.color = '#ef4444'; msg.textContent = 'Sandi minimal 6 karakter.'; return; }
      btn.disabled = true; btn.textContent = 'Menyimpan...';
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'x-session-token': sessionStorage.getItem('sessionToken') },
          body: JSON.stringify({ password: sandi })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const modal = document.querySelector('#ka-modal-sandi .ka-modal');
        modal.innerHTML = `
          <h3>Sandi berhasil diganti</h3>
          <p class="ka-modal-sub">Berikan sandi ini ke <b>${username}</b>. Setelah jendela ini ditutup, sandi tidak bisa dilihat lagi. Perangkat yang sedang login dengan akun ini otomatis keluar.</p>
          <div class="ka-sandi-hasil"><code id="ka-sandi-hasil">${sandi.replace(/</g,'&lt;')}</code>
            <button type="button" class="ka-btn-salin" onclick="kaSalinSandi(this)"><span class="material-symbols-outlined">content_copy</span>Salin</button></div>
          <div class="ka-modal-aksi"><button type="button" class="ka-btn-simpan" onclick="kaTutupGantiSandi()">Selesai</button></div>`;
      } catch (err) {
        msg.style.color = '#ef4444';
        msg.textContent = err.message || 'Gagal mengganti sandi.';
        btn.disabled = false; btn.textContent = 'Simpan Sandi';
      }
    }

    async function kaSalinSandi(btn) {
      const teks = document.getElementById('ka-sandi-hasil').textContent;
      try { await navigator.clipboard.writeText(teks); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(document.getElementById('ka-sandi-hasil')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); document.execCommand('copy'); }
      btn.innerHTML = '<span class="material-symbols-outlined">check</span>Tersalin';
    }

    async function deleteUser(username) {
      if (!confirm(`Hapus akun "${username}"? Tindakan ini tidak bisa dibatalkan.`)) return;
      const token = sessionStorage.getItem('sessionToken');
      try {
        const res = await fetch(`/api/users/${username}`, {
          method: 'DELETE',
          headers: { 'x-session-token': token }
        });
        const data = await res.json();
        alert(data.message);
        if (data.success) loadUserList();
      } catch (err) {
        showToast('Gagal menghapus akun.', 'error');
      }
    }

    function getTimeAgoText(timestamp) {
      if (!timestamp) return 'Belum diperbarui';
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 5) return 'Diperbarui baru saja';
      if (seconds < 60) return `Diperbarui ${seconds} dtk lalu`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `Diperbarui ${minutes} mnt lalu`;
      return `Diperbarui ${Math.floor(minutes / 60)} jam lalu`;
    }

    function startRealtimeTimer() {
      setInterval(() => {
        if (lastFetchTimeInbound) {
          const textInc = getTimeAgoText(lastFetchTimeInbound);
          document.querySelectorAll('.time-ago-text-inbound').forEach(el => el.innerText = textInc);
        }
        if (lastFetchTimeOutbound) {
          const textOut = getTimeAgoText(lastFetchTimeOutbound);
          document.querySelectorAll('.time-ago-text-outbound').forEach(el => el.innerText = textOut);
        }
      }, 1000);
    }

    // ============================================================
    // HASH ROUTER — URL berubah saat pindah menu
    // Refresh = hanya load data halaman aktif, sidebar tidak reload
    // ============================================================
    const PAGE_DATA_LOADERS = {
      'dashboard'         : () => loadDashboard(),
      'pusat-inventory'   : () => initSoPage(),
      'lacak-awb'         : () => null,
      'kelola-akun'       : () => loadUserList(),
      'pengaturan'        : () => (typeof setInit === 'function' ? setInit() : null),
      'statistik-team'    : () => initTeamStatPage()
    };

    function switchTab(pageId, element, pushState = true) {
      if (pushState && perluMuatUlang) { history.pushState({ page: pageId }, '', `#${pageId}`); if (muatUlangBilaPerlu()) return; }
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      if (element) element.classList.add('active');
      else {
        // Aktifkan nav item berdasarkan pageId
        document.querySelectorAll('.nav-item').forEach(i => {
          if (i.getAttribute('onclick') && i.getAttribute('onclick').includes(`'${pageId}'`)) i.classList.add('active');
        });
      }

      document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
      const titleEl = element || document.querySelector(`.nav-item[href="#${pageId}"]`);
      if (titleEl) {
        document.getElementById('page-title').innerText = titleEl.querySelector('span:not(.material-symbols-outlined)').innerText;
        document.getElementById('page-icon').innerText = titleEl.querySelector('.material-symbols-outlined').innerText;
      }

      const targetPage = document.getElementById(`page-${pageId}`);
      if (targetPage) targetPage.classList.add('active');
      else {
        if (titleEl) document.getElementById('generic-title').innerText = titleEl.querySelector('span:not(.material-symbols-outlined)').innerText;
        document.getElementById('page-generic').classList.add('active');
      }

      // Update URL hash tanpa reload
      if (pushState) history.pushState({ page: pageId }, '', `#${pageId}`);

      // Menu lipat (Laporan Opname): buka otomatis bila anaknya aktif
      navSinkronGrup();

      // Lazy load: panggil loader data hanya untuk halaman ini
      if (PAGE_DATA_LOADERS[pageId]) PAGE_DATA_LOADERS[pageId]();
    }

    // =============================================
    // MENU LIPAT SIDEBAR
    // =============================================
    function navToggleGrup(nama) {
      const grup = document.getElementById('nav-grup-' + nama);
      if (!grup) return;
      const buka = !grup.classList.contains('buka');
      grup.classList.toggle('buka', buka);
      grup.querySelector('.nav-group-toggle')?.setAttribute('aria-expanded', buka ? 'true' : 'false');
      try { localStorage.setItem('navGrup_' + nama, buka ? '1' : '0'); } catch (e) {}
    }
    function navSinkronGrup() {
      document.querySelectorAll('.nav-group').forEach(grup => {
        const adaAktif = !!grup.querySelector('.nav-group-isi .nav-item.active');
        grup.classList.toggle('punya-aktif', adaAktif);
        const nama = grup.id.replace('nav-grup-', '');
        let simpan = null;
        try { simpan = localStorage.getItem('navGrup_' + nama); } catch (e) {}
        if (adaAktif || simpan === '1') grup.classList.add('buka');
        grup.querySelector('.nav-group-toggle')?.setAttribute('aria-expanded', grup.classList.contains('buka') ? 'true' : 'false');
      });
    }

    // Handle tombol back/forward browser
    window.addEventListener('popstate', e => {
      const p = e.state?.page || 'dashboard';
      const pageId = Object.keys(PAGE_DATA_LOADERS).includes(p) ? p : 'dashboard';
      switchTab(pageId, null, false);
    });

    // Handle refresh: baca hash dari URL saat pertama load
    function initRouterFromHash() {
      const hash = window.location.hash.replace('#', '') || 'dashboard';
      const validPages = Object.keys(PAGE_DATA_LOADERS);
      const pageId = validPages.includes(hash) ? hash : 'dashboard';
      // Set state awal tanpa pushState
      history.replaceState({ page: pageId }, '', `#${pageId}`);
      switchTab(pageId, null, false);
    }

    function getFormattedStatus(rawStatus, type) {
      const map = type === 'inbound' ? INBOUND_STATUS_MAP : OUTBOUND_STATUS_MAP;
      return map[rawStatus] || String(rawStatus).replace(/_/g, ' ');
    }

    // Dashboard gudang dipindah ke /js/dashboard.js (fungsi loadDashboard ada di sana)

    // =============================================
    // TRACKING AWB — FULL REVAMP
    // =============================================
    let currentTableFilter = 'semua';

    // Format tanggal apapun menjadi yyyy-MM-dd HH:mm (WIB)
    // Menangani: Date object string panjang, ISO string, yyyy-MM-dd HH:mm, dll.
    function formatTglDisplay(val) {
      if (!val || val === '-') return '-';
      const s = String(val).trim();
      // Sudah format pendek yyyy-MM-dd atau yyyy-MM-dd HH:mm → langsung pakai
      if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s)) return s;
      // Format panjang seperti "Thu Sep 10 2026 09:21:00 GMT+0700 ..."
      // atau ISO "2026-09-10T02:21:00.000Z" → parse jadi Date lalu konversi ke WIB
      try {
        const d = new Date(s);
        if (isNaN(d.getTime())) return s; // tidak bisa di-parse, kembalikan apa adanya
        const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        const yyyy = wib.getUTCFullYear();
        const mm   = String(wib.getUTCMonth() + 1).padStart(2, '0');
        const dd   = String(wib.getUTCDate()).padStart(2, '0');
        const hh   = String(wib.getUTCHours()).padStart(2, '0');
        const min  = String(wib.getUTCMinutes()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
      } catch (e) { return s; }
    }

    function detectKurir(resi) {
      resi = String(resi).toUpperCase().trim();
      if (/^JX\d+$/.test(resi) || /^JY\d+$/.test(resi)) return 'JNT';
      if (/^JT\d+$/.test(resi)) return 'JNT';
      if (/^000\d+$/.test(resi) || /^886\d+$/.test(resi)) return 'SiCepat';
      if (/^LP\d+$/.test(resi)) return 'Lalamove';
      if (/^JDID\d+$/.test(resi)) return 'JD ID';
      if (/^AWB\d+$/.test(resi) || /^10\d{10}$/.test(resi)) return 'Anteraja';
      if (/^TGK\d+$/.test(resi)) return 'Tiki';
      if (/^\d{20,}$/.test(resi)) return 'Shopee Express';
      if (/^IDEX\d+$/.test(resi)) return 'ID Express';
      if (/^PCP\d+$/.test(resi)) return 'Paxel';
      return 'J&T';
    }

    function kategorikanStatus(status, keterangan) {
      const s = String(status || '').toLowerCase();
      const k = String(keterangan || '').toLowerCase();
      if (!status || s.includes('gagal') || s.includes('error') || s === '-') return 'gagal';
      if (s.includes('cancel') || s.includes('batal') || s.includes('cancelled')) return 'cancel';
      // Sudah jalan: picked, dropping, delivered
      if (s.includes('picked') || s.includes('dropping') || s.includes('delivered') || k.includes('has been picked')) return 'sudah_jalan';
      // Belum jalan: manifest / allocated / picking_up yang masih manifes
      if (s.includes('manifest') || s.includes('allocated') || s.includes('disimpan') || k.includes('manifes') ||
          (s.includes('picking') && k.includes('manifes'))) return 'belum_jalan';
      if (s.includes('picking_up') || s.includes('confirmed')) return 'belum_jalan';
      return 'sudah_jalan';
    }

    function updateResiCount() {
      const lines = document.getElementById('input-awb-bulk').value.split('\n').map(s => s.trim()).filter(Boolean);
      document.getElementById('resi-count-label').innerText = `${lines.length} resi`;
    }

    function setTableFilter(filter, btnEl) {
      currentTableFilter = filter;
      document.querySelectorAll('.awb-filter-btn').forEach(b => b.classList.remove('active'));
      if (btnEl) btnEl.classList.add('active');
      else {
        document.querySelectorAll('.awb-filter-btn').forEach(b => {
          if (b.getAttribute('onclick') && b.getAttribute('onclick').includes(filter)) b.classList.add('active');
        });
      }
      renderResultsTable();
    }

    function hitungSummary() {
      let jalan = 0, belum = 0, cancel = 0, gagal = 0;
      allTrackedData.forEach(d => {
        if (d.category === 'sudah_jalan') jalan++;
        else if (d.category === 'belum_jalan') belum++;
        else if (d.category === 'cancel') cancel++;
        else gagal++;
      });
      const total = allTrackedData.length;
      document.getElementById('cnt-total').innerText = total;
      document.getElementById('cnt-sudah-jalan').innerText = jalan;
      document.getElementById('cnt-belum-jalan').innerText = belum;
      document.getElementById('cnt-cancel').innerText = cancel;
      document.getElementById('cnt-gagal-cek').innerText = gagal;
      document.getElementById('cnt-belum-cek').innerText = '0';
      document.getElementById('cnt-sedang-cek').innerText = '0';
      // Sidebar summary
      if (document.getElementById('cnt-sudah-jalan2')) document.getElementById('cnt-sudah-jalan2').innerText = jalan;
      if (document.getElementById('cnt-belum-jalan2')) document.getElementById('cnt-belum-jalan2').innerText = belum;
      if (document.getElementById('cnt-cancel2')) document.getElementById('cnt-cancel2').innerText = cancel;
      if (document.getElementById('cnt-gagal2')) document.getElementById('cnt-gagal2').innerText = gagal;
    }

    function resetTrackingSummary() {
      allTrackedData = [];
      ['cnt-total','cnt-belum-cek','cnt-sedang-cek','cnt-sudah-jalan','cnt-belum-jalan','cnt-cancel','cnt-gagal-cek',
       'cnt-sudah-jalan2','cnt-belum-jalan2','cnt-cancel2','cnt-gagal2'].forEach(id => {
        const el = document.getElementById(id); if (el) el.innerText = '0';
      });
      document.getElementById('track-results-body').innerHTML = `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px;">Data direset.</td></tr>`;
      // auto-simpan — tidak perlu toggle disabled
      document.getElementById('awb-top-status').innerText = '';
      document.getElementById('awb-progress-wrap').style.display = 'none';
      if (document.getElementById('table-count-label')) document.getElementById('table-count-label').innerText = '';
    }

    // =============================================
    // LACAK CANCEL — Scan resi + notifikasi suara
    // =============================================
    let cancelResiSet    = new Set(); // semua resi berstatus cancel di tanggal terpilih
    let cancelScannedSet = new Set(); // resi yang sudah discan selama sesi popup ini terbuka

    function updateCancelCounts() {
      const totalEl   = document.getElementById('cancel-total-count');
      const scannedEl = document.getElementById('cancel-scanned-count');
      if (totalEl)   totalEl.innerText   = cancelResiSet.size;
      if (scannedEl) scannedEl.innerText = cancelScannedSet.size;
    }

    // URL Apps Script — fetch langsung dari browser tanpa lewat Railway
    const GAS_URL = 'https://script.google.com/macros/s/AKfycbwBaBiM08RtAuPayp-vtJINsO3li2blbVg1sbTJtKFPF3-xLN6zhBg5_UbUG_79mQoJ/exec';

    async function gasGetDirect(params) {
      const url = new URL(GAS_URL);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url.toString());
      return await res.json();
    }

    async function openLacakCancel() {
      const tanggal = cdpSelectedDate || document.getElementById('filter-tanggal').value;
      if (!tanggal) return showToast('Pilih tanggal terlebih dahulu!', 'warning');
      const gudang = document.getElementById('filter-gudang').value;

      // Tampilkan modal
      const cm = document.getElementById('cancel-modal');
      cm.style.display = 'flex';

      // Reset state
      cancelResiSet    = new Set();
      cancelScannedSet = new Set();
      cancelRowData    = [];
      updateCancelCounts();

      // Reset tabel
      const tbody = document.getElementById('cancel-list-body');
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#94a3b8;font-size:12px;">Memuat daftar resi cancel...</td></tr>';

      // Aktifkan keyboard listener untuk scanner eksternal
      cancelScanBuffer = '';
      document.addEventListener('keydown', cancelScanKeyListener);

      try {
        const params = { action: 'cancelList', tanggal };
        if (gudang) params.gudang = gudang;
        const data = await gasGetDirect(params);
        if (!data.success) {
          tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px;color:#e11d48;font-size:12px;">⚠ ${data.message || 'Gagal memuat data.'}</td></tr>`;
          return;
        }

        // Simpan data rows untuk referensi scan
        cancelRowData = data.rows || [];
        data.rows.forEach(r => cancelResiSet.add(String(r.resi).toUpperCase()));
        updateCancelCounts();

        // Render tabel
        cancelRenderTable();

        // Update status header
        const statusEl = document.getElementById('cancel-scan-status');
        if (statusEl) statusEl.textContent = `${cancelResiSet.size} resi cancel — arahkan scanner ke resi`;

      } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#e11d48;font-size:12px;">Gagal terhubung ke Apps Script.</td></tr>';
      }
    }

    // Data rows cancel untuk render tabel
    let cancelRowData    = [];
    let cancelScanBuffer = '';
    let cancelScanTimer  = null;

    // Render tabel daftar resi cancel
    function cancelRenderTable() {
      const tbody = document.getElementById('cancel-list-body');
      if (!cancelRowData.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:30px;color:#94a3b8;font-size:12px;">Tidak ada resi cancel di tanggal ini.</td></tr>';
        return;
      }
      tbody.innerHTML = cancelRowData.map(r => {
        const resi    = String(r.resi || '').toUpperCase();
        const tgl     = r.tglDicatat || r.tgl_dicatat || '-';
        const batch   = r.batch || '-';
        const scanned = cancelScannedSet.has(resi);
        const rowBg   = scanned ? 'background:#f0fdf4;' : '';
        return `<tr id="cancel-row-${resi}" style="${rowBg}transition:background .3s;">
          <td style="padding:10px 14px;font-family:monospace;font-size:12px;color:#1e293b;font-weight:600;">${resi}</td>
          <td style="padding:10px 14px;font-size:11px;color:#64748b;">${tgl}</td>
          <td style="padding:10px 14px;text-align:center;">
            ${batch !== '-' ? `<span style="background:#f1f5f9;color:#334155;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">${batch}</span>` : '<span style="color:#cbd5e1;font-size:11px;">—</span>'}
          </td>
          <td style="padding:10px 14px;text-align:center;" id="cancel-status-${resi}">
            ${scanned
              ? '<span style="background:#dcfce7;color:#15803d;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">✅ Ditemukan</span>'
              : '<span style="color:#cbd5e1;font-size:11px;">Belum scan</span>'
            }
          </td>
        </tr>`;
      }).join('');
    }

    // Keyboard listener untuk scanner eksternal
    function cancelScanKeyListener(e) {
      // Scanner kirim karakter cepat lalu Enter
      if (e.key === 'Enter') {
        const resi = cancelScanBuffer.trim().toUpperCase();
        cancelScanBuffer = '';
        clearTimeout(cancelScanTimer);
        if (resi.length > 3) cancelProcessScan(resi);
        return;
      }
      // Abaikan modifier keys
      if (e.key.length === 1) {
        cancelScanBuffer += e.key;
        clearTimeout(cancelScanTimer);
        // Reset buffer kalau tidak ada input 300ms (bukan dari scanner)
        cancelScanTimer = setTimeout(() => { cancelScanBuffer = ''; }, 300);
      }
    }

    // Proses hasil scan
    function cancelProcessScan(resi) {
      const resultBox = document.getElementById('cancel-last-result');

      // Cek JNT
      const isJNT = resi.startsWith('JY') || resi.startsWith('JX');
      if (!isJNT) {
        playScanVoice('tidak_valid');
        cancelShowResult(resultBox, '🚫', 'Bukan Paket JNT', resi, '#fff1f2', '#fecdd3', '#be123c');
        return;
      }

      // Double scan
      if (cancelScannedSet.has(resi)) {
        playScanVoice('double');
        cancelShowResult(resultBox, '⚠️', 'Double Paket!', resi, '#f1f5f9', '#cbd5e1', '#334155');
        return;
      }

      cancelScannedSet.add(resi);
      updateCancelCounts();

      if (cancelResiSet.has(resi)) {
        // Cancel ditemukan — hijau di tabel
        playScanVoice('cancel');
        cancelShowResult(resultBox, '🚨', 'Paket Cancel!', resi, '#fee2e2', '#fca5a5', '#dc2626');
        // Update baris tabel
        const row    = document.getElementById(`cancel-row-${resi}`);
        const status = document.getElementById(`cancel-status-${resi}`);
        if (row)    { row.style.background = '#f0fdf4'; }
        if (status) { status.innerHTML = '<span style="background:#dcfce7;color:#15803d;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">✅ Ditemukan</span>'; }
      } else {
        // Valid (JNT, bukan cancel)
        playScanVoice('valid');
        cancelShowResult(resultBox, '✅', 'Paket Valid', resi, '#f0fdf4', '#86efac', '#15803d');
      }
    }

    function cancelShowResult(box, icon, label, resi, bg, border, color) {
      box.style.display = '';
      box.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${bg};border-radius:8px;border:1.5px solid ${border};">
        <span style="font-size:22px;">${icon}</span>
        <div>
          <div style="font-size:13px;font-weight:800;color:${color};">${label}</div>
          <div style="font-size:11px;color:#94a3b8;font-family:monospace;">${resi}</div>
        </div>
      </div>`;
      // Sembunyikan lagi setelah 2.5 detik
      setTimeout(() => { if (box) box.style.display = 'none'; }, 2500);
    }



    // =============================================

// [audio dimuat dari audio.js]

// handleCancelScan lama dihapus — digantikan cancelScanKeyListener

    
    function closeLacakCancel() {
      document.getElementById('cancel-modal').style.display = 'none';
      // Hapus keyboard listener scanner
      document.removeEventListener('keydown', cancelScanKeyListener);
      cancelScanBuffer = '';
      // Reset result notif
      const rb = document.getElementById('cancel-last-result');
      if (rb) { rb.innerHTML = ''; rb.style.display = 'none'; }
    }

    // AMBIL DARI SHEET — baca dari tab "Resi Harian", masukkan ke kotak input
    // AMBIL DARI SHEET — langsung ke Apps Script (tanpa lewat Railway)
    // =============================================
    // CUSTOM DATE PICKER
    // =============================================
    let cdpYear  = new Date().getFullYear();
    let cdpMonth = new Date().getMonth(); // 0-based
    let cdpSelectedDate = ''; // format YYYY-MM-DD

    const CDP_DAYS   = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
    const CDP_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni',
                        'Juli','Agustus','September','Oktober','November','Desember'];

    function cdpToggle() {
      const popup = document.getElementById('cdp-popup');
      const input = document.getElementById('cdp-input');
      const isOpen = popup.style.display !== 'none';
      if (isOpen) {
        popup.style.display = 'none';
        input.classList.remove('open');
      } else {
        popup.style.display = '';
        input.classList.add('open');
        cdpRender();
        // Tutup saat klik di luar
        setTimeout(() => {
          document.addEventListener('click', cdpOutsideClick, { once: true });
        }, 0);
      }
    }

    function cdpOutsideClick(e) {
      const wrap = document.getElementById('cdp-wrap');
      if (wrap && wrap.contains(e.target)) {
        // Klik masih di dalam picker, pasang listener lagi
        setTimeout(() => {
          document.addEventListener('click', cdpOutsideClick, { once: true });
        }, 0);
        return;
      }
      document.getElementById('cdp-popup').style.display = 'none';
      document.getElementById('cdp-input').classList.remove('open');
    }

    function cdpRender() {
      // Update label bulan
      document.getElementById('cdp-month-label').textContent =
        CDP_MONTHS[cdpMonth] + ' ' + cdpYear;

      const grid  = document.getElementById('cdp-grid');
      const today = new Date();
      const todayStr = today.getFullYear() + '-' +
        String(today.getMonth()+1).padStart(2,'0') + '-' +
        String(today.getDate()).padStart(2,'0');

      // Hari pertama bulan ini (0=Min, 1=Sen, dst)
      const firstDay = new Date(cdpYear, cdpMonth, 1).getDay();
      const daysInMonth = new Date(cdpYear, cdpMonth+1, 0).getDate();
      const daysInPrev  = new Date(cdpYear, cdpMonth, 0).getDate();

      let html = '';

      // Header hari
      CDP_DAYS.forEach(d => {
        html += `<div class="cdp-day-name">${d}</div>`;
      });

      // Sel kosong sebelum hari pertama (isi dari bulan sebelumnya)
      for (let i = 0; i < firstDay; i++) {
        const d = daysInPrev - firstDay + 1 + i;
        html += `<div class="cdp-day other-month">${d}</div>`;
      }

      // Hari-hari bulan ini
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = cdpYear + '-' +
          String(cdpMonth+1).padStart(2,'0') + '-' +
          String(d).padStart(2,'0');
        let cls = 'cdp-day';
        if (dateStr === todayStr) cls += ' today';
        if (dateStr === cdpSelectedDate) cls += ' selected';
        html += `<div class="${cls}" onclick="cdpSelect('${dateStr}')">${d}</div>`;
      }

      // Isi sisa grid dengan hari bulan berikutnya
      const total = firstDay + daysInMonth;
      const remainder = total % 7 === 0 ? 0 : 7 - (total % 7);
      for (let d = 1; d <= remainder; d++) {
        html += `<div class="cdp-day other-month">${d}</div>`;
      }

      grid.innerHTML = html;
    }

    function cdpSelect(dateStr) {
      cdpSelectedDate = dateStr;
      // Update hidden input (untuk kompatibilitas)
      document.getElementById('filter-tanggal').value = dateStr;
      // Update display
      const [y, m, d] = dateStr.split('-');
      const disp = document.getElementById('cdp-display');
      disp.textContent = d + ' ' + CDP_MONTHS[parseInt(m)-1] + ' ' + y;
      disp.className = 'cdp-val';
      // Tutup popup
      document.getElementById('cdp-popup').style.display = 'none';
      document.getElementById('cdp-input').classList.remove('open');
      // Langsung Terapkan
      awbTerapkan();
    }

    function cdpSelectToday() {
      const today = new Date();
      cdpYear  = today.getFullYear();
      cdpMonth = today.getMonth();
      const dateStr = today.getFullYear() + '-' +
        String(today.getMonth()+1).padStart(2,'0') + '-' +
        String(today.getDate()).padStart(2,'0');
      cdpSelect(dateStr);
    }

    function cdpClear() {
      cdpSelectedDate = '';
      document.getElementById('filter-tanggal').value = '';
      const disp = document.getElementById('cdp-display');
      disp.textContent = 'Pilih tanggal';
      disp.className = 'cdp-placeholder';
      document.getElementById('cdp-popup').style.display = 'none';
      document.getElementById('cdp-input').classList.remove('open');
      const msg = document.getElementById('awb-top-status');
      msg.innerText = ''; 
    }

    function cdpPrevMonth() {
      cdpMonth--;
      if (cdpMonth < 0) { cdpMonth = 11; cdpYear--; }
      cdpRender();
    }

    function cdpNextMonth() {
      cdpMonth++;
      if (cdpMonth > 11) { cdpMonth = 0; cdpYear++; }
      cdpRender();
    }

    // Fungsi lama tetap ada (dipakai awbTerapkan)
    async function loadFromSheet() {
      const tanggal = document.getElementById('filter-tanggal').value;
      if (!tanggal) return;
      const gudang  = document.getElementById('filter-gudang').value;
      const banner  = document.getElementById('awb-top-status');

      // Sembunyikan banner sementara saat loading
      banner.style.display = 'none';

      try {
        const params = { action: 'loadResi', tanggal };
        if (gudang) params.gudang = gudang;
        const data = await gasGetDirect(params);

        if (!data.success) {
          // Tampilkan banner merah kalau gagal
          banner.style.background = '#fff1f2';
          banner.style.borderColor = '#fecdd3';
          document.getElementById('awb-banner-jumlah').innerHTML =
            `<span style="font-size:15px;color:#be123c;">⚠ ${data.message || 'Gagal memuat resi'}</span>`;
          document.getElementById('awb-banner-sub').textContent = '';
          banner.style.display = 'flex';
          return null;
        }

        const resiList = data.rows.map(r => r.resi).filter(Boolean);
        document.getElementById('input-awb-bulk').value = resiList.join('\n');
        updateResiCount();
        allTrackedData = []; hitungSummary(); renderResultsTable();

        // Tampilkan banner kuning solid dengan angka resi
        const [y, m, d] = tanggal.split('-');
        const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
        const gudangLabel = gudang || 'Semua Gudang';

        banner.style.background = '#f1f5f9';
        banner.style.borderColor = '#cbd5e1';
        document.getElementById('awb-banner-jumlah').innerHTML =
          `<span style="font-size:26px;font-weight:800;color:#334155;">${resiList.length}</span>` +
          ` <span style="font-size:13px;font-weight:500;color:#8a6d1f;">resi siap dilacak</span>`;
        document.getElementById('awb-banner-sub').textContent =
          `${d} ${bulan[parseInt(m)-1]} ${y} · ${gudangLabel} · dimuat ${new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}`;
        awbBannerReset();
        awbBannerTampil();

        return resiList;
      } catch (err) {
        banner.style.background = '#fff1f2';
        banner.style.borderColor = '#fecdd3';
        document.getElementById('awb-banner-jumlah').innerHTML =
          `<span style="font-size:15px;color:#be123c;">⚠ Gagal terhubung ke Apps Script</span>`;
        document.getElementById('awb-banner-sub').textContent = '';
        awbBannerReset();
        awbBannerTampil();
        return null;
      }
    }

    // Terapkan: pilih tanggal → otomatis load resi
    async function awbTerapkan() {
      const tanggal = cdpSelectedDate || document.getElementById('filter-tanggal').value;
      if (!tanggal) {
        const msg = document.getElementById('awb-top-status');
        msg.innerText = '⚠️ Pilih tanggal terlebih dahulu.';
        msg.style.color = '#dc2626'; return;
      }
      await loadFromSheet();
    }

    function awbOnTanggalChange() {
      // Tidak dipakai lagi — CDP langsung Terapkan saat pilih tanggal
    }

    // ---- BANNER NOTIF ----
    let awbBannerDitutup = false; // flag: user tutup manual

    function awbBannerTutup() {
      awbBannerDitutup = true;
      document.getElementById('awb-top-status').style.display = 'none';
    }

    function awbBannerTampil() {
      // Hanya tampil kalau user belum menutup manual
      if (!awbBannerDitutup) {
        document.getElementById('awb-top-status').style.display = 'flex';
      }
    }

    function awbBannerReset() {
      // Reset flag saat ada aksi baru (load tanggal baru, cek resi)
      awbBannerDitutup = false;
    }

    // CEK RESI — langsung ke Apps Script, baca Tracking AWB (tanpa Biteship)
    async function cekResiDariSheet() {
      const tanggal = document.getElementById('filter-tanggal').value;
      if (!tanggal) return showToast('Pilih tanggal terlebih dahulu!', 'warning');
      const gudang = document.getElementById('filter-gudang').value;
      const btn    = document.getElementById('btn-cek-resi');
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;animation:spin 1s linear infinite;">sync</span> Memuat...`;
      try {
        const params = { action: 'loadTracking', tanggal };
        if (gudang) params.gudang = gudang;
        const data = await gasGetDirect(params);
        if (!data.success) {
          showToast(data.message || 'Gagal memuat tracking.', 'error');
          return;
        }
        if (data.rows.length === 0) {
          showToast('Belum ada resi yang ditrack di tanggal ini.', 'info');
          return;
        }
        allTrackedData = data.rows.map(r => ({
          resi: r.resi, gudang: r.gudang || gudang || '',
          kurir: r.kurir || detectKurir(r.resi),
          tanggal: r.tanggal, status: r.status || '',
          keterangan: r.keterangan || '',
          tglInput: r.tglInput || tanggal,
          tglDicatat: r.tglDicatat || '',
          batch: r.batch || '',
          category: kategorikanStatus(r.status, r.keterangan)
        }));
        hitungSummary(); renderResultsTable();
        document.getElementById('btn-sync-wrap').style.display = '';

        // Update banner dengan info cek resi
        const banner = document.getElementById('awb-top-status');
        const [y, m, d] = tanggal.split('-');
        const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
        const gudangLabel = gudang || 'Semua Gudang';
        banner.style.background = '#f1f5f9';
        banner.style.borderColor = '#cbd5e1';
        document.getElementById('awb-banner-jumlah').innerHTML =
          `<span style="font-size:26px;font-weight:800;color:#334155;">${data.rows.length}</span>` +
          ` <span style="font-size:13px;font-weight:500;color:#8a6d1f;">resi dari Tracking AWB</span>`;
        document.getElementById('awb-banner-sub').textContent =
          `${d} ${bulan[parseInt(m)-1]} ${y} · ${gudangLabel}`;
        awbBannerReset();
        awbBannerTampil();

        showToast(`${data.rows.length} resi dimuat dari Tracking AWB.`, 'success');
      } catch (err) {
        showToast('Gagal terhubung ke Apps Script.', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;">manage_search</span> Cek Resi`;
      }
    }

    // RESI BELUM JALAN — langsung ke Apps Script, filter yang belum ada di Tracking AWB
    async function loadBelumJalan() {
      const tanggal = document.getElementById('filter-tanggal').value;
      if (!tanggal) return showToast('Pilih tanggal terlebih dahulu!', 'warning');
      const gudang = document.getElementById('filter-gudang').value;
      const btn = document.getElementById('btn-load-belum-jalan');
      const msg = document.getElementById('awb-top-status');
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;animation:spin 1s linear infinite;">sync</span> Memuat...`;
      msg.innerText = 'Mengambil resi belum jalan...';
      msg.style.color = '#dc2626';
      try {
        const params = { action: 'loadResi', tanggal, onlyPending: 'true' };
        if (gudang) params.gudang = gudang;
        const data = await gasGetDirect(params);
        if (!data.success) { msg.innerText = data.message || 'Gagal.'; msg.style.color = '#ef4444'; return; }
        const resiList = data.rows.map(r => r.resi).filter(Boolean);
        if (resiList.length === 0) {
          msg.innerText = '✅ Semua resi di tanggal ini sudah ditrack.';
          msg.style.color = '#16a34a'; return;
        }
        document.getElementById('input-awb-bulk').value = resiList.join('\n');
        updateResiCount();
        msg.innerText = `⏳ ${resiList.length} resi belum jalan siap di-track.`;
        msg.style.color = '#dc2626';
      } catch (err) {
        msg.innerText = 'Gagal terhubung ke Apps Script.'; msg.style.color = '#ef4444';
      } finally {
        if (btn && btn.style) btn.disabled = false;
      }
    }

    // Track ulang hanya resi yang statusnya belum jalan di allTrackedData
    async function trackBelumJalanSaja() {
      const belumJalanList = allTrackedData.filter(d => d.category === 'belum_jalan').map(d => d.resi);
      if (belumJalanList.length === 0) return showToast('Tidak ada resi belum jalan untuk di-track ulang.', 'error');
      document.getElementById('input-awb-bulk').value = belumJalanList.join('\n');
      updateResiCount();
      // Hapus data belum jalan dari allTrackedData supaya tidak duplikat
      allTrackedData = allTrackedData.filter(d => d.category !== 'belum_jalan');
      await handleTrackAwbBulk();
    }

    async function syncToSheet() {
      if (allTrackedData.length === 0) return showToast('Tidak ada data untuk disimpan.', 'error');
      const tanggal = document.getElementById('filter-tanggal').value;
      if (!tanggal) return showToast('Pilih tanggal terlebih dahulu!', 'warning');
      const btn = document.getElementById('btn-sync-sheet');
      const msg = document.getElementById('awb-top-status');
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;animation:spin 1s linear infinite;">sync</span> Menyimpan...`;
      msg.innerText = 'Mengirim ke Sheet...'; msg.style.color = '#0284c7';
      try {
        const token = sessionStorage.getItem('sessionToken');
        const res = await fetch('/api/sheet/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': token },
          body: JSON.stringify({ tanggal, data: allTrackedData })
        });
        const result = await res.json();
        if (result.success) {
          msg.innerText = `✅ ${allTrackedData.length} data tersimpan ke Sheet.`;
          msg.style.color = '#16a34a';
          document.getElementById('btn-sync-wrap').style.display = 'none';
        } else {
          msg.innerText = result.message || 'Gagal.';
          msg.style.color = '#ef4444';
        }
      } catch { msg.innerText = 'Gagal terhubung ke server.'; msg.style.color = '#ef4444'; }
      finally {
        btn.disabled = false;
        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;">cloud_upload</span> Simpan ke Sheet`;
      }
    }

    async function handleTrackAwbBulk() {
      const rawText = document.getElementById('input-awb-bulk').value.trim();
      if (!rawText) return showToast('Silakan masukkan nomor resi terlebih dahulu!', 'info');
      const semuaResi = rawText.split('\n').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (semuaResi.length === 0) return showToast('Tidak ada resi valid!', 'error');

      const btn = document.getElementById('btn-lacak-now');
      btn.disabled = true;
      document.getElementById('btn-lacak-text').innerText = 'Memeriksa sheet...';
      document.getElementById('awb-progress-wrap').style.display = 'block';
      document.getElementById('progress-label').innerText = 'Memeriksa status resi di sheet...';
      document.getElementById('awb-progress-bar').style.width = '5%';

      const tanggalInput = cdpSelectedDate || document.getElementById('filter-tanggal').value || new Date().toISOString().slice(0,10);
      const gudangDipilih = document.getElementById('filter-gudang').value || '';
      const msg = document.getElementById('awb-top-status');

      // ============================================================
      // LANGKAH 1: Cek sheet — ambil resi yang sudah jalan
      // ============================================================
      const sudahJalanSet = new Set();
      try {
        const dataSheet = await gasGetDirect({ action: 'loadTracking', tanggal: tanggalInput, ...(gudangDipilih ? {gudang: gudangDipilih} : {}) });
        if (dataSheet.success && dataSheet.rows) {
          dataSheet.rows.forEach(r => {
            const cat = kategorikanStatus(r.status, r.keterangan);
            if (cat === 'sudah_jalan') {
              sudahJalanSet.add(String(r.resi || '').trim().toUpperCase());
              // Masukkan ke allTrackedData supaya tetap tampil di tabel
              const existing = allTrackedData.findIndex(d => d.resi === r.resi);
              const obj = {
                resi: r.resi, gudang: r.gudang, kurir: r.kurir,
                tanggal: tanggalInput, status: r.status,
                keterangan: r.keterangan, tglInput: r.tglInput,
                tglDicatat: r.tglDicatat, category: 'sudah_jalan'
              };
              if (existing >= 0) allTrackedData[existing] = obj;
              else allTrackedData.push(obj);
            }
          });
        }
      } catch(e) {
        console.warn('Gagal cek sheet, lanjut tracking semua:', e.message);
      }

      // ============================================================
      // LANGKAH 2: Filter — skip yang sudah jalan
      // ============================================================
      const resiList = semuaResi.filter(r => !sudahJalanSet.has(r));
      const skipped  = semuaResi.length - resiList.length;

      if (skipped > 0) {
        msg.innerText = `⚡ ${skipped} resi sudah jalan — dilewati. Tracking ${resiList.length} resi.`;
        msg.style.color = '#dc2626';
      }

      if (resiList.length === 0) {
        document.getElementById('awb-progress-bar').style.width = '100%';
        document.getElementById('progress-label').innerText = 'Semua resi sudah jalan!';
        document.getElementById('btn-lacak-text').innerText = 'Lacak Sekarang';
        btn.disabled = false;
        hitungSummary(); renderResultsTable();
        showToast(`Semua ${skipped} resi sudah jalan — tidak ada yang perlu di-tracking.`, 'success');
        return;
      }

      // ============================================================
      // LANGKAH 3: Tracking resi yang perlu di-cek
      // ============================================================
      document.getElementById('btn-lacak-text').innerText = 'Sedang Melacak...';
      const totalResi = resiList.length;
      let processed = 0;

      ['cnt-sedang-cek','cnt-total','cnt-belum-cek','cnt-sudah-jalan','cnt-belum-jalan',
       'cnt-cancel','cnt-gagal-cek','cnt-sudah-jalan2','cnt-belum-jalan2','cnt-cancel2','cnt-gagal2'].forEach(id => {
        const el = document.getElementById(id); if (el) el.innerText = '0';
      });
      document.getElementById('cnt-total').innerText = semuaResi.length;

      const CHUNK_SIZE = 50;
      const chunks = [];
      for (let i = 0; i < resiList.length; i += CHUNK_SIZE) chunks.push(resiList.slice(i, i + CHUNK_SIZE));

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        document.getElementById('cnt-sedang-cek').innerText = chunk.length;
        document.getElementById('cnt-belum-cek').innerText  = totalResi - processed;
        document.getElementById('chunk-progress-text').innerText = `Chunk ${i+1}/${chunks.length} · ${processed}/${totalResi} resi`;
        document.getElementById('awb-progress-bar').style.width = `${Math.round((processed/totalResi)*100)}%`;
        document.getElementById('progress-label').innerText = `Melacak ${processed+1}–${Math.min(processed+chunk.length,totalResi)} dari ${totalResi} resi...`;

        try {
          const res = await fetch('/api/track-awb-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': sessionStorage.getItem('sessionToken') || '' },
            body: JSON.stringify({ batchResi: chunk })
          });
          const result = await res.json();
          (result.data || []).forEach(item => {
            if (!item) return;
            const cat = kategorikanStatus(item.status, item.note);
            const obj = {
              resi: item.resi, gudang: gudangDipilih,
              kurir: item.kurir || detectKurir(item.resi),
              tanggal: tanggalInput, status: item.status || '-',
              keterangan: item.note || '-',
              tglInput: item.tglInput || tanggalInput,
              tglDicatat: item.tglDicatat || '-', category: cat
            };
            const idx = allTrackedData.findIndex(d => d.resi === obj.resi);
            if (idx >= 0) allTrackedData[idx] = obj; else allTrackedData.push(obj);
          });
        } catch {
          chunk.forEach(r => {
            const obj = {
              resi: r, gudang: gudangDipilih, kurir: detectKurir(r),
              tanggal: tanggalInput, status: 'Error Koneksi',
              keterangan: 'Gagal menghubungi API',
              tglInput: tanggalInput, tglDicatat: '-', category: 'gagal'
            };
            const idx = allTrackedData.findIndex(d => d.resi === r);
            if (idx >= 0) allTrackedData[idx] = obj; else allTrackedData.push(obj);
          });
        }
        processed += chunk.length;
        hitungSummary(); renderResultsTable();
      }

      document.getElementById('awb-progress-bar').style.width = '100%';
      document.getElementById('chunk-progress-text').innerText = `Selesai · ${totalResi} resi di-tracking`;
      document.getElementById('progress-label').innerText = 'Tracking selesai — menyimpan ke sheet...';
      btn.disabled = false;
      document.getElementById('btn-lacak-text').innerText = 'Lacak Sekarang';

      // ============================================================
      // LANGKAH 4: Auto simpan ke sheet
      // ============================================================
      try {
        // auto-simpan — tidak perlu toggle disabled
        const token = sessionStorage.getItem('sessionToken');
        const resSave = await fetch('/api/sheet/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': token },
          body: JSON.stringify({ tanggal: tanggalInput, data: allTrackedData })
        });
        const resSaveJson = await resSave.json();
        if (resSaveJson.success) {
          document.getElementById('progress-label').innerText = '✅ Tracking selesai & tersimpan ke sheet!';
          msg.innerText = `✅ ${allTrackedData.length} data tersimpan ke Sheet.`;
          msg.style.color = '#16a34a';
          document.getElementById('btn-sync-wrap').style.display = 'none';
          showToast(`Tracking selesai! ${skipped > 0 ? skipped + ' resi dilewati (sudah jalan). ' : ''}Data tersimpan ke sheet.`, 'success');
        } else {
          document.getElementById('progress-label').innerText = 'Tracking selesai — gagal simpan otomatis.';
          msg.innerText = '⚠️ Tracking selesai tapi gagal simpan — klik Simpan ke Sheet manual.';
          msg.style.color = '#dc2626';
          document.getElementById('btn-sync-wrap').style.display = '';
        }
      } catch {
        document.getElementById('progress-label').innerText = 'Tracking selesai — gagal simpan otomatis.';
        msg.innerText = '⚠️ Tracking selesai tapi gagal simpan — klik Simpan ke Sheet manual.';
        msg.style.color = '#dc2626';
        document.getElementById('btn-sync-wrap').style.display = '';
      }
    }

    function renderResultsTable() {
      const tbody = document.getElementById('track-results-body');
      const searchVal = (document.getElementById('search-resi')?.value || '').toLowerCase();
      let filtered = allTrackedData.filter(item => {
        if (currentTableFilter !== 'semua' && item.category !== currentTableFilter) return false;
        if (searchVal && !item.resi.toLowerCase().includes(searchVal)) return false;
        return true;
      });
      // Sort
      if (sortState.col) {
        filtered = [...filtered].sort((a, b) => {
          const va = String(a[sortState.col] || '');
          const vb = String(b[sortState.col] || '');
          return sortState.dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        });
      }

      if (document.getElementById('table-count-label'))
        document.getElementById('table-count-label').innerText = `${filtered.length} data`;

      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:30px;">Tidak ada data untuk filter ini.</td></tr>`;
        return;
      }

      tbody.innerHTML = filtered.map((item, idx) => {
        let badge = `<span class="badge-jalan">${item.status}</span>`;
        if (item.category === 'belum_jalan') badge = `<span class="badge-belum">${item.status}</span>`;
        else if (item.category === 'cancel') badge = `<span class="badge-cancel">${item.status}</span>`;
        else if (item.category === 'gagal') badge = `<span class="badge-gagal">${item.status}</span>`;

        const kurirBadge = item.kurir ? `<span class="badge-kurir">${item.kurir}</span>` : '-';
        const batchBadge = item.batch ? `<span style="background:#ede9fe;color:#6d28d9;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:700;">${item.batch}</span>` : '-';

        return `<tr>
          <td style="color:#cbd5e1;font-size:11px;">${idx + 1}</td>
          <td>${badge}</td>
          <td style="font-family:monospace;font-weight:700;font-size:12px;">${item.resi}</td>
          <td>${kurirBadge}</td>
          <td style="font-size:11px;color:#64748b;">${item.gudang || '-'}</td>
          <td style="font-size:11px;color:#64748b;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${item.keterangan}">${item.keterangan || '-'}</td>
          <td style="font-size:11px;color:#94a3b8;">${item.tglInput || item.tanggal || '-'}</td>
          <td style="font-size:11px;color:#475569;font-weight:500;">${formatTglDisplay(item.tglDicatat) || '-'}</td>
          <td style="font-size:11px;text-align:center;">${batchBadge}</td>
        </tr>`;
      }).join('');
    }

    function filterResultRows() { renderResultsTable(); }


    // =============================================
    // DARK MODE
    // =============================================
    function toggleDarkMode() {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      document.getElementById('dark-icon').innerText = isDark ? 'light_mode' : 'dark_mode';
    }
    (function() {
      const saved = localStorage.getItem('theme');
      if (saved === 'dark') {
        document.documentElement.classList.add('dark');
        // Icon diset setelah DOM ready
        document.addEventListener('DOMContentLoaded', function() {
          const el = document.getElementById('dark-icon');
          if (el) el.innerText = 'light_mode';
        });
      }
    })();

    // =============================================
    // TOAST NOTIFICATION
    // =============================================
    function showToast(msg, type = 'info', duration = 3500) {
      const container = document.getElementById('toast-container');
      if (!container) return;
      const iconMap = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
      const id = 'toast-' + Date.now();
      const el = document.createElement('div');
      el.className = `toast toast-${type}`;
      el.id = id;
      el.innerHTML = `
        <span class="material-symbols-outlined t-icon">${iconMap[type] || 'info'}</span>
        <span class="t-msg">${msg}</span>
        <button class="t-close" onclick="dismissToast('${id}')">&times;</button>
      `;
      container.appendChild(el);
      setTimeout(() => dismissToast(id), duration);
    }
    function dismissToast(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => el.remove(), 300);
    }

    // =============================================
    // KONFIRMASI DIALOG
    // =============================================
    let confirmResolve = null;
    function showConfirm(title, msg, btnLabel = 'Ya, Lanjutkan') {
      return new Promise(resolve => {
        document.getElementById('confirm-title').innerText = title;
        document.getElementById('confirm-msg').innerText = msg;
        document.getElementById('confirm-btn-ok').innerText = btnLabel;
        document.getElementById('confirm-overlay').classList.add('show');
        confirmResolve = (val) => {
          document.getElementById('confirm-overlay').classList.remove('show');
          resolve(val);
        };
      });
    }
    async function konfirmasiSimpan() {
      const total = document.getElementById('cnt-total')?.innerText || '0';
      const ok = await showConfirm(
        'Simpan ke Sheet',
        `Anda akan menyimpan ${total} resi ke Google Sheet. Data yang sudah ada akan ditimpa. Lanjutkan?`,
        'Ya, Simpan'
      );
      if (ok) syncToSheet();
    }

    // =============================================
    // SORT TABEL
    // =============================================
    let sortState = { col: null, dir: 'asc' };
    function sortTable(col, thEl) {
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.col = col; sortState.dir = 'asc';
      }
      // Reset semua sort icon
      document.querySelectorAll('.awb-tbl thead th').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
      });
      thEl.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
      renderResultsTable();
    }

    // =============================================
    // SEPARATOR RIBUAN untuk angka di tabel
    // =============================================
    function formatNumber(n) {
      if (n === null || n === undefined || n === '') return '-';
      return Number(n).toLocaleString('id-ID');
    }

    // =============================================
    // GUDANG INSIGHT
    // =============================================
    let insType      = 'outbound';
    let insSlideIdx  = 0;
    let insData      = [];
    let insSudahInit = false;
    const INS_IMG_BASE = 'https://pdcgudang.et.r.appspot.com/v1/assets/get';

    function initInsightPage() {
      if (insSudahInit) return;
      insSudahInit = true;
      insPreset('bulan', document.querySelector('.ins-preset-btn.aktif'));
      insLoad();
    }

    function insSetType(type, el) {
      insType = type;
      document.querySelectorAll('.ins-type-btn').forEach(b => b.classList.remove('aktif'));
      el.classList.add('aktif');
    }

    function insPreset(preset, el) {
      document.querySelectorAll('.ins-preset-btn').forEach(b => b.classList.remove('aktif'));
      if (el) el.classList.add('aktif');
      const today = new Date();
      const fmt   = d => d.toISOString().slice(0,10);
      const from  = new Date(today);
      if (preset === 'hari')   { /* same day */ }
      if (preset === '3hari')  from.setDate(today.getDate() - 2);
      if (preset === 'minggu') from.setDate(today.getDate() - 6);
      if (preset === 'bulan')  from.setMonth(today.getMonth() - 1);
      if (preset === '3bulan') from.setMonth(today.getMonth() - 3);
      document.getElementById('ins-from').value = fmt(from);
      document.getElementById('ins-to').value   = fmt(today);
    }

    async function insLoad() {
      const from = document.getElementById('ins-from').value;
      const to   = document.getElementById('ins-to').value;
      if (!from || !to) return showToast('Pilih rentang tanggal dulu.', 'warning');

      const btn = document.getElementById('ins-apply-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;animation:spin 1s linear infinite;">sync</span> Memuat...';
      document.getElementById('ins-container').innerHTML =
        '<div class="ins-empty"><span class="material-symbols-outlined" style="animation:spin 1s linear infinite;font-size:48px;">sync</span><p style="font-size:13px;font-weight:600;color:#64748b;margin-top:10px;">Mengambil data dari PDC...</p></div>';

      try {
        const token = sessionStorage.getItem('sessionToken');
        const res   = await fetch(`/api/insight?type=${insType}&date_from=${from}&date_to=${to}`, {
          headers: { 'x-session-token': token }
        });
        const data  = await res.json();
        if (!data.success) {
          document.getElementById('ins-container').innerHTML =
            `<div class="ins-empty"><span class="material-symbols-outlined" style="color:#e11d48;">error</span><p style="font-size:13px;color:#e11d48;">${data.message||'Gagal.'}</p></div>`;
          return;
        }
        insData     = data.warehouses || [];
        insSlideIdx = 0;
        insRenderAll();
      } catch(e) {
        document.getElementById('ins-container').innerHTML =
          '<div class="ins-empty"><span class="material-symbols-outlined">wifi_off</span><p style="font-size:13px;color:#e11d48;">Gagal terhubung ke server.</p></div>';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">refresh</span> Terapkan';
      }
    }

    function insNav(arah) {
      insSlideIdx = Math.max(0, Math.min(insData.length - 1, insSlideIdx + arah));
      insRenderAll();
    }

    function insSlideGo(i) { insSlideIdx = i; insRenderAll(); }

    function insRenderAll() {
      if (!insData.length) return;
      // Dots + label
      const dots = document.getElementById('ins-dots');
      dots.innerHTML = insData.map((w, i) =>
        `<div class="ins-dot${i===insSlideIdx?' aktif':''}" onclick="insSlideGo(${i})"></div>`
      ).join('');
      document.getElementById('ins-slide-lbl').textContent =
        `${insData[insSlideIdx].name} (${insSlideIdx+1}/${insData.length})`;
      document.getElementById('ins-prev').disabled = insSlideIdx === 0;
      document.getElementById('ins-next').disabled = insSlideIdx === insData.length - 1;
      // Render konten
      document.getElementById('ins-container').innerHTML = insBuildSlide(insData[insSlideIdx]);
    }

    function insBuildSlide(wh) {
      const ov = wh.overview || {};
      const bs = Array.isArray(wh.byStatus) ? wh.byStatus : [];
      const dy = Array.isArray(wh.daily)    ? wh.daily    : [];
      const mu = Array.isArray(wh.mostUsed) ? wh.mostUsed : [];
      const from = document.getElementById('ins-from').value;
      const to   = document.getElementById('ins-to').value;
      const typeLabel = insType === 'outbound' ? 'Outbound' : 'Inbound';

      // Ambil raw array dari overview (berisi breakdown per status)
      const raw = Array.isArray(ov.raw) ? ov.raw : [];
      const cancelTrx = raw.find(s => s.status === 'cancel')?.transaction_count || 0;
      const cancelPcs = raw.find(s => s.status === 'cancel')?.item_count || 0;

      let h = `
        <!-- Gudang header -->
        <div class="ins-wh-hdr">
          <div class="ins-wh-icon"><span class="material-symbols-outlined">warehouse</span></div>
          <div>
            <div class="ins-wh-name">${wh.name}</div>
            <div class="ins-wh-sub">${from} — ${to} · ${typeLabel}</div>
          </div>
        </div>

        <!-- Stats utama -->
        <div class="ins-stats">
          <div class="ins-stat trx">
            <div class="ins-stat-n">${Number(ov.total_trx||0).toLocaleString('id-ID')}</div>
            <div class="ins-stat-l">Total Transaksi</div>
          </div>
          <div class="ins-stat pcs">
            <div class="ins-stat-n">${Number(ov.total_pcs||0).toLocaleString('id-ID')}</div>
            <div class="ins-stat-l">Total Pieces</div>
          </div>
          <div class="ins-stat batal">
            <div class="ins-stat-n">${Number(cancelTrx).toLocaleString('id-ID')}</div>
            <div class="ins-stat-l">Batal (${Number(cancelPcs).toLocaleString('id-ID')} pcs)</div>
          </div>
        </div>`;

      // Status breakdown dari overview.raw
      // Status config — mirip web PDC dengan warna header
      const stConfig = {
        waiting          : { lbl:'Menunggu Diproses', bg:'#64748b', text:'#fff' },
        picking          : { lbl:'Sedang Diambil',    bg:'#06b6d4', text:'#fff' },
        picked           : { lbl:'Siap Dikemas',      bg:'#3b82f6', text:'#fff' },
        packing          : { lbl:'Sedang Dikemas',    bg:'#8b5cf6', text:'#fff' },
        packing_completed: { lbl:'Selesai Dikemas',   bg:'#10b981', text:'#fff' },
        completed        : { lbl:'Diserahkan Kurir',  bg:'#0ea5e9', text:'#fff' },
        cancel           : { lbl:'Transaksi Batal',   bg:'#6b7280', text:'#fff' }
      };
      const sourceData = raw.length ? raw : bs;
      if (sourceData.length) {
        h += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">`;
        sourceData.forEach(s => {
          const cfg = stConfig[s.status] || { lbl:s.status, bg:'#94a3b8', text:'#fff' };
          const trx = Number(s.transaction_count||0);
          const pcs = Number(s.item_count||0);
          h += `<div style="flex:1;min-width:100px;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
            <div style="background:${cfg.bg};color:${cfg.text};padding:6px 10px;font-size:10px;font-weight:700;text-align:center;">
              ${cfg.lbl}
            </div>
            <div style="background:#fff;padding:10px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;text-align:center;">
              <div style="font-size:18px;font-weight:800;color:#1e293b;">${trx.toLocaleString('id-ID')}</div>
              <div style="font-size:10px;color:#64748b;margin-top:1px;">Transaksi</div>
              <div style="font-size:11px;font-weight:700;color:#0284c7;margin-top:3px;">${pcs.toLocaleString('id-ID')} pcs</div>
            </div>
          </div>`;
        });
        h += `</div>`;
      }

      // Chart traffic harian — 7 hari patok Sen-Min
      {
        const HARI  = ["Senin","Selasa","Rabu","Kamis","Jum'at","Sabtu","Minggu"];
        const SHORT = ['Sen','Sel','Rab','Kam','Jum','Sab','Min'];
        const dyMap = {};
        (dy||[]).forEach(d => { if (d.day) dyMap[d.day] = Number(d.transaction_count||0); });
        const cd    = HARI.map((nm,i) => ({ lbl: SHORT[i], full: nm, val: dyMap[nm]||0 }));
        const mx    = Math.max(...cd.map(d => d.val), 1);
        const tot   = cd.reduce((s,d) => s + d.val, 0);
        h += `<div class="ins-chart">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div class="ins-chart-title" style="margin-bottom:0;">📊 Traffic Harian</div>
            <div style="font-size:11px;color:#94a3b8;">Total <b style="color:#1e293b;">${tot.toLocaleString('id-ID')}</b> trx</div>
          </div>
          <div style="display:flex;gap:6px;align-items:flex-end;height:130px;">`;
        cd.forEach(d => {
          const h_px = d.val > 0 ? Math.max(4, Math.round((d.val/mx)*115)) : 4;
          const isMax = d.val === mx && d.val > 0;
          h += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;">
            <div style="font-size:10px;font-weight:700;color:${isMax?'#8a6d1f':'#94a3b8'};">${d.val>0?d.val.toLocaleString('id-ID'):''}</div>
            <div style="height:${h_px}px;width:100%;border-radius:4px 4px 0 0;
              background:${d.val===0?'#f1f5f9':isMax?'#64748b':'#475569'};min-height:4px;"
              title="${d.full}: ${d.val.toLocaleString('id-ID')} trx"></div>
            <div style="font-size:10px;font-weight:600;color:${d.val>0?'#475569':'#cbd5e1'};">${d.lbl}</div>
          </div>`;
        });
        h += `</div></div>`;
      }

      // Tabel per Tim
      const bt = Array.isArray(wh.byTeam) ? wh.byTeam : [];
      if (bt.length) {
        h += `<div class="ins-toprod" style="margin-bottom:12px;">
          <div class="ins-toprod-title">👥 Data Per Tim</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:700;font-size:10px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">No</th>
                  <th style="padding:8px 12px;text-align:left;color:#64748b;font-weight:700;font-size:10px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Tim</th>
                  <th style="padding:8px 12px;text-align:right;color:#64748b;font-weight:700;font-size:10px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Transaksi</th>
                  <th style="padding:8px 12px;text-align:right;color:#64748b;font-weight:700;font-size:10px;text-transform:uppercase;border-bottom:1px solid #e2e8f0;">Total Pcs</th>
                </tr>
              </thead>
              <tbody>
                ${bt.slice(0,10).map((t,i) => `
                  <tr style="border-bottom:1px solid #f8fafc;transition:background .1s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                    <td style="padding:8px 12px;color:#94a3b8;font-size:11px;">${i+1}</td>
                    <td style="padding:8px 12px;font-weight:600;color:#1e293b;">${t.team_name || t.name || t.team || t.label || ('Tim ' + (t.team_id||t.id||''))}</td>
                    <td style="padding:8px 12px;text-align:right;font-weight:700;color:#0284c7;">${Number(t.transaction_count||0).toLocaleString('id-ID')}</td>
                    <td style="padding:8px 12px;text-align:right;font-weight:700;color:#16a34a;">${Number(t.item_count||0).toLocaleString('id-ID')}</td>
                  </tr>
                `).join('')}
              </tbody>
              <tfoot>
                <tr style="background:#f8fafc;border-top:2px solid #e2e8f0;">
                  <td colspan="2" style="padding:8px 12px;font-weight:700;color:#1e293b;font-size:11px;">TOTAL</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:800;color:#0284c7;">${bt.slice(0,10).reduce((s,t)=>s+Number(t.transaction_count||0),0).toLocaleString('id-ID')}</td>
                  <td style="padding:8px 12px;text-align:right;font-weight:800;color:#16a34a;">${bt.slice(0,10).reduce((s,t)=>s+Number(t.item_count||0),0).toLocaleString('id-ID')}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>`;
      }

      // Top produk
      if (mu.length) {
        const ranks = ['r1','r2','r3','',''];
        h += `<div class="ins-toprod"><div class="ins-toprod-title">🏆 Produk Terlaris</div>`;
        mu.slice(0,5).forEach((p,i) => {
          const img = p.item_image_id
            ? `<img class="ins-prod-img" src="${INS_IMG_BASE}?id=${encodeURIComponent(p.item_image_id)}&thumbnail=true" onerror="this.style.display='none'">`
            : '<div class="ins-prod-img"></div>';
          h += `<div class="ins-prod-row">
            <div class="ins-rank ${ranks[i]||''}">${i+1}</div>
            ${img}
            <div class="ins-prod-nm">${p.item_name||p.name||'—'}</div>
            <div class="ins-prod-qty">${Number(p.item_count||p.quantity||0).toLocaleString('id-ID')} pcs</div>
          </div>`;
        });
        h += `</div>`;
      }
      return h;
    }

    // =============================================
    // STATISTIK TEAM — PDC Selling
    // =============================================
    let tsInit = false;

    function initTeamStatPage() {
      if (tsInit) { tsLoad(true); return; }   // buka ulang: tampil dari data terakhir, cek perubahan diam-diam
      tsInit = true;
      tsPreset('sebulan', document.querySelector('#page-statistik-team .ins-preset-btn.aktif'), true);
      tsLoad();
    }

    // Tanggal dihitung dalam WIB (dulu pakai UTC, sehingga sebelum jam 07.00 "Hari Ini" jadi kemarin)
    function tsPreset(preset, el, tanpaMuat) {
      document.querySelectorAll('#page-statistik-team .ins-preset-btn').forEach(b => b.classList.remove('aktif'));
      if (el) el.classList.add('aktif');
      const hari = n => new Date(Date.now() + 7 * 3600 * 1000 - n * 86400000);
      const fmt  = d => d.toISOString().slice(0, 10);
      const to = hari(preset === 'kemarin' ? 1 : 0);
      const from = new Date(to);
      if (preset === 'seminggu') from.setUTCDate(from.getUTCDate() - 6);
      else if (preset === 'sebulan') from.setUTCMonth(from.getUTCMonth() - 1);
      else if (preset === '3bulan') from.setUTCMonth(from.getUTCMonth() - 3);
      else if (preset === '6bulan') from.setUTCMonth(from.getUTCMonth() - 6);
      else if (preset === 'setahun') from.setUTCFullYear(from.getUTCFullYear() - 1);
      document.getElementById('ts-from').value = fmt(from);
      document.getElementById('ts-to').value   = fmt(to);
      if (!tanpaMuat) tsLoad();   // pilih preset langsung memuat, tidak perlu klik Terapkan
    }

    // Cache perangkat: data terakhir per periode tampil instan, lalu diperbarui di belakang layar
    const TS_CACHE = 'ts_cache_v1';
    function tsCacheBaca(kunci) { try { return (JSON.parse(localStorage.getItem(TS_CACHE) || '{}'))[kunci] || null; } catch (e) { return null; } }
    function tsCacheTulis(kunci, teams) {
      try {
        const c = JSON.parse(localStorage.getItem(TS_CACHE) || '{}');
        delete c[kunci]; c[kunci] = teams;
        const k = Object.keys(c); if (k.length > 6) k.slice(0, k.length - 6).forEach(x => delete c[x]);
        localStorage.setItem(TS_CACHE, JSON.stringify(c));
      } catch (e) { try { localStorage.removeItem(TS_CACHE); } catch (x) {} }
    }
    let tsMuatKe = 0;
    async function tsLoad(diam) {
      const from = document.getElementById('ts-from').value;
      const to   = document.getElementById('ts-to').value;
      if (!from || !to) return showToast('Pilih rentang tanggal dulu.', 'warning');
      const kunci = from + '|' + to, ke = ++tsMuatKe;
      const simpanan = tsCacheBaca(kunci);
      const btn = document.getElementById('ts-apply-btn');
      const putar = on => {
        btn.disabled = on;
        btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:15px;${on ? 'animation:spin 1s linear infinite;' : ''}">${on ? 'sync' : 'refresh'}</span> ${on ? 'Memuat...' : 'Terapkan'}`;
      };
      if (simpanan) { if (!diam || tsData.from !== from || tsData.to !== to) tsRender(simpanan, from, to); }
      else {
        document.getElementById('ts-container').innerHTML =
          '<div class="ins-empty"><span class="material-symbols-outlined" style="animation:spin 1s linear infinite;font-size:48px;">sync</span><p style="font-size:13px;font-weight:600;color:#64748b;margin-top:10px;">Mengambil data dari PDC Selling...</p></div>';
      }
      putar(true);
      try {
        const res  = await fetch(`/api/selling/team-stat?date_from=${from}&date_to=${to}`, { headers: { 'x-session-token': sessionStorage.getItem('sessionToken') || '' } });
        const data = await res.json();
        if (ke !== tsMuatKe) return;
        if (!data.success) {
          if (!simpanan) document.getElementById('ts-container').innerHTML =
            `<div class="ins-empty"><span class="material-symbols-outlined" style="color:#b91c1c;">error</span><p style="font-size:13px;color:#b91c1c;margin-top:8px;">${data.message || 'Gagal mengambil data.'}</p></div>`;
          return;
        }
        const teams = data.teams || [];
        tsCacheTulis(kunci, teams);
        if (!simpanan || JSON.stringify(simpanan) !== JSON.stringify(teams) || tsData.from !== from || tsData.to !== to) tsRender(teams, from, to);
      } catch (e) {
        if (ke === tsMuatKe && !simpanan) document.getElementById('ts-container').innerHTML =
          '<div class="ins-empty"><span class="material-symbols-outlined">wifi_off</span><p style="font-size:13px;color:#b91c1c;margin-top:8px;">Gagal terhubung ke server.</p></div>';
      } finally {
        if (ke === tsMuatKe) putar(false);
      }
    }

    // Tampilan meniru tabel Team di web PDC Selling + baris ringkasan total di atas
    let tsData = { teams: [], from: '', to: '' }, tsUrut = { kolom: 'transaksi', turun: true }, tsCari = '';
    function tsRender(teams, from, to) {
      if (!teams.length) {
        document.getElementById('ts-container').innerHTML =
          '<div class="ins-empty"><span class="material-symbols-outlined">search_off</span><p style="font-size:13px;color:#64748b;margin-top:8px;">Tidak ada data untuk periode ini.</p></div>';
        return;
      }
      // Cadangan nama team di perangkat: kalau server sesekali gagal ambil nama, pakai nama terakhir yang pernah ketemu
      let petaTim = {};
      try { petaTim = JSON.parse(localStorage.getItem('ts_nama_tim_v1') || '{}') || {}; } catch (e) {}
      teams.forEach(t => {
        const asli = t.team_name && !/^ID \d+$/.test(t.team_name);
        if (asli) petaTim[t.team_id] = t.team_name;
        else if (petaTim[t.team_id]) t.team_name = petaTim[t.team_id];
      });
      try { localStorage.setItem('ts_nama_tim_v1', JSON.stringify(petaTim)); } catch (e) {}
      tsData = { teams, from, to };
      tsGambar();
    }
    let tsCariTimer = null;
    function tsCariKetik(v) {
      tsCari = v;
      clearTimeout(tsCariTimer);
      tsCariTimer = setTimeout(() => {
        tsGambar();
        const el = document.getElementById('ts-cari');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      }, 200);
    }
    function tsEksporCsv() {
      if (!tsData.teams.length) return;
      const k = tsUrut.kolom, arah = tsUrut.turun ? -1 : 1;
      const cari = tsCari.trim().toLowerCase();
      const baris = tsData.teams.slice().sort((a, b) => ((a[k] || 0) - (b[k] || 0)) * arah || (b.transaksi - a.transaksi))
        .filter(t => !cari || String(t.team_name || t.team_id).toLowerCase().includes(cari));
      const jam = ms => { if (!ms) return ''; const d = new Date(ms + 7 * 3600 * 1000); return d.toISOString().slice(0, 16).replace('T', ' '); };
      const esc = v => /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
      const isi = [['Team', 'Transaksi', 'Nilai Belanja', 'Nilai Transaksi', 'Terakhir Dibuat (WIB)']]
        .concat(baris.map(t => [t.team_name || ('ID ' + t.team_id), t.transaksi || 0, Math.round(t.nilai_belanja || 0), Math.round(t.nilai_transaksi || 0), jam(t.terakhir)]))
        .map(r => r.map(esc).join(';')).join('\r\n');
      const blob = new Blob(['\ufeff' + isi], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `statistik-team_${tsData.from}_sd_${tsData.to}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    function tsUrutkan(kolom) {
      tsUrut = { kolom, turun: tsUrut.kolom === kolom ? !tsUrut.turun : true };
      tsGambar();
    }
    function tsGambar() {
      const { from, to } = tsData;
      const k = tsUrut.kolom, arah = tsUrut.turun ? -1 : 1;
      const cari = tsCari.trim().toLowerCase();
      const semua = tsData.teams.slice().sort((a, b) => ((a[k] || 0) - (b[k] || 0)) * arah || (b.transaksi - a.transaksi));
      const teams = cari ? semua.filter(t => String(t.team_name || t.team_id).toLowerCase().includes(cari)) : semua;
      const totTrx = teams.reduce((s, t) => s + (t.transaksi || 0), 0);
      const totBel = teams.reduce((s, t) => s + (t.nilai_belanja || 0), 0);
      const totNil = teams.reduce((s, t) => s + (t.nilai_transaksi || 0), 0);
      const rp = n => 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
      const BLN = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agt','Sep','Okt','Nov','Des'];
      const tgl = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return `${parseInt(d)} ${BLN[parseInt(m) - 1]} ${y}`; };
      const jam = ms => {
        if (!ms) return '—';
        const d = new Date(ms + 7 * 3600 * 1000), p = n => String(n).padStart(2, '0');
        return `${d.getUTCDate()} ${BLN[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
      };
      const th = (kunci, label) => `<th class="${k === kunci ? 'urut' : ''}" onclick="tsUrutkan('${kunci}')">${label}${k === kunci ? (tsUrut.turun ? ' ↓' : ' ↑') : ''}</th>`;
      const periode = from === to ? tgl(from) : `${tgl(from)} – ${tgl(to)}`;

      document.getElementById('ts-container').innerHTML = `
        <div class="ts-ringkas">
          <div><span>Total Transaksi</span><b>${totTrx.toLocaleString('id-ID')}</b></div>
          <div><span>Nilai Belanja</span><b>${rp(totBel)}</b></div>
          <div><span>Nilai Transaksi</span><b>${rp(totNil)}</b></div>
          <div><span>Team</span><b>${teams.length}</b></div>
          <em>${periode}${cari ? ' · hasil pencarian' : ''}</em>
        </div>
        <div class="ts-alat">
          <label class="ts-cari"><span class="material-symbols-outlined">search</span>
            <input id="ts-cari" type="search" placeholder="Cari team…" value="${tsCari.replace(/"/g, '&quot;')}" oninput="tsCariKetik(this.value)"></label>
          <button class="ts-ekspor" onclick="tsEksporCsv()"><span class="material-symbols-outlined">download</span> Ekspor CSV</button>
        </div>
        <div class="ts-wrap"><table class="ts-tabel">
          <thead>
            <tr><th rowspan="2" class="ts-team">Team</th><th colspan="4" class="ts-grup">Order Dibuat</th></tr>
            <tr>${th('transaksi', 'Transaksi')}${th('nilai_belanja', 'Nilai Belanja')}${th('nilai_transaksi', 'Nilai Transaksi')}${th('terakhir', 'Terakhir Dibuat')}</tr>
          </thead>
          <tbody>${teams.length ? '' : '<tr><td colspan="5" class="ts-kosong">Team tidak ditemukan</td></tr>'}${teams.map(t => `<tr>
              <td class="ts-team"><b>${String(t.team_name || ('ID ' + (t.team_id || ''))).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))}</b><span class="ts-badge">Selling</span></td>
              <td class="${k === 'transaksi' ? 'urut' : ''}">${(t.transaksi || 0).toLocaleString('id-ID')}</td>
              <td class="${k === 'nilai_belanja' ? 'urut' : ''}">${rp(t.nilai_belanja)}</td>
              <td class="${k === 'nilai_transaksi' ? 'urut' : ''}">${rp(t.nilai_transaksi)}</td>
              <td class="${k === 'terakhir' ? 'urut' : ''}">${jam(t.terakhir)}</td>
            </tr>`).join('')}</tbody>
          <tfoot><tr><td class="ts-team">Total</td><td>${totTrx.toLocaleString('id-ID')}</td><td>${rp(totBel)}</td><td>${rp(totNil)}</td><td></td></tr></tfoot>
        </table></div>`;
    }

    document.addEventListener('DOMContentLoaded', checkAuthStatus);

    /* ---- MOBILE SIDEBAR TOGGLE ---- */
    function toggleSidebar() {
      const sidebar = document.querySelector('.sidebar');
      const overlay = document.getElementById('sidebar-overlay');
      const isOpen = sidebar.classList.contains('open');
      if (isOpen) { closeSidebar(); } else { openSidebar(); }
    }

    function openSidebar() {
      document.querySelector('.sidebar').classList.add('open');
      const bd = document.getElementById('sidebar-backdrop');
      if (bd) bd.classList.add('show');
      // sidebar-overlay lama (jika masih ada)
      const ov = document.getElementById('sidebar-overlay');
      if (ov) ov.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
      document.querySelector('.sidebar').classList.remove('open');
      const bd = document.getElementById('sidebar-backdrop');
      if (bd) bd.classList.remove('show');
      const ov = document.getElementById('sidebar-overlay');
      if (ov) ov.classList.remove('active');
      document.body.style.overflow = '';
    }

    /* Tutup sidebar otomatis saat nav item diklik di mobile */
    document.addEventListener('DOMContentLoaded', function() {
      document.querySelectorAll('.nav-item').forEach(function(item) {
        if (item.classList.contains('nav-group-toggle')) return;   // buka/tutup grup, sidebar tetap terbuka
        item.addEventListener('click', function() {
          if (window.innerWidth <= 768) { closeSidebar(); }
        });
      });
    });

        // =============================================
    // MODUL PUSAT INVENTORY — CARD VIEW
    // =============================================
    const SO_ASSET_BASE = 'https://pdcgudang.et.r.appspot.com/v1/assets/get';
    const SO_PER_HALAMAN = 60;

    let soSemuaData   = [];
    let soDataFilter  = [];
    let soHalamanAkt  = 1;
    let soStatusAkt   = 'Semua';
    let soSesiAktif   = '';
    let soSudahInit   = false;
    let soPersonilList  = [];
    let soPersonilAktif = '';
    let soPersonilIdx   = -1;
    let piViewMode    = 'grid'; // 'grid' | 'list'

    function piSetView(mode) {
      piViewMode = mode;
      document.getElementById('pi-btn-grid').classList.toggle('aktif', mode === 'grid');
      document.getElementById('pi-btn-list').classList.toggle('aktif', mode === 'list');
      soRenderTabel();
    }

    function piSetStatus(status, el) {
      soStatusAkt  = status;
      soHalamanAkt = 1;
      document.querySelectorAll('#page-pusat-inventory .pi-chip').forEach(c => c.className = 'pi-chip');
      el.classList.add('aktif-' + status);
      soFilter();
    }

    function soNormStatus(s) {
      const v = String(s||'').trim();
      const map = { 'Cocok':'Balance', 'Kurang':'Minus', 'Lebih':'Plus' };
      return map[v] || v;
    }

    // ---- AUTOCOMPLETE PERSONIL ----
    function soPersonilInput() {
      const q  = (document.getElementById('so-personil-input').value || '').toLowerCase().trim();
      const dd = document.getElementById('so-personil-dropdown');
      soPersonilIdx = -1;
      if (!q) {
        soPersonilAktif = '';
        document.getElementById('so-personil-input').style.borderColor = '';
        dd.style.display = 'none';
        soFilter(); return;
      }
      const hits = soPersonilList.filter(n => n.toLowerCase().includes(q));
      if (!hits.length) { dd.style.display = 'none'; return; }
      dd.innerHTML = hits.map((nama, i) => {
        const idxH = nama.toLowerCase().indexOf(q);
        const hl   = idxH >= 0 ? nama.slice(0,idxH)+'<b style="color:#8a6d1f;">'+nama.slice(idxH,idxH+q.length)+'</b>'+nama.slice(idxH+q.length) : nama;
        return `<div class="so-personil-item" data-nama="${nama}" data-idx="${i}"
          style="padding:8px 13px;cursor:pointer;font-size:13px;color:#334155;border-bottom:1px solid #f8fafc;transition:background .1s;"
          onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background=''"
          onclick="soPersonilPilih('${nama.replace(/'/g,"\'")}')">
          ${hl}</div>`;
      }).join('');
      dd.style.display = '';
      setTimeout(() => document.addEventListener('click', soPersonilTutupDd, { once: true }), 0);
    }
    function soPersonilKeydown(e) {
      const dd = document.getElementById('so-personil-dropdown');
      const items = dd.querySelectorAll('.so-personil-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); soPersonilIdx = Math.min(soPersonilIdx+1, items.length-1); soPersonilHighlight(items); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); soPersonilIdx = Math.max(soPersonilIdx-1, 0); soPersonilHighlight(items); }
      else if (e.key === 'Enter') { e.preventDefault(); if (soPersonilIdx >= 0 && items[soPersonilIdx]) soPersonilPilih(items[soPersonilIdx].dataset.nama); }
      else if (e.key === 'Escape') soPersonilTutupDd();
    }
    function soPersonilHighlight(items) {
      items.forEach((el, i) => { el.style.background = i===soPersonilIdx?'#faf6ec':''; el.style.color = i===soPersonilIdx?'#8a6d1f':'#334155'; });
      if (items[soPersonilIdx]) items[soPersonilIdx].scrollIntoView({ block:'nearest' });
    }
    function soPersonilPilih(nama) {
      soPersonilAktif = nama;
      const input = document.getElementById('so-personil-input');
      input.value = nama; input.style.borderColor = '#475569';
      document.getElementById('so-personil-dropdown').style.display = 'none';
      soFilter();
    }
    function soPersonilTutupDd(e) {
      const wrap = document.getElementById('so-personil-wrap');
      if (e && wrap && wrap.contains(e.target)) return;
      document.getElementById('so-personil-dropdown').style.display = 'none';
    }

    // Cache perangkat Opname Sheet: tampil instan dari data terakhir, diperbarui di belakang layar
    const SO_CACHE = 'so_cache_v1';
    function soCacheBaca() { try { return JSON.parse(localStorage.getItem(SO_CACHE) || '{}'); } catch (e) { return {}; } }
    function soCacheTulis(ubah) {
      try {
        const c = Object.assign(soCacheBaca(), ubah);
        const kunci = Object.keys(c.data || {});
        if (kunci.length > 2) kunci.slice(0, kunci.length - 2).forEach(k => delete c.data[k]);   // simpan 2 sesi terakhir
        localStorage.setItem(SO_CACHE, JSON.stringify(c));
      } catch (e) { try { localStorage.removeItem(SO_CACHE); } catch (x) {} }
    }
    async function soAmbil(params) {
      const url = new URL(GAS_URL);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      return (await fetch(url.toString())).json();
    }

    async function initSoPage() {
      if (soSudahInit) { if (soSesiAktif) soGantiSesi(true); return; }   // buka ulang: cek perubahan diam-diam
      soSudahInit = true;
      await soMuatDaftarSesi();
    }

    function soIsiDaftarSesi(daftar) {
      const sel = document.getElementById('so-sesi-select');
      const bMap = {1:'Januari',2:'Februari',3:'Maret',4:'April',5:'Mei',6:'Juni',7:'Juli',8:'Agustus',9:'September',10:'Oktober',11:'November',12:'Desember'};
      const pilih = sel.value;
      sel.innerHTML = '<option value="">— Pilih Bulan SO —</option>';
      daftar.forEach(s => {
        const o = document.createElement('option');
        o.value = s.nama; o.textContent = `${bMap[s.bulan]||s.bulan} ${s.tahun}`;
        sel.appendChild(o);
      });
      sel.disabled = false;
      if (pilih && daftar.some(s => s.nama === pilih)) sel.value = pilih;
    }

    async function soMuatDaftarSesi() {
      const sel = document.getElementById('so-sesi-select');
      const cache = soCacheBaca();
      if (cache.sesi && cache.sesi.length) {
        soIsiDaftarSesi(cache.sesi);
        sel.value = cache.sesi[0].nama; soGantiSesi();
      } else {
        sel.innerHTML = '<option value="">Memuat daftar sesi...</option>';
        sel.disabled = true;
      }
      try {
        const data = await soAmbil({ action: 'soListSesi' });
        if (!data.success || !data.data || !data.data.length) {
          if (!cache.sesi) sel.innerHTML = '<option value="">Tidak ada data SO</option>';
          return;
        }
        soCacheTulis({ sesi: data.data });
        const lamaPertama = cache.sesi && cache.sesi[0] && cache.sesi[0].nama;
        soIsiDaftarSesi(data.data);
        if (!lamaPertama) { sel.value = data.data[0].nama; soGantiSesi(); }
        else if (lamaPertama !== data.data[0].nama && soSesiAktif === lamaPertama) { sel.value = data.data[0].nama; soGantiSesi(); }
      } catch(err) {
        if (!cache.sesi) sel.innerHTML = '<option value="">Gagal memuat daftar sesi</option>';
      }
    }

    function soTerapkanData(rows) {
      soSemuaData = rows || [];
      soPersonilList = [];
      const seen = {};
      soSemuaData.forEach(r => {
        const raw = String(r.personil || '').trim();
        if (!raw) return;
        const key = raw.toLowerCase();
        if (!seen[key]) { seen[key] = true; soPersonilList.push(raw); }
      });
      soPersonilList.sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      opIsiTim('so-tim', soSemuaData);
      soHitungStats();
      soFilter();
    }

    let soMuatKe = 0;
    async function soGantiSesi(diam) {
      const sesi = diam ? soSesiAktif : document.getElementById('so-sesi-select').value;
      if (!sesi) return;
      const ke = ++soMuatKe;
      const simpanan = ((soCacheBaca().data) || {})[sesi];
      if (!diam) {
        soSesiAktif     = sesi;
        soSemuaData     = [];
        soDataFilter    = [];
        soHalamanAkt    = 1;
        soStatusAkt     = 'Semua';
        soPersonilAktif = '';
        document.querySelectorAll('#page-pusat-inventory .pi-chip').forEach(c => c.className = 'pi-chip');
        document.getElementById('pi-chip-Semua').classList.add('aktif-Semua');
        document.getElementById('so-cari').value = '';
        document.getElementById('so-rak-filter').value = '';
        document.getElementById('so-tim').value = '';
        document.getElementById('so-personil').value = '';
        document.getElementById('so-personil-input').value = '';
        document.getElementById('so-personil-input').style.borderColor = '';
        document.getElementById('so-personil-dropdown').style.display = 'none';
        if (simpanan) soTerapkanData(simpanan);
        else {
          document.getElementById('so-stats').style.display   = 'none';
          document.getElementById('so-info-bar').style.display = 'none';
          document.getElementById('so-pager').style.display   = 'none';
          document.getElementById('pi-view-container').style.display = 'none';
          soTampilLoading('Memuat data SO...');
        }
      }
      try {
        const data = await soAmbil({ action: 'soLoadData', sesi });
        if (ke !== soMuatKe) return;
        if (!data.success) { if (!simpanan && !diam) soTampilPesan('error', data.message || 'Gagal memuat data.'); return; }
        const c = soCacheBaca(); c.data = c.data || {}; delete c.data[sesi]; c.data[sesi] = data.rows || [];
        soCacheTulis({ data: c.data });
        const lama = diam ? soSemuaData : simpanan;
        if (!lama || JSON.stringify(lama) !== JSON.stringify(data.rows || [])) soTerapkanData(data.rows);
      } catch(err) {
        if (ke === soMuatKe && !simpanan && !diam) soTampilPesan('error', 'Gagal terhubung ke Apps Script.');
      }
    }

    function soFilter() {
      // Pilihan Rak & Personil ikut Tim yang dipilih
      const lolosTim = soSemuaData.filter(r => opCocokTim('so-tim', r));
      opIsiRak('so-rak-filter', lolosTim);
      opIsiPersonil('so-personil', soPersonilList, lolosTim, soPersonilAktif);
      if (soPersonilAktif && document.getElementById('so-personil').value !== soPersonilAktif) soPersonilAktif = '';
      const cari       = (document.getElementById('so-cari').value || '').toLowerCase();
      const rak        = (document.getElementById('so-rak-filter').value || '').toLowerCase();
      const personilKw = (soPersonilAktif || '').toLowerCase();
      const sort       = document.getElementById('pi-sort-select').value;

      soDataFilter = soSemuaData.filter(r => {
        const normSt = soNormStatus(r.status);
        if (soStatusAkt !== 'Semua' && normSt !== soStatusAkt) return false;
        if (rak       && String(r.rak).toLowerCase() !== rak) return false;
        if (personilKw && !String(r.personil||'').toLowerCase().includes(personilKw)) return false;
        if (!opCocokTim('so-tim', r)) return false;
        if (cari      && !(r.sku+' '+r.namaProduk).toLowerCase().includes(cari)) return false;
        return true;
      });

      // Sort
      const statusOrder = { 'Minus':0, 'Plus':1, 'Balance':2, 'Belum':3 };
      soDataFilter.sort((a, b) => {
        if (sort === 'rak')          return opBandingRak(a, b);
        if (sort === 'qty-desc')     return (b.qtySistem||0) - (a.qtySistem||0);
        if (sort === 'qty-asc')      return (a.qtySistem||0) - (b.qtySistem||0);
        if (sort === 'nama')         return a.namaProduk.localeCompare(b.namaProduk);
        if (sort === 'selisih-desc') return Math.abs(b.selisih||0) - Math.abs(a.selisih||0);
        if (sort === 'status') {
          const sa = statusOrder[soNormStatus(a.status)] ?? 4;
          const sb = statusOrder[soNormStatus(b.status)] ?? 4;
          return sa - sb;
        }
        return 0;
      });

      soHalamanAkt = 1;
      soRenderTabel();
      soUpdateInfoBar();
    }
    function soPilihPersonil(nama) {
      soPersonilAktif = nama || '';
      document.getElementById('so-personil-input').value = soPersonilAktif;
      soFilter();
    }
    function soPersonilChip(nama) {
      if (nama === soPersonilAktif) { document.getElementById('so-personil-input').value = ''; soPersonilInput(); }
      else soPersonilPilih(nama);
    }
    function soResetFilter() {
      ['so-cari', 'so-rak-filter', 'so-personil-input', 'so-personil', 'so-tim'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('so-personil-input').style.borderColor = '';
      document.getElementById('pi-sort-select').value = 'rak';
      soPersonilAktif = '';
      piSetStatus('Semua', document.getElementById('pi-chip-Semua'));
    }

    function soRenderTabel() {
      const container = document.getElementById('pi-view-container');
      const stateBox  = document.getElementById('so-state-box');
      const pager     = document.getElementById('so-pager');

      if (!soDataFilter.length) {
        container.style.display = 'none';
        pager.style.display = 'none';
        soTampilPesan('empty', 'Tidak ada data yang sesuai filter.');
        return;
      }

      stateBox.style.display = 'none';
      container.style.display = '';

      const total   = soDataFilter.length;
      const maxHal  = Math.ceil(total / SO_PER_HALAMAN);
      soHalamanAkt  = Math.min(soHalamanAkt, maxHal);
      const mulai   = (soHalamanAkt - 1) * SO_PER_HALAMAN;
      const slice   = soDataFilter.slice(mulai, mulai + SO_PER_HALAMAN);

      // Satu tampilan: tabel di laptop, kartu di HP (lihat opname-ui.js)
      container.className = 'op-wrap';
      container.innerHTML = opDaftarHtml(slice, { id: 'so', status: r => soNormStatus(r.status) });

      if (maxHal > 1) {
        pager.style.display = '';
        document.getElementById('so-pager-info').textContent  = `${soHalamanAkt} / ${maxHal}`;
        document.getElementById('so-pager-count').textContent = `${mulai+1}–${Math.min(mulai+SO_PER_HALAMAN,total)} dari ${total}`;
        document.getElementById('so-btn-prev').disabled = soHalamanAkt <= 1;
        document.getElementById('so-btn-next').disabled = soHalamanAkt >= maxHal;
      } else {
        pager.style.display = 'none';
      }
    }

    function piRenderCard(r) {
      const norm  = soNormStatus(r.status);
      const foto  = r.kodeGambar
        ? `<img class="pi-card-img" loading="lazy" src="${SO_ASSET_BASE}?id=${encodeURIComponent(r.kodeGambar)}&thumbnail=true" onerror="this.outerHTML='<div class=\'pi-card-img-placeholder\'><span class=\'material-symbols-outlined\' style=\'font-size:36px;\'>image_not_supported</span></div>'">`
        : `<div class="pi-card-img-placeholder"><span class="material-symbols-outlined" style="font-size:36px;">image_not_supported</span></div>`;
      const sel   = r.selisih === '' ? '' : (r.selisih < 0 ? `<span style="font-size:11px;color:#be123c;font-weight:700;">▼${r.selisih}</span>` : r.selisih > 0 ? `<span style="font-size:11px;color:#2563eb;font-weight:700;">▲+${r.selisih}</span>` : '');
      const dEnc  = encodeURIComponent(JSON.stringify({sku:r.sku,nama:r.namaProduk,sesi:soSesiAktif,kodeGambar:r.kodeGambar||''}));
      return `<div class="pi-card" onclick="piOpenDetail('${dEnc}')">
        ${foto}
        <span class="pi-status-badge pi-badge-${norm}">${norm}</span>
        <div class="pi-card-body">
          <div class="pi-card-name">${r.namaProduk}</div>
          <div class="pi-card-sku">${r.sku}</div>
          <div class="pi-card-meta">
            <div>
              <div class="pi-card-qty">${r.qtySistem}</div>
              <div style="font-size:9px;color:#94a3b8;">qty sistem</div>
            </div>
            <div style="text-align:right;">
              <div class="pi-card-rak">${r.rak}</div>
              <div style="margin-top:2px;">${sel}</div>
            </div>
          </div>
        </div>
      </div>`;
    }

    function piRenderListItem(r) {
      const norm = soNormStatus(r.status);
      const foto = r.kodeGambar
        ? `<img class="pi-list-thumb" loading="lazy" src="${SO_ASSET_BASE}?id=${encodeURIComponent(r.kodeGambar)}&thumbnail=true" onerror="this.outerHTML='<div class=\'pi-list-thumb-ph\'><span class=\'material-symbols-outlined\' style=\'font-size:22px;\'>image_not_supported</span></div>'">`
        : `<div class="pi-list-thumb-ph"><span class="material-symbols-outlined" style="font-size:22px;">image_not_supported</span></div>`;
      const sel  = r.selisih === '' ? '' : r.selisih < 0 ? `<span style="color:#be123c;font-weight:700;font-size:11px;">▼${r.selisih}</span>` : r.selisih > 0 ? `<span style="color:#2563eb;font-weight:700;font-size:11px;">▲+${r.selisih}</span>` : '';
      const dEnc = encodeURIComponent(JSON.stringify({sku:r.sku,nama:r.namaProduk,sesi:soSesiAktif,kodeGambar:r.kodeGambar||''}));
      return `<div class="pi-list-item" onclick="piOpenDetail('${dEnc}')">
        ${foto}
        <div class="pi-list-info">
          <div class="pi-list-name">${r.namaProduk}</div>
          <div class="pi-list-sub">${r.sku}</div>
          <div class="pi-list-rak">Rak: <b>${r.rak}</b> · Tim: ${r.tim||'—'} · <span class="pi-status-badge pi-badge-${norm}" style="position:static;display:inline-block;">${norm}</span> ${sel}</div>
        </div>
        <div class="pi-list-qty">${r.qtySistem}</div>
      </div>`;
    }

    // ---- MODAL DETAIL CARD ----
    async function piOpenDetail(encodedData) {
      const d = JSON.parse(decodeURIComponent(encodedData));
      const overlay = document.getElementById('pi-detail-overlay');
      const content = document.getElementById('pi-detail-content');

      // Set header
      const imgEl = document.getElementById('pi-detail-img');
      if (d.kodeGambar) {
        imgEl.src = `${SO_ASSET_BASE}?id=${encodeURIComponent(d.kodeGambar)}&thumbnail=true`;
        imgEl.style.display = '';
      } else {
        imgEl.style.display = 'none';
      }
      document.getElementById('pi-detail-nama').textContent = d.nama;
      document.getElementById('pi-detail-sku').textContent  = d.sku;

      // Cari data row
      const row = soSemuaData.find(r => r.sku === d.sku);
      const norm = row ? soNormStatus(row.status) : '—';
      const badgeColor = {'Balance':'#dcfce7','Plus':'#dbeafe','Minus':'#fee2e2','Belum':'#f1f5f9'};
      const badgeText  = {'Balance':'#15803d','Plus':'#1d4ed8','Minus':'#be123c','Belum':'#334155'};
      document.getElementById('pi-detail-meta').innerHTML = row ? `
        <span style="background:${badgeColor[norm]||'#f1f5f9'};color:${badgeText[norm]||'#475569'};border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">${norm}</span>
        <span style="font-size:11px;color:#94a3b8;">Rak: <b style="color:#f8fafc;">${row.rak}</b></span>
        <span style="font-size:11px;color:#94a3b8;">Tim: <b style="color:#f8fafc;">${row.tim||'—'}</b></span>
        <span style="font-size:11px;color:#94a3b8;">Sistem: <b style="color:#475569;">${row.qtySistem}</b></span>
        <span style="font-size:11px;color:#94a3b8;">Real: <b style="color:#f8fafc;">${row.totalReal===''?'Belum':row.totalReal}</b></span>
        ${row.selisih!==''&&row.selisih!==0?`<span style="font-size:11px;font-weight:700;color:${row.selisih<0?'#fca5a5':'#93c5fd'}">Selisih: ${row.selisih>0?'+':''}${row.selisih}</span>`:''}
      ` : '';

      content.innerHTML = '<div class="pi-detail-empty"><span class="material-symbols-outlined" style="animation:spin 1s linear infinite;">sync</span><p>Memuat riwayat...</p></div>';
      overlay.classList.add('open');

      // Render tabel riwayat dari data yang sudah ada + load data rusak
      if (!row) {
        content.innerHTML = '<div class="pi-detail-empty"><span class="material-symbols-outlined">search_off</span><p>Data tidak ditemukan.</p></div>';
        return;
      }

      // Bangun tabel dari data row SO
      const r1 = row.realSatu  !== undefined ? row.realSatu  : '—';
      const r2 = row.realDua   !== undefined ? row.realDua   : '—';
      const r3 = row.realTiga  !== undefined ? row.realTiga  : '—';

      // Load data rusak
      let rusakInfo = null;
      try {
        const dataRusak = await gasGetDirect({ action: 'soGetRiwayat', sku: d.sku, sesi: d.sesi });
        if (dataRusak.success && dataRusak.rows.length) rusakInfo = dataRusak.rows;
      } catch(e) {}

      const dEncFull = encodeURIComponent(JSON.stringify({sku:d.sku,nama:d.nama,sesi:d.sesi,kodeGambar:d.kodeGambar||''}));

      content.innerHTML = `
        <table class="pi-riwayat-tbl">
          <thead>
            <tr>
              <th>Tim</th>
              <th>Personil</th>
              <th style="text-align:right;">Real 1</th>
              <th style="text-align:right;">Real 2</th>
              <th style="text-align:right;">Real 3</th>
              <th style="text-align:right;">Total Real</th>
              <th style="text-align:right;">Selisih</th>
              <th>Status</th>
              <th style="text-align:center;">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="font-weight:700;color:#1e293b;">${row.tim||'—'}</td>
              <td>
                <div style="font-weight:600;color:#334155;">${row.personil||'—'}</div>
                <div style="font-size:10px;color:#94a3b8;">ct: ${(row.personil||'—').toLowerCase()}</div>
              </td>
              <td style="text-align:right;font-family:monospace;color:#475569;">${row.real1!==undefined&&row.real1!==''?row.real1:'—'}</td>
              <td style="text-align:right;font-family:monospace;color:#475569;">${row.real2!==undefined&&row.real2!==''?row.real2:'—'}</td>
              <td style="text-align:right;font-family:monospace;color:#475569;">${row.real3!==undefined&&row.real3!==''?row.real3:'—'}</td>
              <td style="text-align:right;font-weight:700;color:#1e293b;">${row.totalReal===''?'<span style="color:#94a3b8;font-style:italic;font-size:11px;">Belum</span>':row.totalReal}</td>
              <td style="text-align:right;">${row.selisih===''?'—':row.selisih<0?`<span style="color:#be123c;font-weight:700;">${row.selisih}</span>`:row.selisih>0?`<span style="color:#2563eb;font-weight:700;">+${row.selisih}</span>`:'<span style="color:#94a3b8;">0</span>'}</td>
              <td><span style="background:${{'Balance':'#dcfce7','Plus':'#dbeafe','Minus':'#fee2e2','Belum':'#f1f5f9'}[norm]||'#f1f5f9'};color:${{'Balance':'#15803d','Plus':'#1d4ed8','Minus':'#be123c','Belum':'#334155'}[norm]||'#475569'};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;">${norm}</span></td>
              <td style="text-align:center;">
                <button onclick="soOpenActions('${dEncFull}')"
                  style="border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;padding:3px 10px;cursor:pointer;font-size:13px;color:#64748b;font-weight:700;"
                  onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#f8fafc'"
                  title="Barang rusak: lihat & laporkan">···</button>
              </td>
            </tr>
          </tbody>
        </table>
        ${row.catatan ? `<div style="padding:12px 14px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;"><b>Catatan:</b> ${row.catatan}</div>` : ''}
        ${row.balancing ? `<div style="padding:6px 14px 12px;font-size:11px;color:#94a3b8;">Balancing: ${row.balancing}</div>` : ''}
        ${rusakInfo ? `
          <div style="padding:12px 14px;border-top:1px solid #f1f5f9;">
            <div style="font-size:11px;font-weight:700;color:#be123c;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">⚠ Riwayat Kerusakan</div>
            ${rusakInfo.map(ri=>`
              <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;margin-bottom:5px;">
                <div>
                  <span style="font-weight:800;color:#be123c;font-size:15px;">${ri.jumlahRusak} pcs</span>
                  <span style="font-size:11px;color:#64748b;margin-left:8px;">· ${ri.oleh||'—'} · ${ri.sesi||''}</span>
                  ${ri.keterangan?`<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${ri.keterangan}</div>`:''}
                </div>
                <span style="font-size:10px;color:#94a3b8;">${ri.dicatatPada||''}</span>
              </div>
            `).join('')}
          </div>` : ''}
      `;
    }

    function piTutupDetail(e) {
      if (e && e.target !== document.getElementById('pi-detail-overlay')) return;
      document.getElementById('pi-detail-overlay').classList.remove('open');
    }

    function soHalamanNav(arah) {
      soHalamanAkt += arah;
      soRenderTabel();
      document.getElementById('pi-scroll-area').scrollTo({ top: 0, behavior: 'smooth' });
    }

    function soHitungStats() {
      const h = { Balance: 0, Plus: 0, Minus: 0, Belum: 0 };
      soSemuaData.forEach(r => {
        const norm = soNormStatus(r.status);
        if (h[norm] !== undefined) h[norm]++; else h.Belum++;
      });
      document.getElementById('so-n-balance').textContent = h.Balance;
      document.getElementById('so-n-plus').textContent    = h.Plus;
      document.getElementById('so-n-minus').textContent   = h.Minus;
      document.getElementById('so-n-belum').textContent   = h.Belum;
      opIsiChip('pi', h);
    }

    function soUpdateInfoBar() {
      document.getElementById('so-info-total').textContent  = soSemuaData.length;
      document.getElementById('so-info-tampil').textContent = soDataFilter.length;
      document.getElementById('so-info-sesi').textContent   = soSesiAktif + ' · ' + opTimLabel(soDataFilter).pendek;
      document.getElementById('so-info-bar').style.display  = '';
    }

    function soTampilLoading(pesan) {
      const box = document.getElementById('so-state-box');
      box.innerHTML = `<span class="material-symbols-outlined" style="animation:spin 1s linear infinite;">sync</span><p>${pesan}</p>`;
      box.style.display = '';
      document.getElementById('pi-view-container').style.display = 'none';
      document.getElementById('so-pager').style.display = 'none';
    }

    function soTampilPesan(tipe, pesan) {
      const box = document.getElementById('so-state-box');
      box.innerHTML = `<span class="material-symbols-outlined">${tipe==='error'?'error':'search_off'}</span><p>${pesan}</p>`;
      box.style.display = '';
      document.getElementById('pi-view-container').style.display = 'none';
      document.getElementById('so-pager').style.display = 'none';
    }

    function soOpenLightbox(kodeEncoded) {
      const kode = decodeURIComponent(kodeEncoded);
      document.getElementById('so-lightbox-img').src = SO_ASSET_BASE + '?id=' + encodeURIComponent(kode) + '&thumbnail=false';
      document.getElementById('so-lightbox').classList.add('open');
    }
    function soCloseLightbox() {
      document.getElementById('so-lightbox').classList.remove('open');
      document.getElementById('so-lightbox-img').src = '';
    }

    // URL Apps Script untuk export SO ke Google Sheets
    // Ganti dengan URL Web App setelah deploy
    const SO_SHEET_GAS_URL = 'https://script.google.com/macros/s/AKfycbx7zBJK1p1OEZGtjWaV9zVc76COolQ3QcwUicsENjnw1i7ET5Ljd6i7zgcrGKHVRQmjcg/exec';

    // Ekspor .xlsx (panel Unduh / Bagikan ke WA). Logika data Opname Sheet tidak diubah.
    function soEkspor() {
      const label = { Semua: 'Semua', Minus: 'Kurang', Plus: 'Lebih', Balance: 'Sesuai', Belum: 'Belum' };
      const sel = document.getElementById('so-sesi-select');
      const bulanLabel = sel && sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : soSesiAktif;
      opBukaEkspor({
        sumber: 'Opname Sheet', sesi: soSesiAktif, bulanLabel,
        rows: soDataFilter.slice(), status: r => soNormStatus(r.status),
        filterStatus: label[soStatusAkt] || soStatusAkt, filterRak: document.getElementById('so-rak-filter').value || '',
        filterPersonil: soPersonilAktif || '', cari: document.getElementById('so-cari').value || '',
        sesudah: () => opKirimSheet(soSesiAktif ? soSesiAktif.replace(/_/g, ' ') : 'SO', `Ekspor Opname Sheet | Sesi: ${soSesiAktif || '-'} | Filter: ${soStatusAkt}`,
          soDataFilter.map(r => [r.sku || '', r.namaProduk || '', r.qtySistem != null ? Number(r.qtySistem) : '', (r.selisih === '' || r.selisih == null) ? '' : Number(r.selisih)]))
      });
    }

    async function soExportCSV() {
      if (!soDataFilter.length) return showToast('Tidak ada data untuk diekspor.', 'error');

      const now  = new Date();
      const tgl  = now.toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' });
      const jam  = now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });

      // Filter aktif saat ini
      const filterStatus   = soStatusAkt || 'Semua';
      const filterPersonil = soPersonilAktif || '-';
      const filterRak      = (document.getElementById('so-rak-filter')?.value || '-') || '-';
      const filterCari     = (document.getElementById('so-cari')?.value || '-') || '-';

      // Helper encode CSV field
      const esc = v => { const s = String(v == null ? '' : v).replace(/"/g,'""'); return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s; };

      // Ringkasan status
      const total   = soDataFilter.length;
      const minus   = soDataFilter.filter(r => Number(r.selisih) < 0).length;
      const plus    = soDataFilter.filter(r => Number(r.selisih) > 0).length;
      const balance = soDataFilter.filter(r => r.selisih === 0 || r.selisih === '0').length;
      const belum   = soDataFilter.filter(r => r.selisih === '' || r.selisih == null).length;

      // Nama sheet tab: dari sesi SO, e.g. "SO 2026-10"
      const sheetName = soSesiAktif
        ? soSesiAktif.replace(/_/g, ' ')
        : `SO ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

      // Badge text (baris 1 di sheet)
      const badgeText = `Ekspor: ${tgl} ${jam}  |  Sesi: ${soSesiAktif || '-'}  |  Filter: ${filterStatus}  |  Personil: ${filterPersonil}  |  Rak: ${filterRak}`;

      // Data rows untuk Google Sheets (4 kolom: SKU, NAMA PRODUCT, STOCK REAL, MINUS)
      const sheetRows = soDataFilter.map(r => [
        r.sku        || '',
        r.namaProduk || '',
        r.qtySistem  != null ? Number(r.qtySistem) : '',
        (r.selisih === '' || r.selisih == null) ? '' : Number(r.selisih)
      ]);

      // Kirim ke Google Sheets via Apps Script
      showToast('\u23F3 Mengirim ke Google Sheets...', 'info');
      try {
        const resp = await fetch(SO_SHEET_GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action:    'exportSO',
            sheetName: sheetName,
            badgeText: badgeText,
            rows:      sheetRows
          })
        });
        const result = await resp.json();
        if (result.success) {
          showToast(`\u2705 ${total} produk berhasil masuk ke sheet "${sheetName}"`, 'success');
        } else {
          showToast(`\u26A0\uFE0F Gagal ke Sheets: ${result.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        showToast(`\u26A0\uFE0F Gagal menghubungi Sheets: ${err.message}`, 'error');
      }

      // Tetap download CSV lokal juga
      const csvRows = [];
      csvRows.push(['LAPORAN STOCK OPNAME \u2014 PDC WAREHOUSE']);
      csvRows.push(['Sesi SO', soSesiAktif || '-']);
      csvRows.push(['Tanggal Ekspor', `${tgl} ${jam}`]);
      csvRows.push(['Filter Status',   filterStatus]);
      csvRows.push(['Filter Personil', filterPersonil]);
      csvRows.push(['Filter Rak',      filterRak]);
      csvRows.push(['Kata Cari',       filterCari]);
      csvRows.push([]);
      csvRows.push(['RINGKASAN']);
      csvRows.push(['Total Produk Ditampilkan', total]);
      csvRows.push(['Minus (kurang)',  minus]);
      csvRows.push(['Plus (lebih)',    plus]);
      csvRows.push(['Balance (pas)',   balance]);
      csvRows.push(['Belum diopname', belum]);
      csvRows.push([]);
      csvRows.push(['No','SKU','Nama Produk','Qty Sistem','Selisih','Status','Rak','Personil','Keterangan']);
      soDataFilter.forEach((r, i) => {
        const selisihVal  = r.selisih === '' || r.selisih == null ? 'Belum' :
                            Number(r.selisih) > 0 ? `+${r.selisih}` : String(r.selisih);
        const statusLabel = soNormStatus(r.status) === 'Minus'   ? 'Minus'   :
                            soNormStatus(r.status) === 'Plus'    ? 'Plus'    :
                            soNormStatus(r.status) === 'Balance' ? 'Balance' : 'Belum';
        csvRows.push([i+1, r.sku||'', r.namaProduk||'', r.qtySistem??'', selisihVal, statusLabel, r.rak||'', r.personil||'', r.keterangan||'']);
      });
      const csv  = csvRows.map(r => r.map(esc).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const tglFile = now.toISOString().slice(0, 10);
      a.href     = url;
      a.download = `SO_${soSesiAktif || 'export'}_${filterStatus}_${tglFile}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // SO ACTIONS — popup uraian rusak
    let soRusakAktif = null;   // produk yang sedang dibuka di popup barang rusak
    async function soOpenActions(encodedData) {
      const d = JSON.parse(decodeURIComponent(encodedData));
      soRusakAktif = d;
      const rowData = soSemuaData.find(r => r.sku === d.sku) || {};
      opRusakSiapkan('so', { nama: d.nama || rowData.namaProduk, sku: d.sku, rak: rowData.rak || '', qty: rowData.qtySistem });
      try {
        const data = await gasGetDirect({ action: 'soGetRiwayat', sku: d.sku, sesi: d.sesi });
        if (soRusakAktif === d) opRusakRiwayat('so', data.success ? (data.rows || []) : null, !data.success);
      } catch(e) {
        if (soRusakAktif === d) opRusakRiwayat('so', null, true);
      }
    }
    function soTutupRusakModal(e) {
      if (e && e.target !== document.getElementById('so-rusak-modal')) return;
      document.getElementById('so-rusak-modal').style.display = 'none';
    }

    // Simpan laporan barang rusak dari Opname Sheet (dulu ada di menu Data Opname)
    async function soSimpanRusak() {
      const d   = soRusakAktif;
      const msg = document.getElementById('so-rusak-msg');
      const btn = document.getElementById('so-rusak-btn');
      if (!d) return;
      const f = opRusakAmbil('so');
      if (!f) return;
      const ok = await showConfirm('Tambahkan Kerusakan', `${d.nama || d.sku}: ${f.qty} pcs (${f.jenis}). Simpan?`, 'Ya, Simpan');
      if (!ok) return;
      btn.disabled = true; btn.textContent = 'Menyimpan...'; msg.textContent = '';
      try {
        const res = await fetch('/api/so/rusak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-session-token': sessionStorage.getItem('sessionToken') },
          body: JSON.stringify({ sku: d.sku, namaProduk: d.nama || '', sesi: d.sesi || soSesiAktif, jumlahRusak: f.qty, keterangan: f.keterangan })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Laporan kerusakan tersimpan.', 'success');
          soOpenActions(encodeURIComponent(JSON.stringify(d)));   // muat ulang riwayat
        } else {
          msg.style.color = '#d1646c'; msg.textContent = data.message || 'Gagal menyimpan.';
        }
      } catch (e) { msg.style.color = '#d1646c'; msg.textContent = 'Gagal terhubung ke server.'; }
      finally { btn.disabled = false; btn.textContent = 'Simpan'; }
    }

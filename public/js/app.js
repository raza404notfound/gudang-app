// app.js — Core Application: Auth, Routing, Utils

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
        btn.innerText = 'Login';
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

    async function checkAuthStatus() {
      const token     = sessionStorage.getItem('sessionToken');
      const savedUser = sessionStorage.getItem('sessionUser');

      // Tidak ada sesi sama sekali → tampil login langsung
      if (!token || !savedUser) {
        showPageLoading(false);
        document.getElementById('auth-modal').style.display = 'flex';
        return;
      }

      // Ada sesi → sidebar sudah tampil (tidak kedip),
      // area konten tampil spinner putih sampai verifikasi selesai
      showPageLoading(true);

      // Isi sidebar dari cache supaya tidak berubah selama loading
      const cachedUser = sessionStorage.getItem('sessionUser') || 'U';
      document.getElementById('user-name-display').innerText = cachedUser.toUpperCase();
      document.getElementById('user-avatar').innerText       = cachedUser.charAt(0).toUpperCase();
      const cachedRole = sessionStorage.getItem('sessionRole') || '';
      if (cachedRole === 'superuser') {
        document.getElementById('nav-kelola-akun').style.display = 'flex';
      }

      // Verifikasi token ke server
      try {
        const res  = await fetch('/api/auth/me', { headers: { 'x-session-token': token } });
        const data = await res.json();

        if (data.success) {
          currentSessionToken = token;
          currentUserRole     = data.role;
          sessionStorage.setItem('sessionRole', data.role);
          sessionStorage.setItem('sessionUser', data.username);

          // Update sidebar dengan data fresh dari server
          document.getElementById('user-name-display').innerText = data.username.toUpperCase();
          document.getElementById('user-avatar').innerText       = data.username.charAt(0).toUpperCase();
          if (data.role === 'superuser') {
            document.getElementById('nav-kelola-akun').style.display = 'flex';
          }

          // Sembunyikan loading, render halaman
          showPageLoading(false);
          document.getElementById('auth-modal').style.display = 'none';
          initRouterFromHash();
          startRealtimeTimer();
        } else {
          // Token tidak valid → tampil login
          sessionStorage.clear();
          showPageLoading(false);
          document.getElementById('auth-modal').style.display = 'flex';
        }
      } catch (err) {
        // Network error — tetap tampil login, jangan biarkan spinner selamanya
        console.error('Auth check error:', err.message);
        sessionStorage.clear();
        showPageLoading(false);
        document.getElementById('auth-modal').style.display = 'flex';
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

// HASH ROUTER — URL berubah saat pindah menu
    // Refresh = hanya load data halaman aktif, sidebar tidak reload
    // ============================================================
    const PAGE_DATA_LOADERS = {
      'dashboard'         : () => loadDashboard(),
      'pusat-inventory'   : () => initSoPage(),
      'barang-bermasalah' : () => initDataOpname(),
      'lacak-awb'         : () => null,
      'kelola-akun'       : () => loadUserList(),
      'gudang-insight'    : () => initInsightPage()
    };

    function switchTab(pageId, element, pushState = true) {
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

      // Lazy load: panggil loader data hanya untuk halaman ini
      if (PAGE_DATA_LOADERS[pageId]) PAGE_DATA_LOADERS[pageId]();
    }

    // Handle tombol back/forward browser
    window.addEventListener('popstate', e => {
      const pageId = e.state?.page || 'dashboard';
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

    /* RENDER DASHBOARD DENGAN KATA KUNCI KONSISTEN & URUTAN POSISI PERMANEN */
    async function loadDashboard() {
      const grid = document.getElementById('warehouse-grid');
      grid.innerHTML = '';

      WAREHOUSE_LIST.forEach(wh => {
        const card = document.createElement('div');
        card.className = 'wh-card';
        card.id = `wh-card-${wh.id}`;
        card.innerHTML = `
          <div class="wh-title">${wh.name}</div>
          <div class="tables-flex">
            <div class="table-box">
              <div>
                <div class="table-header">
                  <span>INBOUND HARI INI</span>
                  <span class="total-chip-inc" id="inbound-total-${wh.id}">TOTAL: 0 TRX</span>
                </div>
                <table>
                  <thead><tr><th>STATUS</th><th class="num">TRX</th><th class="num">BARANG</th><th class="pct">%</th></tr></thead>
                  <tbody id="inbound-body-${wh.id}"><tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:20px;">Memuat Inbound...</td></tr></tbody>
                </table>
              </div>
              <div class="table-footer"><span class="material-symbols-outlined">schedule</span><span class="time-ago-text-inbound">Belum diperbarui</span></div>
            </div>

            <div class="table-box">
              <div>
                <div class="table-header">
                  <span>OUTBOUND HARI INI</span>
                  <span class="total-chip-out" id="outbound-total-${wh.id}">TOTAL: 0 TRX</span>
                </div>
                <table>
                  <thead><tr><th>STATUS</th><th class="num">TRX</th><th class="num">BARANG</th><th class="pct">%</th></tr></thead>
                  <tbody id="outbound-body-${wh.id}"><tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:20px;">Memuat Outbound...</td></tr></tbody>
                </table>
              </div>
              <div class="table-footer"><span class="material-symbols-outlined">schedule</span><span class="time-ago-text-outbound">Belum diperbarui</span></div>
            </div>
          </div>
        `;
        grid.appendChild(card);
      });

      const renderRows = (list, type, totalTrx) => {
        if (!Array.isArray(list) || list.length === 0) {
          return '<tr><td colspan="4" style="text-align:center; color:#94a3b8;">Tidak ada data</td></tr>';
        }

        let ongoingCount = 0;
        let completedCount = 0;

        const mappedRows = list.map(item => {
          const trx = Number(item.transaction_count) || 0;
          const pcs = Number(item.item_count) || Number(item.total_item_count) || 0;
          const percentage = totalTrx > 0 ? ((trx / totalTrx) * 100).toFixed(1) : '0.0';
          const fillClass = type === 'inbound' ? 'progress-fill-inc' : 'progress-fill-out';

          let statusName = getFormattedStatus(item.status, type);

          if (type === 'inbound') {
            const rawStatus = String(item.status || '').toLowerCase();
            const typeStr = String(
              item.type || item.inbound_type || item.category || item.sub_type || 
              item.title || item.name || item.status_name || item.source || ''
            ).toLowerCase();

            const isRetur = typeStr.includes('retur') || typeStr.includes('return') || 
                            typeStr.includes('customer') || typeStr.includes('buyer') || 
                            item.is_retur === true || item.is_return === true;
                            
            const isNormalInbound = typeStr.includes('supplier') || typeStr.includes('inbound') || 
                                    typeStr.includes('vendor') || typeStr.includes('po');

            if (rawStatus === 'cancel' || rawStatus === 'cancelled') {
              statusName = 'Batal';
            } else if (rawStatus === 'received') {
              statusName = 'Inbound Diterima';
            } else if (rawStatus === 'retur_proses' || rawStatus === 'retur_ongoing') {
              statusName = 'Retur Diproses';
            } else if (rawStatus === 'retur_selesai' || rawStatus === 'retur_completed') {
              statusName = 'Retur Selesai';
            } else if (rawStatus === 'ongoing') {
              if (isRetur) {
                statusName = 'Retur Diproses';
              } else if (isNormalInbound) {
                statusName = 'Inbound OTW';
              } else {
                ongoingCount++;
                statusName = (ongoingCount === 1) ? 'Inbound OTW' : 'Retur Diproses';
              }
            } else if (rawStatus === 'completed') {
              if (isRetur) {
                statusName = 'Retur Selesai';
              } else if (isNormalInbound) {
                statusName = 'Inbound Diterima';
              } else {
                completedCount++;
                statusName = (completedCount === 1) ? 'Inbound Diterima' : 'Retur Selesai';
              }
            }
          }

          return { statusName, trx, pcs, percentage, fillClass };
        });

        // Urutan permanen nomor kata kunci agar tidak pernah bertukar posisi
        mappedRows.sort((a, b) => {
          if (type === 'inbound') {
            const orderInbound = {
              'Inbound OTW': 1,
              'Batal': 2,
              'Inbound Diterima': 3,
              'Retur Diproses': 4,
              'Retur Selesai': 5
            };
            return (orderInbound[a.statusName] || 99) - (orderInbound[b.statusName] || 99);
          } else {
            const orderOutbound = {
              'Menunggu Diproses': 1,
              'Batal': 2,
              'Sedang Diambil': 3,
              'Siap Dikemas': 4,
              'Sedang Dikemas': 5,
              'Selesai Dikemas': 6,
              'Diserahkan Kurir': 7
            };
            return (orderOutbound[a.statusName] || 99) - (orderOutbound[b.statusName] || 99);
          }
        });

        return mappedRows.map(row => {
          const isBatal = row.statusName === 'Batal';
          const statusDisplay = isBatal 
            ? `<span class="status-chip status-batal">${row.statusName}</span>` 
            : row.statusName;

          return `
            <tr>
              <td class="status-name">${statusDisplay}</td>
              <td class="num">${row.trx.toLocaleString('id-ID')} <span>trx</span></td>
              <td class="num">${row.pcs.toLocaleString('id-ID')} <span>pcs</span></td>
              <td class="pct">
                <div class="progress-bar-container">
                  <div class="progress-track"><div class="${row.fillClass}" style="width: ${Math.min(row.percentage, 100)}%;"></div></div>
                  <span>${row.percentage}%</span>
                </div>
              </td>
            </tr>
          `;
        }).join('');
      };

      try {
        const resInbound = await fetch('/api/dashboard?type=inbound');
        const dataInbound = await resInbound.json();
        document.getElementById('total-inbound').innerText = dataInbound.summary?.totalInboundTrx || 0;
        
        dataInbound.warehouses.forEach(wh => {
          const details = wh.data?.inbound?.details || [];
          const totalTrx = wh.data?.inbound?.total_trx || 0;
          const totalEl = document.getElementById(`inbound-total-${wh.id}`);
          const bodyEl = document.getElementById(`inbound-body-${wh.id}`);
          if (totalEl) totalEl.innerText = `TOTAL: ${totalTrx} TRX`;
          if (bodyEl) bodyEl.innerHTML = renderRows(details, 'inbound', totalTrx || 1);
        });
        lastFetchTimeInbound = Date.now();
      } catch (err) {}

      try {
        const resOutbound = await fetch('/api/dashboard?type=outbound');
        const dataOutbound = await resOutbound.json();
        document.getElementById('total-outbound').innerText = dataOutbound.summary?.totalOutboundTrx || 0;

        dataOutbound.warehouses.forEach(wh => {
          const details = wh.data?.outbound?.details || [];
          const totalTrx = wh.data?.outbound?.total_trx || 0;
          const totalEl = document.getElementById(`outbound-total-${wh.id}`);
          const bodyEl = document.getElementById(`outbound-body-${wh.id}`);
          if (totalEl) totalEl.innerText = `TOTAL: ${totalTrx} TRX`;
          if (bodyEl) bodyEl.innerHTML = renderRows(details, 'outbound', totalTrx || 1);
        });
        lastFetchTimeOutbound = Date.now();
      } catch (err) {}
    }

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
      document.querySelectorAll('.pi-chip').forEach(c => c.className = 'pi-chip');
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
        const hl   = idxH >= 0 ? nama.slice(0,idxH)+'<b style="color:#e11d48;">'+nama.slice(idxH,idxH+q.length)+'</b>'+nama.slice(idxH+q.length) : nama;
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
      items.forEach((el, i) => { el.style.background = i===soPersonilIdx?'#fff1f2':''; el.style.color = i===soPersonilIdx?'#e11d48':'#334155'; });
      if (items[soPersonilIdx]) items[soPersonilIdx].scrollIntoView({ block:'nearest' });
    }
    function soPersonilPilih(nama) {
      soPersonilAktif = nama;
      const input = document.getElementById('so-personil-input');
      input.value = nama; input.style.borderColor = '#fbbf24';
      document.getElementById('so-personil-dropdown').style.display = 'none';
      soFilter();
    }
    function soPersonilTutupDd(e) {
      const wrap = document.getElementById('so-personil-wrap');
      if (e && wrap && wrap.contains(e.target)) return;
      document.getElementById('so-personil-dropdown').style.display = 'none';
    }

    async function initSoPage() {
      if (soSudahInit) return;
      soSudahInit = true;
      await soMuatDaftarSesi();
    }

    async function soMuatDaftarSesi() {
      const sel = document.getElementById('so-sesi-select');
      sel.innerHTML = '<option value="">Memuat daftar sesi...</option>';
      sel.disabled = true;
      try {
        const url = new URL(GAS_URL);
        url.searchParams.set('action', 'soListSesi');
        const data = await (await fetch(url.toString())).json();
        if (!data.success || !data.data || !data.data.length) {
          sel.innerHTML = '<option value="">Tidak ada data SO</option>'; return;
        }
        const bMap = {1:'Januari',2:'Februari',3:'Maret',4:'April',5:'Mei',6:'Juni',7:'Juli',8:'Agustus',9:'September',10:'Oktober',11:'November',12:'Desember'};
        sel.innerHTML = '<option value="">— Pilih Bulan SO —</option>';
        data.data.forEach(s => {
          const o = document.createElement('option');
          o.value = s.nama; o.textContent = `${bMap[s.bulan]||s.bulan} ${s.tahun}`;
          sel.appendChild(o);
        });
        sel.disabled = false;
        if (data.data.length) { sel.value = data.data[0].nama; soGantiSesi(); }
      } catch(err) {
        sel.innerHTML = '<option value="">Gagal memuat daftar sesi</option>';
      }
    }

    async function soGantiSesi() {
      const sesi = document.getElementById('so-sesi-select').value;
      if (!sesi) return;
      soSesiAktif     = sesi;
      soSemuaData     = [];
      soDataFilter    = [];
      soHalamanAkt    = 1;
      soStatusAkt     = 'Semua';
      soPersonilAktif = '';
      document.querySelectorAll('.pi-chip').forEach(c => c.className = 'pi-chip');
      document.getElementById('pi-chip-Semua').classList.add('aktif-Semua');
      document.getElementById('so-cari').value = '';
      document.getElementById('so-rak-filter').value = '';
      document.getElementById('so-personil-input').value = '';
      document.getElementById('so-personil-input').style.borderColor = '';
      document.getElementById('so-personil-dropdown').style.display = 'none';
      document.getElementById('so-stats').style.display   = 'none';
      document.getElementById('so-info-bar').style.display = 'none';
      document.getElementById('so-pager').style.display   = 'none';
      document.getElementById('pi-view-container').style.display = 'none';
      soTampilLoading('Memuat data SO...');
      try {
        const url = new URL(GAS_URL);
        url.searchParams.set('action', 'soLoadData');
        url.searchParams.set('sesi', sesi);
        const data = await (await fetch(url.toString())).json();
        if (!data.success) { soTampilPesan('error', data.message || 'Gagal memuat data.'); return; }
        soSemuaData = data.rows || [];
        // Build personil list
        soPersonilList = [];
        const seen = {};
        (data.rows || []).forEach(r => {
          const raw = String(r.personil || '').trim();
          if (!raw) return;
          const key = raw.toLowerCase();
          if (!seen[key]) { seen[key] = true; soPersonilList.push(raw); }
        });
        soPersonilList.sort((a,b) => a.toLowerCase().localeCompare(b.toLowerCase()));
        soHitungStats();
        soFilter();
      } catch(err) {
        soTampilPesan('error', 'Gagal terhubung ke Apps Script.');
      }
    }

    function soFilter() {
      const cari       = (document.getElementById('so-cari').value || '').toLowerCase();
      const rak        = (document.getElementById('so-rak-filter').value || '').toLowerCase();
      const personilKw = (soPersonilAktif || '').toLowerCase();
      const sort       = document.getElementById('pi-sort-select').value;

      soDataFilter = soSemuaData.filter(r => {
        const normSt = soNormStatus(r.status);
        if (soStatusAkt !== 'Semua' && normSt !== soStatusAkt) return false;
        if (rak       && !String(r.rak).toLowerCase().includes(rak)) return false;
        if (personilKw && !String(r.personil||'').toLowerCase().includes(personilKw)) return false;
        if (cari      && !(r.sku+' '+r.namaProduk).toLowerCase().includes(cari)) return false;
        return true;
      });

      // Sort
      const statusOrder = { 'Minus':0, 'Plus':1, 'Balance':2, 'Belum':3 };
      soDataFilter.sort((a, b) => {
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

      if (piViewMode === 'grid') {
        container.className = 'pi-grid';
        container.innerHTML = slice.map(r => piRenderCard(r)).join('');
      } else {
        container.className = 'pi-list';
        container.innerHTML = slice.map(r => piRenderListItem(r)).join('');
      }

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
      const badgeColor = {'Balance':'#dcfce7','Plus':'#dbeafe','Minus':'#fee2e2','Belum':'#fef9c3'};
      const badgeText  = {'Balance':'#15803d','Plus':'#1d4ed8','Minus':'#be123c','Belum':'#92400e'};
      document.getElementById('pi-detail-meta').innerHTML = row ? `
        <span style="background:${badgeColor[norm]||'#f1f5f9'};color:${badgeText[norm]||'#475569'};border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700;">${norm}</span>
        <span style="font-size:11px;color:#94a3b8;">Rak: <b style="color:#f8fafc;">${row.rak}</b></span>
        <span style="font-size:11px;color:#94a3b8;">Tim: <b style="color:#f8fafc;">${row.tim||'—'}</b></span>
        <span style="font-size:11px;color:#94a3b8;">Sistem: <b style="color:#fbbf24;">${row.qtySistem}</b></span>
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
              <td><span style="background:${{'Balance':'#dcfce7','Plus':'#dbeafe','Minus':'#fee2e2','Belum':'#fef9c3'}[norm]||'#f1f5f9'};color:${{'Balance':'#15803d','Plus':'#1d4ed8','Minus':'#be123c','Belum':'#92400e'}[norm]||'#475569'};border-radius:20px;padding:2px 9px;font-size:11px;font-weight:700;">${norm}</span></td>
              <td style="text-align:center;">
                <button onclick="soOpenActions('${dEncFull}')"
                  style="border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;padding:3px 10px;cursor:pointer;font-size:13px;color:#64748b;font-weight:700;"
                  onmouseover="this.style.background='#fef3c7'" onmouseout="this.style.background='#f8fafc'"
                  title="Riwayat kerusakan">···</button>
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
      document.getElementById('so-stats').style.display   = '';
    }

    function soUpdateInfoBar() {
      document.getElementById('so-info-total').textContent  = soSemuaData.length;
      document.getElementById('so-info-tampil').textContent = soDataFilter.length;
      document.getElementById('so-info-sesi').textContent   = soSesiAktif;
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

    function soExportCSV() {
      if (!soDataFilter.length) return showToast('Tidak ada data untuk diekspor.', 'error');
      const tgl  = new Date().toLocaleDateString('id-ID', { day:'2-digit', month:'2-digit', year:'numeric' });
      const rows = [['Tanggal Eksport','SKU','Nama Produk','Selisih']];
      soDataFilter.forEach(r => rows.push([tgl, r.sku, r.namaProduk, r.selisih===''?'':r.selisih]));
      const csv  = rows.map(r => r.map(v => { const s=String(v==null?'':v).replace(/"/g,'""'); return s.includes(',')||s.includes('"')?`"${s}"`:s; }).join(',')).join('\n');
      const blob = new Blob(['\uFEFF'+csv], { type:'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${soSesiAktif}_export_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    // SO ACTIONS — popup uraian rusak
    async function soOpenActions(encodedData) {
      const d = JSON.parse(decodeURIComponent(encodedData));
      const modal = document.getElementById('so-rusak-modal');
      const body  = document.getElementById('so-rusak-modal-body');
      const judul = document.getElementById('so-rusak-modal-judul');
      judul.textContent = d.nama || d.sku;
      body.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:24px 0;"><span class="material-symbols-outlined" style="font-size:32px;animation:spin 1s linear infinite;display:block;margin-bottom:8px;">sync</span>Memuat data...</div>';
      modal.style.display = 'flex';
      try {
        const data = await gasGetDirect({ action: 'soGetRiwayat', sku: d.sku, sesi: d.sesi });
        const rowData  = soSemuaData.find(r => r.sku === d.sku);
        const fotoHtml = (rowData && rowData.kodeGambar)
          ? `<img src="${SO_ASSET_BASE}?id=${encodeURIComponent(rowData.kodeGambar)}&thumbnail=true" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0;background:#f1f5f9;" onerror="this.style.display='none'">`
          : `<div style="width:60px;height:60px;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex-shrink:0;"><span class="material-symbols-outlined" style="color:#cbd5e1;font-size:24px;">image_not_supported</span></div>`;
        if (!data.success || !data.rows || !data.rows.length) {
          body.innerHTML = `<div style="display:flex;gap:12px;align-items:center;padding:0 0 14px;border-bottom:1px solid #f1f5f9;margin-bottom:14px;">${fotoHtml}<div><div style="font-size:12px;font-weight:700;color:#1e293b;">${d.nama}</div><div style="font-size:11px;color:#94a3b8;margin-top:2px;font-family:monospace;">${d.sku}</div></div></div>
            <div style="text-align:center;padding:20px 0;"><span class="material-symbols-outlined" style="font-size:40px;color:#d1d5db;display:block;margin-bottom:10px;">check_circle</span><p style="color:#64748b;font-size:13px;font-weight:600;">Belum pernah dirusak</p></div>`; return;
        }
        const latest = data.rows[0]; const history = data.rows.slice(1);
        body.innerHTML = `<div style="display:flex;gap:12px;align-items:center;padding:0 0 14px;border-bottom:1px solid #f1f5f9;margin-bottom:14px;">${fotoHtml}<div style="min-width:0;"><div style="font-size:12px;font-weight:700;color:#1e293b;line-height:1.3;">${d.nama}</div><div style="font-size:11px;color:#94a3b8;margin-top:2px;font-family:monospace;">${d.sku}</div></div></div>
          <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;"><span style="font-size:11px;font-weight:700;color:#e11d48;text-transform:uppercase;letter-spacing:.4px;">Laporan Terbaru</span><span style="font-size:11px;color:#94a3b8;">${latest.dicatatPada||'-'}</span></div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:26px;font-weight:800;color:#be123c;">${latest.jumlahRusak}</span><span style="font-size:12px;color:#64748b;">pcs rusak</span></div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;"><span class="material-symbols-outlined" style="font-size:14px;color:#64748b;">person</span><span style="font-size:12px;font-weight:600;color:#334155;">${latest.oleh||'—'}</span><span style="font-size:11px;color:#94a3b8;">· ${latest.sesi||''}</span></div>
            ${latest.keterangan?`<div style="font-size:12px;color:#64748b;background:#fff;border-radius:6px;padding:8px 10px;border:1px solid #f1f5f9;">${latest.keterangan}</div>`:''}
          </div>
          ${history.length?`<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Riwayat Sebelumnya</div><div style="max-height:140px;overflow-y:auto;">${history.map(r=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border:1px solid #f1f5f9;border-radius:7px;margin-bottom:5px;background:#fafafa;"><div><span style="font-weight:700;color:#be123c;">${r.jumlahRusak} pcs</span><span style="font-size:11px;color:#64748b;margin-left:6px;">· ${r.oleh||'—'} · ${r.sesi||''}</span></div><span style="font-size:10px;color:#94a3b8;">${r.dicatatPada||''}</span></div>`).join('')}</div>`:''}`;
      } catch(e) {
        body.innerHTML = '<div style="text-align:center;color:#ef4444;padding:20px;">Gagal memuat data.</div>';
      }
    }
    function soTutupRusakModal(e) {
      if (e && e.target !== document.getElementById('so-rusak-modal')) return;
      document.getElementById('so-rusak-modal').style.display = 'none';
    }

// =============================================
    // MODUL DATA OPNAME
    // =============================================
    let doSemuaData   = [];
    let doDataFilter  = [];
    let doRusakMap    = {};  // sku → data rusak terbaru
    let doHalamanAkt  = 1;
    let doSudahInit   = false;
    let doSkuAktif    = '';
    let doNamaAktif   = '';
    const DO_PER_HAL  = 50;

    async function initDataOpname(sesiAwal) {
      if (!doSudahInit) {
        doSudahInit = true;
        await doMuatDaftarSesi();
      }
      if (sesiAwal) {
        const sel = document.getElementById('do-sesi-select');
        if (sel.value !== sesiAwal) { sel.value = sesiAwal; await doGantiSesi(); }
      }
    }

    async function doMuatDaftarSesi() {
      const sel = document.getElementById('do-sesi-select');
      sel.innerHTML = '<option value="">Memuat...</option>';
      sel.disabled = true;
      try {
        // Langsung dari browser ke Apps Script
        const data = await gasGetDirect({ action: 'soListSesi' });
        if (!data.success || !data.data || !data.data.length) {
          sel.innerHTML = '<option value="">Tidak ada data SO</option>';
          sel.disabled = false; return;
        }
        const bMap = {1:'Januari',2:'Februari',3:'Maret',4:'April',5:'Mei',6:'Juni',
                      7:'Juli',8:'Agustus',9:'September',10:'Oktober',11:'November',12:'Desember'};
        sel.innerHTML = '<option value="">— Pilih Bulan SO —</option>';
        data.data.forEach(s => {
          const o = document.createElement('option');
          o.value = s.nama;
          o.textContent = `${bMap[s.bulan]||s.bulan} ${s.tahun}`;
          sel.appendChild(o);
        });
        sel.disabled = false;
        if (data.data.length) { sel.value = data.data[0].nama; await doGantiSesi(); }
      } catch(e) {
        sel.innerHTML = '<option value="">Gagal memuat sesi</option>';
        sel.disabled = false;
      }
    }

    async function doGantiSesi() {
      const sesi = document.getElementById('do-sesi-select').value;
      if (!sesi) return;
      doSemuaData = []; doDataFilter = []; doHalamanAkt = 1;
      doTampilLoading();
      try {
        // Load data SO langsung dari browser ke Apps Script (tanpa lewat Railway)
        const dataSO = await gasGetDirect({ action: 'soLoadData', sesi });
        if (!dataSO.success) { doTampilPesan('error', dataSO.message||'Gagal memuat data SO.'); return; }
        doSemuaData = dataSO.rows || [];

        // Populate filter Tim dari data (sort numerik)
        const timSet = [...new Set(doSemuaData.map(r => String(r.tim||'').trim()).filter(Boolean))]
          .sort((a,b) => {
            const na = parseInt(a), nb = parseInt(b);
            return (!isNaN(na) && !isNaN(nb)) ? na - nb : a.localeCompare(b);
          });
        const selTim = document.getElementById('do-filter-tim');
        const prevTim = selTim.value;
        selTim.innerHTML = '<option value="">Semua Tim</option>';
        timSet.forEach(t => {
          const o = document.createElement('option');
          o.value = o.textContent = t;
          selTim.appendChild(o);
        });
        if (timSet.includes(prevTim)) selTim.value = prevTim;

        // Load data rusak langsung ke Apps Script (baca _SO_RUSAK, tidak perlu Railway)
        try {
          const dataRusak = await gasGetDirect({ action: 'soGetRusak', sesi });
          doRusakMap = {};
          if (dataRusak.success) dataRusak.rows.forEach(r => { doRusakMap[r.sku] = r; });
        } catch(e) { doRusakMap = {}; }

        document.getElementById('do-info-sesi').textContent = sesi;
        document.getElementById('do-info-bar').style.display = '';
        doFilter();
      } catch(e) {
        console.error('doGantiSesi error:', e);
        doTampilPesan('error', 'Gagal terhubung ke Apps Script.');
      }
    }

    function doNormStatus(s) {
      // Mapping nilai sheet → tampilan web
      const v = String(s||'').trim();
      const map = { 'Cocok':'Balance', 'Kurang':'Minus', 'Lebih':'Plus' };
      return map[v] || v;
    }

    function doFilter() {
      const cari       = (document.getElementById('do-cari').value||'').toLowerCase();
      const filterSO   = document.getElementById('do-filter-status').value;  // Balance/Plus/Minus/Belum
      const filterTim  = (document.getElementById('do-filter-tim').value||'').trim();
      const filterBrg  = document.getElementById('do-filter-barang').value;  // rusak/ok/''
      doDataFilter = doSemuaData.filter(r => {
        const normSt = doNormStatus(r.status);
        if (filterSO  && normSt !== filterSO)         return false;
        if (filterTim && String(r.tim||'').trim() !== filterTim) return false;
        const isRusak = !!doRusakMap[r.sku];
        if (filterBrg === 'rusak' && !isRusak) return false;
        if (filterBrg === 'ok'    && isRusak)  return false;
        if (cari && !(r.sku+' '+r.namaProduk).toLowerCase().includes(cari)) return false;
        return true;
      });
      doHalamanAkt = 1;
      doRenderTabel();
      document.getElementById('do-info-tampil').textContent = doDataFilter.length;
    }

    function doStatusSOBadge(status) {
      const norm = doNormStatus(status);
      const map = {
        'Balance': 'do-badge-so do-badge-so-balance',
        'Plus'   : 'do-badge-so do-badge-so-plus',
        'Minus'  : 'do-badge-so do-badge-so-minus',
        'Belum'  : 'do-badge-so do-badge-so-belum',
        'Cocok'  : 'do-badge-so do-badge-so-balance'
      };
      return `<span class="${map[norm]||'do-badge-so do-badge-so-belum'}">${norm||'Belum'}</span>`;
    }

    function doRenderTabel() {
      const tbody = document.getElementById('do-tbody');
      const table = document.getElementById('do-table');
      const pager = document.getElementById('do-pager');
      if (!doDataFilter.length) {
        table.style.display = 'none'; pager.style.display = 'none';
        doTampilPesan('empty', 'Tidak ada data yang sesuai filter.'); return;
      }
      document.getElementById('do-state-box').style.display = 'none';
      table.style.display = '';
      const total  = doDataFilter.length;
      const maxHal = Math.ceil(total / DO_PER_HAL);
      doHalamanAkt = Math.min(doHalamanAkt, maxHal);
      const mulai  = (doHalamanAkt-1)*DO_PER_HAL;
      const slice  = doDataFilter.slice(mulai, mulai+DO_PER_HAL);

      tbody.innerHTML = slice.map(r => {
        const rusak = doRusakMap[r.sku];
        // Data Opname: tidak tampilkan foto, ganti dengan nomor urut
        const foto = `<span style="font-size:11px;color:#cbd5e1;font-weight:600;">${mulai + slice.indexOf(r) + 1}</span>`;

        const statusBarang = rusak
          ? `<div class="do-badge-rusak"><span class="material-symbols-outlined" style="font-size:12px;">warning</span>${rusak.jumlahRusak} pcs · ${rusak.oleh}</div>`
          : `<span class="do-badge-ok">Normal</span>`;

        const sel = r.selisih===''?'<span style="color:#cbd5e1;">—</span>'
          : r.selisih<0?`<span class="do-sel-minus">${r.selisih}</span>`
          : r.selisih>0?`<span class="do-sel-plus">+${r.selisih}</span>`
          : '<span style="color:#94a3b8;">0</span>';
        const real = (r.totalReal===''||r.totalReal===null)
          ? '<span style="color:#94a3b8;font-style:italic;font-size:11px;">Belum</span>'
          : r.totalReal;
        const skuEsc   = r.sku.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const namaEsc  = r.namaProduk.replace(/\\/g,'\\\\').replace(/'/g,"\\'");

        return `<tr>
          <td style="padding:7px 10px;">${foto}</td>
          <td style="font-family:monospace;font-size:11px;color:#64748b;white-space:nowrap;">${r.sku}</td>
          <td style="font-size:13px;color:#1e293b;">${r.namaProduk}</td>
          <td><span style="font-weight:700;color:#334155;font-size:12px;">${r.rak}</span></td>
          <td style="color:#64748b;font-size:12px;">${r.tim||'—'}</td>
          <td style="text-align:right;font-weight:600;color:#334155;">${r.qtySistem}</td>
          <td style="text-align:right;color:#334155;">${real}</td>
          <td style="text-align:right;">${sel}</td>
          <td>${doStatusSOBadge(r.status)}</td>
          <td>${statusBarang}</td>
          <td style="text-align:center;">
            <button onclick="doOpenModal('${skuEsc}','${namaEsc}')"
              style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:5px 12px;cursor:pointer;font-size:14px;color:#64748b;font-weight:700;transition:all .12s;line-height:1;"
              onmouseover="this.style.background='#f1f5f9';this.style.color='#1e293b';"
              onmouseout="this.style.background='#f8fafc';this.style.color='#64748b';">···</button>
          </td>
        </tr>`;
      }).join('');

      if (maxHal > 1) {
        pager.style.display = '';
        document.getElementById('do-pager-info').textContent = `${doHalamanAkt} / ${maxHal}`;
        document.getElementById('do-pager-count').textContent = `${mulai+1}–${Math.min(mulai+DO_PER_HAL,total)} dari ${total}`;
        document.getElementById('do-btn-prev').disabled = doHalamanAkt <= 1;
        document.getElementById('do-btn-next').disabled = doHalamanAkt >= maxHal;
      } else { pager.style.display = 'none'; }
    }

    function doHalamanNav(arah) { doHalamanAkt += arah; doRenderTabel(); }

    function doTampilLoading() {
      document.getElementById('do-state-box').innerHTML = '<span class="material-symbols-outlined" style="animation:spin 1s linear infinite;">sync</span><p>Memuat data...</p>';
      document.getElementById('do-state-box').style.display = '';
      document.getElementById('do-table').style.display = 'none';
      document.getElementById('do-pager').style.display = 'none';
    }

    function doTampilPesan(tipe, pesan) {
      document.getElementById('do-state-box').innerHTML = `<span class="material-symbols-outlined">${tipe==='error'?'error':'search_off'}</span><p>${pesan}</p>`;
      document.getElementById('do-state-box').style.display = '';
      document.getElementById('do-table').style.display = 'none';
      document.getElementById('do-pager').style.display = 'none';
    }

    // ---- MODAL ----
    function doOpenModal(sku, nama) {
      doSkuAktif  = sku;
      doNamaAktif = nama;
      document.getElementById('do-modal-judul').textContent = nama || sku;
      document.getElementById('do-form-sku').value  = sku;
      document.getElementById('do-form-nama').value = nama;
      document.getElementById('do-form-qty').value  = '';
      document.getElementById('do-form-ket').value  = '';
      document.getElementById('do-form-msg').textContent = '';
      // Default tab ke Barang Rusak
      doSwitchTab('rusak', document.querySelector('.do-tab'));
      // Langsung load riwayat di background
      doLoadRiwayat(sku);
      document.getElementById('do-modal-overlay').classList.add('open');
    }

    function doTutupModal(e) {
      if (e && e.target !== document.getElementById('do-modal-overlay') && e.type !== 'click') return;
      if (e && e.currentTarget === document.getElementById('do-modal-overlay') && e.target !== e.currentTarget) return;
      document.getElementById('do-modal-overlay').classList.remove('open');
    }

    function doSwitchTab(tab, el) {
      document.querySelectorAll('.do-tab').forEach(t => t.classList.remove('aktif'));
      document.querySelectorAll('.do-tab-panel').forEach(p => p.classList.remove('aktif'));
      if (el) el.classList.add('aktif');
      else { document.querySelectorAll('.do-tab').forEach(t => { if(t.textContent.toLowerCase().includes(tab)) t.classList.add('aktif'); }); }
      document.getElementById('do-panel-' + tab).classList.add('aktif');
    }

    async function doLoadRiwayat(sku) {
      const box = document.getElementById('do-riwayat-list');
      box.innerHTML = '<div class="do-state-box" style="padding:20px 0;"><span class="material-symbols-outlined" style="animation:spin 1s linear infinite;font-size:28px;">sync</span><p>Memuat riwayat...</p></div>';
      const sesi = document.getElementById('do-sesi-select').value;
      try {
        // Langsung ke Apps Script
        const data = await gasGetDirect({ action: 'soGetRiwayat', sku, sesi });
        if (!data.success || !data.rows.length) {
          box.innerHTML = '<div class="do-state-box" style="padding:20px 0;"><span class="material-symbols-outlined" style="font-size:28px;">history</span><p>Belum ada riwayat untuk produk ini.</p></div>';
          return;
        }
        box.innerHTML = data.rows.map(r => `
          <div class="do-riwayat-item">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <span class="qty">${r.jumlahRusak} pcs rusak</span>
              <span class="tgl">${r.dicatatPada||'-'}</span>
            </div>
            <div class="user">👤 ${r.oleh} · ${r.sesi}</div>
            <div class="ket">${r.keterangan||'—'}</div>
          </div>
        `).join('');
      } catch(e) {
        box.innerHTML = '<div class="do-state-box" style="padding:20px 0;"><p>Gagal memuat riwayat.</p></div>';
      }
    }

    async function doSimpanRusak() {
      const qty = parseInt(document.getElementById('do-form-qty').value);
      const ket = document.getElementById('do-form-ket').value.trim();
      const msg = document.getElementById('do-form-msg');
      const btn = document.getElementById('do-btn-simpan');
      if (!qty || qty < 1) { msg.style.color='#ef4444'; msg.textContent='Jumlah rusak wajib diisi (min. 1 pcs).'; return; }
      const sesi  = document.getElementById('do-sesi-select').value;
      const token = sessionStorage.getItem('sessionToken');
      btn.disabled = true; btn.textContent = 'Menyimpan...';
      msg.textContent = '';
      try {
        const res  = await fetch('/api/so/rusak', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'x-session-token': token },
          body: JSON.stringify({ sku: doSkuAktif, namaProduk: doNamaAktif, sesi, jumlahRusak: qty, keterangan: ket })
        });
        const data = await res.json();
        if (data.success) {
          msg.style.color = '#16a34a';
          msg.textContent = '✅ Laporan rusak tersimpan.';
          // Update doRusakMap lokal
          doRusakMap[doSkuAktif] = { sku: doSkuAktif, jumlahRusak: qty, oleh: data.oleh||sessionStorage.getItem('sessionUser'), dicatatPada: data.dicatatPada||'', keterangan: ket, sesi };
          doRenderTabel();
          doLoadRiwayat(doSkuAktif);
          document.getElementById('do-form-qty').value = '';
          document.getElementById('do-form-ket').value = '';
        } else {
          msg.style.color = '#ef4444'; msg.textContent = data.message||'Gagal menyimpan.';
        }
      } catch(e) { msg.style.color='#ef4444'; msg.textContent='Gagal terhubung ke server.'; }
      finally { btn.disabled = false; btn.textContent = 'Simpan Laporan Rusak'; }
    }

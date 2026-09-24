// main.js — PDC Warehouse Admin

let allTrackedData = [];

    const WAREHOUSE_LIST = [
      { id: 'pdc', name: 'PDC WAREHOUSE' },
      { id: 'febri', name: 'FEBRI WAREHOUSE' },
      { id: 'palem', name: 'PALEM WAREHOUSE' },
      { id: 'cemara', name: 'CEMARA WAREHOUSE' }
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
            <td style="font-weight:600;color:#1e293b;">${u.username}</td>
            <td><span style="background:${u.role==='superuser'?'#fef3c7':u.role==='admin'?'#f1f5f9':'#f0fdf4'};color:${u.role==='superuser'?'#92400e':u.role==='admin'?'#475569':'#15803d'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">${u.role === 'superuser' ? 'Superuser' : u.role === 'admin' ? 'Admin' : 'User'}</span></td>
            <td style="color:#64748b;font-size:12px;">${u.createdAt ? new Date(u.createdAt).toLocaleDateString('id-ID') : '-'}</td>
            <td>
              ${u.role !== 'superuser' ? `<button onclick="deleteUser('${u.username}')" style="background:#fee2e2;color:#ef4444;border:none;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;">Hapus</button>` : '<span style="color:#cbd5e1;font-size:11px;">—</span>'}
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
    let cancelResiSet = new Set();     // semua resi berstatus cancel di tanggal terpilih
    let cancelScannedSet = new Set();  // resi yang sudah discan selama sesi popup ini terbuka

    // URL Apps Script — fetch langsung dari browser tanpa lewat Railway
    const GAS_URL = 'https://script.google.com/macros/s/AKfycbwBaBiM08RtAuPayp-vtJINsO3li2blbVg1sbTJtKFPF3-xLN6zhBg5_UbUG_79mQoJ/exec';

    async function gasGetDirect(params) {
      const url = new URL(GAS_URL);
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url.toString());
      return await res.json();
    }

    async function openLacakCancel() {
      const tanggal = document.getElementById('filter-tanggal').value;
      if (!tanggal) return showToast('Pilih tanggal terlebih dahulu!', 'warning');
      const gudang = document.getElementById('filter-gudang').value;

      const cm = document.getElementById('cancel-modal');
      cm.style.display = 'flex';
      const resultBox = document.getElementById('cancel-last-result');
      resultBox.innerText = 'Memuat data cancel...';
      resultBox.style.background = '#f8fafc';
      resultBox.style.color = '#64748b';

      cancelResiSet = new Set();
      cancelScannedSet = new Set();
      updateCancelCounts();

      try {
        const params = { action: 'cancelList', tanggal };
        if (gudang) params.gudang = gudang;
        const data = await gasGetDirect(params);
        if (!data.success) {
          resultBox.innerText = data.message || 'Gagal memuat data.';
          return;
        }
        data.rows.forEach(r => cancelResiSet.add(String(r.resi).toUpperCase()));
        renderCancelList(data.rows);
        updateCancelCounts();
        resultBox.innerText = `${cancelResiSet.size} resi cancel siap discan.`;
        document.getElementById('cancel-scan-input').value = '';
        document.getElementById('cancel-scan-input').focus();
      } catch (err) {
        resultBox.innerText = 'Gagal terhubung ke Apps Script.';
      }
    }

    function renderCancelList(rows) {
            document.getElementById('cancel-total-count').innerText = cancelResiSet.size;
      document.getElementById('cancel-scanned-count').innerText = cancelScannedSet.size;
    }

    // =============================================

// [audio dimuat dari audio.js]

function handleCancelScan(event) {
      if (event.key !== 'Enter') return;
      const input = document.getElementById('cancel-scan-input');
      const resi  = input.value.trim().toUpperCase();
      input.value = '';
      if (!resi) return;

      const resultBox = document.getElementById('cancel-last-result');

      // Cek apakah resi JNT (awalan JY atau JX)
      const isJNT = resi.startsWith('JY') || resi.startsWith('JX');
      if (!isJNT) {
        playScanVoice('tidak_valid');
        resultBox.innerHTML = `
          <div style="text-align:center;">
            <div style="font-size:28px;margin-bottom:4px;">🚫</div>
            <div style="font-size:15px;font-weight:800;color:#be123c;">Bukan Paket JNT</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace;">${resi}</div>
          </div>`;
        resultBox.style.background = '#fff1f2';
        resultBox.style.border     = '1.5px solid #fecdd3';
        return;
      }

      // Double paket
      if (cancelScannedSet.has(resi)) {
        playScanVoice('double');
        resultBox.innerHTML = `
          <div style="text-align:center;">
            <div style="font-size:28px;margin-bottom:4px;">⚠️</div>
            <div style="font-size:15px;font-weight:800;color:#92400e;">Double Paket!</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace;">${resi}</div>
          </div>`;
        resultBox.style.background = '#fef3c7';
        resultBox.style.border     = '1.5px solid #fde68a';
        return;
      }

      cancelScannedSet.add(resi);

      if (cancelResiSet.has(resi)) {
        // Paket cancel ditemukan
        playScanVoice('cancel');
        resultBox.innerHTML = `
          <div style="text-align:center;">
            <div style="font-size:28px;margin-bottom:4px;">🚨</div>
            <div style="font-size:15px;font-weight:800;color:#dc2626;">Paket Cancel!</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace;">${resi}</div>
          </div>`;
        resultBox.style.background = '#fee2e2';
        resultBox.style.border     = '1.5px solid #fca5a5';
      } else {
        // Resi valid (JNT, ada di daftar, bukan cancel)
        playScanVoice('valid');
        resultBox.innerHTML = `
          <div style="text-align:center;">
            <div style="font-size:28px;margin-bottom:4px;">✅</div>
            <div style="font-size:15px;font-weight:800;color:#16a34a;">Paket Valid</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;font-family:monospace;">${resi}</div>
          </div>`;
        resultBox.style.background = '#f0fdf4';
        resultBox.style.border     = '1.5px solid #86efac';
      }

      updateCancelCounts();
    }

    function closeLacakCancel() {
      document.getElementById('cancel-modal').style.display = 'none';
      // Reset result box
      document.getElementById('cancel-last-result').innerHTML = `
        <div style="text-align:center;color:#94a3b8;">
          <div style="font-size:32px;margin-bottom:6px;">📦</div>
          <div style="font-size:13px;font-weight:600;">Siap scan resi...</div>
          <div style="font-size:11px;margin-top:3px;opacity:.7;">JY/JX = JNT · Lainnya = tidak valid</div>
        </div>`;
      document.getElementById('cancel-last-result').style.background = '#f8fafc';
      document.getElementById('cancel-last-result').style.border = '1.5px solid #e2e8f0';
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

        banner.style.background = '#fef3c7';
        banner.style.borderColor = '#fde68a';
        document.getElementById('awb-banner-jumlah').innerHTML =
          `<span style="font-size:26px;font-weight:800;color:#92400e;">${resiList.length}</span>` +
          ` <span style="font-size:13px;font-weight:500;color:#b45309;">resi siap dilacak</span>`;
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
        msg.style.color = '#d97706'; return;
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
        banner.style.background = '#fef3c7';
        banner.style.borderColor = '#fde68a';
        document.getElementById('awb-banner-jumlah').innerHTML =
          `<span style="font-size:26px;font-weight:800;color:#92400e;">${data.rows.length}</span>` +
          ` <span style="font-size:13px;font-weight:500;color:#b45309;">resi dari Tracking AWB</span>`;
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
      msg.style.color = '#d97706';
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
        msg.style.color = '#d97706';
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
        msg.style.color = '#d97706';
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
            headers: { 'Content-Type': 'application/json' },
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
          msg.style.color = '#d97706';
          document.getElementById('btn-sync-wrap').style.display = '';
        }
      } catch {
        document.getElementById('progress-label').innerText = 'Tracking selesai — gagal simpan otomatis.';
        msg.innerText = '⚠️ Tracking selesai tapi gagal simpan — klik Simpan ke Sheet manual.';
        msg.style.color = '#d97706';
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
        waiting          : { lbl:'Menunggu Diproses', bg:'#f59e0b', text:'#fff' },
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
            <div style="font-size:10px;font-weight:700;color:${isMax?'#d97706':'#94a3b8'};">${d.val>0?d.val.toLocaleString('id-ID'):''}</div>
            <div style="height:${h_px}px;width:100%;border-radius:4px 4px 0 0;
              background:${d.val===0?'#f1f5f9':isMax?'#f59e0b':'#fbbf24'};min-height:4px;"
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
                  <tr style="border-bottom:1px solid #f8fafc;transition:background .1s;" onmouseover="this.style.background='#fffbeb'" onmouseout="this.style.background=''">
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

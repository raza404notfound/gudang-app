// kelola-akun.js — Manajemen Akun

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

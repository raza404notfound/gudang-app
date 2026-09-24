// gudang-insight.js — Gudang Insight

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

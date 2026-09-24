// data-opname.js — Data Opname

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

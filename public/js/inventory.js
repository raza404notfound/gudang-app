// inventory.js — Pusat Inventory Card View

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

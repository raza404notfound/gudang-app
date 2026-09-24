// lacak-awb.js — Lacak AWB, Lacak Cancel, Date Picker

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
      cm.style.alignItems = 'center';
      cm.style.justifyContent = 'center';
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
      const tbody = document.getElementById('cancel-list-body');
      if (!rows || rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:16px;">Tidak ada resi cancel di tanggal ini.</td></tr>`;
        return;
      }
      tbody.innerHTML = rows.map(r => `
        <tr id="cancel-row-${r.resi}">
          <td style="padding:5px 4px;font-family:monospace;font-weight:600;">${r.resi}</td>
          <td style="padding:5px 4px;color:#94a3b8;font-size:11px;">${r.gudang || '-'}</td>
          <td style="padding:5px 4px;text-align:center;">
            <span style="font-size:10px;background:#f1f5f9;color:#475569;padding:2px 6px;border-radius:4px;font-weight:600;">${r.batch || '-'}</span>
          </td>
          <td style="padding:5px 4px;text-align:right;"><span id="cancel-badge-${r.resi}" style="font-size:10px;color:#94a3b8;">Belum scan</span></td>
        </tr>
      `).join('');
    }

    function updateCancelCounts() {
      document.getElementById('cancel-total-count').innerText = cancelResiSet.size;
      document.getElementById('cancel-scanned-count').innerText = cancelScannedSet.size;
    }

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

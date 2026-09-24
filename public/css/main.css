/* main.css — PDC Warehouse Admin */
/* Semua CSS: global, sidebar, layout, komponen */


    /* Variabel tema kuning — hanya root vars */
    :root {
      --kn-utama  : #fbbf24;
      --kn-hover  : #d97706;
      --kn-gelap  : #92400e;
      --kn-muda   : #fef3c7;
      --kn-border : #fde68a;
      --kn-navy   : #1e293b;
    }
  


    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Roboto', sans-serif; }
    body { display: flex; background-color: #f1f5f9; color: #334155; height: 100vh; overflow: hidden; min-width: 320px; }
    /* Konten admin punya min-width supaya tidak collapse di layar kecil */
    .main-wrapper { min-width: 0; }

    /* ---- SIDEBAR ---- */
    .sidebar {
      width: 256px; background: #fff;
      border-right: 1px solid #e8edf2;
      display: flex; flex-direction: column;
      height: 100%; flex-shrink: 0; overflow-y: auto;
    }
    .sidebar::-webkit-scrollbar { width: 0; }

    /* Brand */
    .brand-header {
      padding: 18px 16px 14px;
      display: flex; align-items: center; gap: 12px;
      border-bottom: 1px solid #f1f5f9;
    }
    .brand-logo {
      width: 38px; height: 38px; border-radius: 10px;
      background: linear-gradient(135deg,#fbbf24,#d97706);
      color: #1e293b; display: flex; align-items: center;
      justify-content: center; flex-shrink: 0;
      box-shadow: 0 3px 10px rgba(251,191,36,.3);
    }
    .brand-text { display: flex; flex-direction: column; line-height: 1.25; }
    .brand-name { font-size: 16px; font-weight: 900; color: #d97706; letter-spacing: -.3px; }
    .brand-sub  { font-size: 9.5px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: .7px; }

    /* User Profile */
    .user-profile {
      margin: 10px 12px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #fefce8, #fef9c3);
      border: 1px solid #fde68a;
      border-radius: 12px;
      display: flex; align-items: center; gap: 11px;
    }
    .avatar {
      width: 40px; height: 40px; border-radius: 10px;
      background: linear-gradient(135deg, #fbbf24, #d97706);
      color: #1e293b; display: flex; align-items: center;
      justify-content: center; font-weight: 800; font-size: 17px;
      flex-shrink: 0; box-shadow: 0 2px 8px rgba(251,191,36,.3);
    }
    .user-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .user-name {
      font-size: 13px; font-weight: 800; color: #1e293b;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .user-badge {
      font-size: 10px; font-weight: 700;
      background: #fbbf24; color: #1e293b;
      padding: 2px 8px; border-radius: 20px;
      width: max-content;
    }
    .user-email { display: none; }

    /* Nav body — flex grow */
    .nav-body { flex: 1; }
    .nav-section { padding: 16px 10px 4px; }
    .section-title {
      font-size: 9.5px; font-weight: 700; color: #b0bec5;
      text-transform: uppercase; letter-spacing: 1px;
      padding: 0 10px 8px;
    }
    .nav-item {
      display: flex; align-items: center; gap: 11px;
      padding: 9px 12px; border-radius: 8px;
      color: #64748b; text-decoration: none;
      font-size: 13px; font-weight: 500;
      cursor: pointer; transition: all .15s;
      margin-bottom: 2px;
    }
    .nav-item .material-symbols-outlined { font-size: 18px; flex-shrink: 0; transition: color .15s; }
    .nav-item:hover { background: #fef3c7; color: #92400e; }
    .nav-item:hover .material-symbols-outlined { color: #d97706; }
    .nav-item.active { background: #fef3c7; color: #92400e; font-weight: 700; }
    .nav-item.active .material-symbols-outlined { color: #d97706; }

    /* Sidebar footer - keluar */
    .sidebar-footer {
      padding: 10px 10px 16px;
      border-top: 1px solid #f1f5f9;
      margin-top: auto;
    }
    .sidebar-logout {
      color: #e11d48; font-weight: 600;
      background: #fff1f2; border-radius: 8px;
      margin: 0 2px; border: 1.5px solid #fecdd3;
    }
    .sidebar-logout:hover { background: #fee2e2; border-color: #fca5a5; }
    .sidebar-logout .material-symbols-outlined { color: #e11d48; }

    /* MAIN WRAPPER */
    .main-wrapper { flex: 1; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
    .top-header {
      height: 54px; background: #fff;
      border-bottom: 1px solid #e8edf2;
      display: flex; align-items: center;
      justify-content: space-between; padding: 0 22px;
      font-size: 15px; font-weight: 700; color: #1e293b;
      box-shadow: 0 1px 0 #e8edf2;
    }
    .top-header-left { display: flex; align-items: center; gap: 8px; }
    .top-header-left .material-symbols-outlined { font-size: 20px; color: #94a3b8; }
    /* btn-logout dipindah ke sidebar */

    .content-container {
      flex: 1; padding: 22px 24px; overflow-y: auto; scroll-behavior: smooth;
    }
    /* Opsi C: konten punya max-width tapi tetap fluid */
    .page-content {
      width: 100%;
      /* Tidak pakai max-width di sini — layout AWB butuh full width */
    }
    .content-container::-webkit-scrollbar { width: 5px; }
    .content-container::-webkit-scrollbar-track { background: transparent; }
    .content-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
    .content-container::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
    /* Data Opname: padding dihandle oleh do-sticky-top dan do-scroll-area */
    .page-content { display: none; }
    .page-content.active { display: block; }

    /* ---- PAGE LOADING OVERLAY (bukan login) ---- */
    #page-loading {
      position: absolute; inset: 0;
      background: #fff;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      gap: 16px; z-index: 50;
    }
    #page-loading.hidden { display: none; }
    .page-loading-spinner {
      width: 36px; height: 36px;
      border: 3px solid #f1f5f9;
      border-top-color: #e11d48;
      border-radius: 50%;
      animation: spin .7s linear infinite;
    }
    .page-loading-text {
      font-size: 13px; color: #94a3b8; font-weight: 500;
    }

    /* DASHBOARD LAYOUT & CARDS */
    .dashboard-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-shrink:0; }
    #page-dashboard.active { display:flex !important; flex-direction:column; height:calc(100vh - 55px); overflow:hidden; }
    .dashboard-scroll { flex:1; overflow-y:auto; overflow-x:hidden; scroll-behavior:smooth; padding-bottom:20px; }
    .dashboard-scroll::-webkit-scrollbar { width:5px; }
    .dashboard-scroll::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:10px; }
    .dashboard-sticky { position:sticky; top:0; z-index:5; background:#f8fafc; padding-bottom:10px; flex-shrink:0; }
    .summary-badges { display: flex; gap: 12px; font-size: 13px; font-weight: 600; }
    .badge { background: #fff; border: 1px solid #e2e8f0; padding: 6px 14px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.03); color: #334155; }
    .badge span.inc { color: #dc2626; font-weight: 700; }
    .badge span.out { color: #2563eb; font-weight: 700; }
    
    /* ---- DASHBOARD ---- */
    .grid-container { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .wh-card { background: #fff; border-radius: 10px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.05); }
    .wh-title { background: #1e293b; color: #f8fafc; padding: 9px 14px; font-weight: 700; font-size: 12px; letter-spacing: .6px; text-transform: uppercase; }
    .tables-flex { display: flex; background: #f1f5f9; gap: 1px; }
    .table-box { flex: 1; background: #fff; display: flex; flex-direction: column; justify-content: space-between; }
    .table-header { padding: 7px 12px; font-size: 10px; font-weight: 700; color: #475569; display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border-bottom: 1px solid #f1f5f9; letter-spacing:.4px; text-transform:uppercase; }
    .total-chip-inc { background:#dcfce7; color:#15803d; padding:2px 7px; border-radius:20px; font-size:10px; font-weight:700; }
    .total-chip-out { background:#dbeafe; color:#1d4ed8; padding:2px 7px; border-radius:20px; font-size:10px; font-weight:700; }
    table { width:100%; border-collapse:collapse; font-size:11px; }
    th, td { padding:6px 10px; text-align:left; border-bottom:1px solid #f8fafc; }
    th { color:#94a3b8; font-weight:700; background:#fff; font-size:9px; text-transform:uppercase; letter-spacing:.5px; }
    .status-name { font-weight:500; color:#334155; font-size:11px; }
    .status-chip { display:inline-block; padding:1px 7px; border-radius:20px; font-weight:600; font-size:10px; }
    .status-batal { background:#fee2e2; color:#ef4444; }
    .num { text-align:left; color:#475569; font-size:11px; }
    .num span { font-size:9px; color:#94a3b8; margin-left:2px; }
    .pct { text-align:left; color:#64748b; font-size:10px; font-weight:600; width:90px; }
    .table-footer { padding:6px 12px; font-size:10px; color:#94a3b8; border-top:1px solid #f8fafc; display:flex; align-items:center; gap:4px; background:#fff; }
    .table-footer .material-symbols-outlined { font-size:12px; }
    .progress-bar-container { display:flex; align-items:center; gap:6px; width:100%; }
    .progress-track { flex:1; height:4px; background:#f1f5f9; border-radius:3px; overflow:hidden; }
    .progress-fill-inc { height:100%; background:#fbbf24; border-radius:3px; transition:width .3s ease; }
    .progress-fill-out { height:100%; background:#3b82f6; border-radius:3px; transition:width .3s ease; }

    /* LAYOUT LACAK AWB 2 KOLOM */
    .tracking-layout { display: flex; gap: 20px; align-items: flex-start; }
    .tracking-main-left { flex: 1; min-width: 0; }
    .tracking-sidebar-right { width: 320px; flex-shrink: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }

    .textarea-resi {
      width: 100%; height: 180px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 6px;
      font-size: 13px; outline: none; font-family: monospace; resize: vertical; line-height: 1.5;
    }
    .textarea-resi:focus { border-color: #e11d48; box-shadow: 0 0 0 2px rgba(225, 29, 72, 0.1); }

    .summary-box-title { font-size: 14px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
    .summary-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px dashed #f1f5f9; font-size: 13px; font-weight: 500; }
    
    .txt-kuning { color: #d97706; font-weight: 700; }
    .txt-hijau { color: #16a34a; font-weight: 700; }
    .txt-merah { color: #dc2626; font-weight: 700; }
    
    .btn-lacak-utama {
      width: 100%; padding: 12px; background: #e11d48; color: #ffffff; border: none; border-radius: 6px;
      font-size: 14px; font-weight: 700; cursor: pointer; transition: 0.2s; display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 16px;
      box-shadow: 0 2px 4px rgba(225, 29, 72, 0.2);
    }
    .btn-lacak-utama:hover { background: #be123c; }
    .btn-lacak-utama:disabled { background: #94a3b8; cursor: not-allowed; }

    .table-container-track { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; margin-top: 20px; }
    .track-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .track-table th { background: #f8fafc; padding: 10px 12px; text-align: left; font-weight: 700; color: #475569; border-bottom: 1px solid #e2e8f0; }
    .track-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    
    /* ---- LOGIN ---- */
    .login-overlay {
      position: fixed; inset: 0;
      display: flex; justify-content: center; align-items: center;
      z-index: 9999; overflow: hidden;
      background: linear-gradient(135deg, #0a0f1e 0%, #1e293b 50%, #0a0f1e 100%);
    }
    .login-overlay::after {
      content: ''; position: absolute; bottom: -80px; left: 50%;
      transform: translateX(-50%);
      width: 700px; height: 300px;
      background: radial-gradient(ellipse, rgba(251,191,36,.2) 0%, transparent 70%);
      z-index: 1; pointer-events: none;
    }
    .login-bg-art {
      position: absolute; inset: 0; width: 100%; height: 100%;
      z-index: 1; opacity: .15; pointer-events: none;
    }
    .login-card {
      position: relative; z-index: 2;
      background: rgba(255,255,255,.1);
      backdrop-filter: blur(20px) saturate(1.4);
      -webkit-backdrop-filter: blur(20px) saturate(1.4);
      border: 1px solid rgba(255,255,255,.18);
      padding: 36px 32px; border-radius: 20px; width: 360px;
      box-shadow: 0 24px 60px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.08);
    }
    .login-logo {
      display: flex; align-items: center; justify-content: center;
      gap: 10px; margin-bottom: 22px;
    }
    .login-logo-icon {
      width: 42px; height: 42px; border-radius: 12px;
      background: linear-gradient(135deg,#fbbf24,#d97706);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 14px rgba(251,191,36,.4);
    }
    .login-logo-icon .material-symbols-outlined { font-size: 22px; color: #1e293b; }
    .login-logo-text { display: flex; flex-direction: column; line-height: 1.2; }
    .login-logo-name { font-size: 18px; font-weight: 900; color: #fbbf24; letter-spacing: -.3px; }
    .login-logo-sub  { font-size: 10px; color: rgba(255,255,255,.5); font-weight: 600; text-transform: uppercase; letter-spacing: .8px; }
    .login-card h3 { margin-bottom: 4px; font-size: 18px; font-weight: 700; text-align: center; color: #fff; }
    .login-card p  { font-size: 12px; color: rgba(255,255,255,.5); text-align: center; margin-bottom: 22px; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 11px; font-weight: 700; margin-bottom: 6px; color: rgba(255,255,255,.7); text-transform: uppercase; letter-spacing: .4px; }
    .form-group input {
      width: 100%; padding: 11px 12px;
      background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15);
      border-radius: 8px; font-size: 13px; outline: none; transition: .2s; color: #fff;
    }
    .form-group input::placeholder { color: rgba(255,255,255,.3); }
    .form-group input:focus { border-color: #fbbf24; background: rgba(255,255,255,.12); box-shadow: 0 0 0 3px rgba(251,191,36,.2); }
    .btn-auth {
      width: 100%; padding: 12px;
      background: linear-gradient(135deg,#fbbf24,#d97706);
      color: #1e293b; border: none; border-radius: 10px;
      font-size: 14px; font-weight: 800; cursor: pointer;
      margin-top: 8px; transition: .2s;
      box-shadow: 0 4px 14px rgba(251,191,36,.35);
    }
    .btn-auth:hover { background: linear-gradient(135deg,#f59e0b,#b45309); box-shadow: 0 6px 20px rgba(251,191,36,.45); }
    .toggle-auth { display: block; text-align: center; margin-top: 14px; font-size: 12px; color: rgba(251,191,36,.8); font-weight: 600; cursor: pointer; }
    .toggle-auth:hover { color: #fbbf24; text-decoration: underline; }
    #toggle-pass-icon .material-symbols-outlined { color: rgba(255,255,255,.4); }
    #toggle-pass-icon:hover .material-symbols-outlined { color: rgba(255,255,255,.8); }

    /* =============================================
       RESPONSIVE — MOBILE & TABLET
       Tidak mengubah logic JS manapun,
       hanya menyesuaikan layout & ukuran elemen.
    ============================================= */

    /* Hamburger button — disembunyikan di desktop */
    .btn-hamburger {
      display: none;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      cursor: pointer;
      color: #334155;
      padding: 4px;
      border-radius: 6px;
      transition: background 0.2s;
      margin-right: 4px;
    }
    .btn-hamburger:hover { background: #f1f5f9; }
    .btn-hamburger .material-symbols-outlined { font-size: 22px; }

    /* Overlay gelap saat sidebar terbuka di mobile */
    .sidebar-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      z-index: 200;
    }
    .sidebar-overlay.active { display: block; }

    /* ---- TABLET (max 1024px) ---- */
    @media (max-width: 1024px) {
      .grid-container { grid-template-columns: 1fr; }
      .tracking-layout { flex-direction: column; }
      .tracking-sidebar-right { width: 100%; }
      #page-dashboard.active { height:auto; overflow:visible; }
      .dashboard-scroll { overflow:visible; }
      .dashboard-sticky { position:relative; }
    }

    /* ---- MOBILE (max 768px) ---- */
    @media (max-width: 768px) {
      /* Tampilkan tombol hamburger */
      .btn-hamburger { display: flex; }

      /* Sidebar jadi overlay dari kiri */
      .sidebar {
        position: fixed;
        top: 0; left: 0;
        height: 100%;
        width: 256px;
        z-index: 300;
        transform: translateX(-100%);
        transition: transform 0.25s ease;
        box-shadow: 4px 0 20px rgba(0,0,0,0.15);
      }
      .sidebar.open { transform: translateX(0); }

      /* Overlay gelap saat sidebar terbuka */
      .sidebar-backdrop {
        display: none; position: fixed; inset: 0;
        background: rgba(0,0,0,.4); z-index: 299;
      }
      .sidebar-backdrop.show { display: block; }

      body { overflow: auto; }
      .main-wrapper { width: 100%; }
      .page-content { max-width: 100% !important; }

      /* Header lebih compact */
      .top-header { padding: 0 12px; height: 50px; font-size: 14px; }

      /* Content padding lebih kecil */
      .content-container { padding: 12px; }

      /* Grid selalu 1 kolom */
      .grid-container { grid-template-columns: 1fr; gap: 12px; }

      /* Tabel warehouse: inbound & outbound stack vertikal */
      .tables-flex { flex-direction: column; gap: 0; }
      .table-box { border-top: 1px solid #e2e8f0; }
      .table-box:first-child { border-top: none; }

      /* Tracking layout stack */
      .tracking-layout { flex-direction: column; gap: 12px; }
      .tracking-sidebar-right { width: 100%; }

      /* Textarea resi lebih pendek di mobile */
      .textarea-resi { height: 120px; }

      /* Tabel horizontal scroll di mobile */
      .table-container-track { overflow-x: auto; }
      .track-table { min-width: 520px; }

      /* Summary badges di dashboard wrap */
      .dashboard-header { flex-direction: column; align-items: flex-start; gap: 8px; }
      .summary-badges { flex-wrap: wrap; gap: 8px; }
      .badge { font-size: 12px; padding: 5px 10px; }
      #page-dashboard.active { height:auto; overflow:visible; }
      .dashboard-scroll { overflow:visible; }
      .dashboard-sticky { position:relative; padding-bottom:0; }

      /* Tabel warehouse horizontal scroll */
      .wh-card { overflow-x: auto; }
      table { min-width: 360px; }

      /* Brand lebih compact di mobile */
      .brand-name { font-size: 13px; }
      .brand-sub { display: none; }
      .user-profile { padding: 10px 14px 12px; }
      /* Login card lebih kecil */
      .login-card { width: calc(100vw - 32px); padding: 24px 20px; }

      /* Chip progress text lebih kecil */
      #chunk-progress-text { font-size: 10px; }
    }

    /* ---- SMALL MOBILE (max 400px) ---- */
    @media (max-width: 400px) {
      .top-header { font-size: 13px; }
      .btn-logout span:not(.material-symbols-outlined) { display: none; }
      .btn-logout { padding: 6px 8px; }
      .brand-header { font-size: 14px; }
    }

    /* Animasi spin untuk tombol loading lacak AWB */
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* =============================================
       AWB TRACKING — NEW UI
    ============================================= */
    .awb-toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; justify-content:space-between; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:14px 18px; margin-bottom:12px; }
    .awb-toolbar-left { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
    .awb-toolbar-right { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .awb-filter-group { display:flex; flex-direction:column; gap:4px; }
    .awb-label { font-size:10px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; }
    .awb-date-input { padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; outline:none; color:#334155; }
    .awb-date-input:focus { border-color:#e11d48; }
    .awb-select { padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:13px; outline:none; background:#fff; color:#334155; }
    .awb-btn { display:flex; align-items:center; gap:6px; padding:7px 14px; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; transition:0.2s; }
    .awb-btn .material-symbols-outlined { font-size:15px; }
    .awb-btn-dark { background:#0f172a; color:#fff; }
    .awb-btn-dark:hover { background:#1e293b; }
    .awb-btn-yellow { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
    .awb-btn-yellow:hover { background:#fde68a; }
    .awb-btn-blue { background:#0284c7; color:#fff; }
    .awb-btn-blue:hover { background:#0369a1; }
    .awb-btn-blue:disabled { background:#94a3b8; cursor:not-allowed; }
    .awb-status-msg { font-size:12px; color:#64748b; min-height:16px; margin-bottom:10px; padding:0 2px; }

    .awb-stat-grid { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:14px; }
    .awb-stat-card { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; display:flex; align-items:center; gap:10px; }
    .awb-stat-icon .material-symbols-outlined { font-size:22px; }
    .awb-stat-val { font-size:20px; font-weight:800; line-height:1; }
    .awb-stat-label { font-size:10px; color:#94a3b8; font-weight:600; text-transform:uppercase; margin-top:2px; }
    .stat-total .awb-stat-icon { color:#475569; } .stat-total .awb-stat-val { color:#1e293b; }
    .stat-proses .awb-stat-icon { color:#0284c7; } .stat-proses .awb-stat-val { color:#0284c7; }
    .stat-jalan .awb-stat-icon { color:#16a34a; } .stat-jalan .awb-stat-val { color:#16a34a; }
    .stat-belum .awb-stat-icon { color:#d97706; } .stat-belum .awb-stat-val { color:#d97706; }
    .stat-cancel .awb-stat-icon { color:#dc2626; } .stat-cancel .awb-stat-val { color:#dc2626; }
    .stat-gagal .awb-stat-icon { color:#94a3b8; } .stat-gagal .awb-stat-val { color:#94a3b8; }

    .awb-main-layout { display:flex; gap:14px; align-items:flex-start; }
    .awb-main-left { flex:1; min-width:0; display:flex; flex-direction:column; gap:12px; }
    .awb-main-right { width:240px; flex-shrink:0; display:flex; flex-direction:column; gap:0; }

    .awb-card { background:#fff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; }
    .awb-card-header { padding:10px 14px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:13px; font-weight:700; color:#1e293b; display:flex; justify-content:space-between; align-items:center; }
    .awb-card-body { padding:14px; }
    .awb-count-badge { background:#f1f5f9; color:#475569; font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; }

    .awb-textarea { width:100%; height:130px; padding:10px 12px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-family:monospace; resize:vertical; outline:none; line-height:1.6; }
    .awb-textarea:focus { border-color:#e11d48; box-shadow:0 0 0 2px rgba(225,29,72,0.08); }

    .awb-btn-lacak { flex:1; display:flex; align-items:center; justify-content:center; gap:7px; padding:11px; background:#e11d48; color:#fff; border:none; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; transition:0.2s; }
    .awb-btn-lacak:hover { background:#be123c; }
    .awb-btn-lacak:disabled { background:#94a3b8; cursor:not-allowed; }
    .awb-btn-lacak-secondary { display:flex; align-items:center; gap:6px; padding:11px 14px; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; transition:0.2s; }
    .awb-btn-lacak-secondary:hover { background:#e2e8f0; }

    .awb-table-toolbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; padding:8px 0 6px; }
    .awb-filter-btn { padding:4px 10px; border-radius:4px; border:1px solid #e2e8f0; background:#f8fafc; font-size:11px; font-weight:600; color:#475569; cursor:pointer; transition:0.15s; }
    .awb-filter-btn.active { background:#0f172a; color:#fff; border-color:#0f172a; }
    .awb-filter-btn.filter-jalan.active { background:#dcfce7; color:#15803d; border-color:#86efac; }
    .awb-filter-btn.filter-belum.active { background:#fef3c7; color:#92400e; border-color:#fde68a; }
    .awb-filter-btn.filter-cancel.active { background:#fee2e2; color:#dc2626; border-color:#fca5a5; }
    .awb-filter-btn.filter-gagal.active { background:#f1f5f9; color:#475569; border-color:#cbd5e1; }

    .awb-summary-row { display:flex; justify-content:space-between; align-items:center; padding:9px 14px; border-bottom:1px solid #f8fafc; font-size:12px; font-weight:500; color:#475569; cursor:pointer; transition:background 0.15s; }
    .awb-summary-row:last-child { border-bottom:none; }
    .awb-summary-row:hover { background:#f8fafc; }
    .highlight-jalan:hover { background:#f0fdf4!important; }
    .highlight-belum:hover { background:#fffbeb!important; }
    .highlight-cancel:hover { background:#fff1f2!important; }

    /* Status badges di tabel */
    .badge-jalan { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:#dcfce7; color:#15803d; }
    .badge-belum { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:#fef3c7; color:#92400e; }
    .badge-cancel { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:#fee2e2; color:#dc2626; }
    .badge-gagal { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:#f1f5f9; color:#64748b; }
    .badge-kurir { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; font-weight:700; background:#e0f2fe; color:#0369a1; }

    /* Responsive AWB */
    @media (max-width: 1024px) {
      .awb-stat-grid { grid-template-columns:repeat(3,1fr); }
      .awb-main-layout { flex-direction:column; }
      .awb-main-right { width:100%; }
    }
    @media (max-width: 768px) {
      .awb-stat-grid { grid-template-columns:repeat(2,1fr); }
      .awb-toolbar { flex-direction:column; align-items:stretch; }
      .awb-toolbar-right { justify-content:stretch; }
      .awb-toolbar-right .awb-btn { flex:1; justify-content:center; }
    }

    /* === DARK MODE === */
    :root {
      --bg-page:#f8fafc;--bg-card:#ffffff;--text-primary:#1e293b;
      --text-secondary:#64748b;--border-color:#e2e8f0;--hover-bg:#f1f5f9;
      --input-bg:#ffffff;--input-border:#e2e8f0;--tbl-header:#1e293b;
    }
    html.dark {
      --bg-page:#0f172a;--bg-card:#1e293b;--text-primary:#f1f5f9;
      --text-secondary:#94a3b8;--border-color:#334155;--hover-bg:#334155;
      --input-bg:#1e293b;--input-border:#334155;--tbl-header:#0f172a;
    }
    html.dark body { background:var(--bg-page); color:var(--text-primary); }
    html.dark .main-content { background:var(--bg-page); }
    html.dark .page-header { background:var(--bg-page); border-bottom-color:var(--border-color); }
    html.dark .wh-card { background:var(--bg-card); border-color:var(--border-color); }
    html.dark .wh-title { background:#1e3a5f; }
    html.dark .table-box { border-color:var(--border-color); }
    html.dark table thead tr { background:var(--tbl-header) !important; }
    html.dark table thead th { background:var(--tbl-header) !important; color:#f1f5f9 !important; }
    html.dark table tbody td { color:var(--text-primary); border-color:var(--border-color); }
    html.dark table tbody tr:hover { background:var(--hover-bg); }
    html.dark .awb-input-card,.awb-status-panel,.awb-action-panel,.awb-table-card { background:var(--bg-card); }
    html.dark .awb-input-card,.html.dark .awb-status-panel,.html.dark .awb-action-panel,.html.dark .awb-table-card { border-color:var(--border-color); }
    html.dark .awb-textarea { background:var(--input-bg); border-color:var(--input-border); color:var(--text-primary); }
    html.dark input[type="date"],html.dark select { background:var(--input-bg); border-color:var(--input-border); color:var(--text-primary); }
    html.dark .awb-tbl thead th { background:var(--tbl-header) !important; }
    html.dark .awb-tbl tbody td { border-bottom-color:var(--border-color); color:var(--text-primary); }
    html.dark .awb-tbl tbody tr:hover { background:var(--hover-bg); }
    html.dark .do-table thead th { background:var(--tbl-header) !important; color:#f1f5f9 !important; }
    html.dark .do-table tbody td { padding: 10px 10px !important; line-height: 1.5; border-bottom-color:var(--border-color); color:var(--text-primary); }
    html.dark .awb-filter-btn { background:var(--hover-bg); color:var(--text-secondary); border-color:var(--border-color); }
    html.dark #search-resi { background:var(--input-bg); border-color:var(--input-border); color:var(--text-primary); }
    html.dark .awb-status-panel-header,.awb-action-panel-header,.awb-input-header { border-bottom-color:var(--border-color); }
    html.dark .awb-status-row { border-bottom-color:var(--border-color); }
    html.dark .table-footer { border-top-color:var(--border-color); }
    html.dark .awb-top-bar { background:var(--bg-page); border-color:var(--border-color); }
    /* Dark toggle btn */
    #dark-toggle {
      display:flex;align-items:center;justify-content:center;
      width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,0.08);
      border:none;cursor:pointer;color:#94a3b8;font-size:18px;transition:0.2s;
      flex-shrink:0;
    }
    #dark-toggle:hover { background:rgba(255,255,255,0.15); color:#f1f5f9; }

    /* === TOAST === */
    #toast-container {
      position:fixed;bottom:24px;right:24px;z-index:99999;
      display:flex;flex-direction:column;gap:8px;pointer-events:none;
    }
    .toast {
      display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:10px;
      font-size:13px;font-weight:500;min-width:260px;max-width:360px;
      box-shadow:0 8px 24px rgba(0,0,0,0.18);animation:toastIn 0.3s ease;
      pointer-events:all;
    }
    .toast-success{background:#16a34a;color:#fff;}
    .toast-error{background:#dc2626;color:#fff;}
    .toast-warning{background:#d97706;color:#fff;}
    .toast-info{background:#0284c7;color:#fff;}
    .toast .t-icon{font-size:18px;flex-shrink:0;}
    .toast .t-msg{flex:1;}
    .toast .t-close{background:none;border:none;color:inherit;cursor:pointer;opacity:0.7;font-size:16px;padding:0;}
    .toast .t-close:hover{opacity:1;}
    @keyframes toastIn{from{transform:translateX(110%);opacity:0;}to{transform:translateX(0);opacity:1;}}
    @keyframes toastOut{from{transform:translateX(0);opacity:1;}to{transform:translateX(110%);opacity:0;}}

    /* === STICKY TABLE HEADER (Lacak AWB) === */
    .awb-tbl-wrap { overflow-x:auto; max-height:58vh; overflow-y:auto; }
    .awb-tbl thead th { position:sticky;top:0;z-index:3; }
    .awb-tbl thead th.sortable { cursor:pointer;user-select:none; }
    .awb-tbl thead th.sortable:hover { opacity:0.85; }
    .sort-icon { font-size:10px;margin-left:3px;opacity:0.4; }
    th.sort-asc .sort-icon::after { content:'▲';opacity:1; }
    th.sort-desc .sort-icon::after { content:'▼';opacity:1; }

    /* === KONFIRMASI MODAL === */
    #confirm-overlay {
      display:none;position:fixed;inset:0;background:rgba(15,23,42,0.7);
      z-index:99998;align-items:center;justify-content:center;
    }
    #confirm-overlay.show { display:flex; }
    .confirm-box {
      background:#fff;border-radius:14px;padding:28px 24px 20px;
      max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.25);
    }
    html.dark .confirm-box { background:#1e293b;color:#f1f5f9; }
    .confirm-box h3 { margin:0 0 8px;font-size:16px; }
    .confirm-box p { margin:0 0 20px;font-size:13px;color:#64748b; }
    html.dark .confirm-box p { color:#94a3b8; }
    .confirm-btns { display:flex;gap:10px;justify-content:flex-end; }
    .confirm-btns button { padding:8px 18px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;border:none; }
    .confirm-btn-no { background:#f1f5f9;color:#475569; }
    .confirm-btn-no:hover { background:#e2e8f0; }
    .confirm-btn-yes { background:#0284c7;color:#fff; }
    .confirm-btn-yes:hover { background:#0369a1; }
    html.dark .confirm-btn-no { background:#334155;color:#cbd5e1; }
  


          /* ---- PI LAYOUT FREEZE ---- */
          #page-pusat-inventory.active { display:flex !important; flex-direction:column; height:calc(100vh - 54px); overflow:hidden; }
          .pi-sticky { position:sticky; top:0; z-index:10; background:#f1f5f9; padding-bottom:8px; flex-shrink:0; }
          .pi-scroll { flex:1; overflow-y:auto; overflow-x:hidden; scroll-behavior:smooth; }
          .pi-scroll::-webkit-scrollbar { width:5px; }
          .pi-scroll::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:10px; }

          /* ---- TOOLBAR ---- */
          .pi-toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:8px; box-shadow:0 1px 3px rgba(0,0,0,.04); }
          .pi-toolbar select, .pi-toolbar input[type=text] { border:1px solid #e2e8f0; border-radius:7px; padding:7px 10px; font-size:13px; color:#1e293b; background:#f8fafc; outline:none; transition:border-color .15s; }
          .pi-toolbar select:focus, .pi-toolbar input[type=text]:focus { border-color:#fbbf24; }

          /* Status chips */
          .pi-chip { border:1.5px solid #e2e8f0; border-radius:20px; padding:4px 12px; font-size:12px; font-weight:600; cursor:pointer; background:#f8fafc; color:#64748b; transition:all .15s; white-space:nowrap; user-select:none; }
          .pi-chip:hover { border-color:#94a3b8; color:#334155; }
          .pi-chip.aktif-Semua   { background:#f1f5f9; border-color:#64748b; color:#1e293b; }
          .pi-chip.aktif-Balance { background:#f0fdf4; border-color:#22c55e; color:#15803d; }
          .pi-chip.aktif-Plus    { background:#eff6ff; border-color:#3b82f6; color:#1d4ed8; }
          .pi-chip.aktif-Minus   { background:#fff1f2; border-color:#e11d48; color:#be123c; }
          .pi-chip.aktif-Belum   { background:#fefce8; border-color:#ca8a04; color:#92400e; }

          /* Toggle view btn */
          .pi-view-btn { display:flex; align-items:center; justify-content:center; width:34px; height:34px; border:1.5px solid #e2e8f0; border-radius:7px; background:#f8fafc; cursor:pointer; color:#64748b; transition:.15s; flex-shrink:0; }
          .pi-view-btn:hover, .pi-view-btn.aktif { background:#fef3c7; border-color:#fbbf24; color:#92400e; }
          .pi-view-btn .material-symbols-outlined { font-size:18px; }

          /* Info bar */
          .pi-info-bar { font-size:12px; color:#64748b; margin-bottom:8px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:space-between; }

          /* Stats */
          .pi-stats { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
          .pi-stat { flex:1 1 80px; background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:8px 12px; text-align:center; }
          .pi-stat .num { font-size:18px; font-weight:700; }
          .pi-stat .lbl { font-size:10px; color:#64748b; margin-top:1px; }
          .pi-stat.c-balance .num { color:#16a34a; }
          .pi-stat.c-plus .num   { color:#2563eb; }
          .pi-stat.c-minus .num  { color:#e11d48; }
          .pi-stat.c-belum .num  { color:#ca8a04; }

          /* ---- GRID VIEW ---- */
          .pi-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; padding:2px; }
          .pi-card {
            background:#fff; border:1px solid #e2e8f0; border-radius:12px;
            overflow:hidden; cursor:pointer; transition:all .18s;
            box-shadow:0 1px 3px rgba(0,0,0,.05);
            position:relative;
          }
          .pi-card:hover { box-shadow:0 6px 20px rgba(0,0,0,.1); transform:translateY(-2px); border-color:#fbbf24; }
          .pi-card-img { width:100%; aspect-ratio:1; object-fit:cover; background:#f8fafc; display:block; }
          .pi-card-img-placeholder { width:100%; aspect-ratio:1; background:#f1f5f9; display:flex; align-items:center; justify-content:center; color:#cbd5e1; }
          .pi-card-body { padding:10px 12px; }
          .pi-card-name { font-size:12px; font-weight:700; color:#1e293b; line-height:1.3; margin-bottom:4px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
          .pi-card-sku  { font-size:10px; color:#94a3b8; font-family:monospace; margin-bottom:6px; }
          .pi-card-meta { display:flex; align-items:center; justify-content:space-between; gap:4px; }
          .pi-card-qty  { font-size:18px; font-weight:800; color:#1e293b; }
          .pi-card-rak  { font-size:10px; color:#64748b; font-weight:600; }

          /* Status badge di card */
          .pi-status-badge { position:absolute; top:8px; right:8px; border-radius:20px; padding:2px 8px; font-size:10px; font-weight:700; }
          .pi-badge-Balance { background:#dcfce7; color:#15803d; }
          .pi-badge-Plus    { background:#dbeafe; color:#1d4ed8; }
          .pi-badge-Minus   { background:#fee2e2; color:#be123c; }
          .pi-badge-Belum   { background:#fef9c3; color:#92400e; }

          /* ---- LIST VIEW ---- */
          .pi-list { display:flex; flex-direction:column; gap:6px; }
          .pi-list-item {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            display:flex; align-items:center; gap:12px; padding:10px 14px;
            cursor:pointer; transition:all .15s;
            box-shadow:0 1px 2px rgba(0,0,0,.04);
          }
          .pi-list-item:hover { border-color:#fbbf24; background:#fffbeb; }
          .pi-list-thumb { width:52px; height:52px; border-radius:8px; object-fit:cover; background:#f1f5f9; flex-shrink:0; }
          .pi-list-thumb-ph { width:52px; height:52px; border-radius:8px; background:#f1f5f9; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:#cbd5e1; }
          .pi-list-info { flex:1; min-width:0; }
          .pi-list-name { font-size:13px; font-weight:700; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
          .pi-list-sub  { font-size:11px; color:#94a3b8; font-family:monospace; margin-top:1px; }
          .pi-list-rak  { font-size:11px; color:#64748b; margin-top:2px; }
          .pi-list-qty  { font-size:20px; font-weight:800; color:#1e293b; flex-shrink:0; text-align:right; min-width:40px; }

          /* ---- MODAL DETAIL CARD ---- */
          #pi-detail-overlay {
            display:none; position:fixed; inset:0;
            background:rgba(15,23,42,.6); z-index:9500;
            align-items:center; justify-content:center;
            backdrop-filter:blur(3px);
          }
          #pi-detail-overlay.open { display:flex; animation:doFadeIn .18s ease; }
          .pi-detail-modal {
            background:#fff; border-radius:16px;
            width:780px; max-width:96vw; max-height:90vh;
            display:flex; flex-direction:column;
            box-shadow:0 24px 60px rgba(0,0,0,.2); overflow:hidden;
          }
          .pi-detail-header {
            background:#1e293b; color:#f8fafc;
            padding:14px 18px; display:flex; gap:14px; align-items:center; flex-shrink:0;
          }
          .pi-detail-header-img {
            width:52px; height:52px; border-radius:8px; object-fit:cover;
            background:#334155; flex-shrink:0;
          }
          .pi-detail-header-info { flex:1; min-width:0; }
          .pi-detail-header-name { font-size:14px; font-weight:700; line-height:1.3; }
          .pi-detail-header-sku  { font-size:11px; color:#94a3b8; font-family:monospace; margin-top:2px; }
          .pi-detail-header-meta { display:flex; gap:8px; margin-top:5px; flex-wrap:wrap; }
          .pi-detail-close { background:none; border:none; color:#94a3b8; font-size:22px; cursor:pointer; padding:0; line-height:1; flex-shrink:0; }
          .pi-detail-close:hover { color:#fff; }
          .pi-detail-body { flex:1; overflow-y:auto; padding:0; }
          .pi-detail-body::-webkit-scrollbar { width:4px; }
          .pi-detail-body::-webkit-scrollbar-thumb { background:#e2e8f0; border-radius:4px; }

          /* Riwayat table */
          .pi-riwayat-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
          .pi-riwayat-tbl thead th {
            background:#f8fafc; color:#64748b; padding:9px 14px;
            text-align:left; font-size:10px; font-weight:700;
            text-transform:uppercase; letter-spacing:.4px;
            border-bottom:1px solid #f1f5f9; position:sticky; top:0; z-index:2;
          }
          .pi-riwayat-tbl tbody tr { border-bottom:1px solid #f8fafc; transition:background .1s; }
          .pi-riwayat-tbl tbody tr:hover { background:#fffbeb; }
          .pi-riwayat-tbl td { padding:9px 14px; vertical-align:middle; color:#334155; }
          .pi-detail-empty { padding:40px 20px; text-align:center; color:#94a3b8; }
          .pi-detail-empty .material-symbols-outlined { font-size:40px; display:block; margin-bottom:8px; }

          /* Lightbox tetap ada */
          #so-lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;align-items:center;justify-content:center;}
          #so-lightbox.open{display:flex;}
          #so-lightbox img{max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.5);}
          #so-lightbox-close{position:absolute;top:18px;right:24px;color:#fff;font-size:30px;cursor:pointer;background:none;border:none;line-height:1;}

          /* Modal rusak tetap ada */
          #so-rusak-modal{display:none;position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:9998;align-items:center;justify-content:center;}
        


          /* ---- WRAPPER LAYOUT ---- */
          #page-barang-bermasalah.active { display:flex !important; flex-direction:column; height:calc(100vh - 54px); overflow:hidden; }
          #page-barang-bermasalah { display:none; }

          /* ---- TOOLBAR FREEZE ---- */
          .do-sticky-top {
            position:sticky; top:0; z-index:10;
            background:#f8fafc; padding-bottom:10px;
            flex-shrink:0;
          }
          .do-toolbar {
            display:flex; flex-wrap:wrap; gap:8px; align-items:center;
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:10px 14px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .do-toolbar select, .do-toolbar input[type=text] {
            border:1px solid #e2e8f0; border-radius:7px; padding:7px 11px;
            font-size:13px; color:#1e293b; background:#f8fafc; outline:none;
            transition:border-color .15s, box-shadow .15s;
          }
          .do-toolbar select:focus, .do-toolbar input[type=text]:focus {
            border-color:#e11d48; box-shadow:0 0 0 3px rgba(225,29,72,.08);
          }
          .do-info-strip {
            font-size:12px; color:#64748b; padding:6px 2px 0;
            display:flex; align-items:center; gap:8px;
          }

          /* ---- SCROLL AREA ---- */
          .do-scroll-area {
            flex:1; overflow-y:auto; overflow-x:auto;
            scroll-behavior:smooth;
            -webkit-overflow-scrolling:touch;
          }
          /* Custom scrollbar */
          .do-scroll-area::-webkit-scrollbar { width:5px; height:5px; }
          .do-scroll-area::-webkit-scrollbar-track { background:transparent; }
          .do-scroll-area::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:10px; }
          .do-scroll-area::-webkit-scrollbar-thumb:hover { background:#94a3b8; }

          /* ---- TABEL ---- */
          .do-table-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; min-width:900px; }
          .do-table { width:100%; border-collapse:collapse; font-size:12.5px; }
          .do-table thead th {
            background:#1e293b; color:#f1f5f9; padding:10px 12px;
            text-align:left; font-weight:600; white-space:nowrap;
            font-size:11px; letter-spacing:.4px; text-transform:uppercase;
            position:sticky; top:0; z-index:3;
          }
          .do-table thead th:first-child { border-radius:0; }
          .do-table tbody tr {
            border-bottom:1px solid #f1f5f9;
            transition:background .12s ease;
          }
          .do-table tbody tr:last-child { border-bottom:none; }
          .do-table tbody tr:hover { background:#fffbeb; }
          .do-table td { padding:9px 12px; vertical-align:middle; color:#334155; }

          /* Status badges */
          .do-badge-rusak {
            display:inline-flex; align-items:center; gap:5px;
            background:#fff1f2; color:#be123c; border:1px solid #fecdd3;
            border-radius:20px; padding:3px 10px; font-size:11px; font-weight:700;
          }
          .do-badge-ok {
            display:inline-block; background:#f0fdf4; color:#15803d;
            border:1px solid #bbf7d0; border-radius:20px;
            padding:3px 10px; font-size:11px; font-weight:700;
          }
          .do-badge-so { display:inline-block; border-radius:20px; padding:3px 10px; font-size:11px; font-weight:700; white-space:nowrap; }
          .do-badge-so-balance { background:#dbeafe; color:#1d4ed8; }
          .do-badge-so-plus    { background:#eff6ff; color:#1d4ed8; }
          .do-badge-so-minus   { background:#fff1f2; color:#be123c; }
          .do-badge-so-belum   { background:#fef9c3; color:#92400e; }
          .do-badge-so-cocok   { background:#dbeafe; color:#1d4ed8; }

          /* Selisih */
          .do-sel-minus { color:#dc2626; font-weight:700; }
          .do-sel-plus  { color:#2563eb; font-weight:700; }

          /* State box */
          .do-state-box { padding:60px 20px; text-align:center; color:#94a3b8; }
          .do-state-box .material-symbols-outlined { font-size:48px; margin-bottom:10px; display:block; }
          .do-state-box p { font-size:13px; margin:0; }

          /* Pager */
          .do-pager {
            display:flex; align-items:center; gap:8px; justify-content:flex-end;
            padding:10px 14px; border-top:1px solid #f1f5f9; font-size:13px; color:#475569;
            background:#fff;
          }
          .do-pager button {
            border:1px solid #e2e8f0; border-radius:7px; padding:5px 14px;
            background:#f8fafc; cursor:pointer; font-size:12px; color:#334155;
            transition:background .12s;
          }
          .do-pager button:not(:disabled):hover { background:#e2e8f0; }
          .do-pager button:disabled { opacity:.35; cursor:default; }

          /* ---- MODAL ---- */
          #do-modal-overlay {
            display:none; position:fixed; inset:0;
            background:rgba(15,23,42,.55); z-index:9000;
            align-items:center; justify-content:center;
            backdrop-filter:blur(2px);
          }
          #do-modal-overlay.open { display:flex; animation:doFadeIn .18s ease; }
          @keyframes doFadeIn { from{opacity:0;transform:scale(.97)} to{opacity:1;transform:scale(1)} }
          .do-modal {
            background:#fff; border-radius:14px; width:460px; max-width:94vw;
            box-shadow:0 20px 60px rgba(0,0,0,.18); overflow:hidden;
          }
          .do-modal-header {
            padding:15px 18px; background:#1e293b; color:#fff;
            font-size:13px; font-weight:700;
            display:flex; justify-content:space-between; align-items:center;
          }
          .do-modal-body { padding:18px; }
          .do-tab-bar {
            display:flex; gap:0; border-bottom:2px solid #f1f5f9; margin-bottom:16px;
          }
          .do-tab {
            padding:8px 20px; font-size:13px; font-weight:600; cursor:pointer;
            color:#64748b; border-bottom:2px solid transparent; margin-bottom:-2px;
            transition:color .15s, border-color .15s; border-radius:6px 6px 0 0;
          }
          .do-tab:hover { color:#92400e; background:#fef3c7; }
          .do-tab.aktif { color:#92400e; border-bottom-color:#fbbf24; background:#fefce8; }
          .do-tab-panel { display:none; }
          .do-tab-panel.aktif { display:block; }
          .do-form-row { margin-bottom:13px; }
          .do-form-row label { display:block; font-size:11px; font-weight:700; color:#64748b; margin-bottom:5px; text-transform:uppercase; letter-spacing:.4px; }
          .do-form-row input, .do-form-row textarea {
            width:100%; padding:9px 11px; border:1px solid #e2e8f0;
            border-radius:8px; font-size:13px; outline:none; transition:border-color .15s, box-shadow .15s;
            color:#1e293b;
          }
          .do-form-row input:focus, .do-form-row textarea:focus {
            border-color:#e11d48; box-shadow:0 0 0 3px rgba(225,29,72,.08);
          }
          .do-form-row input[readonly] { background:#f8fafc; color:#64748b; }
          .do-form-row textarea { resize:vertical; min-height:72px; font-family:inherit; }
          .do-btn-submit {
            width:100%; padding:11px; background:#e11d48; color:#fff;
            border:none; border-radius:8px; font-size:13px; font-weight:700;
            cursor:pointer; transition:background .15s;
          }
          .do-btn-submit:hover:not(:disabled) { background:#be123c; }
          .do-btn-submit:disabled { background:#94a3b8; cursor:not-allowed; }
          .do-riwayat-item {
            padding:11px 13px; border:1px solid #f1f5f9; border-radius:10px;
            margin-bottom:8px; background:#fafafa; transition:background .12s;
          }
          .do-riwayat-item:hover { background:#f1f5f9; }
          .do-riwayat-item .tgl { font-size:11px; color:#94a3b8; }
          .do-riwayat-item .qty { font-size:17px; font-weight:800; color:#be123c; }
          .do-riwayat-item .user { font-size:11px; font-weight:600; color:#475569; margin-top:2px; }
          .do-riwayat-item .ket { font-size:12px; color:#64748b; margin-top:4px; }
        


          /* ---- LACAK AWB REDESIGN ---- */
          .awb-top-bar {
            display:flex; align-items:center; gap:10px; flex-wrap:wrap;
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:12px 16px; margin-bottom:8px;
            box-shadow:0 1px 3px rgba(0,0,0,.04);
            width:100%;
          }
          .awb-top-bar .awb-date-wrap {
            display:flex; align-items:center; gap:8px; flex:1; min-width:200px;
          }
          .awb-top-bar label { font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:.4px; white-space:nowrap; }
          .awb-top-bar input[type=date], .awb-top-bar select {
            border:1px solid #e2e8f0; border-radius:7px; padding:7px 10px;
            font-size:13px; color:#1e293b; background:#f8fafc; outline:none;
            transition:border-color .15s;
          }
          .awb-top-bar input[type=date]:focus, .awb-top-bar select:focus { border-color:#e11d48; }
          .awb-apply-btn {
            background:#1e293b; color:#fff; border:none; border-radius:7px;
            padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer;
            display:flex; align-items:center; gap:6px; transition:.15s; white-space:nowrap;
          }
          .awb-apply-btn:hover { background:#0f172a; }
          .awb-apply-btn:disabled { background:#94a3b8; cursor:not-allowed; }
          .awb-cek-btn {
            background:#fff; color:#1e293b; border:1.5px solid #e2e8f0; border-radius:7px;
            padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;
            display:flex; align-items:center; gap:6px; transition:.15s; white-space:nowrap;
          }
          .awb-cek-btn:hover { border-color:#1e293b; background:#f8fafc; }
          .awb-cancel-btn {
            background:#fff1f2; color:#dc2626; border:1.5px solid #fecdd3; border-radius:7px;
            padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer;
            display:flex; align-items:center; gap:6px; transition:.15s; white-space:nowrap; margin-left:auto;
          }
          .awb-cancel-btn:hover { background:#fee2e2; }
          #awb-top-status {
            font-size:13px; font-weight:600; color:#64748b;
            width:100%; padding:6px 2px 2px; min-height:24px;
          }

          /* Layout utama */
          .awb-new-layout { display:flex; gap:12px; align-items:flex-start; width:100%; }
          .awb-new-left { flex:1; min-width:0; display:flex; flex-direction:column; gap:10px; overflow:hidden; }
          .awb-new-right { width:270px; flex-shrink:0; display:flex; flex-direction:column; gap:10px; }

          /* Status panel kanan atas */
          .awb-status-panel {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .awb-status-panel-header {
            background:#1e293b; color:#f8fafc; padding:9px 14px;
            font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
            display:flex; justify-content:space-between; align-items:center;
          }
          .awb-status-row {
            display:flex; justify-content:space-between; align-items:center;
            padding:8px 14px; border-bottom:1px solid #f8fafc;
            cursor:pointer; transition:background .1s; font-size:13px;
          }
          .awb-status-row:last-child { border-bottom:none; }
          .awb-status-row:hover { background:#fffbeb; }
          .awb-status-row .lbl { color:#475569; display:flex; align-items:center; gap:6px; }
          .awb-status-row .val { font-weight:700; font-size:14px; }

          /* Tombol kanan */
          .awb-action-panel {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .awb-action-panel-header {
            background:#1e293b; color:#f8fafc; padding:9px 14px;
            font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.5px;
          }
          .awb-action-btn-row {
            padding:10px 14px; border-bottom:1px solid #f8fafc;
          }
          .awb-action-btn-row:last-child { border-bottom:none; }
          .awb-side-btn {
            width:100%; padding:9px 12px; border-radius:7px; font-size:13px;
            font-weight:600; cursor:pointer; display:flex; align-items:center;
            gap:8px; transition:.15s; border:1.5px solid transparent;
          }
          .awb-side-btn-lacak {
            background:#fbbf24; color:#1e293b; border-color:#fbbf24;
          }
          .awb-side-btn-lacak:hover { background:#d97706; border-color:#d97706; }
          .awb-side-btn-lacak:disabled { background:#94a3b8; border-color:#94a3b8; cursor:not-allowed; }
          .awb-side-btn-belum {
            background:#fef9c3; color:#92400e; border-color:#fde68a;
          }
          .awb-side-btn-belum:hover { background:#fef08a; }
          .awb-side-btn-simpan {
            background:#dbeafe; color:#1d4ed8; border-color:#bfdbfe;
          }
          .awb-side-btn-simpan:hover:not(:disabled) { background:#bfdbfe; }
          .awb-side-btn-simpan:disabled { opacity:.4; cursor:not-allowed; }

          /* Input & progress */
          .awb-input-card {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .awb-input-header {
            padding:10px 14px; border-bottom:1px solid #f1f5f9;
            display:flex; justify-content:space-between; align-items:center;
            font-size:13px; font-weight:600; color:#1e293b;
          }

          /* Progress */
          .awb-progress-card {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:12px 16px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }

          /* Tabel */
          .awb-table-card {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .awb-table-filter-bar {
            padding:10px 14px; border-bottom:1px solid #f1f5f9;
            display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;
          }
          .awb-tbl { width:100%; border-collapse:collapse; font-size:12.5px; }
          .awb-tbl thead th {
            background:#1e293b; color:#f1f5f9; padding:9px 12px;
            text-align:left; font-size:10px; font-weight:700;
            text-transform:uppercase; letter-spacing:.4px; white-space:nowrap;
            position:sticky; top:0; z-index:2;
          }
          .awb-tbl tbody tr { border-bottom:1px solid #f8fafc; transition:background .1s; }
          .awb-tbl tbody tr:hover { background:#fffbeb; }
          .awb-tbl td { padding:8px 12px; vertical-align:middle; color:#334155; }
          .awb-tbl-wrap { max-height:calc(100vh - 260px); overflow-y:auto; overflow-x:auto; }
          .awb-tbl { min-width: 700px; }
          .awb-tbl-wrap::-webkit-scrollbar { width:4px; }
          .awb-tbl-wrap::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:4px; }

          @media(max-width:900px) {
            .awb-new-layout { flex-direction:column; }
            .awb-new-right { width:100%; flex-direction:row; flex-wrap:wrap; gap:10px; }
            .awb-status-panel, .awb-action-panel { flex:1; min-width:220px; }
            .awb-tbl-wrap { max-height:350px !important; }
          }
          @media(max-width:600px) {
            .awb-new-right { flex-direction:column; }
          }
        


          /* ---- CUSTOM DATE PICKER ---- */
          .cdp-wrap { position:relative; }
          .cdp-input {
            display:flex; align-items:center; gap:7px;
            border:1.5px solid #e2e8f0; border-radius:8px;
            padding:7px 12px; background:#fff; cursor:pointer;
            font-size:13px; color:#1e293b; transition:.15s;
            min-width:150px; user-select:none;
          }
          .cdp-input:hover { border-color:#fbbf24; }
          .cdp-input.open  { border-color:#fbbf24; box-shadow:0 0 0 3px rgba(251,191,36,.15); }
          .cdp-input .material-symbols-outlined { font-size:17px; color:#94a3b8; }
          .cdp-input .cdp-val { font-weight:600; }
          .cdp-input .cdp-placeholder { color:#94a3b8; font-weight:400; }

          .cdp-popup {
            position:absolute; top:calc(100% + 8px); left:0;
            background:#fff; border:1px solid #e2e8f0; border-radius:14px;
            box-shadow:0 12px 40px rgba(0,0,0,.14); z-index:9999;
            width:300px; overflow:hidden; animation:cdpFadeIn .15s ease;
          }
          @keyframes cdpFadeIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }

          .cdp-header {
            display:flex; align-items:center; justify-content:space-between;
            padding:14px 16px 10px; border-bottom:1px solid #f1f5f9;
          }
          .cdp-month-label {
            font-size:14px; font-weight:700; color:#1e293b; cursor:pointer;
          }
          .cdp-nav {
            display:flex; gap:4px;
          }
          .cdp-nav button {
            width:30px; height:30px; border:1px solid #e2e8f0; border-radius:7px;
            background:#f8fafc; cursor:pointer; display:flex; align-items:center;
            justify-content:center; color:#64748b; transition:.15s;
          }
          .cdp-nav button:hover { background:#fef3c7; border-color:#fbbf24; color:#92400e; }
          .cdp-nav button .material-symbols-outlined { font-size:16px; }

          .cdp-grid {
            display:grid; grid-template-columns:repeat(7,1fr);
            padding:10px 12px 14px; gap:2px;
          }
          .cdp-day-name {
            font-size:10px; font-weight:700; color:#94a3b8;
            text-align:center; padding:4px 0 8px;
            text-transform:uppercase; letter-spacing:.4px;
          }
          .cdp-day {
            aspect-ratio:1; display:flex; align-items:center; justify-content:center;
            font-size:13px; border-radius:8px; cursor:pointer;
            color:#334155; transition:all .12s; position:relative;
          }
          .cdp-day:hover { background:#fef3c7; color:#92400e; }
          .cdp-day.other-month { color:#cbd5e1; }
          .cdp-day.other-month:hover { background:#f8fafc; color:#94a3b8; }
          .cdp-day.today {
            font-weight:700; color:#fbbf24;
          }
          .cdp-day.today::after {
            content:''; position:absolute; bottom:3px; left:50%;
            transform:translateX(-50%); width:4px; height:4px;
            border-radius:50%; background:#fbbf24;
          }
          .cdp-day.selected {
            background:#fbbf24 !important; color:#1e293b !important;
            font-weight:700; box-shadow:0 2px 8px rgba(251,191,36,.4);
          }
          .cdp-day.selected::after { display:none; }

          .cdp-footer {
            padding:10px 14px 12px; border-top:1px solid #f1f5f9;
            display:flex; justify-content:space-between; align-items:center;
          }
          .cdp-today-btn {
            font-size:12px; color:#64748b; background:none; border:none;
            cursor:pointer; font-weight:600; padding:4px 8px; border-radius:6px;
            transition:.15s;
          }
          .cdp-today-btn:hover { background:#f1f5f9; color:#334155; }
          .cdp-clear-btn {
            font-size:12px; color:#94a3b8; background:none; border:none;
            cursor:pointer; padding:4px 8px; border-radius:6px; transition:.15s;
          }
          .cdp-clear-btn:hover { color:#e11d48; }
        


          @keyframes awbBannerIn {
            from { opacity:0; transform:translateY(-8px); }
            to   { opacity:1; transform:translateY(0); }
          }
        


          #page-gudang-insight.active { display:flex !important; flex-direction:column; height:calc(100vh - 54px); overflow:hidden; }
          .ins-sticky { flex-shrink:0; background:#f1f5f9; padding-bottom:8px; }
          .ins-scroll  { flex:1; overflow-y:auto; padding-bottom:24px; }
          .ins-scroll::-webkit-scrollbar { width:5px; }
          .ins-scroll::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:10px; }

          /* Toolbar */
          .ins-toolbar {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:11px 16px; display:flex; align-items:center; gap:8px; flex-wrap:wrap;
            box-shadow:0 1px 3px rgba(0,0,0,.04); margin-bottom:8px;
          }
          .ins-type-btn {
            padding:6px 14px; border-radius:20px; font-size:13px; font-weight:600;
            cursor:pointer; border:1.5px solid #e2e8f0; background:#f8fafc; color:#64748b; transition:.15s;
          }
          .ins-type-btn.aktif { background:#fbbf24; color:#1e293b; border-color:#fbbf24; }
          .ins-type-btn:hover:not(.aktif) { border-color:#fbbf24; color:#92400e; background:#fef3c7; }
          .ins-preset-btn {
            padding:5px 11px; border-radius:20px; font-size:12px; font-weight:600;
            cursor:pointer; border:1.5px solid #e2e8f0; background:#f8fafc; color:#64748b; transition:.15s;
          }
          .ins-preset-btn.aktif { background:#1e293b; color:#fff; border-color:#1e293b; }
          .ins-preset-btn:hover:not(.aktif) { border-color:#1e293b; background:#f1f5f9; }
          .ins-apply-btn {
            background:#1e293b; color:#fff; border:none; border-radius:8px;
            padding:7px 16px; font-size:13px; font-weight:700; cursor:pointer;
            display:flex; align-items:center; gap:5px; transition:.15s; white-space:nowrap;
          }
          .ins-apply-btn:hover { background:#0f172a; }
          .ins-apply-btn:disabled { background:#94a3b8; cursor:not-allowed; }

          /* Slide nav */
          .ins-slide-nav {
            display:flex; align-items:center; justify-content:space-between;
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:10px 14px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .ins-arrow {
            width:32px; height:32px; border:1.5px solid #e2e8f0; border-radius:8px;
            background:#f8fafc; cursor:pointer; display:flex; align-items:center;
            justify-content:center; color:#64748b; transition:.15s;
          }
          .ins-arrow:hover:not(:disabled) { border-color:#fbbf24; background:#fef3c7; color:#92400e; }
          .ins-arrow:disabled { opacity:.3; cursor:not-allowed; }
          .ins-dots { display:flex; gap:5px; align-items:center; }
          .ins-dot {
            width:7px; height:7px; border-radius:50%; background:#e2e8f0; cursor:pointer; transition:.2s;
          }
          .ins-dot.aktif { background:#fbbf24; width:18px; border-radius:4px; }

          /* Slide */
          .ins-slide { display:none; }
          .ins-slide.aktif { display:block; animation:insFadeIn .2s ease; }
          @keyframes insFadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }

          /* Gudang header */
          .ins-wh-hdr {
            display:flex; align-items:center; gap:12px; margin-bottom:14px;
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:14px 16px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .ins-wh-icon {
            width:42px; height:42px; border-radius:10px;
            background:linear-gradient(135deg,#fbbf24,#d97706);
            display:flex; align-items:center; justify-content:center;
            box-shadow:0 2px 8px rgba(251,191,36,.3); flex-shrink:0;
          }
          .ins-wh-icon .material-symbols-outlined { font-size:20px; color:#1e293b; }
          .ins-wh-name { font-size:17px; font-weight:800; color:#1e293b; }
          .ins-wh-sub  { font-size:11px; color:#94a3b8; margin-top:1px; }

          /* Stats */
          .ins-stats { display:flex; gap:10px; margin-bottom:12px; flex-wrap:wrap; }
          .ins-stat {
            flex:1; min-width:110px; background:#fff; border:1px solid #e2e8f0;
            border-radius:10px; padding:14px 16px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .ins-stat-n { font-size:28px; font-weight:800; color:#1e293b; line-height:1; }
          .ins-stat-l { font-size:10px; color:#94a3b8; margin-top:4px; text-transform:uppercase; letter-spacing:.5px; }
          .ins-stat.trx .ins-stat-n { color:#0284c7; }
          .ins-stat.pcs .ins-stat-n { color:#16a34a; }
          .ins-stat.batal .ins-stat-n { color:#e11d48; }

          /* Status breakdown */
          .ins-status-grid { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
          .ins-st-item {
            flex:1; min-width:90px; background:#fff; border:1px solid #e2e8f0;
            border-radius:8px; padding:10px 12px; text-align:center;
            box-shadow:0 1px 2px rgba(0,0,0,.03);
          }
          .ins-st-n { font-size:16px; font-weight:700; color:#1e293b; }
          .ins-st-l { font-size:10px; color:#94a3b8; margin-top:3px; }

          /* Chart traffic harian */
          .ins-chart {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:14px 16px; margin-bottom:12px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .ins-chart-title { font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.5px; margin-bottom:12px; }
          .ins-bars { display:flex; gap:4px; align-items:flex-end; height:100px; overflow-x:auto; }
          .ins-bar-col { display:flex; flex-direction:column; align-items:center; gap:3px; flex:1; min-width:28px; }
          .ins-bar-v { font-size:9px; font-weight:700; color:#64748b; }
          .ins-bar-b { width:100%; border-radius:3px 3px 0 0; background:#fbbf24; min-height:3px; transition:height .4s ease; }
          .ins-bar-l { font-size:9px; color:#94a3b8; white-space:nowrap; }

          /* Top produk */
          .ins-toprod {
            background:#fff; border:1px solid #e2e8f0; border-radius:10px;
            padding:14px 16px; box-shadow:0 1px 3px rgba(0,0,0,.04);
          }
          .ins-toprod-title { font-size:12px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.5px; margin-bottom:10px; }
          .ins-prod-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f8fafc; }
          .ins-prod-row:last-child { border-bottom:none; }
          .ins-rank { width:22px; height:22px; border-radius:50%; background:#fef3c7; color:#92400e; font-size:10px; font-weight:800; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
          .ins-rank.r1 { background:#fbbf24; color:#1e293b; }
          .ins-rank.r2 { background:#e2e8f0; color:#475569; }
          .ins-rank.r3 { background:#fed7aa; color:#9a3412; }
          .ins-prod-img { width:34px; height:34px; border-radius:6px; object-fit:cover; background:#f1f5f9; flex-shrink:0; }
          .ins-prod-nm { flex:1; font-size:12px; font-weight:600; color:#1e293b; line-height:1.3; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .ins-prod-qty { font-size:13px; font-weight:800; color:#0284c7; flex-shrink:0; }

          /* State box */
          .ins-empty { padding:60px 20px; text-align:center; color:#94a3b8; }
          .ins-empty .material-symbols-outlined { font-size:48px; display:block; margin-bottom:10px; color:#e2e8f0; }

export function renderConsoleHtml(baseUrl = '/api/v1/console/api'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IPOVault — Backend Admin Console</title>
  
  <!-- Google Fonts: Google Sans Flex, JetBrains Mono -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wght@300;400;500;600;700&family=Google+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  
  <!-- Feather Icons CDN -->
  <script src="https://unpkg.com/feather-icons"></script>
  
  <style>
    /* IPOVault Modern SaaS Application Theme */
    :root {
      --bg-app: #F8FAFC;
      --bg-sidebar: #0F172A;
      --bg-surface: #FFFFFF;
      --bg-hover: #F1F5F9;
      --bg-active: #E2E8F0;
      
      --border-color: #E2E8F0;
      --border-subtle: #F1F5F9;
      
      --text-main: #0F172A;
      --text-muted: #64748B;
      --text-subtle: #94A3B8;
      
      --primary: #4F46E5;
      --primary-light: #EEF2FF;
      --primary-hover: #4338CA;
      
      /* Status Colors */
      --status-open-bg: #DCFCE7;
      --status-open-fg: #15803D;
      
      --status-upcoming-bg: #FEF3C7;
      --status-upcoming-fg: #D97706;
      
      --status-closed-bg: #F1F5F9;
      --status-closed-fg: #64748B;

      --status-published-bg: #EEF2FF;
      --status-published-fg: #4F46E5;

      --shadow-card: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    }

    body.dark-mode {
      --bg-app: #090D16;
      --bg-sidebar: #0B0F19;
      --bg-surface: #0F172A;
      --bg-hover: #1E293B;
      --bg-active: #334155;
      
      --border-color: #1E293B;
      --border-subtle: #0F172A;
      
      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
      --text-subtle: #64748B;
      
      --primary: #818CF8;
      --primary-light: #1E1B4B;
      --primary-hover: #6366F1;
      
      --shadow-card: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    html, body, button, input, select, textarea {
      font-family: 'Google Sans Flex', 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    html, body {
      width: 100%;
      height: 100vh;
      overflow: hidden;
      background-color: var(--bg-app);
      color: var(--text-main);
    }

    /* SaaS Application Root Layout */
    .app-root {
      display: flex;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    }

    /* Sidebar Styling (Dark Modern SaaS Sidebar) */
    .sidebar {
      width: 250px;
      background-color: var(--bg-sidebar);
      display: flex;
      flex-direction: column;
      padding: 20px 14px;
      flex-shrink: 0;
      color: #94A3B8;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }

    .sidebar.collapsed {
      width: 72px;
      padding: 20px 10px;
    }

    .sidebar.collapsed .brand-title,
    .sidebar.collapsed .workspace-picker,
    .sidebar.collapsed .nav-group-title,
    .sidebar.collapsed .nav-item span,
    .sidebar.collapsed .user-info {
      display: none !important;
    }

    .sidebar.collapsed .brand-logo {
      justify-content: center;
    }

    .sidebar.collapsed .nav-item {
      justify-content: center;
      padding: 10px 0;
    }

    .sidebar.collapsed .user-profile {
      justify-content: center;
      padding: 6px 0;
    }

    .sidebar-brand { margin-bottom: 24px; }
    .brand-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
    .logo-box {
      width: 32px;
      height: 32px;
      background-color: var(--primary);
      color: #FFFFFF;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-family: 'Google Sans Flex', 'Google Sans', sans-serif;
    }
    .brand-title { font-family: 'Google Sans Flex', 'Google Sans', sans-serif; font-weight: 700; font-size: 18px; color: #F8FAFC; letter-spacing: -0.3px; }

    .workspace-picker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 12px;
      background-color: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: #E2E8F0;
    }
    .workspace-picker i { width: 14px; height: 14px; color: #94A3B8; }

    /* Navigation Menu */
    .sidebar-nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      color: #94A3B8;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      background: transparent;
      border: none;
      width: 100%;
      text-align: left;
    }
    .nav-item:hover { background-color: rgba(255, 255, 255, 0.06); color: #F8FAFC; }
    .nav-item.active { background-color: var(--primary); color: #FFFFFF; font-weight: 600; }
    .nav-item i { width: 16px; height: 16px; }

    .nav-group-title {
      font-size: 11px;
      font-weight: 700;
      color: #64748B;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 16px 10px 6px 10px;
    }

    /* Sidebar User Profile Footer */
    .sidebar-footer { border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 14px; margin-top: 8px; }
    .user-profile { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; }
    .user-avatar-box {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background-color: var(--primary);
      color: #FFFFFF;
      font-weight: 700;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .user-info { display: flex; flex-direction: column; flex: 1; }
    .user-name { font-size: 12px; font-weight: 600; color: #F8FAFC; }
    .user-email { font-size: 11px; color: #64748B; }

    /* Main Workspace Area */
    .main-workspace { flex: 1; display: flex; flex-direction: column; background-color: var(--bg-app); overflow: hidden; }

    /* Top Breadcrumb & Actions Bar */
    .top-bar {
      min-height: 60px;
      height: auto;
      background-color: var(--bg-surface);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 24px;
      flex-shrink: 0;
      flex-wrap: wrap;
      gap: 12px;
    }

    .breadcrumbs { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: var(--text-muted); flex-wrap: wrap; }
    .breadcrumb-active { color: var(--text-main); font-weight: 600; }
    .breadcrumbs i { width: 14px; height: 14px; color: var(--text-subtle); }

    .top-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

    .search-input-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 7px 14px;
      width: 220px;
      max-width: 100%;
    }
    .search-input-box i { width: 14px; height: 14px; color: var(--text-muted); }
    .search-input-box input {
      border: none;
      background: none;
      font-size: 13px;
      color: var(--text-main);
      outline: none;
      width: 100%;
    }

    .icon-btn {
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      cursor: pointer;
      padding: 8px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover { background-color: var(--bg-active); color: var(--text-main); }

    /* Content Area */
    .workspace-content {
      flex: 1;
      overflow-y: auto;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* KPI Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 18px; margin-bottom: 8px; }
    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: var(--shadow-card);
    }
    .stat-title { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--text-main); }

    /* Status Pills & Badges */
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .status-pill.open { background-color: var(--status-open-bg); color: var(--status-open-fg); }
    .status-pill.upcoming { background-color: var(--status-upcoming-bg); color: var(--status-upcoming-fg); }
    .status-pill.closed { background-color: var(--status-closed-bg); color: var(--status-closed-fg); }
    .status-pill.published { background-color: var(--status-published-bg); color: var(--status-published-fg); }

    /* Grid Table System */
    .grid-table-box {
      width: 100%;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow: hidden;
      background: var(--bg-surface);
      box-shadow: var(--shadow-card);
    }

    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      background: var(--bg-hover);
      padding: 12px 18px;
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--border-color);
    }
    td {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 13px;
      color: var(--text-main);
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background-color: var(--bg-hover); }

    /* Controls & Buttons */
    .btn-primary {
      background-color: var(--primary);
      color: #FFFFFF;
      border: none;
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn-primary:hover { background-color: var(--primary-hover); transform: translateY(-1px); }

    .btn-secondary {
      background-color: var(--bg-surface);
      color: var(--text-main);
      border: 1px solid var(--border-color);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-secondary:hover { background-color: var(--bg-hover); }

    .btn-success { background-color: #10B981; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-danger { background-color: #EF4444; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-warning { background-color: #F59E0B; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }

    /* Form Header Actions Bar */
    .form-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 4px;
    }
    .form-header-buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; width: 100%; }
    .form-group label { font-size: 12px; font-weight: 600; color: var(--text-muted); }
    .form-group input, .form-group select, .form-group textarea {
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 9px 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      width: 100%;
      box-sizing: border-box;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: var(--primary); }

    .alert-box { padding: 12px 16px; border-radius: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
    .alert-box.success { background: #ECFDF5; border: 1px solid #10B981; color: #065F46; }
    .alert-box.danger { background: #FEF2F2; border: 1px solid #EF4444; color: #991B1B; }

    .mono { font-family: 'JetBrains Mono', monospace; }

    .grid-table-box {
      width: 100%;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow-x: auto;
      background: var(--bg-surface);
      box-shadow: var(--shadow-card);
    }
    table { width: 100%; border-collapse: collapse; text-align: left; min-width: 600px; }

    /* Split-View & Mobile Responsive Breakpoints */
    @media (max-width: 1100px) {
      .workspace-content { padding: 18px 16px; gap: 16px; }
      .top-bar { padding: 10px 16px; }
      .search-input-box { width: 160px; }
      .form-grid { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    }

    @media (max-width: 800px) {
      .sidebar {
        width: 72px;
        padding: 20px 10px;
      }
      .sidebar .brand-title,
      .sidebar .workspace-picker,
      .sidebar .nav-group-title,
      .sidebar .nav-item span,
      .sidebar .user-info {
        display: none !important;
      }
      .sidebar .brand-logo { justify-content: center; }
      .sidebar .nav-item { justify-content: center; padding: 10px 0; }
      .sidebar .user-profile { justify-content: center; padding: 6px 0; }

      .top-bar { padding: 8px 12px; gap: 8px; }
      .search-input-box { width: 100%; }
      .form-grid { grid-template-columns: 1fr; gap: 12px; }
      .form-header-bar { flex-direction: column; align-items: stretch; gap: 10px; }
      .form-header-buttons { width: 100%; justify-content: flex-start; }
      .stat-card { padding: 16px; }
      .btn-primary, .btn-secondary, .btn-success, .btn-danger, .btn-warning {
        padding: 8px 12px;
        font-size: 12px;
      }
    }
    
    /* Strict Tab Section Display */
    .section-view { display: none !important; }
    .section-view.active { display: flex !important; flex-direction: column; gap: 20px; }
  </style>
</head>
<body>

  <!-- SaaS Root Container -->
  <div class="app-root">
    <!-- Left Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-logo" style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="logo-box">
              <span>IV</span>
            </div>
            <span class="brand-title">IPOVault</span>
          </div>
          <button class="sidebar-toggle-btn" onclick="toggleSidebar()" title="Toggle Menu" style="background:none; border:none; color:#94A3B8; cursor:pointer; padding:4px; border-radius:6px; display:flex; align-items:center;">
            <i data-feather="sidebar"></i>
          </button>
        </div>
        <div class="workspace-picker">
          <span>Production API (v1)</span>
          <i data-feather="chevron-down"></i>
        </div>
      </div>

      <!-- Navigation Menu -->
      <nav class="sidebar-nav">
        <div class="nav-group-title">Console Modules</div>

        <button class="nav-item active" id="nav-btn-dashboard" title="Dashboard" onclick="switchTab('dashboard')">
          <i data-feather="grid"></i>
          <span>Dashboard</span>
        </button>
        <button class="nav-item" id="nav-btn-manual" title="Manual IPO Manager" onclick="switchTab('manual')">
          <i data-feather="edit-3"></i>
          <span>Manual IPO Manager</span>
        </button>
        <button class="nav-item" id="nav-btn-explorer" title="IPO Explorer" onclick="switchTab('explorer')">
          <i data-feather="search"></i>
          <span>IPO Explorer</span>
        </button>
        <button class="nav-item" id="nav-btn-quality" title="Data Quality" onclick="switchTab('quality')">
          <i data-feather="shield"></i>
          <span>Data Quality</span>
        </button>
        <button class="nav-item" id="nav-btn-sources" title="Source Health" onclick="switchTab('sources')">
          <i data-feather="server"></i>
          <span>Source Health</span>
        </button>
        <button class="nav-item" id="nav-btn-notifications" title="Notification Ops" onclick="switchTab('notifications')">
          <i data-feather="bell"></i>
          <span>Notification Ops</span>
        </button>
        <button class="nav-item" id="nav-btn-allotment" title="Allotment Ops" onclick="switchTab('allotment')">
          <i data-feather="check-square"></i>
          <span>Allotment Ops</span>
        </button>
      </nav>

      <!-- Sidebar User Profile Footer -->
      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar-box">ADM</div>
          <div class="user-info">
            <span class="user-name">IPOVault Admin</span>
            <span class="user-email">admin@getipovault.in</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- Main Workspace Area -->
    <main class="main-workspace">
      <!-- Top Bar Header -->
      <div class="top-bar">
        <div class="breadcrumbs">
          <button class="icon-btn" onclick="toggleSidebar()" title="Toggle Menu" style="margin-right:6px;">
            <i data-feather="sidebar"></i>
          </button>
          <span>Console</span>
          <i data-feather="chevron-right"></i>
          <span class="breadcrumb-active" id="active-breadcrumb-title">Dashboard</span>
        </div>
        <div class="top-actions">
          <div class="search-input-box">
            <i data-feather="search"></i>
            <input type="text" id="global-search-input" placeholder="Search IPOs or symbols..." oninput="debounceFetchManualIpos()" />
          </div>
          <button class="icon-btn" id="themeToggleBtn" title="Toggle Theme" onclick="toggleTheme()">
            <i data-feather="moon"></i>
          </button>
          <button class="btn-primary" onclick="openCreateModal()">
            <i data-feather="plus"></i>
            <span>Add Manual IPO</span>
          </button>
        </div>
      </div>

      <!-- Workspace Scrollable Content -->
      <div class="workspace-content">

        <!-- 1. DASHBOARD OVERVIEW TAB -->
        <div id="tab-dashboard" class="section-view active">
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-title">Total Canonical IPOs</div>
              <div class="stat-value" id="kpi-total">-</div>
            </div>
            <div class="stat-card">
              <div class="stat-title">Published to Mobile App</div>
              <div class="stat-value" style="color:#10B981" id="kpi-published">-</div>
            </div>
            <div class="stat-card">
              <div class="stat-title">Currently Open IPOs</div>
              <div class="stat-value" style="color:#4F46E5" id="kpi-open">-</div>
            </div>
            <div class="stat-card">
              <div class="stat-title">Drafts & Pending</div>
              <div class="stat-value" style="color:#F59E0B" id="kpi-drafts">-</div>
            </div>
          </div>

          <div class="grid-table-box">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:600; font-size:14px; color:var(--text-main);">Recent Manual & Canonical IPOs</span>
              <button class="btn-secondary" onclick="switchTab('manual')" style="font-size:12px; padding:4px 10px;">Manage All IPOs →</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Symbol / Legal Name</th>
                  <th>Segment</th>
                  <th>Lifecycle Status</th>
                  <th>Publication Status</th>
                  <th>Price Band</th>
                  <th>Bidding Dates</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="dashboard-recent-table-body">
                <tr><td colspan="7" style="text-align:center; padding: 24px;">Loading IPO Vault records...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 2. MANUAL IPOs MANAGER TAB -->
        <div id="tab-manual" class="section-view">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div style="display:flex; gap:10px;">
              <button class="btn-primary" onclick="openCreateModal()"><i data-feather="plus"></i> <span>Add Manual IPO</span></button>
              <button class="btn-secondary" onclick="triggerJsonImport()">Import JSON</button>
              <input type="file" id="json-file-input" accept=".json,application/json" onchange="handleJsonFileSelect(event)" style="display:none;" />
            </div>
            <div style="display:flex; gap:10px;">
              <input type="text" id="man-search-q" placeholder="Search company or symbol..." oninput="debounceFetchManualIpos()" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;" />
              <select id="man-filter-pub" onchange="fetchManualIpos()" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;">
                <option value="">All Publication States</option>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <select id="man-filter-status" onchange="fetchManualIpos()" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;">
                <option value="">All Lifecycle Statuses</option>
                <option value="OPEN">Open</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="CLOSED">Closed</option>
                <option value="ALLOTMENT_COMPLETED">Allotment Completed</option>
              </select>
            </div>
          </div>

          <div class="grid-table-box" style="margin-top:8px;">
            <table>
              <thead>
                <tr>
                  <th>Symbol / Company Name</th>
                  <th>Segment</th>
                  <th>Lifecycle Status</th>
                  <th>Publication Status</th>
                  <th>Price Band</th>
                  <th>Open / Close Dates</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="manual-ipos-table-body">
                <tr><td colspan="7" style="text-align:center; padding: 24px;">Loading Manual IPOs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. MANUAL IPO EDIT / CREATE TAB -->
        <div id="tab-manual-edit" class="section-view">
          <div class="form-header-bar">
            <button class="btn-secondary" onclick="switchTab('manual')">Back to Manual IPOs</button>
            <div class="form-header-buttons">
              <button class="btn-primary" id="btn-save-action" onclick="saveManualIpo()">Save</button>
              <button class="btn-success" id="btn-publish-action" onclick="publishCurrentIpo()">Publish</button>
              <button class="btn-warning" id="btn-unpublish-action" onclick="unpublishCurrentIpo()">Unpublish</button>
              <button class="btn-secondary" id="btn-archive-action" onclick="archiveCurrentIpo()">Archive</button>
              <button class="btn-danger" id="btn-delete-action" onclick="deleteCurrentIpo()">Delete</button>
            </div>
          </div>

          <div id="validation-banner" style="display:none;" class="alert-box"></div>

          <div class="stat-card" style="padding:24px;">
            <div class="stat-title" style="margin-bottom:16px; font-size:14px; color:var(--primary);">Canonical IPO Information</div>
            <form id="manual-ipo-form" autocomplete="off" onsubmit="event.preventDefault(); saveManualIpo();" style="display:flex; flex-direction:column; gap:16px;">
              <input type="hidden" id="form-ipo-id" />

              <div class="form-grid">
                <div class="form-group">
                  <label>Legal Company Name *</label>
                  <input type="text" id="form-legalName" autocomplete="off" required />
                </div>
                <div class="form-group">
                  <label>Display Name</label>
                  <input type="text" id="form-displayName" autocomplete="off" />
                </div>
                <div class="form-group">
                  <label>CIN</label>
                  <input type="text" id="form-cin" autocomplete="off" placeholder="e.g. U12345MH2024PLC000001" />
                </div>
                <div class="form-group">
                  <label>Trading Symbol</label>
                  <input type="text" id="form-symbol" autocomplete="off" placeholder="e.g. SYMBOL" />
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Market Segment</label>
                  <select id="form-marketSegment">
                    <option value="MAINBOARD">MAINBOARD</option>
                    <option value="SME">SME</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Exchange Listing</label>
                  <select id="form-exchange">
                    <option value="NSE">NSE</option>
                    <option value="BSE">BSE</option>
                    <option value="BOTH">BOTH</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Lifecycle Status</label>
                  <select id="form-status" onchange="updateFormStatusSections()">
                    <option value="DRAFT">DRAFT</option>
                    <option value="UPCOMING">UPCOMING</option>
                    <option value="OPEN">OPEN</option>
                    <option value="CLOSED">CLOSED</option>
                    <option value="ALLOTMENT_COMPLETED">ALLOTMENT_COMPLETED</option>
                    <option value="LISTED">LISTED</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>Publication Status</label>
                  <select id="form-publicationStatus">
                    <option value="DRAFT">DRAFT (Hidden from Mobile App)</option>
                    <option value="PUBLISHED">PUBLISHED (Live on Mobile App)</option>
                    <option value="ARCHIVED">ARCHIVED</option>
                  </select>
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Price Band Low (₹)</label>
                  <input type="number" step="0.01" id="form-priceBandLow" />
                </div>
                <div class="form-group">
                  <label>Price Band High (₹)</label>
                  <input type="number" step="0.01" id="form-priceBandHigh" />
                </div>
                <div class="form-group">
                  <label>Lot Size (Shares)</label>
                  <input type="number" id="form-lotSize" />
                </div>
                <div class="form-group">
                  <label>Total Issue Size (₹ Cr)</label>
                  <input type="number" step="0.01" id="form-issueSize" />
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Issue Open Date</label>
                  <input type="date" id="form-openDate" />
                </div>
                <div class="form-group">
                  <label>Issue Close Date</label>
                  <input type="date" id="form-closeDate" />
                </div>
                <div class="form-group">
                  <label>Allotment Date</label>
                  <input type="date" id="form-allotmentDate" />
                </div>
                <div class="form-group">
                  <label>Listing Date</label>
                  <input type="date" id="form-listingDate" />
                </div>
              </div>

              <div class="form-group">
                <label>Company Logo URL</label>
                <input type="url" id="form-logoUrl" placeholder="https://example.com/logo.png" />
              </div>

              <!-- Offer Breakup & Retail Category Terms -->
              <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                <strong style="color:var(--primary); font-size:14px;">Offer Breakup & Retail Category Terms</strong>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>QIB Allocation (%)</label>
                  <input type="number" step="0.01" id="cat-qib-pct" placeholder="e.g. 50" />
                </div>
                <div class="form-group">
                  <label>NII Allocation (%)</label>
                  <input type="number" step="0.01" id="cat-nii-pct" placeholder="e.g. 15" />
                </div>
                <div class="form-group">
                  <label>Retail Allocation (%)</label>
                  <input type="number" step="0.01" id="cat-retail-pct" placeholder="e.g. 35" />
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Retail Min Lots</label>
                  <input type="number" id="cat-retail-min-lots" placeholder="e.g. 1" />
                </div>
                <div class="form-group">
                  <label>Retail Max Lots</label>
                  <input type="number" id="cat-retail-max-lots" placeholder="e.g. 13" />
                </div>
                <div class="form-group">
                  <label>Retail Min Shares</label>
                  <input type="number" id="cat-retail-min-shares" placeholder="e.g. 100" />
                </div>
                <div class="form-group">
                  <label>Retail Max Shares</label>
                  <input type="number" id="cat-retail-max-shares" placeholder="e.g. 1300" />
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Retail Min Amount (₹)</label>
                  <input type="number" step="0.01" id="cat-retail-min-amount" placeholder="e.g. 14800" />
                </div>
                <div class="form-group">
                  <label>Retail Max Amount (₹)</label>
                  <input type="number" step="0.01" id="cat-retail-max-amount" placeholder="e.g. 192400" />
                </div>
              </div>

              <!-- Participants (Registrar & Lead Managers) -->
              <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                <strong style="color:var(--primary); font-size:14px;">Participants (Registrar & Lead Managers)</strong>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Registrar Name</label>
                  <input type="text" id="part-reg-name" placeholder="e.g. MUFG Intime India Pvt Ltd / KFintech" />
                </div>
                <div class="form-group">
                  <label>Registrar Phone</label>
                  <input type="text" id="part-reg-phone" placeholder="e.g. +91 22 4918 6270" />
                </div>
                <div class="form-group">
                  <label>Registrar Email</label>
                  <input type="email" id="part-reg-email" placeholder="e.g. ipo@linkintime.co.in" />
                </div>
                <div class="form-group">
                  <label>Registrar Website</label>
                  <input type="url" id="part-reg-website" placeholder="https://..." />
                </div>
              </div>

              <div class="form-group">
                <label>Lead Manager / BRLM Name(s)</label>
                <input type="text" id="part-brlm-name" placeholder="e.g. ICICI Securities, Axis Capital (comma-separated)" />
              </div>

              <!-- Manual GMP & Subscriptions -->
              <div id="section-gmp-box">
                <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                  <strong style="color:var(--primary); font-size:14px;">Manual GMP & Subscription Observations</strong>
                </div>

                <div class="form-grid">
                  <div class="form-group">
                    <label>GMP Amount (₹)</label>
                    <input type="number" step="0.01" id="gmp-amount" placeholder="e.g. 25.00" />
                  </div>
                  <div class="form-group">
                    <label>GMP Percentage (%)</label>
                    <input type="number" step="0.01" id="gmp-percentage" placeholder="e.g. 23.15" />
                  </div>
                  <div class="form-group">
                    <label>Est Profit / Lot (₹)</label>
                    <input type="number" step="0.01" id="gmp-est-profit" placeholder="e.g. 3500.00" />
                  </div>
                </div>

                <div class="form-grid" style="margin-top:12px;">
                  <div class="form-group">
                    <label>QIB Sub (x)</label>
                    <input type="number" step="0.01" id="sub-qib" placeholder="e.g. 4.5" />
                  </div>
                  <div class="form-group">
                    <label>NII Sub (x)</label>
                    <input type="number" step="0.01" id="sub-nii" placeholder="e.g. 12.3" />
                  </div>
                  <div class="form-group">
                    <label>Retail Sub (x)</label>
                    <input type="number" step="0.01" id="sub-retail" placeholder="e.g. 8.1" />
                  </div>
                  <div class="form-group">
                    <label>Total Sub (x)</label>
                    <input type="number" step="0.01" id="sub-total" placeholder="e.g. 7.9" />
                  </div>
                </div>
              </div>

              <!-- Listing Performance (For Listed IPOs) -->
              <div id="section-listing-box" style="display:none;">
                <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                  <strong style="color:var(--primary); font-size:14px;">Listing Performance Details</strong>
                </div>

                <div class="form-grid">
                  <div class="form-group">
                    <label>Listing Price (₹)</label>
                    <input type="number" step="0.01" id="form-listingPrice" placeholder="e.g. 150.00" />
                  </div>
                  <div class="form-group">
                    <label>Listing Gain (%)</label>
                    <input type="number" step="0.01" id="form-listingGainPct" placeholder="e.g. 25.00" />
                  </div>
                  <div class="form-group">
                    <label>Est Profit Amount (₹)</label>
                    <input type="number" step="0.01" id="form-profitAmount" placeholder="e.g. 3500.00" />
                  </div>
                  <div class="form-group">
                    <label>Est Profit (%)</label>
                    <input type="number" step="0.01" id="form-profitPercentage" placeholder="e.g. 25.00" />
                  </div>
                </div>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:16px;">
                <button type="button" class="btn-secondary" onclick="switchTab('manual')">Cancel</button>
                <button type="submit" class="btn-primary">Save</button>
              </div>
            </form>
          </div>

          <!-- Allotment Configuration Form -->
          <div class="stat-card" style="padding:24px; margin-top:20px;">
            <div class="stat-title" style="margin-bottom:12px; font-size:14px; color:var(--primary);">Allotment Checker Mapping Configuration</div>
            <div class="form-grid">
              <div class="form-group">
                <label>Registrar Code</label>
                <input type="text" id="allot-registrar-code" placeholder="kfintech / linkintime / bigshare" />
              </div>
              <div class="form-group">
                <label>Registrar IPO Code / ID</label>
                <input type="text" id="allot-registrar-ipo-code" placeholder="e.g. REGISTRAR_IPO_CODE" />
              </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:12px;">
              <button class="btn-secondary" onclick="saveAllotmentConfig()">Save Allotment Config</button>
            </div>
          </div>
        </div>

        <!-- 4. IPO EXPLORER TAB -->
        <div id="tab-explorer" class="section-view">
          <div class="grid-table-box">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
              <span style="font-weight:600; font-size:14px;">Canonical IPO Explorer</span>
              <input type="text" id="exp-search-q" placeholder="Search symbol or name..." oninput="debounceFetchExplorerIpos()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;" />
            </div>
            <table>
              <thead>
                <tr>
                  <th>Company / Symbol</th>
                  <th>Segment</th>
                  <th>Status</th>
                  <th>Price Band</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="explorer-ipos-table-body">
                <tr><td colspan="5" style="text-align:center; padding:24px;">Loading IPO Explorer...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 5. DATA QUALITY TAB -->
        <div id="tab-quality" class="section-view">
          <div class="stat-card">
            <div class="stat-title">Overall Data Quality Gate</div>
            <div class="stat-value" id="qual-overall-status">COMPLETE</div>
          </div>
          <div class="stats-grid" id="qual-breakdown-grid"></div>
        </div>

        <!-- 6. SOURCE HEALTH TAB -->
        <div id="tab-sources" class="section-view">
          <div class="grid-table-box">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); font-weight:600; font-size:14px;">Upstream Data Sources</div>
            <table>
              <thead>
                <tr>
                  <th>Source Name</th>
                  <th>Type</th>
                  <th>Records Ingested</th>
                  <th>Health Status</th>
                </tr>
              </thead>
              <tbody id="sources-table-body">
                <tr><td colspan="4" style="text-align:center; padding:24px;">Loading source health...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 7. NOTIFICATIONS OPS TAB -->
        <div id="tab-notifications" class="section-view">
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-title">Total Deliveries</div><div class="stat-value" id="notif-total">-</div></div>
            <div class="stat-card"><div class="stat-title">Delivered</div><div class="stat-value" style="color:#10B981" id="notif-delivered">-</div></div>
            <div class="stat-card"><div class="stat-title">Failed</div><div class="stat-value" style="color:#EF4444" id="notif-failed">-</div></div>
            <div class="stat-card"><div class="stat-title">Success Rate</div><div class="stat-value" style="color:#4F46E5" id="notif-rate">-</div></div>
          </div>
        </div>

        <!-- 8. ALLOTMENT OPS TAB -->
        <div id="tab-allotment" class="section-view">
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-title">Total Allotment Jobs</div><div class="stat-value" id="allot-jobs">-</div></div>
            <div class="stat-card"><div class="stat-title">Completed Jobs</div><div class="stat-value" style="color:#10B981" id="allot-completed">-</div></div>
            <div class="stat-card"><div class="stat-title">Observations</div><div class="stat-value" id="allot-observations">-</div></div>
            <div class="stat-card"><div class="stat-title">Positive Allotments</div><div class="stat-value" style="color:#4F46E5" id="allot-positive">-</div></div>
          </div>
        </div>

      </div>
    </main>
  </div>

  <script>
    const API_BASE = '${baseUrl}';
    let currentTab = 'dashboard';
    let currentIpoData = null;

    document.addEventListener('DOMContentLoaded', () => {
      if (localStorage.getItem('sidebar-collapsed') === 'true') {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
      }
      if (window.feather) feather.replace();
    });

    function toggleSidebar() {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');
      localStorage.setItem('sidebar-collapsed', isCollapsed ? 'true' : 'false');
    }

    function toggleTheme() {
      document.body.classList.toggle('dark-mode');
      const isDark = document.body.classList.contains('dark-mode');
      const btn = document.getElementById('themeToggleBtn');
      if (btn) {
        btn.innerHTML = isDark ? '<i data-feather="sun"></i>' : '<i data-feather="moon"></i>';
        if (window.feather) feather.replace();
      }
    }

    function switchTab(tabId) {
      currentTab = tabId;
      document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('tab-' + tabId);
      if (target) target.classList.add('active');

      document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
      const activeNavBtn = document.getElementById('nav-btn-' + tabId);
      if (activeNavBtn) activeNavBtn.classList.add('active');

      const titleMap = {
        'dashboard': 'Dashboard',
        'manual': 'Manual IPO Manager',
        'explorer': 'IPO Explorer',
        'quality': 'Data Quality Overview',
        'sources': 'Upstream Source Health',
        'notifications': 'Notification Delivery Ops',
        'allotment': 'Allotment Check Ops'
      };
      const breadcrumbEl = document.getElementById('active-breadcrumb-title');
      if (breadcrumbEl) breadcrumbEl.textContent = titleMap[tabId] || 'Dashboard';

      if (tabId === 'dashboard') loadDashboard();
      if (tabId === 'manual') fetchManualIpos();
      if (tabId === 'explorer') fetchExplorerIpos();
      if (tabId === 'quality') loadQuality();
      if (tabId === 'sources') loadSources();
      if (tabId === 'notifications') loadNotifications();
      if (tabId === 'allotment') loadAllotment();
    }

    async function loadDashboard() {
      try {
        const res = await fetch(API_BASE + '/dashboard');
        const json = await res.json();
        const data = json.data || json;
        document.getElementById('kpi-total').textContent = data.totalCanonicalIpos ?? 0;
        document.getElementById('kpi-published').textContent = data.publishedIpos ?? 0;
        document.getElementById('kpi-open').textContent = data.openIpos ?? 0;
        document.getElementById('kpi-drafts').textContent = data.draftIpos ?? 0;

        fetchRecentDashboardIpos();
      } catch (err) {
        console.error('Dashboard load error:', err);
      }
    }

    async function fetchRecentDashboardIpos() {
      try {
        const res = await fetch(API_BASE + '/manual-ipos?limit=10');
        const json = await res.json();
        const items = json.data?.items || json.items || [];
        const tbody = document.getElementById('dashboard-recent-table-body');

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color:var(--text-muted);">No recent IPO records found.</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(item => \`
          <tr>
            <td><strong>\${item.legalName || 'N/A'}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${item.symbol || 'No Symbol'}</span></td>
            <td>\${item.marketSegment || 'MAINBOARD'}</td>
            <td><span class="status-pill \${(item.status || 'DRAFT').toLowerCase()}">\${item.status || 'DRAFT'}</span></td>
            <td><span class="status-pill \${item.publicationStatus === 'PUBLISHED' ? 'published' : 'upcoming'}">\${item.publicationStatus || 'DRAFT'}</span></td>
            <td>₹\${item.priceBandLow || 0} - ₹\${item.priceBandHigh || 0}</td>
            <td style="font-size:12px;">\${item.openDate || 'TBD'} to \${item.closeDate || 'TBD'}</td>
            <td>
              <button class="btn-secondary" onclick="editManualIpo('\${item.id}')" style="padding:4px 8px; font-size:11px;">Edit</button>
            </td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Dashboard recent fetch error:', err);
      }
    }

    async function fetchManualIpos() {
      try {
        const q = document.getElementById('man-search-q').value;
        const pub = document.getElementById('man-filter-pub').value;
        const st = document.getElementById('man-filter-status').value;
        const query = new URLSearchParams({ page: 1, limit: 50 });
        if (q) query.set('q', q);
        if (pub) query.set('publicationStatus', pub);
        if (st) query.set('status', st);

        const res = await fetch(API_BASE + '/manual-ipos?' + query.toString());
        const json = await res.json();
        const items = json.data?.items || json.items || [];
        const tbody = document.getElementById('manual-ipos-table-body');
        
        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color:var(--text-muted);">No Manual IPOs found. Click "Add Manual IPO" to create one.</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(item => \`
          <tr>
            <td><strong>\${item.legalName || 'N/A'}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${item.symbol || 'No Symbol'}</span></td>
            <td>\${item.marketSegment || 'MAINBOARD'}</td>
            <td><span class="status-pill \${(item.status || 'DRAFT').toLowerCase()}">\${item.status || 'DRAFT'}</span></td>
            <td><span class="status-pill \${item.publicationStatus === 'PUBLISHED' ? 'published' : 'upcoming'}">\${item.publicationStatus || 'DRAFT'}</span></td>
            <td>₹\${item.priceBandLow || 0} - ₹\${item.priceBandHigh || 0}</td>
            <td style="font-size:12px;">\${item.openDate || 'TBD'} to \${item.closeDate || 'TBD'}</td>
            <td>
              <button class="btn-secondary" onclick="editManualIpo('\${item.id}')" style="padding:4px 8px; font-size:11px;">Edit</button>
            </td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Fetch manual IPOs error:', err);
      }
    }

    let debounceTimer;
    function debounceFetchManualIpos() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchManualIpos, 300);
    }

    async function fetchExplorerIpos() {
      try {
        const q = document.getElementById('exp-search-q').value;
        const res = await fetch(API_BASE + '/ipos?limit=50' + (q ? '&q=' + encodeURIComponent(q) : ''));
        const json = await res.json();
        const items = json.data?.items || json.items || [];
        const tbody = document.getElementById('explorer-ipos-table-body');
        
        tbody.innerHTML = items.map(i => \`
          <tr>
            <td><strong>\${i.companyName || i.legalName}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${i.symbol || ''}</span></td>
            <td>\${i.marketSegment || 'MAINBOARD'}</td>
            <td><span class="status-pill open">\${i.status}</span></td>
            <td>₹\${i.priceBandLow || 0} - ₹\${i.priceBandHigh || 0}</td>
            <td><button class="btn-secondary" style="padding:4px 8px; font-size:11px;">View Detail</button></td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Explorer load error:', err);
      }
    }

    function debounceFetchExplorerIpos() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(fetchExplorerIpos, 300);
    }

    function updateFormStatusSections() {
      const statusSelect = document.getElementById('form-status');
      const status = statusSelect ? statusSelect.value : '';
      const gmpBox = document.getElementById('section-gmp-box');
      const listingBox = document.getElementById('section-listing-box');

      if (status === 'LISTED') {
        if (gmpBox) gmpBox.style.display = 'none';
        if (listingBox) listingBox.style.display = 'block';
      } else {
        if (gmpBox) gmpBox.style.display = 'block';
        if (listingBox) listingBox.style.display = 'none';
      }
    }

    function openCreateModal() {
      currentIpoData = null;
      document.getElementById('manual-ipo-form').reset();
      document.getElementById('form-ipo-id').value = '';
      updateFormStatusSections();
      switchTab('manual-edit');
    }

    async function editManualIpo(id) {
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id);
        const json = await res.json();
        currentIpoData = json.data || json;
        
        document.getElementById('form-ipo-id').value = currentIpoData.id;
        document.getElementById('form-legalName').value = currentIpoData.legalName || '';
        document.getElementById('form-displayName').value = currentIpoData.displayName || '';
        document.getElementById('form-cin').value = currentIpoData.cin || '';
        document.getElementById('form-symbol').value = currentIpoData.symbol || '';
        document.getElementById('form-marketSegment').value = currentIpoData.marketSegment || 'MAINBOARD';
        document.getElementById('form-exchange').value = currentIpoData.exchange || 'NSE';
        document.getElementById('form-status').value = currentIpoData.status || 'DRAFT';
        document.getElementById('form-publicationStatus').value = currentIpoData.publicationStatus || 'DRAFT';
        document.getElementById('form-priceBandLow').value = currentIpoData.priceBandLow || '';
        document.getElementById('form-priceBandHigh').value = currentIpoData.priceBandHigh || '';
        document.getElementById('form-lotSize').value = currentIpoData.lotSize || '';
        document.getElementById('form-issueSize').value = currentIpoData.issueSize || '';
        document.getElementById('form-openDate').value = currentIpoData.openDate ? currentIpoData.openDate.split('T')[0] : '';
        document.getElementById('form-closeDate').value = currentIpoData.closeDate ? currentIpoData.closeDate.split('T')[0] : '';
        document.getElementById('form-allotmentDate').value = currentIpoData.allotmentDate ? currentIpoData.allotmentDate.split('T')[0] : '';
        document.getElementById('form-listingDate').value = currentIpoData.listingDate ? currentIpoData.listingDate.split('T')[0] : '';
        document.getElementById('form-logoUrl').value = currentIpoData.logoUrl || '';
        document.getElementById('form-listingPrice').value = currentIpoData.listingPrice ?? '';
        document.getElementById('form-listingGainPct').value = currentIpoData.listingGainPct ?? '';
        document.getElementById('form-profitAmount').value = currentIpoData.profitAmount ?? '';
        document.getElementById('form-profitPercentage').value = currentIpoData.profitPercentage ?? '';

        if (currentIpoData.latestGmp) {
          document.getElementById('gmp-amount').value = currentIpoData.latestGmp.gmpAmount ?? '';
          document.getElementById('gmp-percentage').value = currentIpoData.latestGmp.gmpPercentage ?? '';
          document.getElementById('gmp-est-profit').value = currentIpoData.latestGmp.estProfitPerLot ?? '';
        } else {
          document.getElementById('gmp-amount').value = '';
          document.getElementById('gmp-percentage').value = '';
          document.getElementById('gmp-est-profit').value = '';
        }

        updateFormStatusSections();
        switchTab('manual-edit');
      } catch (err) {
        console.error('Error fetching manual IPO detail:', err);
      }
    }

    async function saveManualIpo() {
      const id = document.getElementById('form-ipo-id').value;
      const payload = {
        legalName: document.getElementById('form-legalName').value,
        displayName: document.getElementById('form-displayName').value,
        cin: document.getElementById('form-cin').value,
        symbol: document.getElementById('form-symbol').value,
        marketSegment: document.getElementById('form-marketSegment').value,
        exchange: document.getElementById('form-exchange').value,
        status: document.getElementById('form-status').value,
        publicationStatus: document.getElementById('form-publicationStatus').value,
        priceBandLow: parseFloat(document.getElementById('form-priceBandLow').value) || undefined,
        priceBandHigh: parseFloat(document.getElementById('form-priceBandHigh').value) || undefined,
        lotSize: parseInt(document.getElementById('form-lotSize').value, 10) || undefined,
        listingPrice: parseFloat(document.getElementById('form-listingPrice').value) || undefined,
        listingGainPct: parseFloat(document.getElementById('form-listingGainPct').value) || undefined,
        profitAmount: parseFloat(document.getElementById('form-profitAmount').value) || undefined,
        profitPercentage: parseFloat(document.getElementById('form-profitPercentage').value) || undefined,
        issueSize: parseFloat(document.getElementById('form-issueSize').value) || undefined,
        openDate: document.getElementById('form-openDate').value || undefined,
        closeDate: document.getElementById('form-closeDate').value || undefined,
        allotmentDate: document.getElementById('form-allotmentDate').value || undefined,
        listingDate: document.getElementById('form-listingDate').value || undefined,
        logoUrl: document.getElementById('form-logoUrl').value || undefined,
      };

      const gmpVal = parseFloat(document.getElementById('gmp-amount').value);
      if (!isNaN(gmpVal)) {
        payload.gmp = {
          gmpAmount: gmpVal,
          gmpPercentage: parseFloat(document.getElementById('gmp-percentage').value) || undefined,
          estProfitPerLot: parseFloat(document.getElementById('gmp-est-profit').value) || undefined,
        };
      }

      try {
        const method = id ? 'PATCH' : 'POST';
        const url = id ? API_BASE + '/manual-ipos/' + id : API_BASE + '/manual-ipos';
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Save failed with status ' + res.status);
        alert('Manual IPO saved successfully!');
        switchTab('manual');
      } catch (err) {
        alert('Failed to save manual IPO: ' + err.message);
      }
    }

    async function publishCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) return;
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/publish', { method: 'POST' });
        if (res.ok) { alert('Published to mobile live feed!'); switchTab('manual'); }
      } catch (err) { alert('Publish error: ' + err.message); }
    }

    async function unpublishCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) return;
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/unpublish', { method: 'POST' });
        if (res.ok) { alert('Unpublished!'); switchTab('manual'); }
      } catch (err) { alert('Unpublish error: ' + err.message); }
    }

    async function archiveCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) return;
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/archive', { method: 'POST' });
        if (res.ok) { alert('Archived IPO!'); switchTab('manual'); }
      } catch (err) { alert('Archive error: ' + err.message); }
    }

    async function deleteCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id || !confirm('Permanently delete this IPO?')) return;
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id, { method: 'DELETE' });
        if (res.ok) { alert('Deleted!'); switchTab('manual'); }
      } catch (err) { alert('Delete error: ' + err.message); }
    }

    function triggerJsonImport() {
      document.getElementById('json-file-input').click();
    }

    function handleJsonFileSelect(evt) {
      const file = evt.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const jsonPayload = JSON.parse(e.target.result);
          const res = await fetch(API_BASE + '/manual-ipos/import-json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPayload)
          });
          if (res.ok) { alert('JSON Imported successfully!'); fetchManualIpos(); }
        } catch (err) { alert('JSON import failed: ' + err.message); }
      };
      reader.readAsText(file);
    }

    async function loadQuality() {
      try {
        const res = await fetch(API_BASE + '/quality');
        const json = await res.json();
        const data = json.data || json;
        document.getElementById('qual-overall-status').textContent = data.overallQualityGateStatus || 'COMPLETE';

        const grid = document.getElementById('qual-breakdown-grid');
        grid.innerHTML = Object.entries(data.statusBreakdown || {}).map(([st, cnt]) => \`
          <div class="stat-card">
            <div class="stat-title">\${st}</div>
            <div class="stat-value">\${cnt}</div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Quality load error:', err);
      }
    }

    async function loadSources() {
      try {
        const res = await fetch(API_BASE + '/sources');
        const json = await res.json();
        const sources = json.data?.sources || json.sources || [];
        const tbody = document.getElementById('sources-table-body');
        tbody.innerHTML = sources.map(s => \`
          <tr>
            <td><strong>\${s.name}</strong> (\${s.code})</td>
            <td>\${s.sourceType}</td>
            <td class="mono">\${s.totalRecords}</td>
            <td><span class="status-pill open">\${s.healthState}</span></td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Sources load error:', err);
      }
    }

    async function loadNotifications() {
      try {
        const res = await fetch(API_BASE + '/notifications');
        const json = await res.json();
        const data = json.data || json;
        document.getElementById('notif-total').textContent = data.totalDeliveries ?? 0;
        document.getElementById('notif-delivered').textContent = data.deliveredCount ?? 0;
        document.getElementById('notif-failed').textContent = data.failedCount ?? 0;
        document.getElementById('notif-rate').textContent = (data.deliverySuccessRatePercentage ?? 100) + '%';
      } catch (err) {
        console.error('Notif ops error:', err);
      }
    }

    async function loadAllotment() {
      try {
        const res = await fetch(API_BASE + '/allotment');
        const json = await res.json();
        const data = json.data || json;
        document.getElementById('allot-jobs').textContent = data.totalJobs ?? 0;
        document.getElementById('allot-completed').textContent = data.completedJobs ?? 0;
        document.getElementById('allot-observations').textContent = data.totalObservations ?? 0;
        document.getElementById('allot-positive').textContent = data.positiveAllotments ?? 0;
      } catch (err) {
        console.error('Allotment ops error:', err);
      }
    }

    // Init
    loadDashboard();
  </script>
</body>
</html>`;
}

export function renderConsoleHtml(baseUrl = '/api/v1/console/api'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AutomatePro — IPOVault Backend Console</title>
  
  <!-- Google Fonts: Inter & Outfit & JetBrains Mono -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet" />
  
  <!-- Feather Icons CDN -->
  <script src="https://unpkg.com/feather-icons"></script>
  
  <style>
    /* AutomatePro Dashboard CSS System */
    :root {
      --bg-app: #ECEFF1;
      --bg-window: #FFFFFF;
      --bg-sidebar: #F8FAFC;
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
      
      /* Status Colors */
      --status-in-progress-bg: #FEF3C7;
      --status-in-progress-fg: #D97706;
      
      --status-ready-bg: #F3E8FF;
      --status-ready-fg: #7C3AED;
      
      /* Priority Colors */
      --priority-urgent-bg: #FEF2F2;
      --priority-urgent-fg: #DC2626;
      
      --priority-normal-bg: #F0FDF4;
      --priority-normal-fg: #16A34A;
      
      --priority-low-bg: #EFF6FF;
      --priority-low-fg: #2563EB;
      
      --progress-fill: #6366F1;
      --shadow-window: 0 20px 50px rgba(0, 0, 0, 0.08);
      --shadow-card: 0 4px 12px rgba(0, 0, 0, 0.04);
    }

    body.dark-mode {
      --bg-app: #090D16;
      --bg-window: #0F172A;
      --bg-sidebar: #1E293B;
      --bg-surface: #1E293B;
      --bg-hover: #334155;
      --bg-active: #475569;
      
      --border-color: #334155;
      --border-subtle: #1E293B;
      
      --text-main: #F8FAFC;
      --text-muted: #94A3B8;
      --text-subtle: #64748B;
      
      --primary: #818CF8;
      --primary-light: #1E1B4B;
      
      --shadow-window: 0 20px 50px rgba(0, 0, 0, 0.5);
      --shadow-card: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-app);
      color: var(--text-main);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 24px;
      overflow-x: hidden;
    }

    /* Window Frame Container */
    .window-frame {
      width: 100%;
      max-width: 1400px;
      background-color: var(--bg-window);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-window);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 92vh;
      max-height: 960px;
    }

    /* Window Top Control Bar */
    .window-header {
      height: 44px;
      background-color: var(--bg-window);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      flex-shrink: 0;
    }

    .window-controls { display: flex; align-items: center; gap: 8px; }
    .control-btn { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .control-btn.close { background-color: #FF5F56; }
    .control-btn.minimize { background-color: #FFBD2E; }
    .control-btn.maximize { background-color: #27C93F; }

    .url-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: var(--bg-hover);
      padding: 4px 16px;
      border-radius: 20px;
      font-size: 12px;
      color: var(--text-muted);
      width: 340px;
      justify-content: center;
    }
    .url-bar i { width: 12px; height: 12px; }

    .header-right-actions { display: flex; align-items: center; gap: 12px; }
    .icon-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 6px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover { background-color: var(--bg-hover); color: var(--text-main); }

    /* App Layout Grid */
    .app-layout { display: flex; flex: 1; overflow: hidden; }

    /* Sidebar Styling */
    .sidebar {
      width: 250px;
      background-color: var(--bg-sidebar);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      padding: 16px 12px;
      flex-shrink: 0;
    }

    .sidebar-brand { margin-bottom: 20px; }
    .brand-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .logo-box {
      width: 30px;
      height: 30px;
      background-color: #000000;
      color: #FFFFFF;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    body.dark-mode .logo-box { background-color: #FFFFFF; color: #000000; }
    .logo-box i { width: 16px; height: 16px; }
    .brand-title { font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 16px; color: var(--text-main); }

    .workspace-picker {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
    }
    .workspace-picker i { width: 14px; height: 14px; color: var(--text-muted); }

    /* Navigation Menu */
    .sidebar-nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 8px;
      color: var(--text-muted);
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
    .nav-item:hover { background-color: var(--bg-hover); color: var(--text-main); }
    .nav-item.active { background-color: var(--bg-surface); color: var(--text-main); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); }
    .nav-item i { width: 16px; height: 16px; }

    .nav-group { margin-top: 16px; }
    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-subtle);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .group-actions { display: flex; align-items: center; gap: 6px; }
    .group-actions i { width: 12px; height: 12px; cursor: pointer; }
    .group-items { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }

    /* Sidebar User Profile Footbar */
    .sidebar-footer { border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 8px; }
    .user-profile { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 8px; cursor: pointer; }
    .user-profile:hover { background-color: var(--bg-hover); }
    .user-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; background: #e2e8f0; }
    .user-info { display: flex; flex-direction: column; flex: 1; }
    .user-name { font-size: 12px; font-weight: 600; color: var(--text-main); }
    .user-email { font-size: 11px; color: var(--text-subtle); }

    /* Main Workspace Container */
    .main-workspace { flex: 1; display: flex; flex-direction: column; background-color: var(--bg-surface); overflow: hidden; }

    /* Top Breadcrumb & Actions Bar */
    .top-bar {
      height: 54px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      flex-shrink: 0;
    }

    .breadcrumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 500; color: var(--text-muted); }
    .breadcrumb-active { color: var(--text-main); font-weight: 600; }
    .breadcrumbs i { width: 14px; height: 14px; color: var(--text-subtle); }

    .top-actions { display: flex; align-items: center; gap: 12px; }

    .search-input-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 6px 12px;
      width: 220px;
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

    .action-btn-outlined {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-main);
      cursor: pointer;
    }
    .action-btn-outlined:hover { background-color: var(--bg-hover); }
    .action-btn-outlined i { width: 14px; height: 14px; }

    .notification-btn { position: relative; }
    .notification-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 14px;
      height: 14px;
      background-color: #EF4444;
      color: #FFFFFF;
      font-size: 9px;
      font-weight: 700;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Sub Navigation Tabs Bar */
    .view-tabs-bar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 24px;
      border-bottom: 1px solid var(--border-color);
      height: 44px;
      flex-shrink: 0;
    }

    .view-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .view-tab:hover { color: var(--text-main); }
    .view-tab.active { background-color: var(--primary-light); color: var(--primary); font-weight: 600; }
    .view-tab i { width: 14px; height: 14px; }

    .add-tab-btn {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      cursor: pointer;
      border: 1px solid var(--border-color);
    }
    .add-tab-btn i { width: 14px; height: 14px; }

    /* Content Area */
    .workspace-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* Group Banner Header */
    .group-section { display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }
    .group-banner { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
    
    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .status-pill.in-progress { background-color: var(--status-in-progress-bg); color: var(--status-in-progress-fg); }
    .status-pill.ready { background-color: var(--status-ready-bg); color: var(--status-ready-fg); }

    .group-count-badge {
      background-color: rgba(0, 0, 0, 0.06);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
    }

    /* Grid Table System */
    .grid-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
      background: var(--bg-surface);
    }
    .grid-header {
      display: grid;
      grid-template-columns: 2.2fr 2fr 1.2fr 1.2fr 1fr 1.2fr 0.8fr;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .grid-row {
      display: grid;
      grid-template-columns: 2.2fr 2fr 1.2fr 1.2fr 1fr 1.2fr 0.8fr;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-subtle);
      align-items: center;
      font-size: 13px;
      transition: background 0.15s ease;
    }
    .grid-row:hover { background-color: var(--bg-hover); }

    .col-task { display: flex; align-items: center; gap: 8px; }
    .tree-toggle { color: var(--text-subtle); cursor: pointer; transition: transform 0.2s ease; }
    .tree-toggle i { width: 14px; height: 14px; }
    .task-checkbox { width: 16px; height: 16px; accent-color: var(--primary); cursor: pointer; }
    .task-title { font-weight: 500; color: var(--text-main); }
    .task-title.text-checked { text-decoration: line-through; color: var(--text-subtle); }
    .task-comment-count { font-size: 11px; color: var(--text-subtle); display: flex; align-items: center; gap: 3px; }
    .task-comment-count i { width: 11px; height: 11px; }

    .col-desc { color: var(--text-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-right: 12px; }
    
    /* Assignee Avatars */
    .avatar-group { display: flex; align-items: center; }
    .avatar-circle {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background-color: #818CF8;
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid var(--bg-surface);
      margin-left: -6px;
    }
    .avatar-circle:first-child { margin-left: 0; }

    /* Priority Badges */
    .priority-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
    }
    .priority-badge.urgent { background-color: var(--priority-urgent-bg); color: var(--priority-urgent-fg); }
    .priority-badge.normal { background-color: var(--priority-normal-bg); color: var(--priority-normal-fg); }
    .priority-badge.low { background-color: var(--priority-low-bg); color: var(--priority-low-fg); }
    .priority-badge i { width: 11px; height: 11px; }

    /* Progress Bar */
    .progress-cell { display: flex; align-items: center; gap: 8px; width: 100%; }
    .progress-bar-track { flex: 1; height: 5px; background-color: var(--border-color); border-radius: 4px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background-color: var(--progress-fill); border-radius: 4px; transition: width 0.3s ease; }
    .progress-text { font-size: 11px; font-weight: 600; color: var(--text-muted); width: 30px; text-align: right; }

    /* Created Tag */
    .created-tag {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background-color: #0284C7;
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* KPI Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      box-shadow: var(--shadow-card);
    }
    .stat-title { font-size: 12px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
    .stat-value { font-size: 26px; font-weight: 700; color: var(--text-main); }

    /* Controls & Buttons */
    .btn-primary {
      background-color: var(--primary);
      color: #FFFFFF;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary:hover { opacity: 0.9; }

    .btn-secondary {
      background-color: var(--bg-hover);
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
    .btn-secondary:hover { background-color: var(--bg-active); }

    .btn-success { background-color: #10B981; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-danger { background-color: #EF4444; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .btn-warning { background-color: #F59E0B; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }

    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
    .form-group input, .form-group select, .form-group textarea {
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
    }
    .form-group input:focus, .form-group select:focus { border-color: var(--primary); }

    .alert-box { padding: 12px 16px; border-radius: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
    .alert-box.success { background: #ECFDF5; border: 1px solid #10B981; color: #065F46; }
    .alert-box.danger { background: #FEF2F2; border: 1px solid #EF4444; color: #991B1B; }
    .alert-box.warning { background: #FFFBEB; border: 1px solid #F59E0B; color: #92400E; }

    .mono { font-family: 'JetBrains Mono', monospace; }
    
    /* Strict Tab Visibility Section */
    .section-view { display: none !important; }
    .section-view.active { display: flex !important; flex-direction: column; gap: 20px; }
  </style>
</head>
<body>

  <!-- Window Frame -->
  <div class="window-frame">
    <!-- Window Control Header -->
    <header class="window-header">
      <div class="window-controls">
        <span class="control-btn close"></span>
        <span class="control-btn minimize"></span>
        <span class="control-btn maximize"></span>
      </div>
      <div class="url-bar">
        <i data-feather="lock"></i>
        <span class="url-text">app.automatepro.com</span>
        <i data-feather="rotate-cw"></i>
      </div>
      <div class="header-right-actions">
        <button class="icon-btn" id="themeToggleBtn" title="Toggle Theme" onclick="toggleTheme()">
          <i data-feather="moon"></i>
        </button>
      </div>
    </header>

    <!-- App Layout -->
    <div class="app-layout">
      <!-- Left Sidebar -->
      <aside class="sidebar">
        <!-- Brand & Workspace -->
        <div class="sidebar-brand">
          <div class="brand-logo">
            <div class="logo-box">
              <i data-feather="box"></i>
            </div>
            <span class="brand-title">AutomatePro</span>
          </div>
          <div class="workspace-picker">
            <span>Keitoto Studio</span>
            <i data-feather="chevron-down"></i>
          </div>
        </div>

        <!-- Navigation Menu -->
        <nav class="sidebar-nav">
          <button class="nav-item" onclick="switchTab('dashboard')">
            <i data-feather="grid"></i>
            <span>Dashboard</span>
          </button>
          <button class="nav-item" onclick="switchTab('manual')">
            <i data-feather="inbox"></i>
            <span>Inbox</span>
          </button>
          <button class="nav-item" onclick="switchTab('explorer')">
            <i data-feather="users"></i>
            <span>Teams</span>
          </button>
          <button class="nav-item" onclick="switchTab('quality')">
            <i data-feather="user-check"></i>
            <span>Assigned to me</span>
          </button>
          <button class="nav-item" onclick="switchTab('sources')">
            <i data-feather="plus-circle"></i>
            <span>Created by me</span>
          </button>

          <!-- Favorites Category -->
          <div class="nav-group">
            <div class="group-header">
              <span>Favorites</span>
              <div class="group-actions">
                <i data-feather="more-horizontal"></i>
                <i data-feather="plus"></i>
              </div>
            </div>
          </div>

          <!-- Projects Category -->
          <div class="nav-group">
            <div class="group-header">
              <span>Projects</span>
              <div class="group-actions">
                <i data-feather="more-horizontal"></i>
                <i data-feather="plus"></i>
              </div>
            </div>
            <div class="group-items">
              <button class="nav-item active" id="nav-btn-dashboard" onclick="switchTab('dashboard')">
                <i data-feather="list"></i>
                <span>Adrian Bert - CRM Da...</span>
              </button>
              <button class="nav-item" id="nav-btn-manual" onclick="switchTab('manual')">
                <i data-feather="list"></i>
                <span>Manual IPO Manager</span>
              </button>
              <button class="nav-item" id="nav-btn-explorer" onclick="switchTab('explorer')">
                <i data-feather="list"></i>
                <span>IPO Explorer</span>
              </button>
              <button class="nav-item" id="nav-btn-quality" onclick="switchTab('quality')">
                <i data-feather="list"></i>
                <span>Data Quality</span>
              </button>
              <button class="nav-item" id="nav-btn-sources" onclick="switchTab('sources')">
                <i data-feather="list"></i>
                <span>Source Health</span>
              </button>
              <button class="nav-item" id="nav-btn-notifications" onclick="switchTab('notifications')">
                <i data-feather="list"></i>
                <span>Notifications Ops</span>
              </button>
              <button class="nav-item" id="nav-btn-allotment" onclick="switchTab('allotment')">
                <i data-feather="list"></i>
                <span>Allotment Ops</span>
              </button>
            </div>
          </div>
        </nav>

        <!-- Sidebar Footer -->
        <div class="sidebar-footer">
          <div class="nav-item" style="margin-bottom: 4px;">
            <i data-feather="settings"></i>
            <span>Settings</span>
          </div>
          <div class="nav-item" style="margin-bottom: 8px;">
            <i data-feather="help-circle"></i>
            <span>Help Center</span>
          </div>
          <div class="user-profile">
            <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80" class="user-avatar" alt="Darlene Robertson" />
            <div class="user-info">
              <span class="user-name">Darlene Robertson</span>
              <span class="user-email">darlene@gmail.com</span>
            </div>
          </div>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="main-workspace">
        <!-- Top Breadcrumb & Actions Bar -->
        <div class="top-bar">
          <div class="breadcrumbs">
            <span>Projects</span>
            <i data-feather="chevron-right"></i>
            <span class="breadcrumb-active" id="active-breadcrumb-title">Adrian Bert - CRM Dashboard</span>
          </div>
          <div class="top-actions">
            <div class="search-input-box">
              <i data-feather="search"></i>
              <input type="text" id="global-search-input" placeholder="Search task..." />
            </div>
            <button class="action-btn-outlined">
              <i data-feather="filter"></i>
              <span>Filter</span>
            </button>
            <button class="icon-btn notification-btn">
              <i data-feather="bell"></i>
              <span class="notification-badge">1</span>
            </button>
            <button class="btn-primary" onclick="openCreateModal()">
              <i data-feather="plus"></i>
              <span>+ Add Task</span>
            </button>
          </div>
        </div>

        <!-- View Sub Tabs Bar -->
        <div class="view-tabs-bar">
          <a href="#" class="view-tab active">
            <i data-feather="layout"></i>
            <span>Spreadsheet</span>
          </a>
          <a href="#" class="view-tab">
            <i data-feather="clock"></i>
            <span>Timeline</span>
          </a>
          <a href="#" class="view-tab">
            <i data-feather="calendar"></i>
            <span>Calendar</span>
          </a>
          <a href="#" class="view-tab">
            <i data-feather="columns"></i>
            <span>Board</span>
          </a>
          <div class="add-tab-btn">
            <i data-feather="plus"></i>
          </div>
        </div>

        <!-- Scrollable Workspace Content -->
        <div class="workspace-content">

          <!-- 1. DASHBOARD TAB -->
          <div id="tab-dashboard" class="section-view active">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-title">Total IPOs</div>
                <div class="stat-value" id="kpi-total">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Published to Mobile</div>
                <div class="stat-value" style="color:#10B981" id="kpi-published">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Open IPOs</div>
                <div class="stat-value" style="color:#4F46E5" id="kpi-open">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-title">Drafts</div>
                <div class="stat-value" style="color:#F59E0B" id="kpi-drafts">-</div>
              </div>
            </div>

            <!-- Group Section 1: In Progress -->
            <div class="group-section">
              <div class="group-banner">
                <span class="status-pill in-progress">
                  <i data-feather="pie-chart" style="width:12px;height:12px;"></i>
                  <span>In Progress</span>
                </span>
                <span class="group-count-badge" id="in-progress-count">3</span>
              </div>
              <div class="grid-table">
                <div class="grid-header">
                  <div>Task / IPO Name</div>
                  <div>Description</div>
                  <div>Assignee</div>
                  <div>Due Date</div>
                  <div>Priority</div>
                  <div>Progress</div>
                  <div>Created</div>
                </div>
                <div class="grid-row">
                  <div class="col-task">
                    <span class="tree-toggle"><i data-feather="chevron-down"></i></span>
                    <input type="checkbox" class="task-checkbox" />
                    <span class="task-title">Wireframing</span>
                    <span class="task-comment-count"><i data-feather="message-square"></i> 3</span>
                  </div>
                  <div class="col-desc">-</div>
                  <div class="avatar-group">
                    <div class="avatar-circle" style="background-color:#818CF8">GT</div>
                    <div class="avatar-circle" style="background-color:#F43F5E">HG</div>
                    <div class="avatar-circle" style="background-color:#06B6D4">TB</div>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted)">February 12, 2024</div>
                  <div><span class="priority-badge urgent"><i data-feather="flag"></i> Urgent</span></div>
                  <div class="progress-cell">
                    <div class="progress-bar-track"><div class="progress-bar-fill" style="width: 85%;"></div></div>
                    <span class="progress-text">85%</span>
                  </div>
                  <div><span class="created-tag">X</span></div>
                </div>
                <div class="grid-row">
                  <div class="col-task" style="padding-left:16px;">
                    <span class="tree-toggle" style="opacity:0;"><i data-feather="chevron-down"></i></span>
                    <input type="checkbox" class="task-checkbox" checked />
                    <span class="task-title text-checked">Dashboard</span>
                  </div>
                  <div class="col-desc">Create wireframe for Dashboard page</div>
                  <div class="avatar-group">
                    <div class="avatar-circle" style="background-color:#EF4444">AN</div>
                    <div class="avatar-circle" style="background-color:#F59E0B">HG</div>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted)">February 12, 2024</div>
                  <div><span class="priority-badge urgent"><i data-feather="flag"></i> Urgent</span></div>
                  <div class="progress-cell">
                    <div class="progress-bar-track"><div class="progress-bar-fill" style="width: 95%;"></div></div>
                    <span class="progress-text">95%</span>
                  </div>
                  <div><span class="created-tag">X</span></div>
                </div>
                <div class="grid-row">
                  <div class="col-task" style="padding-left:16px;">
                    <span class="tree-toggle" style="opacity:0;"><i data-feather="chevron-down"></i></span>
                    <input type="checkbox" class="task-checkbox" checked />
                    <span class="task-title text-checked">Analytics</span>
                  </div>
                  <div class="col-desc">Create wireframe for analytics page</div>
                  <div class="avatar-group">
                    <div class="avatar-circle" style="background-color:#6366F1">GT</div>
                    <div class="avatar-circle" style="background-color:#EC4899">HG</div>
                    <div class="avatar-circle" style="background-color:#14B8A6">TB</div>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted)">February 12, 2024</div>
                  <div><span class="priority-badge urgent"><i data-feather="flag"></i> Urgent</span></div>
                  <div class="progress-cell">
                    <div class="progress-bar-track"><div class="progress-bar-fill" style="width: 100%;"></div></div>
                    <span class="progress-text">100%</span>
                  </div>
                  <div><span class="created-tag">X</span></div>
                </div>
              </div>
            </div>

            <!-- Group Section 2: Ready to check -->
            <div class="group-section">
              <div class="group-banner">
                <span class="status-pill ready">
                  <i data-feather="check-circle" style="width:12px;height:12px;"></i>
                  <span>Ready to check by PM</span>
                </span>
                <span class="group-count-badge">2</span>
              </div>
              <div class="grid-table">
                <div class="grid-header">
                  <div>Task / IPO Name</div>
                  <div>Description</div>
                  <div>Assignee</div>
                  <div>Due Date</div>
                  <div>Priority</div>
                  <div>Progress</div>
                  <div>Created</div>
                </div>
                <div class="grid-row">
                  <div class="col-task">
                    <span class="tree-toggle"><i data-feather="chevron-down"></i></span>
                    <input type="checkbox" class="task-checkbox" checked />
                    <span class="task-title text-checked">Hi-Fi Design</span>
                    <span class="task-comment-count"><i data-feather="message-square"></i> 3</span>
                  </div>
                  <div class="col-desc">Create hi-fi design 3 main screen</div>
                  <div class="avatar-group">
                    <div class="avatar-circle" style="background-color:#94A3B8">NZ</div>
                    <div class="avatar-circle" style="background-color:#818CF8">RW</div>
                    <div class="avatar-circle" style="background-color:#38BDF8">FG</div>
                    <div class="avatar-circle" style="background-color:#C084FC">RO</div>
                  </div>
                  <div style="font-size:12px; color:var(--text-muted)">February 14, 2024</div>
                  <div><span class="priority-badge low"><i data-feather="flag"></i> Low</span></div>
                  <div class="progress-cell">
                    <div class="progress-bar-track"><div class="progress-bar-fill" style="width: 100%;"></div></div>
                    <span class="progress-text">100%</span>
                  </div>
                  <div><span class="created-tag">X</span></div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. MANUAL IPOs TAB -->
          <div id="tab-manual" class="section-view">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; gap:10px;">
                <button class="btn-primary" onclick="openCreateModal()">+ Add Manual IPO</button>
                <button class="btn-secondary" onclick="triggerJsonImport()">📥 Import JSON</button>
                <input type="file" id="json-file-input" accept=".json,application/json" onchange="handleJsonFileSelect(event)" style="display:none;" />
              </div>
              <div style="display:flex; gap:10px;">
                <input type="text" id="man-search-q" placeholder="Search company or symbol..." oninput="debounceFetchManualIpos()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;" />
                <select id="man-filter-pub" onchange="fetchManualIpos()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;">
                  <option value="">All Publication States</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="DRAFT">Draft</option>
                  <option value="ARCHIVED">Archived</option>
                </select>
                <select id="man-filter-status" onchange="fetchManualIpos()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;">
                  <option value="">All Lifecycle Statuses</option>
                  <option value="OPEN">Open</option>
                  <option value="UPCOMING">Upcoming</option>
                  <option value="CLOSED">Closed</option>
                  <option value="ALLOTMENT_COMPLETED">Allotment Completed</option>
                </select>
              </div>
            </div>

            <div class="grid-table" style="margin-top:12px;">
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr style="background:var(--bg-hover); font-size:11px; text-transform:uppercase; color:var(--text-muted); text-align:left;">
                    <th style="padding:12px 16px;">Symbol / Company</th>
                    <th style="padding:12px 16px;">Segment</th>
                    <th style="padding:12px 16px;">Lifecycle Status</th>
                    <th style="padding:12px 16px;">Publication Status</th>
                    <th style="padding:12px 16px;">Price Band</th>
                    <th style="padding:12px 16px;">Open / Close Dates</th>
                    <th style="padding:12px 16px;">Actions</th>
                  </tr>
                </thead>
                <tbody id="manual-ipos-table-body">
                  <tr><td colspan="7" style="text-align:center; padding: 24px;">Loading Manual IPOs...</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 3. MANUAL IPO EDIT TAB (FORM CONTAINER) -->
          <div id="tab-manual-edit" class="section-view">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <button class="btn-secondary" onclick="switchTab('manual')">← Back to Manual IPOs</button>
              <div style="display:flex; gap:10px;">
                <button class="btn-success" id="btn-publish-action" onclick="publishCurrentIpo()">🚀 PUBLISH TO MOBILE</button>
                <button class="btn-warning" id="btn-unpublish-action" onclick="unpublishCurrentIpo()">⏸️ Unpublish</button>
                <button class="btn-secondary" id="btn-archive-action" onclick="archiveCurrentIpo()">📦 Archive IPO</button>
                <button class="btn-secondary" id="btn-unarchive-action" onclick="unarchiveCurrentIpo()" style="display:none;">↩️ Unarchive IPO</button>
                <button class="btn-danger" id="btn-delete-action" onclick="deleteCurrentIpo()">🗑️ PERMANENTLY DELETE</button>
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
                    <select id="form-status">
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
                      <option value="DRAFT">DRAFT (Hidden from Mobile)</option>
                      <option value="PUBLISHED">PUBLISHED (Live on Mobile)</option>
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

                <!-- Financial History -->
                <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px; display:flex; justify-content:space-between; align-items:center;">
                  <strong style="color:var(--primary); font-size:14px;">Financial History</strong>
                  <button type="button" class="btn-secondary" onclick="addFinancialRow()" style="padding:4px 10px; font-size:12px;">+ Add Period</button>
                </div>

                <div id="financial-rows-container"></div>

                <!-- Manual GMP & Subscriptions -->
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

                <div class="form-grid">
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

                <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:16px;">
                  <button type="button" class="btn-secondary" onclick="switchTab('manual')">Cancel</button>
                  <button type="submit" class="btn-primary">💾 Save Canonical IPO</button>
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
            <div class="grid-table" style="padding:16px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <span style="font-weight:600;">Canonical IPO Explorer</span>
                <input type="text" id="exp-search-q" placeholder="Search symbol or name..." oninput="debounceFetchExplorerIpos()" style="padding:6px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main);" />
              </div>
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr style="background:var(--bg-hover); font-size:11px; text-transform:uppercase; color:var(--text-muted); text-align:left;">
                    <th style="padding:10px 16px;">Company / Symbol</th>
                    <th style="padding:10px 16px;">Segment</th>
                    <th style="padding:10px 16px;">Status</th>
                    <th style="padding:10px 16px;">Price Band</th>
                    <th style="padding:10px 16px;">Actions</th>
                  </tr>
                </thead>
                <tbody id="explorer-ipos-table-body">
                  <tr><td colspan="5" style="text-align:center; padding:16px;">Loading IPO Explorer...</td></tr>
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
            <div class="grid-table" style="padding:16px;">
              <div style="font-weight:600; margin-bottom:12px;">Upstream Data Sources</div>
              <table style="width:100%; border-collapse:collapse;">
                <thead>
                  <tr style="background:var(--bg-hover); font-size:11px; text-transform:uppercase; color:var(--text-muted); text-align:left;">
                    <th style="padding:10px 16px;">Source Name</th>
                    <th style="padding:10px 16px;">Type</th>
                    <th style="padding:10px 16px;">Records</th>
                    <th style="padding:10px 16px;">Health</th>
                  </tr>
                </thead>
                <tbody id="sources-table-body">
                  <tr><td colspan="4" style="text-align:center; padding:16px;">Loading source health...</td></tr>
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
  </div>

  <script>
    const API_BASE = '${baseUrl}';
    let currentTab = 'dashboard';
    let currentIpoData = null;

    document.addEventListener('DOMContentLoaded', () => {
      if (window.feather) feather.replace();
    });

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

      document.querySelectorAll('.group-items .nav-item').forEach(el => el.classList.remove('active'));
      const activeNavBtn = document.getElementById('nav-btn-' + tabId);
      if (activeNavBtn) activeNavBtn.classList.add('active');

      const titleMap = {
        'dashboard': 'Adrian Bert - CRM Dashboard',
        'manual': 'Manual IPO Manager',
        'explorer': 'IPO Explorer',
        'quality': 'Data Quality Overview',
        'sources': 'Upstream Source Health',
        'notifications': 'Notification Delivery Ops',
        'allotment': 'Allotment Check Ops'
      };
      const breadcrumbEl = document.getElementById('active-breadcrumb-title');
      if (breadcrumbEl) breadcrumbEl.textContent = titleMap[tabId] || 'Console Dashboard';

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
      } catch (err) {
        console.error('Dashboard load error:', err);
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
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color:var(--text-muted);">No Manual IPOs found. Click "+ Add Manual IPO" to create one.</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(item => \`
          <tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:12px 16px;"><strong>\${item.legalName || 'N/A'}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${item.symbol || 'No Symbol'}</span></td>
            <td style="padding:12px 16px;">\${item.marketSegment || 'MAINBOARD'}</td>
            <td style="padding:12px 16px;"><span class="priority-badge normal">\${item.status || 'DRAFT'}</span></td>
            <td style="padding:12px 16px;"><span class="status-pill \${item.publicationStatus === 'PUBLISHED' ? 'in-progress' : 'ready'}">\${item.publicationStatus || 'DRAFT'}</span></td>
            <td style="padding:12px 16px;">₹\${item.priceBandLow || 0} - ₹\${item.priceBandHigh || 0}</td>
            <td style="padding:12px 16px; font-size:12px;">\${item.openDate || 'TBD'} to \${item.closeDate || 'TBD'}</td>
            <td style="padding:12px 16px;">
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
          <tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:10px 16px;"><strong>\${i.companyName || i.legalName}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${i.symbol || ''}</span></td>
            <td style="padding:10px 16px;">\${i.marketSegment || 'MAINBOARD'}</td>
            <td style="padding:10px 16px;"><span class="priority-badge low">\${i.status}</span></td>
            <td style="padding:10px 16px;">₹\${i.priceBandLow || 0} - ₹\${i.priceBandHigh || 0}</td>
            <td style="padding:10px 16px;"><button class="btn-secondary" style="padding:4px 8px; font-size:11px;">View Detail</button></td>
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

    function openCreateModal() {
      currentIpoData = null;
      document.getElementById('manual-ipo-form').reset();
      document.getElementById('form-ipo-id').value = '';
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
        issueSize: parseFloat(document.getElementById('form-issueSize').value) || undefined,
        openDate: document.getElementById('form-openDate').value || undefined,
        closeDate: document.getElementById('form-closeDate').value || undefined,
        allotmentDate: document.getElementById('form-allotmentDate').value || undefined,
        listingDate: document.getElementById('form-listingDate').value || undefined,
        logoUrl: document.getElementById('form-logoUrl').value || undefined,
      };

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
          <tr style="border-bottom:1px solid var(--border-subtle);">
            <td style="padding:10px 16px;"><strong>\${s.name}</strong> (\${s.code})</td>
            <td style="padding:10px 16px;">\${s.sourceType}</td>
            <td style="padding:10px 16px;" class="mono">\${s.totalRecords}</td>
            <td style="padding:10px 16px;"><span class="status-pill in-progress">\${s.healthState}</span></td>
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

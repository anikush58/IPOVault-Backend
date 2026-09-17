export function renderConsoleHtml(baseUrl = '/api/v1/console/api'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AutomatePro — IPOVault Backend Console</title>
  
  <!-- Google Fonts: Inter & Outfit -->
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
      max-width: 1380px;
      background-color: var(--bg-window);
      border-radius: 16px;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-window);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 92vh;
      max-height: 940px;
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
    .section-view { display: none; }
    .section-view.active { display: flex; flex-direction: column; gap: 20px; }
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
              <input type="text" id="global-search-input" placeholder="Search task..." oninput="handleGlobalSearch(event)" />
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

          <!-- DASHBOARD TAB -->
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

          <!-- MANUAL IPOs TAB -->
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

          <!-- MANUAL IPO EDIT TAB -->
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
              <div class="stat-title" style="margin-bottom:16px; font-size:14px;">Canonical IPO Information</div>
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
                    <input type="text" id="form-cin" autocomplete="off" />
                  </div>
                  <div class="form-group">
                    <label>Trading Symbol</label>
                    <input type="text" id="form-symbol" autocomplete="off" />
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
                    </select>
                  </div>
                  <div class="form-group">
                    <label>Publication Status</label>
                    <select id="form-publicationStatus">
                      <option value="DRAFT">DRAFT (Hidden)</option>
                      <option value="PUBLISHED">PUBLISHED (Live)</option>
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

                <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:16px;">
                  <button type="button" class="btn-secondary" onclick="switchTab('manual')">Cancel</button>
                  <button type="submit" class="btn-primary">💾 Save Canonical IPO</button>
                </div>
              </form>
            </div>
          </div>

          <!-- IPO EXPLORER TAB -->
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

          <!-- DATA QUALITY TAB -->
          <div id="tab-quality" class="section-view">
            <div class="stat-card">
              <div class="stat-title">Overall Data Quality Gate</div>
              <div class="stat-value" id="qual-overall-status">COMPLETE</div>
            </div>
            <div class="stats-grid" id="qual-breakdown-grid"></div>
          </div>

          <!-- SOURCE HEALTH TAB -->
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

          <!-- NOTIFICATIONS OPS TAB -->
          <div id="tab-notifications" class="section-view">
            <div class="stats-grid">
              <div class="stat-card"><div class="stat-title">Total Deliveries</div><div class="stat-value" id="notif-total">-</div></div>
              <div class="stat-card"><div class="stat-title">Delivered</div><div class="stat-value" style="color:#10B981" id="notif-delivered">-</div></div>
              <div class="stat-card"><div class="stat-title">Failed</div><div class="stat-value" style="color:#EF4444" id="notif-failed">-</div></div>
              <div class="stat-card"><div class="stat-title">Success Rate</div><div class="stat-value" style="color:#4F46E5" id="notif-rate">-</div></div>
            </div>
          </div>

          <!-- ALLOTMENT OPS TAB -->
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


            <div class="form-grid">
              <div class="form-group">
                <label>Anchor Portion (₹ Cr)</label>
                <input type="number" step="0.01" id="form-anchorPortion" placeholder="e.g. 150.00" />
              </div>
              <div class="form-group">
                <label>Anchor Bid Date</label>
                <input type="date" id="form-anchorBidDate" />
              </div>
              <div class="form-group">
                <label>Anchor Price (₹)</label>
                <input type="number" step="0.01" id="form-anchorPrice" placeholder="e.g. 43.00" />
              </div>
              <div class="form-group">
                <label>% of QIBs</label>
                <input type="number" step="0.01" id="form-anchorQibPct" placeholder="e.g. 60.00" />
              </div>
              <div class="form-group">
                <label>Shares Locked (30 Days)</label>
                <input type="text" id="form-anchorLockIn30" placeholder="e.g. 43,77,907" />
              </div>
              <div class="form-group">
                <label>Shares Locked (90 Days)</label>
                <input type="text" id="form-anchorLockIn90" placeholder="e.g. 43,77,907" />
              </div>
              <div class="form-group">
                <label>General Lock-in Summary</label>
                <input type="text" id="form-anchorLockIn" placeholder="e.g. 30 Days (50%), 90 Days (50%)" />
              </div>
            </div>

            <div style="margin-top:12px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <label style="font-weight:600; color:var(--text); font-size:13px;">Anchor Investors Allocation List</label>
                <button type="button" class="btn btn-secondary" style="font-size:12px; padding:4px 10px;" onclick="addAnchorRow()">+ Add Investor Row</button>
              </div>

              <div style="overflow-x:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:left;" id="anchor-investors-table">
                  <thead>
                    <tr style="background:#131b2e; border-bottom:1px solid var(--card-border); color:var(--text-muted);">
                      <th style="padding:8px; width:35px; text-align:center;">#</th>
                      <th style="padding:8px;">Anchor Investor Name</th>
                      <th style="padding:8px; width:130px;">Shares Allotted</th>
                      <th style="padding:8px; width:110px;">Amt (₹ Cr)</th>
                      <th style="padding:8px; width:110px;">% Allocated</th>
                      <th style="padding:8px; width:110px;">% of Issue</th>
                      <th style="padding:8px; width:40px; text-align:center;"></th>
                    </tr>
                  </thead>
                  <tbody id="anchor-investors-tbody">
                    <!-- Dynamic Rows -->
                  </tbody>
                  <tfoot>
                    <tr style="background:#0f172a; font-weight:600; border-top:2px solid var(--card-border); color:var(--text);">
                      <td style="padding:8px; text-align:center;">Total</td>
                      <td style="padding:8px;">-</td>
                      <td style="padding:8px;" id="total-anchor-shares">0</td>
                      <td style="padding:8px;" id="total-anchor-amt">₹0.00</td>
                      <td style="padding:8px;" id="total-anchor-pct-alloc">0%</td>
                      <td style="padding:8px;" id="total-anchor-pct-issue">0%</td>
                      <td style="padding:8px;"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div class="form-group" style="margin-top:12px;">
              <label>Additional Notes / Breakdown Text</label>
              <textarea id="form-anchorDetails" rows="2" placeholder="Optional notes or text breakdown..." style="background:#0b0f19; border:1px solid var(--card-border); border-radius:8px; padding:8px 12px; color:var(--text); font-family:inherit; font-size:13px;"></textarea>
            </div>

            <div style="border-top:1px solid var(--card-border); margin:12px 0; padding-top:12px;">
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

            <div style="border-top:1px solid var(--card-border); margin:12px 0; padding-top:12px;">
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

            <div style="border-top:1px solid var(--card-border); margin:12px 0; padding-top:12px; display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:var(--primary); font-size:14px;">Financial History</strong>
              <button type="button" class="btn btn-secondary" onclick="addFinancialRow()" style="padding:4px 10px; font-size:12px;">+ Add Period</button>
            </div>

            <div id="financial-rows-container"></div>
            <input type="hidden" id="fin-period" />
            <input type="hidden" id="fin-assets" />
            <input type="hidden" id="fin-revenue" />
            <input type="hidden" id="fin-pat" />
            <input type="hidden" id="fin-ebitda" />
            <input type="hidden" id="fin-networth" />
            <input type="hidden" id="fin-eps" />

            <div style="border-top:1px solid var(--card-border); margin:12px 0; padding-top:12px;">
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

            <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:8px;">
              <button type="submit" class="btn">Save Changes</button>
            </div>
          </form>
        </div>

        <!-- Allotment Configuration Form -->
        <div class="card">
          <div class="card-title">Allotment Checker Mapping Configuration</div>
          <div class="form-grid" style="margin-top:12px;">
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
            <button class="btn btn-secondary" onclick="saveAllotmentConfig()">Save Allotment Config</button>
          </div>
        </div>
      </div>

      <!-- EXPLORER TAB -->
      <div id="tab-explorer" class="section-view">
        <div class="table-container">
          <div class="table-header">
            <div class="table-title">Canonical IPO Records Explorer</div>
            <div class="search-box">
              <input type="text" id="search-q" placeholder="Search symbol or company..." oninput="debounceFetchIpos()" />
              <select id="filter-segment" onchange="fetchIpos()">
                <option value="">All Segments</option>
                <option value="MAINBOARD">Mainboard</option>
                <option value="SME">SME</option>
              </select>
              <select id="filter-status" onchange="fetchIpos()">
                <option value="">All Statuses</option>
                <option value="OPEN">Open</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="CLOSED">Closed</option>
                <option value="LISTED">Listed</option>
              </select>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Symbol / Company</th>
                <th>Segment</th>
                <th>Status</th>
                <th>Price Band</th>
                <th>Issue Size</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody id="ipos-table-body">
              <tr><td colspan="6" style="text-align:center; padding: 24px;">Loading canonical IPOs...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- DETAIL MODAL / VIEW -->
      <div id="tab-detail" class="section-view">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <button class="btn btn-secondary" onclick="switchTab('explorer')">← Back to Explorer</button>
          <div class="badge badge-upcoming" id="det-ipo-status">OPEN</div>
        </div>
        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-size:22px; font-weight:700;" id="det-company-name">-</div>
              <div style="color:var(--muted); font-size:13px;" id="det-symbol-exchange">-</div>
            </div>
            <div class="mono" style="font-size:12px; color:var(--muted);" id="det-ipo-id">ID: -</div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div class="card">
            <div class="card-title">Issue Structure</div>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
              <div>Price Band: <strong id="det-price-band">-</strong></div>
              <div>Total Issue Size: <strong id="det-issue-size">-</strong></div>
              <div>Lot Size: <strong id="det-lot-size">-</strong></div>
            </div>
          </div>
          <div class="card">
            <div class="card-title">Data Quality Gate</div>
            <div style="font-size:18px; font-weight:700; margin-top:8px;" id="det-quality-status">-</div>
            <div class="card-sub" id="det-quality-score">-</div>
          </div>
        </div>

        <!-- Lineage / Field Provenance -->
        <div class="table-container">
          <div class="table-header"><div class="table-title">Field Provenance & Lineage</div></div>
          <table>
            <thead>
              <tr><th>Field</th><th>Value</th><th>Source</th><th>Observed At</th></tr>
            </thead>
            <tbody id="lineage-table-body">
              <tr><td colspan="4" style="text-align:center; padding: 16px;">Loading field provenance...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- DATA QUALITY TAB -->
      <div id="tab-quality" class="section-view">
        <div class="card">
          <div class="card-title">Data Quality Telemetry Summary</div>
          <div style="font-size:24px; font-weight:700; margin-top:8px;" id="qual-overall-status">Evaluating...</div>
          <div class="card-sub">Evaluated against completeness, freshness, and source health gates</div>
        </div>
        <div class="stats-grid" id="qual-breakdown-grid"></div>
      </div>

      <!-- SOURCE HEALTH TAB -->
      <div id="tab-sources" class="section-view">
        <div class="table-container">
          <div class="table-header"><div class="table-title">Source Health & Discovery Adapters</div></div>
          <table>
            <thead>
              <tr><th>Source</th><th>Type</th><th>Records</th><th>Status</th></tr>
            </thead>
            <tbody id="sources-table-body">
              <tr><td colspan="4" style="text-align:center; padding:16px;">Loading source health...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- NOTIFICATION OPS TAB -->
      <div id="tab-notifications" class="section-view">
        <div class="stats-grid" id="notif-stats-grid">
          <div class="card"><div class="card-title">Total Deliveries</div><div class="card-value" id="notif-total">-</div></div>
          <div class="card"><div class="card-title">Delivered</div><div class="card-value" style="color:var(--success)" id="notif-delivered">-</div></div>
          <div class="card"><div class="card-title">Failed</div><div class="card-value" style="color:var(--danger)" id="notif-failed">-</div></div>
          <div class="card"><div class="card-title">Success Rate</div><div class="card-value" style="color:var(--primary)" id="notif-rate">-</div></div>
        </div>
      </div>

      <!-- ALLOTMENT OPS TAB -->
      <div id="tab-allotment" class="section-view">
        <div class="stats-grid" id="allot-stats-grid">
          <div class="card"><div class="card-title">Total Check Jobs</div><div class="card-value" id="allot-jobs">-</div></div>
          <div class="card"><div class="card-title">Completed Jobs</div><div class="card-value" style="color:var(--success)" id="allot-completed">-</div></div>
          <div class="card"><div class="card-title">Total Observations</div><div class="card-value" id="allot-observations">-</div></div>
          <div class="card"><div class="card-title">Positive Allotments</div><div class="card-value" style="color:var(--primary)" id="allot-positive">-</div></div>
        </div>
      </div>

    </div>
  </div>

  <script>
    const API_BASE = '${baseUrl}';
    let searchTimeout = null;
    let manualSearchTimeout = null;
    let lastExtractionReview = null;

    function formatCrores(val) {
      if (val === null || val === undefined || val === '') return '';
      const num = Number(val);
      if (isNaN(num)) return '';
      const inCrores = num >= 100000 ? num / 10000000 : num;
      return Number.isInteger(inCrores) ? inCrores.toString() : inCrores.toFixed(2);
    }

    function renderFinancialRows(list) {
      const container = document.getElementById('financial-rows-container');
      if (!container) return;
      const items = (Array.isArray(list) && list.length > 0) ? list : [{}];
      container.innerHTML = items.map((fin, idx) => \`
        <div class="fin-row" style="background:rgba(255,255,255,0.02); border:1px solid var(--card-border); border-radius:8px; padding:12px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <span style="font-size:12px; font-weight:600; color:var(--text-muted);">Financial Period #\${idx + 1}</span>
            \${items.length > 1 ? \`<button type="button" onclick="removeFinancialRow(\${idx})" style="background:transparent; border:none; color:#ef4444; cursor:pointer; font-size:12px;">✕ Remove</button>\` : ''}
          </div>
          <div class="form-grid">
            <div class="form-group">
              <label>Fiscal Period</label>
              <input type="text" class="fin-period-input" value="\${fin.fiscalPeriod || ''}" placeholder="e.g. FY24" />
            </div>
            <div class="form-group">
              <label>Total Assets (₹ Cr)</label>
              <input type="number" step="0.01" class="fin-assets-input" value="\${fin.totalAssets ?? ''}" />
            </div>
            <div class="form-group">
              <label>Total Revenue (₹ Cr)</label>
              <input type="number" step="0.01" class="fin-revenue-input" value="\${fin.totalRevenue ?? ''}" />
            </div>
            <div class="form-group">
              <label>PAT (₹ Cr)</label>
              <input type="number" step="0.01" class="fin-pat-input" value="\${fin.pat ?? ''}" />
            </div>
          </div>
          <div class="form-grid" style="margin-top:8px;">
            <div class="form-group">
              <label>EBITDA (₹ Cr)</label>
              <input type="number" step="0.01" class="fin-ebitda-input" value="\${fin.ebitda ?? ''}" />
            </div>
            <div class="form-group">
              <label>Net Worth (₹ Cr)</label>
              <input type="number" step="0.01" class="fin-networth-input" value="\${fin.netWorth ?? ''}" />
            </div>
            <div class="form-group">
              <label>EPS (₹)</label>
              <input type="number" step="0.01" class="fin-eps-input" value="\${fin.eps ?? ''}" />
            </div>
          </div>
        </div>
      \`).join('');
    }

    function addFinancialRow() {
      const current = getFinancialsFromForm();
      current.push({});
      renderFinancialRows(current);
    }

    function removeFinancialRow(idx) {
      const current = getFinancialsFromForm();
      current.splice(idx, 1);
      renderFinancialRows(current.length > 0 ? current : [{}]);
    }

    function getFinancialsFromForm() {
      const rows = document.querySelectorAll('.fin-row');
      const financials = [];
      rows.forEach(row => {
        const period = row.querySelector('.fin-period-input')?.value?.trim();
        const assets = parseFloat(row.querySelector('.fin-assets-input')?.value);
        const revenue = parseFloat(row.querySelector('.fin-revenue-input')?.value);
        const pat = parseFloat(row.querySelector('.fin-pat-input')?.value);
        const ebitda = parseFloat(row.querySelector('.fin-ebitda-input')?.value);
        const networth = parseFloat(row.querySelector('.fin-networth-input')?.value);
        const eps = parseFloat(row.querySelector('.fin-eps-input')?.value);
        if (period || !isNaN(assets) || !isNaN(revenue) || !isNaN(pat) || !isNaN(ebitda) || !isNaN(networth) || !isNaN(eps)) {
          financials.push({
            fiscalPeriod: period || '',
            totalAssets: !isNaN(assets) ? assets : undefined,
            totalRevenue: !isNaN(revenue) ? revenue : undefined,
            pat: !isNaN(pat) ? pat : undefined,
            ebitda: !isNaN(ebitda) ? ebitda : undefined,
            netWorth: !isNaN(networth) ? networth : undefined,
            eps: !isNaN(eps) ? eps : undefined,
          });
        }
      });
      return financials;
    }

    function switchTab(tabId) {
      document.querySelectorAll('.nav-item button').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.section-view').forEach(sec => sec.classList.remove('active'));

      const targetBtn = Array.from(document.querySelectorAll('.nav-item button')).find(b => b.textContent.toLowerCase().includes(tabId));
      if (targetBtn) targetBtn.classList.add('active');

      const targetSec = document.getElementById('tab-' + tabId);
      if (targetSec) targetSec.classList.add('active');

      document.getElementById('page-title').textContent = tabId.toUpperCase() + ' — Backend Data Console';

      if (tabId === 'dashboard') loadDashboard();
      if (tabId === 'manual') fetchManualIpos();
      if (tabId === 'explorer') fetchIpos();
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

        document.getElementById('kpi-total').textContent = data.ipoCounts?.total ?? 0;
        document.getElementById('kpi-published').textContent = data.publicationBreakdown?.published ?? 0;
        document.getElementById('kpi-open').textContent = data.ipoCounts?.open ?? 0;
        document.getElementById('kpi-drafts').textContent = data.publicationBreakdown?.draft ?? 0;
        document.getElementById('dash-quality-status').textContent = 'Evaluated (' + (data.dataQuality?.complete ?? 0) + ' Complete)';
      } catch (err) {
        console.error('Dashboard load error:', err);
      }
    }

    function debounceFetchManualIpos() {
      clearTimeout(manualSearchTimeout);
      manualSearchTimeout = setTimeout(fetchManualIpos, 300);
    }

    async function fetchManualIpos() {
      const q = document.getElementById('man-search-q').value;
      const pub = document.getElementById('man-filter-pub').value;
      const status = document.getElementById('man-filter-status').value;
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (pub) params.append('publicationStatus', pub);
      if (status) params.append('status', status);

      try {
        const res = await fetch(API_BASE + '/manual-ipos?' + params.toString());
        const json = await res.json();
        const data = json.data || json;
        const items = data.items || [];

        // Count stats
        let publishedCnt = 0, draftCnt = 0, archivedCnt = 0;
        items.forEach(i => {
          if (i.publicationStatus === 'PUBLISHED') publishedCnt++;
          else if (i.publicationStatus === 'DRAFT') draftCnt++;
          else if (i.publicationStatus === 'ARCHIVED') archivedCnt++;
        });

        document.getElementById('man-total').textContent = data.pagination?.total ?? items.length;
        document.getElementById('man-published').textContent = publishedCnt;
        document.getElementById('man-drafts').textContent = draftCnt;
        document.getElementById('man-archived').textContent = archivedCnt;

        const tbody = document.getElementById('manual-ipos-table-body');
        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px;">No Manual IPOs found</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(ipo => {
          const pubClass = (ipo.publicationStatus || 'DRAFT').toLowerCase();
          const pubBtnHtml = ipo.publicationStatus !== 'PUBLISHED'
            ? '<button class="btn btn-success" onclick="publishManualIpoDirect(\\\'' + ipo.id + '\\\')">Publish</button>'
            : '<button class="btn btn-warning" onclick="unpublishManualIpoDirect(\\\'' + ipo.id + '\\\')">Unpublish</button>';
          const arcBtnHtml = ipo.publicationStatus === 'ARCHIVED'
            ? '<button class="btn btn-secondary" onclick="unarchiveManualIpoDirect(\\\'' + ipo.id + '\\\')" title="Revert to DRAFT status">↩️ Unarchive</button>'
            : '<button class="btn btn-secondary" onclick="archiveManualIpoDirect(\\\'' + ipo.id + '\\\')" title="Set status to ARCHIVED">📦 Archive</button>';
          const safeName = (ipo.legalName || ipo.displayName || ipo.symbol || '').replace(/'/g, "\\\\'");
          const delBtnHtml = '<button class="btn btn-danger" onclick="deleteManualIpoDirect(\\\'' + ipo.id + '\\\', \\\'' + safeName + '\\\')" title="PERMANENTLY delete from database">🗑️ Delete</button>';

          return \`
            <tr>
              <td>
                <strong>\${ipo.legalName || ipo.displayName || ipo.symbol}</strong>
                <div style="font-size:11px; color:var(--muted)">\${ipo.symbol || 'N/A'}</div>
              </td>
              <td><span class="badge">\${ipo.marketSegment} / \${ipo.exchange}</span></td>
              <td><span class="badge badge-\${(ipo.status||'').toLowerCase()}">\${ipo.status}</span></td>
              <td><span class="badge badge-\${pubClass}">\${ipo.publicationStatus}</span></td>
              <td>\${ipo.priceBandLow ? '₹' + ipo.priceBandLow + ' - ₹' + ipo.priceBandHigh : 'N/A'}</td>
              <td>\${ipo.openDate || 'Pending'} to \${ipo.closeDate || 'Pending'}</td>
              <td>
                <div style="display:flex; gap:6px;">
                  <button class="btn btn-secondary" onclick="editManualIpo('\${ipo.id}')">Inspect/Edit</button>
                  \${pubBtnHtml}
                  \${arcBtnHtml}
                  \${delBtnHtml}
                </div>
              </td>
            </tr>
          \`;
        }).join('');
      } catch (err) {
        console.error('Error fetching manual IPOs:', err);
      }
    }

    function addAnchorRow(data) {
      data = data || {};
      const tbody = document.getElementById('anchor-investors-tbody');
      if (!tbody) return;
      const rowCount = tbody.children.length + 1;
      const tr = document.createElement('tr');
      tr.className = 'anchor-row';
      tr.style.borderBottom = '1px solid var(--card-border)';
      const safeName = (data.anchorName || '').replace(/"/g, '&quot;');
      const sharesVal = data.sharesAllotted != null ? data.sharesAllotted : '';
      const amtVal = data.amtCr != null ? data.amtCr : '';
      const allocVal = data.pctAllocated != null ? data.pctAllocated : '';
      const issueVal = data.pctOfIssue != null ? data.pctOfIssue : '';

      tr.innerHTML =
        '<td style="padding:6px; text-align:center; color:var(--text-muted);" class="row-num">' + rowCount + '</td>' +
        '<td style="padding:6px;"><input type="text" class="anchor-name" value="' + safeName + '" placeholder="e.g. BHARAT VALUE FUND" style="width:100%; background:#0b0f19; border:1px solid var(--card-border); border-radius:4px; padding:4px 8px; color:var(--text); font-size:12px;" /></td>' +
        '<td style="padding:6px;"><input type="number" class="anchor-shares" value="' + sharesVal + '" placeholder="e.g. 4104199" oninput="calculateAnchorTotals()" style="width:100%; background:#0b0f19; border:1px solid var(--card-border); border-radius:4px; padding:4px 8px; color:var(--text); font-size:12px;" /></td>' +
        '<td style="padding:6px;"><input type="number" step="0.01" class="anchor-amt" value="' + amtVal + '" placeholder="e.g. 17.65" oninput="calculateAnchorTotals()" style="width:100%; background:#0b0f19; border:1px solid var(--card-border); border-radius:4px; padding:4px 8px; color:var(--text); font-size:12px;" /></td>' +
        '<td style="padding:6px;"><input type="number" step="0.01" class="anchor-pct-alloc" value="' + allocVal + '" placeholder="e.g. 46.87" oninput="calculateAnchorTotals()" style="width:100%; background:#0b0f19; border:1px solid var(--card-border); border-radius:4px; padding:4px 8px; color:var(--text); font-size:12px;" /></td>' +
        '<td style="padding:6px;"><input type="number" step="0.01" class="anchor-pct-issue" value="' + issueVal + '" placeholder="e.g. 14.06" oninput="calculateAnchorTotals()" style="width:100%; background:#0b0f19; border:1px solid var(--card-border); border-radius:4px; padding:4px 8px; color:var(--text); font-size:12px;" /></td>' +
        '<td style="padding:6px; text-align:center;"><button type="button" onclick="removeAnchorRow(this)" style="background:#ef4444; color:#fff; border:none; padding:3px 8px; border-radius:4px; cursor:pointer; font-size:12px;">&times;</button></td>';

      tbody.appendChild(tr);
      calculateAnchorTotals();
    }

    function removeAnchorRow(btn) {
      const tr = btn.closest('tr');
      if (tr) {
        tr.remove();
        const rows = document.querySelectorAll('#anchor-investors-tbody tr');
        rows.forEach((row, idx) => {
          const numCell = row.querySelector('.row-num');
          if (numCell) numCell.textContent = idx + 1;
        });
        calculateAnchorTotals();
      }
    }

    function calculateAnchorTotals() {
      const rows = document.querySelectorAll('#anchor-investors-tbody tr');
      let totalShares = 0;
      let totalAmt = 0;
      let totalAlloc = 0;
      let totalIssue = 0;

      rows.forEach(row => {
        const shares = parseFloat(row.querySelector('.anchor-shares')?.value) || 0;
        const amt = parseFloat(row.querySelector('.anchor-amt')?.value) || 0;
        const alloc = parseFloat(row.querySelector('.anchor-pct-alloc')?.value) || 0;
        const issue = parseFloat(row.querySelector('.anchor-pct-issue')?.value) || 0;

        totalShares += shares;
        totalAmt += amt;
        totalAlloc += alloc;
        totalIssue += issue;
      });

      const sharesEl = document.getElementById('total-anchor-shares');
      const amtEl = document.getElementById('total-anchor-amt');
      const allocEl = document.getElementById('total-anchor-pct-alloc');
      const issueEl = document.getElementById('total-anchor-pct-issue');

      if (sharesEl) sharesEl.textContent = totalShares ? totalShares.toLocaleString('en-IN') : '0';
      if (amtEl) amtEl.textContent = totalAmt ? '₹' + totalAmt.toFixed(2) : '₹0.00';
      if (allocEl) allocEl.textContent = totalAlloc ? totalAlloc.toFixed(2) + '%' : '0%';
      if (issueEl) issueEl.textContent = totalIssue ? totalIssue.toFixed(2) + '%' : '0%';
    }

    function getAnchorInvestorsFromForm() {
      const rows = document.querySelectorAll('#anchor-investors-tbody tr');
      const list = [];
      rows.forEach(row => {
        const name = (row.querySelector('.anchor-name')?.value || '').trim();
        if (name) {
          list.push({
            anchorName: name,
            sharesAllotted: parseFloat(row.querySelector('.anchor-shares')?.value) || undefined,
            amtCr: parseFloat(row.querySelector('.anchor-amt')?.value) || undefined,
            pctAllocated: parseFloat(row.querySelector('.anchor-pct-alloc')?.value) || undefined,
            pctOfIssue: parseFloat(row.querySelector('.anchor-pct-issue')?.value) || undefined,
          });
        }
      });
      return list;
    }

    function updateLogoPreview() {
      const url = (document.getElementById('form-logoUrl')?.value || '').trim();
      const img = document.getElementById('form-logo-preview');
      if (img) {
        if (url) {
          img.src = url;
          img.style.display = 'inline-block';
        } else {
          img.style.display = 'none';
          img.src = '';
        }
      }
    }

    function openCreateModal() {
      document.getElementById('form-ipo-id').value = '';
      document.getElementById('form-legalName').value = '';
      document.getElementById('form-displayName').value = '';
      document.getElementById('form-cin').value = '';
      document.getElementById('form-symbol').value = '';
      document.getElementById('form-marketSegment').value = 'MAINBOARD';
      document.getElementById('form-exchange').value = 'NSE';
      document.getElementById('form-status').value = 'DRAFT';
      document.getElementById('form-publicationStatus').value = 'DRAFT';
      document.getElementById('form-priceBandLow').value = '';
      document.getElementById('form-priceBandHigh').value = '';
      document.getElementById('form-lotSize').value = '';
      document.getElementById('form-faceValue').value = '';
      document.getElementById('form-issueSize').value = '';
      document.getElementById('form-freshIssueSize').value = '';
      document.getElementById('form-ofsSize').value = '';
      document.getElementById('form-issueShareCount').value = '';
      document.getElementById('form-freshIssueShareCount').value = '';
      document.getElementById('form-ofsShareCount').value = '';
      document.getElementById('form-openDate').value = '';
      document.getElementById('form-closeDate').value = '';
      document.getElementById('form-allotmentDate').value = '';
      document.getElementById('form-listingDate').value = '';

      document.getElementById('form-logoUrl').value = '';
      document.getElementById('form-website').value = '';
      document.getElementById('form-industry').value = '';
      document.getElementById('form-sector').value = '';
      document.getElementById('form-phone').value = '';
      document.getElementById('form-email').value = '';
      document.getElementById('form-contactPerson').value = '';
      document.getElementById('form-aboutDescription').value = '';
      updateLogoPreview();

      document.getElementById('form-drhpUrl').value = '';
      document.getElementById('form-rhpUrl').value = '';
      document.getElementById('form-prospectusUrl').value = '';
      document.getElementById('form-anchorListUrl').value = '';
      document.getElementById('form-anchorPortion').value = '';
      document.getElementById('form-anchorBidDate').value = '';
      document.getElementById('form-anchorLockIn').value = '';
      document.getElementById('form-anchorDetails').value = '';
      document.getElementById('form-anchorPrice').value = '';
      document.getElementById('form-anchorQibPct').value = '';
      document.getElementById('form-anchorLockIn30').value = '';
      document.getElementById('form-anchorLockIn90').value = '';
      const anchorTbody = document.getElementById('anchor-investors-tbody');
      if (anchorTbody) anchorTbody.innerHTML = '';
      addAnchorRow();

      document.getElementById('cat-qib-pct').value = '';
      document.getElementById('cat-nii-pct').value = '';
      document.getElementById('cat-retail-pct').value = '';
      document.getElementById('cat-retail-min-lots').value = '';
      document.getElementById('cat-retail-max-lots').value = '';
      document.getElementById('cat-retail-min-shares').value = '';
      document.getElementById('cat-retail-max-shares').value = '';
      document.getElementById('cat-retail-min-amount').value = '';
      document.getElementById('cat-retail-max-amount').value = '';

      document.getElementById('part-reg-name').value = '';
      document.getElementById('part-reg-phone').value = '';
      document.getElementById('part-reg-email').value = '';
      document.getElementById('part-reg-website').value = '';
      document.getElementById('part-brlm-name').value = '';

      renderFinancialRows([]);

      document.getElementById('gmp-amount').value = '';
      document.getElementById('gmp-percentage').value = '';
      document.getElementById('gmp-est-profit').value = '';

      document.getElementById('sub-qib').value = '';
      document.getElementById('sub-nii').value = '';
      document.getElementById('sub-retail').value = '';
      document.getElementById('sub-total').value = '';

      document.getElementById('validation-banner').style.display = 'none';

      document.getElementById('allot-registrar-code').value = '';
      document.getElementById('allot-registrar-ipo-code').value = '';

      const fileInput = document.getElementById('doc-file-input');
      if (fileInput) fileInput.value = '';
      const urlInput = document.getElementById('doc-url-input');
      if (urlInput) urlInput.value = '';

      lastExtractionReview = null;
      const reviewContainer = document.getElementById('parser-review-container');
      if (reviewContainer) reviewContainer.style.display = 'none';
      const statusMsg = document.getElementById('upload-status-message');
      if (statusMsg) { statusMsg.style.display = 'none'; statusMsg.textContent = ''; }

      const btnPublish = document.getElementById('btn-publish-action');
      const btnUnpublish = document.getElementById('btn-unpublish-action');
      const btnArchive = document.getElementById('btn-archive-action');
      const btnUnarchive = document.getElementById('btn-unarchive-action');
      const btnDelete = document.getElementById('btn-delete-action');

      if (btnPublish) btnPublish.style.display = 'none';
      if (btnUnpublish) btnUnpublish.style.display = 'none';
      if (btnArchive) btnArchive.style.display = 'none';
      if (btnUnarchive) btnUnarchive.style.display = 'none';
      if (btnDelete) btnDelete.style.display = 'none';

      switchTab('manual-edit');
    }

    async function editManualIpo(id) {
      switchTab('manual-edit');

      // Reset document upload & extraction review state when opening IPO for edit
      const fileInput = document.getElementById('doc-file-input');
      if (fileInput) fileInput.value = '';
      const urlInput = document.getElementById('doc-url-input');
      if (urlInput) urlInput.value = '';
      lastExtractionReview = null;
      const reviewContainer = document.getElementById('parser-review-container');
      if (reviewContainer) reviewContainer.style.display = 'none';
      const statusMsg = document.getElementById('upload-status-message');
      if (statusMsg) { statusMsg.style.display = 'none'; statusMsg.textContent = ''; }

      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id);
        const json = await res.json();
        const ipo = json.data || json;

        const pubStatus = ipo.publicationStatus || 'DRAFT';
        const btnPublish = document.getElementById('btn-publish-action');
        const btnUnpublish = document.getElementById('btn-unpublish-action');
        const btnArchive = document.getElementById('btn-archive-action');
        const btnUnarchive = document.getElementById('btn-unarchive-action');
        const btnDelete = document.getElementById('btn-delete-action');

        if (btnPublish) btnPublish.style.display = pubStatus === 'PUBLISHED' ? 'none' : 'inline-block';
        if (btnUnpublish) btnUnpublish.style.display = pubStatus === 'PUBLISHED' ? 'inline-block' : 'none';
        if (btnArchive) btnArchive.style.display = pubStatus === 'ARCHIVED' ? 'none' : 'inline-block';
        if (btnUnarchive) btnUnarchive.style.display = pubStatus === 'ARCHIVED' ? 'inline-block' : 'none';
        if (btnDelete) btnDelete.style.display = 'inline-block';

        document.getElementById('form-ipo-id').value = ipo.id;
        document.getElementById('form-legalName').value = ipo.company?.legalName || '';
        document.getElementById('form-displayName').value = ipo.company?.displayName || '';
        document.getElementById('form-cin').value = ipo.company?.cin || '';
        document.getElementById('form-symbol').value = ipo.symbol || '';
        document.getElementById('form-marketSegment').value = ipo.marketSegment || 'MAINBOARD';
        document.getElementById('form-exchange').value = ipo.exchange || 'NSE';
        document.getElementById('form-status').value = ipo.status || 'DRAFT';
        document.getElementById('form-publicationStatus').value = ipo.publicationStatus || 'DRAFT';
        document.getElementById('form-priceBandLow').value = ipo.priceBandLow ?? '';
        document.getElementById('form-priceBandHigh').value = ipo.priceBandHigh ?? '';
        document.getElementById('form-lotSize').value = ipo.lotSize ?? '';
        document.getElementById('form-faceValue').value = ipo.faceValue ?? '';
        document.getElementById('form-issueSize').value = formatCrores(ipo.issueSize);
        document.getElementById('form-freshIssueSize').value = formatCrores(ipo.freshIssueSize);
        document.getElementById('form-ofsSize').value = formatCrores(ipo.ofsSize);
        document.getElementById('form-issueShareCount').value = ipo.issueShareCount ?? '';
        document.getElementById('form-freshIssueShareCount').value = ipo.freshIssueShareCount ?? '';
        document.getElementById('form-ofsShareCount').value = ipo.ofsShareCount ?? '';
        document.getElementById('form-openDate').value = ipo.openDate || '';
        document.getElementById('form-closeDate').value = ipo.closeDate || '';
        document.getElementById('form-listingDate').value = ipo.listingDate || '';

        const allotmentEv = ipo.lifecycleEvents?.find(e => e.eventType === 'BASIS_OF_ALLOTMENT');
        document.getElementById('form-allotmentDate').value = ipo.allotmentDate || (allotmentEv ? allotmentEv.eventDate.slice(0, 10) : '');

        // Company
        document.getElementById('form-logoUrl').value = ipo.company?.logoUrl || ipo.logoUrl || '';
        document.getElementById('form-website').value = ipo.company?.website || '';
        document.getElementById('form-industry').value = ipo.company?.industry || '';
        document.getElementById('form-sector').value = ipo.company?.sector || '';
        document.getElementById('form-phone').value = ipo.company?.phone || '';
        document.getElementById('form-email').value = ipo.company?.email || '';
        document.getElementById('form-contactPerson').value = ipo.company?.contactPerson || '';
        document.getElementById('form-aboutDescription').value = ipo.company?.aboutDescription || '';
        updateLogoPreview();

        const drhpDoc = ipo.documents?.find(d => d.documentType === 'DRHP');
        const rhpDoc = ipo.documents?.find(d => d.documentType === 'RHP');
        const prospectusDoc = ipo.documents?.find(d => d.documentType === 'PROSPECTUS');
        const anchorDoc = ipo.documents?.find(d => d.documentType === 'ANCHOR_LIST');
        const anchorExt = anchorDoc?.extractionData || {};

        document.getElementById('form-drhpUrl').value = ipo.drhpUrl || drhpDoc?.sourceUrl || '';
        document.getElementById('form-rhpUrl').value = ipo.rhpUrl || rhpDoc?.sourceUrl || '';
        document.getElementById('form-prospectusUrl').value = ipo.prospectusUrl || prospectusDoc?.sourceUrl || '';
        document.getElementById('form-anchorListUrl').value = ipo.anchorListUrl || anchorDoc?.sourceUrl || '';

        document.getElementById('form-anchorPortion').value = ipo.anchorDetails?.portion ?? anchorExt.anchorPortion ?? '';
        document.getElementById('form-anchorBidDate').value = ipo.anchorDetails?.bidDate ?? anchorExt.anchorBidDate ?? '';
        document.getElementById('form-anchorLockIn').value = ipo.anchorDetails?.lockIn ?? anchorExt.anchorLockIn ?? '';
        document.getElementById('form-anchorDetails').value = ipo.anchorDetails?.details ?? anchorExt.anchorDetails ?? '';
        document.getElementById('form-anchorPrice').value = ipo.anchorDetails?.price ?? anchorExt.anchorPrice ?? '';
        document.getElementById('form-anchorQibPct').value = ipo.anchorDetails?.qibPct ?? anchorExt.anchorQibPct ?? '';
        document.getElementById('form-anchorLockIn30').value = ipo.anchorDetails?.lockIn30 ?? anchorExt.anchorLockIn30 ?? '';
        document.getElementById('form-anchorLockIn90').value = ipo.anchorDetails?.lockIn90 ?? anchorExt.anchorLockIn90 ?? '';

        const anchorTbody = document.getElementById('anchor-investors-tbody');
        if (anchorTbody) anchorTbody.innerHTML = '';
        const invList = ipo.anchorDetails?.investors || anchorExt.anchorInvestors || [];
        if (Array.isArray(invList) && invList.length > 0) {
          invList.forEach(inv => addAnchorRow(inv));
        } else {
          addAnchorRow();
        }

        // Categories
        const qib = ipo.offerCategories?.find(c => c.category === 'QIB');
        const nii = ipo.offerCategories?.find(c => c.category === 'NII');
        const retail = ipo.offerCategories?.find(c => c.category === 'RETAIL');
        document.getElementById('cat-qib-pct').value = qib?.allocationPct ?? '';
        document.getElementById('cat-nii-pct').value = nii?.allocationPct ?? '';
        document.getElementById('cat-retail-pct').value = retail?.allocationPct ?? '';
        document.getElementById('cat-retail-min-lots').value = retail?.minLots ?? '';
        document.getElementById('cat-retail-max-lots').value = retail?.maxLots ?? '';
        document.getElementById('cat-retail-min-shares').value = retail?.minShares ?? '';
        document.getElementById('cat-retail-max-shares').value = retail?.maxShares ?? '';
        document.getElementById('cat-retail-min-amount').value = retail?.minAmount ?? '';
        document.getElementById('cat-retail-max-amount').value = retail?.maxAmount ?? '';

        // Participants
        const reg = ipo.participants?.find(p => p.role === 'REGISTRAR');
        const brlms = ipo.participants?.filter(p => p.role === 'BRLM' || p.role === 'CO_BRLM').map(p => p.name).join(', ');
        document.getElementById('part-reg-name').value = reg?.name || ipo.allotmentConfig?.registrar || '';
        document.getElementById('part-reg-phone').value = reg?.phone || '';
        document.getElementById('part-reg-email').value = reg?.email || '';
        document.getElementById('part-reg-website').value = reg?.website || ipo.allotmentConfig?.allotmentSourceUrl || '';
        document.getElementById('part-brlm-name').value = brlms || '';

        // Financials
        renderFinancialRows(ipo.financials || ipo.company?.financials || []);

        // GMP
        const gmp = ipo.gmpObservations?.[0];
        document.getElementById('gmp-amount').value = gmp?.gmpAmount ?? '';
        document.getElementById('gmp-percentage').value = gmp?.gmpPercentage ?? '';
        document.getElementById('gmp-est-profit').value = gmp?.estProfitPerLot ?? '';

        // Subscription
        const subs = ipo.subscriptionObservations || [];
        const qibSub = subs.find(s => s.category === 'QIB');
        const niiSub = subs.find(s => s.category === 'NII');
        const retailSub = subs.find(s => s.category === 'RETAIL');
        const totalSub = subs.find(s => s.category === 'OTHER');
        document.getElementById('sub-qib').value = qibSub?.subscriptionMultiple ?? '';
        document.getElementById('sub-nii').value = niiSub?.subscriptionMultiple ?? '';
        document.getElementById('sub-retail').value = retailSub?.subscriptionMultiple ?? '';
        document.getElementById('sub-total').value = totalSub?.subscriptionMultiple ?? '';

        // Allotment config
        if (ipo.allotmentConfig) {
          document.getElementById('allot-registrar-code').value = ipo.allotmentConfig.registrar || '';
          document.getElementById('allot-registrar-ipo-code').value = ipo.allotmentConfig.registrarIpoCode || '';
        } else {
          document.getElementById('allot-registrar-code').value = reg?.name ? reg.name.toLowerCase().replace(/\s+/g, '') : '';
          document.getElementById('allot-registrar-ipo-code').value = '';
        }

        // Render validation banner
        renderValidationBanner(ipo.validation);
      } catch (err) {
        console.error('Error loading manual IPO:', err);
      }
    }

    function renderValidationBanner(val) {
      const banner = document.getElementById('validation-banner');
      if (!val) { banner.style.display = 'none'; return; }

      if (val.isValid && (!val.warnings || val.warnings.length === 0)) {
        banner.className = 'alert-box success';
        banner.innerHTML = '<strong>✅ Ready for Publication</strong><div>Pre-publication validation checks passed completely.</div>';
        banner.style.display = 'flex';
      } else if (val.isValid && val.warnings.length > 0) {
        banner.className = 'alert-box warning';
        banner.innerHTML = '<strong>⚠️ Ready with Warnings (' + val.warnings.length + ')</strong><div>' + val.warnings.map(w => w.message).join(' | ') + '</div>';
        banner.style.display = 'flex';
      } else {
        banner.className = 'alert-box danger';
        banner.innerHTML = '<strong>❌ Validation Errors Block Publication (' + val.errors.length + ')</strong><div>' + val.errors.map(e => e.message).join(' | ') + '</div>';
        banner.style.display = 'flex';
      }
    }

    async function saveManualIpo() {
      const id = document.getElementById('form-ipo-id').value;
      const issueSizeVal = document.getElementById('form-issueSize').value;
      const freshSizeVal = document.getElementById('form-freshIssueSize').value;
      const ofsSizeVal = document.getElementById('form-ofsSize').value;

      const offerCategories = [];
      const qibPct = parseFloat(document.getElementById('cat-qib-pct').value);
      const niiPct = parseFloat(document.getElementById('cat-nii-pct').value);
      const retailPct = parseFloat(document.getElementById('cat-retail-pct').value);
      if (!isNaN(qibPct)) offerCategories.push({ category: 'QIB', allocationPct: qibPct });
      if (!isNaN(niiPct)) offerCategories.push({ category: 'NII', allocationPct: niiPct });
      if (!isNaN(retailPct)) {
        offerCategories.push({
          category: 'RETAIL',
          allocationPct: retailPct,
          minLots: parseInt(document.getElementById('cat-retail-min-lots').value, 10) || undefined,
          maxLots: parseInt(document.getElementById('cat-retail-max-lots').value, 10) || undefined,
          minShares: parseInt(document.getElementById('cat-retail-min-shares').value, 10) || undefined,
          maxShares: parseInt(document.getElementById('cat-retail-max-shares').value, 10) || undefined,
          minAmount: parseFloat(document.getElementById('cat-retail-min-amount').value) || undefined,
          maxAmount: parseFloat(document.getElementById('cat-retail-max-amount').value) || undefined,
        });
      }

      const participants = [];
      const regName = document.getElementById('part-reg-name').value.trim();
      if (regName) {
        participants.push({
          role: 'REGISTRAR',
          name: regName,
          phone: document.getElementById('part-reg-phone').value.trim() || undefined,
          email: document.getElementById('part-reg-email').value.trim() || undefined,
          website: document.getElementById('part-reg-website').value.trim() || undefined,
          displayOrder: 1,
        });
      }
      const brlmLines = document.getElementById('part-brlm-name').value.split(',').map(s => s.trim()).filter(Boolean);
      brlmLines.forEach((bName, idx) => {
        participants.push({ role: 'BRLM', name: bName, displayOrder: idx + 2 });
      });

      const financials = [];
      const finPeriod = document.getElementById('fin-period').value.trim();
      if (finPeriod) {
        financials.push({
          fiscalPeriod: finPeriod,
          totalAssets: parseFloat(document.getElementById('fin-assets').value) || undefined,
          totalRevenue: parseFloat(document.getElementById('fin-revenue').value) || undefined,
          pat: parseFloat(document.getElementById('fin-pat').value) || undefined,
          ebitda: parseFloat(document.getElementById('fin-ebitda').value) || undefined,
          netWorth: parseFloat(document.getElementById('fin-networth').value) || undefined,
          eps: parseFloat(document.getElementById('fin-eps').value) || undefined,
        });
      }

      let gmp = undefined;
      const gmpVal = parseFloat(document.getElementById('gmp-amount').value);
      if (!isNaN(gmpVal)) {
        gmp = {
          gmpAmount: gmpVal,
          gmpPercentage: parseFloat(document.getElementById('gmp-percentage').value) || undefined,
          estProfitPerLot: parseFloat(document.getElementById('gmp-est-profit').value) || undefined,
        };
      }

      const subscription = [];
      const subQib = parseFloat(document.getElementById('sub-qib').value);
      const subNii = parseFloat(document.getElementById('sub-nii').value);
      const subRetail = parseFloat(document.getElementById('sub-retail').value);
      const subTotal = parseFloat(document.getElementById('sub-total').value);
      if (!isNaN(subQib)) subscription.push({ category: 'QIB', subscriptionMultiple: subQib });
      if (!isNaN(subNii)) subscription.push({ category: 'NII', subscriptionMultiple: subNii });
      if (!isNaN(subRetail)) subscription.push({ category: 'RETAIL', subscriptionMultiple: subRetail });
      if (!isNaN(subTotal)) subscription.push({ category: 'OTHER', subscriptionMultiple: subTotal });

      const body = {
        legalName: document.getElementById('form-legalName').value,
        displayName: document.getElementById('form-displayName').value || undefined,
        cin: document.getElementById('form-cin').value || undefined,
        symbol: document.getElementById('form-symbol').value || undefined,
        marketSegment: document.getElementById('form-marketSegment').value,
        exchange: document.getElementById('form-exchange').value,
        status: document.getElementById('form-status').value,
        publicationStatus: document.getElementById('form-publicationStatus').value,
        priceBandLow: parseFloat(document.getElementById('form-priceBandLow').value) || undefined,
        priceBandHigh: parseFloat(document.getElementById('form-priceBandHigh').value) || undefined,
        lotSize: parseInt(document.getElementById('form-lotSize').value, 10) || undefined,
        faceValue: parseFloat(document.getElementById('form-faceValue').value) || undefined,
        issueSize: issueSizeVal ? parseFloat(issueSizeVal) : undefined,
        freshIssueSize: freshSizeVal ? parseFloat(freshSizeVal) : undefined,
        ofsSize: ofsSizeVal ? parseFloat(ofsSizeVal) : undefined,
        issueShareCount: parseInt(document.getElementById('form-issueShareCount').value, 10) || undefined,
        freshIssueShareCount: parseInt(document.getElementById('form-freshIssueShareCount').value, 10) || undefined,
        ofsShareCount: parseInt(document.getElementById('form-ofsShareCount').value, 10) || undefined,
        openDate: document.getElementById('form-openDate').value || undefined,
        closeDate: document.getElementById('form-closeDate').value || undefined,
        listingDate: document.getElementById('form-listingDate').value || undefined,
        allotmentDate: document.getElementById('form-allotmentDate').value || undefined,

        logoUrl: document.getElementById('form-logoUrl').value || undefined,
        website: document.getElementById('form-website').value || undefined,
        industry: document.getElementById('form-industry').value || undefined,
        sector: document.getElementById('form-sector').value || undefined,
        phone: document.getElementById('form-phone').value || undefined,
        email: document.getElementById('form-email').value || undefined,
        contactPerson: document.getElementById('form-contactPerson').value || undefined,
        aboutDescription: document.getElementById('form-aboutDescription').value || undefined,

        drhpUrl: document.getElementById('form-drhpUrl').value.trim() || undefined,
        rhpUrl: document.getElementById('form-rhpUrl').value.trim() || undefined,
        prospectusUrl: document.getElementById('form-prospectusUrl').value.trim() || undefined,
        anchorListUrl: document.getElementById('form-anchorListUrl').value.trim() || undefined,

        anchorPortion: parseFloat(document.getElementById('form-anchorPortion').value) || undefined,
        anchorBidDate: document.getElementById('form-anchorBidDate').value.trim() || undefined,
        anchorLockIn: document.getElementById('form-anchorLockIn').value.trim() || undefined,
        anchorDetails: document.getElementById('form-anchorDetails').value.trim() || undefined,
        anchorPrice: parseFloat(document.getElementById('form-anchorPrice').value) || undefined,
        anchorQibPct: parseFloat(document.getElementById('form-anchorQibPct').value) || undefined,
        anchorLockIn30: document.getElementById('form-anchorLockIn30').value.trim() || undefined,
        anchorLockIn90: document.getElementById('form-anchorLockIn90').value.trim() || undefined,
        anchorInvestors: getAnchorInvestorsFromForm(),

        offerCategories: offerCategories.length > 0 ? offerCategories : undefined,
        participants: participants.length > 0 ? participants : undefined,
        financials: getFinancialsFromForm().filter(f => f.fiscalPeriod),
        gmp,
        subscription: subscription.length > 0 ? subscription : undefined,
      };

      try {
        const method = id ? 'PATCH' : 'POST';
        const url = id ? (API_BASE + '/manual-ipos/' + id) : (API_BASE + '/manual-ipos');
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json();
          alert('Save failed: ' + (err.message || 'Unknown error'));
          return;
        }

        const json = await res.json();
        const saved = json.data || json;
        alert('Manual IPO saved successfully.');
        editManualIpo(saved.id);
      } catch (err) {
        console.error('Save error:', err);
      }
    }

    async function publishCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) { alert('Save the IPO draft first before publishing.'); return; }
      await publishManualIpoDirect(id);
    }

    async function publishManualIpoDirect(id) {
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/publish', { method: 'POST' });
        if (!res.ok) {
          const err = await res.json();
          alert('Publish failed: ' + (err.message || 'Validation error'));
          return;
        }
        alert('🚀 Published to Mobile successfully!');
        if (document.getElementById('form-ipo-id').value === id) editManualIpo(id);
        else fetchManualIpos();
      } catch (err) {
        console.error('Publish error:', err);
      }
    }

    async function unpublishCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) return;
      await unpublishManualIpoDirect(id);
    }

    async function unpublishManualIpoDirect(id) {
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/unpublish', { method: 'POST' });
        if (res.ok) {
          alert('Unpublished successfully.');
          if (document.getElementById('form-ipo-id').value === id) editManualIpo(id);
          else fetchManualIpos();
        }
      } catch (err) {
        console.error('Unpublish error:', err);
      }
    }

    async function archiveCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) return;
      await archiveManualIpoDirect(id);
    }

    async function archiveManualIpoDirect(id) {
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/archive', { method: 'POST' });
        if (res.ok) {
          alert('📦 IPO archived successfully.\\n(Status set to ARCHIVED. Data remains in database but is hidden from mobile app)');
          if (document.getElementById('form-ipo-id').value === id) editManualIpo(id);
          else fetchManualIpos();
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Archive failed: ' + (err.error?.message || err.message || res.statusText));
        }
      } catch (err) {
        console.error('Archive error:', err);
      }
    }

    async function unarchiveCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) return;
      await unarchiveManualIpoDirect(id);
    }

    async function unarchiveManualIpoDirect(id) {
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/unarchive', { method: 'POST' });
        if (res.ok) {
          alert('↩️ IPO unarchived (reverted to DRAFT status).');
          if (document.getElementById('form-ipo-id').value === id) editManualIpo(id);
          else fetchManualIpos();
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Unarchive failed: ' + (err.error?.message || err.message || res.statusText));
        }
      } catch (err) {
        console.error('Unarchive error:', err);
      }
    }

    async function deleteCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      const name = document.getElementById('form-legalName').value || document.getElementById('form-displayName').value || 'this IPO';
      if (!id) return;

      const confirmed = confirm(
        '⚠️ PERMANENT HARD DELETE WARNING:\\n\\n' +
        'Are you sure you want to PERMANENTLY DELETE "' + name + '"?\\n\\n' +
        'This will PERMANENTLY ERASE this IPO and all associated records from the database.\\n\\n' +
        'This action is PERMANENT and CANNOT be undone. Proceed?'
      );

      if (!confirmed) return;

      const deleted = await deleteManualIpoDirect(id, name, false);
      if (deleted) {
        openCreateModal();
        switchTab('manual');
      }
    }

    async function deleteManualIpoDirect(id, name, promptConfirm = true) {
      if (promptConfirm) {
        const confirmed = confirm(
          '⚠️ PERMANENT HARD DELETE WARNING:\\n\\n' +
          'Are you sure you want to PERMANENTLY DELETE "' + (name || 'this IPO') + '"?\\n\\n' +
          'This will PERMANENTLY ERASE this IPO and all associated records from the database.\\n\\n' +
          'This action is PERMANENT and CANNOT be undone. Proceed?'
        );
        if (!confirmed) return false;
      }

      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id, { method: 'DELETE' });
        if (res.ok) {
          alert('🗑️ IPO permanently deleted from the database.');
          fetchManualIpos();
          return true;
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Delete failed: ' + (err.error?.message || err.message || res.statusText));
          return false;
        }
      } catch (err) {
        console.error('Delete error:', err);
        alert('Delete failed: ' + (err.message || err));
        return false;
      }
    }

    function showUploadStatus(text, type = 'info') {
      const statusMsg = document.getElementById('upload-status-message');
      if (!statusMsg) return;
      statusMsg.style.display = 'block';
      statusMsg.textContent = text;
      if (type === 'error') {
        statusMsg.style.background = 'rgba(248, 113, 113, 0.15)';
        statusMsg.style.color = 'var(--danger)';
        statusMsg.style.border = '1px solid rgba(248, 113, 113, 0.3)';
      } else if (type === 'success') {
        statusMsg.style.background = 'rgba(52, 211, 153, 0.15)';
        statusMsg.style.color = 'var(--success)';
        statusMsg.style.border = '1px solid rgba(52, 211, 153, 0.3)';
      } else {
        statusMsg.style.background = 'rgba(56, 189, 248, 0.15)';
        statusMsg.style.color = 'var(--primary)';
        statusMsg.style.border = '1px solid rgba(56, 189, 248, 0.3)';
      }
    }

    function triggerJsonImport() {
      const fileInput = document.getElementById('json-file-input');
      if (fileInput) fileInput.click();
    }

    async function handleJsonFileSelect(event) {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const jsonPayload = JSON.parse(text);

        const currentIpoId = document.getElementById('form-ipo-id')?.value || undefined;
        let url = API_BASE + '/manual-ipos/import-json';
        if (currentIpoId) url += '?targetIpoId=' + encodeURIComponent(currentIpoId);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jsonPayload),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errorMsg = data.error?.message || data.message || res.statusText || 'Invalid JSON format';
          alert('JSON Import Failed: ' + errorMsg);
          return;
        }

        alert('✅ Canonical JSON Import Successful!\\nIPO saved in DRAFT status with ID: ' + data.id);
        fetchManualIpos();
        editManualIpo(data.id);
      } catch (err) {
        console.error('JSON import error:', err);
        alert('Invalid JSON file format: ' + (err.message || err));
      } finally {
        event.target.value = '';
      }
    }

    async function saveAllotmentConfig() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) { alert('Save IPO draft first'); return; }

      const registrar = document.getElementById('allot-registrar-code').value.trim();
      const registrarIpoCode = document.getElementById('allot-registrar-ipo-code').value.trim();

      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/allotment-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrar, registrarIpoCode, enabled: true }),
        });
        if (res.ok) {
          alert('Allotment registrar config saved successfully.');
        }
      } catch (err) {
        console.error('Save allotment config error:', err);
      }
    }

    function debounceFetchIpos() {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(fetchIpos, 300);
    }

    async function fetchIpos() {
      const q = document.getElementById('search-q').value;
      const segment = document.getElementById('filter-segment').value;
      const status = document.getElementById('filter-status').value;
      const params = new URLSearchParams();
      if (q) params.append('q', q);
      if (segment) params.append('marketSegment', segment);
      if (status) params.append('status', status);

      try {
        const res = await fetch(API_BASE + '/ipos?' + params.toString());
        const json = await res.json();
        const ipos = json.data || [];
        const tbody = document.getElementById('ipos-table-body');
        
        if (ipos.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 24px;">No matching canonical IPOs found</td></tr>';
          return;
        }

        tbody.innerHTML = ipos.map(ipo => \`
          <tr>
            <td>
              <strong>\${ipo.companyName || ipo.symbol}</strong>
              <div style="font-size:11px; color:var(--muted)">\${ipo.symbol}</div>
            </td>
            <td><span class="badge">\${ipo.marketSegment}</span></td>
            <td><span class="badge badge-\${(ipo.status||'').toLowerCase()}">\${ipo.status}</span></td>
            <td>\${ipo.priceBandLow ? '₹' + ipo.priceBandLow + ' - ₹' + ipo.priceBandHigh : 'N/A'}</td>
            <td>\${ipo.issueSizeInr ? '₹' + (ipo.issueSizeInr / 10000000).toFixed(2) + ' Cr' : 'N/A'}</td>
            <td><button class="btn btn-secondary" onclick="viewIpoDetail('\${ipo.id}')">Inspect</button></td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Error fetching IPOs:', err);
      }
    }

    async function viewIpoDetail(id) {
      switchTab('detail');
      try {
        const res = await fetch(API_BASE + '/ipos/' + id);
        const json = await res.json();
        const ipo = json.data || json;

        document.getElementById('det-company-name').textContent = ipo.companyName || ipo.symbol;
        document.getElementById('det-symbol-exchange').textContent = (ipo.symbol || '') + ' | ' + (ipo.exchange || 'NSE/BSE');
        document.getElementById('det-ipo-id').textContent = 'ID: ' + ipo.id;
        document.getElementById('det-price-band').textContent = ipo.priceBandLow ? '₹' + ipo.priceBandLow + ' - ₹' + ipo.priceBandHigh : 'N/A';
        document.getElementById('det-issue-size').textContent = ipo.issueSizeInr ? '₹' + (ipo.issueSizeInr / 10000000).toFixed(2) + ' Cr' : 'N/A';
        document.getElementById('det-lot-size').textContent = ipo.lotSize ? ipo.lotSize + ' shares' : 'N/A';
        document.getElementById('det-quality-status').textContent = ipo.qualityStatus || 'COMPLETE';

        loadLineage(id);
      } catch (err) {
        console.error('Error loading IPO detail:', err);
      }
    }

    async function loadLineage(id) {
      try {
        const res = await fetch(API_BASE + '/ipos/' + id + '/lineage');
        const json = await res.json();
        const lineage = json.data || json;
        const provenances = lineage.provenances || [];

        const tbody = document.getElementById('lineage-table-body');
        if (provenances.length === 0) {
          tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:16px;">No field provenance entries found</td></tr>';
          return;
        }

        tbody.innerHTML = provenances.map(p => \`
          <tr>
            <td><strong>\${p.fieldName}</strong></td>
            <td>\${p.fieldValue || 'N/A'}</td>
            <td><span class="badge">\${p.sourceCode || 'SYSTEM'}</span></td>
            <td class="mono" style="font-size:11px">\${new Date(p.observedAt).toLocaleString()}</td>
          </tr>
        \`).join('');
      } catch (err) {
        console.error('Lineage load error:', err);
      }
    }

    async function loadQuality() {
      try {
        const res = await fetch(API_BASE + '/quality');
        const json = await res.json();
        const data = json.data || json;
        document.getElementById('qual-overall-status').textContent = data.overallQualityGateStatus || 'COMPLETE';

        const grid = document.getElementById('qual-breakdown-grid');
        grid.innerHTML = Object.entries(data.statusBreakdown || {}).map(([st, cnt]) => \`
          <div class="card">
            <div class="card-title">\${st}</div>
            <div class="card-value">\${cnt}</div>
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
            <td><span class="badge badge-open">\${s.healthState}</span></td>
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

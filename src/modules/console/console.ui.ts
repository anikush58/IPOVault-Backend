import { FAVICON_DATA_URI } from './console.favicon';

export function renderConsoleHtml(_baseUrl = '/api/v1/console/api'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IPOVault — Backend Admin Console</title>
  <link rel="icon" type="image/png" href="${FAVICON_DATA_URI}" />
  <link rel="shortcut icon" type="image/png" href="${FAVICON_DATA_URI}" />
  <link rel="apple-touch-icon" href="${FAVICON_DATA_URI}" />
  
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
      max-width: 100vw;
      height: 100vh;
      height: 100dvh;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background-color: var(--bg-app);
      color: var(--text-main);
      -webkit-text-size-adjust: 100%;
    }

    /* SaaS Application Root Layout */
    .app-root {
      display: flex;
      width: 100vw;
      max-width: 100vw;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      position: relative;
    }

    /* Mobile Sidebar Backdrop Overlay */
    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background-color: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 998;
      opacity: 0;
      transition: opacity 0.25s ease;
      pointer-events: none;
    }

    body.mobile-sidebar-open .sidebar-backdrop {
      display: block;
      opacity: 1;
      pointer-events: auto;
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
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1), padding 0.25s cubic-bezier(0.4, 0, 0.2, 1), transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      z-index: 999;
    }

    .mobile-sidebar-close {
      display: none !important;
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
      width: 40px;
      height: 40px;
      padding: 0;
      margin: 2px auto;
      justify-content: center;
      border-radius: 10px;
    }

    .sidebar.collapsed .nav-item i,
    .sidebar.collapsed .nav-item svg {
      width: 16px;
      height: 16px;
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
    .workspace-picker i,
    .workspace-picker svg { width: 13px; height: 13px; color: #94A3B8; }

    /* Navigation Menu */
    .sidebar-nav { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
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
    .nav-item:hover { background-color: rgba(255, 255, 255, 0.07); color: #F8FAFC; }
    .nav-item.active { background-color: var(--primary); color: #FFFFFF; font-weight: 600; box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3); }
    .nav-item i,
    .nav-item svg { width: 16px; height: 16px; min-width: 16px; flex-shrink: 0; }

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
    .user-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .user-name { font-size: 12px; font-weight: 600; color: #F8FAFC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .user-email { font-size: 11px; color: #64748B; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Main Workspace Area */
    .main-workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; background-color: var(--bg-app); overflow: hidden; }

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

    .breadcrumbs { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; color: var(--text-muted); flex-wrap: wrap; min-width: 0; }
    .breadcrumb-active { color: var(--text-main); font-weight: 600; }
    .breadcrumbs i,
    .breadcrumbs svg { width: 13px; height: 13px; color: var(--text-subtle); flex-shrink: 0; }

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
    .search-input-box i,
    .search-input-box svg { width: 13px; height: 13px; color: var(--text-muted); flex-shrink: 0; }
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
      min-width: 36px;
      min-height: 36px;
      transition: background-color 0.15s ease, color 0.15s ease;
    }
    .icon-btn i,
    .icon-btn svg { width: 16px; height: 16px; }
    .icon-btn:hover { background-color: var(--bg-active); color: var(--text-main); }

    /* Section View Tab Switching */
    .section-view {
      display: none !important;
    }
    .section-view.active {
      display: flex !important;
      flex-direction: column;
      gap: 20px;
    }

    /* Content Area */
    .workspace-content {
      flex: 1;
      overflow-y: auto;
      padding: 28px;
      display: flex;
      flex-direction: column;
      gap: 24px;
      -webkit-overflow-scrolling: touch;
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
      white-space: nowrap;
    }
    .status-pill.open { background-color: var(--status-open-bg); color: var(--status-open-fg); }
    .status-pill.closing_today, .status-pill.closing-today { background-color: #FEF3C7; color: #D97706; }
    .status-pill.upcoming { background-color: var(--status-upcoming-bg); color: var(--status-upcoming-fg); }
    .status-pill.closed, .status-pill.allotment-completed, .status-pill.allotment_completed { background-color: var(--status-closed-bg); color: var(--status-closed-fg); }
    .status-pill.published, .status-pill.listed { background-color: var(--status-published-bg); color: var(--status-published-fg); }

    /* In-Row Interactive Status Select */
    .status-pill-select {
      display: inline-flex;
      align-items: center;
      padding: 4px 22px 4px 9px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid rgba(0, 0, 0, 0.08);
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: none;
      background-repeat: no-repeat;
      background-position: right 6px center;
      background-size: 11px;
      transition: all 0.18s ease;
      outline: none;
    }
    .status-pill-select:hover {
      filter: brightness(0.96);
      border-color: rgba(0, 0, 0, 0.22);
    }
    body.dark-mode .status-pill-select {
      border-color: rgba(255, 255, 255, 0.12);
    }
    body.dark-mode .status-pill-select:hover {
      filter: brightness(1.12);
      border-color: rgba(255, 255, 255, 0.28);
    }
    .status-pill-select:focus {
      box-shadow: 0 0 0 2px var(--primary);
    }
    .status-pill-select.open {
      background-color: var(--status-open-bg);
      color: var(--status-open-fg);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2315803D' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    }
    .status-pill-select.closing_today, .status-pill-select.closing-today {
      background-color: #FEF3C7;
      color: #D97706;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23D97706' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    }
    .status-pill-select.upcoming {
      background-color: var(--status-upcoming-bg);
      color: var(--status-upcoming-fg);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23D97706' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    }
    .status-pill-select.closed, .status-pill-select.allotment-completed, .status-pill-select.allotment_completed {
      background-color: var(--status-closed-bg);
      color: var(--status-closed-fg);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    }
    .status-pill-select.published, .status-pill-select.listed {
      background-color: var(--status-published-bg);
      color: var(--status-published-fg);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%234F46E5' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    }
    .status-pill-select.draft {
      background-color: var(--bg-hover);
      color: var(--text-muted);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748B' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
    }
    .status-pill-select option {
      background-color: var(--bg-surface);
      color: var(--text-main);
      font-weight: 500;
    }
    .status-pill-select.saving {
      opacity: 0.5;
      pointer-events: none;
    }

    .status-filter-pills {
      display: flex;
      gap: 8px;
      align-items: center;
      overflow-x: auto;
      white-space: nowrap;
      padding: 4px 2px 8px 2px;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .status-filter-pills::-webkit-scrollbar {
      display: none;
    }
    .filter-pill {
      padding: 6px 14px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-hover);
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .filter-pill:hover {
      background-color: var(--bg-active);
      color: var(--text-main);
    }
    .filter-pill.active {
      background-color: var(--primary);
      color: #FFFFFF;
      border-color: var(--primary);
      font-weight: 600;
      box-shadow: 0 2px 6px rgba(79, 70, 229, 0.25);
    }
    .filter-pill .pill-badge {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.08);
      color: inherit;
      font-weight: 700;
      margin-left: 6px;
      display: inline-block;
      vertical-align: middle;
    }
    body.dark-mode .filter-pill .pill-badge {
      background: rgba(255, 255, 255, 0.12);
    }
    .filter-pill.active .pill-badge {
      background: rgba(255, 255, 255, 0.28) !important;
      color: #FFFFFF !important;
    }

    /* Grid Table System */
    .grid-table-box {
      width: 100%;
      max-width: 100%;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      background: var(--bg-surface);
      box-shadow: var(--shadow-card);
    }

    table { width: 100%; border-collapse: collapse; text-align: left; min-width: 620px; }
    th {
      background: var(--bg-hover);
      padding: 12px 18px;
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
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
      justify-content: center;
      gap: 6px;
      transition: all 0.15s ease;
      min-height: 38px;
      white-space: nowrap;
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
      justify-content: center;
      gap: 6px;
      min-height: 38px;
      white-space: nowrap;
    }
    .btn-secondary:hover { background-color: var(--bg-hover); }

    .btn-success { background-color: #10B981; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 38px; }
    .btn-danger { background-color: #EF4444; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 38px; }
    .btn-warning { background-color: #F59E0B; color: #FFFFFF; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 38px; }

    /* Clickable Table Row */
    .clickable-row {
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .clickable-row:hover td {
      background-color: var(--bg-hover) !important;
    }

    /* Segmented Actions Icon Group (Table: 170px for 4 icons, Form: 212px for 5 icons) */
    .table-action-group {
      display: inline-flex;
      align-items: center;
      width: 170px;
      height: 36px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      vertical-align: middle;
      flex-shrink: 0;
    }

    .form-action-group {
      display: inline-flex;
      align-items: center;
      width: 212px;
      height: 36px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      vertical-align: middle;
      flex-shrink: 0;
    }

    .table-action-btn, .form-action-btn {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-right: 1px solid #E2E8F0;
      cursor: pointer;
      padding: 0;
      transition: background-color 0.15s ease, transform 0.1s ease;
    }

    .table-action-btn:last-child, .form-action-btn:last-child {
      border-right: none;
    }

    .table-action-btn:hover, .form-action-btn:hover {
      background-color: #F8FAFC;
    }

    .table-action-btn:active, .form-action-btn:active {
      background-color: #F1F5F9;
      transform: scale(0.95);
    }

    body.dark-mode .table-action-group, body.dark-mode .form-action-group {
      background: #0F172A;
      border-color: #1E293B;
    }

    body.dark-mode .table-action-btn, body.dark-mode .form-action-btn {
      border-right-color: #1E293B;
    }

    body.dark-mode .table-action-btn:hover, body.dark-mode .form-action-btn:hover {
      background-color: #1E293B;
    }

    /* Back Button & Edit Header Buttons */
    .btn-back-manual {
      height: 36px;
      padding: 0 16px;
      background-color: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      color: #0F172A;
      font-weight: 600;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      white-space: nowrap;
    }

    .btn-back-manual:hover {
      background-color: #F8FAFC;
      border-color: #CBD5E1;
    }

    body.dark-mode .btn-back-manual {
      background-color: #0F172A;
      border-color: #1E293B;
      color: #F8FAFC;
    }

    body.dark-mode .btn-back-manual svg {
      stroke: #F8FAFC;
    }

    body.dark-mode .btn-back-manual:hover {
      background-color: #1E293B;
    }

    /* Form Header Actions Bar */
    .form-header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 4px;
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
      min-height: 38px;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: var(--primary); }

    .alert-box { padding: 12px 16px; border-radius: 8px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
    .alert-box.success { background: #ECFDF5; border: 1px solid #10B981; color: #065F46; }
    .alert-box.danger { background: #FEF2F2; border: 1px solid #EF4444; color: #991B1B; }

    .mono { font-family: 'JetBrains Mono', monospace; }

    /* Responsive Breakpoints */
    @media (max-width: 1100px) {
      .workspace-content { padding: 20px 16px; gap: 18px; }
      .top-bar { padding: 10px 16px; }
      .search-input-box { width: 180px; }
      .form-grid { grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
    }

    @media (max-width: 768px) {
      /* Off-canvas mobile navigation drawer */
      .sidebar {
        position: fixed;
        top: 0;
        bottom: 0;
        left: 0;
        width: 270px;
        height: 100vh;
        height: 100dvh;
        z-index: 1000;
        transform: translateX(-100%);
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: none;
      }

      body.mobile-sidebar-open .sidebar {
        transform: translateX(0);
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.45);
      }

      .mobile-sidebar-close {
        display: flex !important;
      }

      .sidebar.collapsed {
        width: 270px !important;
        padding: 20px 14px !important;
      }

      .sidebar.collapsed .brand-title,
      .sidebar.collapsed .workspace-picker,
      .sidebar.collapsed .nav-group-title,
      .sidebar.collapsed .nav-item span,
      .sidebar.collapsed .user-info {
        display: block !important;
      }

      .sidebar.collapsed .brand-logo {
        justify-content: flex-start !important;
      }

      .sidebar.collapsed .nav-item {
        width: 100% !important;
        height: auto !important;
        padding: 9px 12px !important;
        margin: 0 !important;
        justify-content: flex-start !important;
        border-radius: 8px !important;
      }

      .sidebar.collapsed .user-profile {
        justify-content: flex-start !important;
        padding: 6px 8px !important;
      }

      .top-bar {
        min-height: 52px;
        padding: 8px 12px;
        gap: 8px;
      }

      .breadcrumbs {
        font-size: 13px;
        gap: 6px;
      }

      .breadcrumb-active {
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .workspace-content {
        padding: 14px 12px;
        gap: 14px;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }

      .stat-card {
        padding: 14px;
        border-radius: 10px;
        gap: 4px;
      }

      .stat-title {
        font-size: 11px;
      }

      .stat-value {
        font-size: 20px;
      }

      .form-grid {
        grid-template-columns: 1fr;
        gap: 12px;
      }

      .form-group input,
      .form-group select,
      .form-group textarea {
        font-size: 14px;
        padding: 9px 12px;
        border-radius: 8px;
        min-height: 40px;
      }

      .form-header-bar {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
      }

      .form-action-group {
        width: 200px;
        height: 36px;
      }

      .manual-toolbar {
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 10px !important;
      }

      .manual-toolbar-actions {
        width: 100%;
        display: flex;
        gap: 8px;
      }

      .manual-toolbar-actions .btn-primary,
      .manual-toolbar-actions .btn-secondary {
        flex: 1;
        justify-content: center;
      }

      .manual-toolbar-filters {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .manual-toolbar-filters input,
      .manual-toolbar-filters select {
        width: 100% !important;
        box-sizing: border-box;
      }

      .accordion-header {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 10px !important;
      }

      .accordion-header > div:last-child {
        width: 100%;
        display: flex;
        gap: 8px;
        justify-content: flex-start;
        flex-wrap: wrap;
      }

      th {
        padding: 10px 12px;
        font-size: 11px;
      }

      td {
        padding: 10px 12px;
        font-size: 12px;
      }
    }

    @media (max-width: 480px) {
      .top-bar {
        padding: 6px 10px;
      }

      .search-input-box {
        display: none;
      }

      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }

      .form-header-bar {
        gap: 6px;
      }

      .btn-back-manual {
        height: 36px;
        padding: 0 10px;
        font-size: 12px;
      }

      .form-action-group {
        width: 190px;
        height: 36px;
      }

      .auth-overlay {
        padding: 12px;
      }

      .auth-card {
        padding: 22px 16px;
        border-radius: 14px;
        gap: 16px;
      }

      .auth-title {
        font-size: 18px;
      }
    }

    /* Authentication Modal Overlay */
    .auth-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(15, 23, 42, 0.82);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 1;
      visibility: visible;
      transition: opacity 0.25s ease, visibility 0.25s ease;
    }
    .auth-overlay.hidden {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
    }
    .auth-card {
      width: 100%;
      max-width: 400px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 32px 28px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .auth-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 12px;
    }
    .auth-logo {
      width: 48px;
      height: 48px;
      object-fit: contain;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.2));
    }
    .auth-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-main);
      margin: 0;
    }
    .auth-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin: 4px 0 0 0;
    }
    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .auth-input-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .auth-input-group label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
    }
    .auth-input-group input {
      background: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 10px 14px;
      color: var(--text-main);
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s ease;
      width: 100%;
      box-sizing: border-box;
    }
    .auth-input-group input:focus {
      border-color: var(--primary);
    }
    .auth-btn-submit {
      background-color: var(--primary);
      color: #FFFFFF;
      font-size: 14px;
      font-weight: 600;
      padding: 11px 16px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background-color 0.15s ease;
      margin-top: 4px;
    }
    .auth-btn-submit:hover {
      background-color: var(--primary-hover);
    }
    .auth-btn-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .auth-error-alert {
      padding: 10px 14px;
      background-color: #FEF2F2;
      border: 1px solid #EF4444;
      color: #991B1B;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      display: none;
    }
  </style>
</head>
<body>

  <!-- Authentication Modal Overlay -->
  <div id="login-overlay" class="auth-overlay">
    <div class="auth-card">
      <div class="auth-header">
        <img src="${FAVICON_DATA_URI}" alt="IPOVault Logo" class="auth-logo" />
        <div>
          <h2 class="auth-title">IPOVault Console</h2>
          <p class="auth-subtitle">Sign in to access admin console and tools</p>
        </div>
      </div>

      <div id="login-error-alert" class="auth-error-alert"></div>

      <form class="auth-form" onsubmit="handleLogin(event); return false;">
        <div class="auth-input-group">
          <label for="login-username">Username</label>
          <input type="text" id="login-username" name="username" placeholder="Enter admin username" autocomplete="username" required autofocus />
        </div>
        <div class="auth-input-group">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" placeholder="Enter password" autocomplete="current-password" required />
        </div>
        <button type="submit" id="login-submit-btn" class="auth-btn-submit">
          <span>Sign In</span>
        </button>
      </form>
    </div>
  </div>

  <!-- SaaS Root Container -->
  <div class="app-root">
    <!-- Mobile Sidebar Backdrop Overlay -->
    <div id="sidebar-backdrop" class="sidebar-backdrop" onclick="closeMobileSidebar()"></div>

    <!-- Left Sidebar Navigation -->
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px;">
          <div class="brand-logo" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
            <img src="${FAVICON_DATA_URI}" alt="IPOVault" style="width:32px; height:32px; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15));" />
            <span class="brand-title">IPOVault</span>
          </div>
          <button type="button" class="mobile-sidebar-close icon-btn" onclick="closeMobileSidebar()" title="Close navigation menu" style="background:transparent; border:none; color:#94A3B8; cursor:pointer;">
            <i data-feather="x"></i>
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
          <span class="nav-badge" id="nav-manual-count" style="margin-left:auto; font-size:11px; padding:2px 7px; border-radius:10px; background:var(--bg-hover); color:var(--text-muted); font-weight:700;"></span>
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
        <button class="nav-item" id="nav-btn-ipo-guru" title="IPO Guru" onclick="switchTab('ipo-guru')">
          <i data-feather="database"></i>
          <span>IPO Guru</span>
        </button>
      </nav>

      <!-- Sidebar User Profile Footer -->
      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar-box">ADM</div>
          <div class="user-info">
            <span class="user-name" id="sidebar-user-name">IPOVault Admin</span>
            <span class="user-email">admin@getipovault.in</span>
          </div>
          <button class="icon-btn" onclick="handleLogout()" title="Log out from console" style="background:transparent; border:none; color:#94A3B8; cursor:pointer; padding:6px; border-radius:6px; display:flex; align-items:center; justify-content:center;">
            <i data-feather="log-out"></i>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Workspace Area -->
    <main class="main-workspace">
      <!-- Top Bar Header -->
      <div class="top-bar">
        <div class="breadcrumbs">
          <button class="icon-btn" onclick="toggleSidebar()" title="Toggle Menu" style="margin-right:6px;">
            <i data-feather="menu"></i>
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
        </div>
      </div>

      <!-- Workspace Scrollable Content -->
      <div class="workspace-content">

        <!-- 1. DASHBOARD OVERVIEW TAB -->
        <div id="tab-dashboard" class="section-view active">
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-title">Total Manual IPOs</div>
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
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <span style="font-weight:600; font-size:14px; color:var(--text-main);">Recent Manual IPOs</span>
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
          <div class="manual-toolbar" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div class="manual-toolbar-actions" style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn-primary" onclick="openCreateModal()"><i data-feather="plus"></i> <span>Add Manual IPO</span></button>
            </div>
            <div class="manual-toolbar-filters" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
              <input type="text" id="man-search-q" placeholder="Search company or symbol..." oninput="debounceFetchManualIpos()" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;" />
              <select id="man-filter-pub" onchange="fetchManualIpos()" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;">
                <option value="">All Publication States</option>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <select id="man-filter-status" onchange="onStatusSelectChange(this.value)" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;">
                <option value="OPEN" selected>Open</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="CLOSED">Closed</option>
                <option value="ALLOTMENT_COMPLETED">Allotment Out</option>
                <option value="LISTED">Listed</option>
                <option value="ALL">All Statuses</option>
              </select>
              <div class="sort-control-group" style="display:flex; align-items:center; gap:6px;">
                <select id="man-sort-by" onchange="onManualSortChange()" style="padding:7px 12px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:13px;" title="Sort IPOs">
                  <option value="smart">⚡ Smart Sort</option>
                  <option value="closeDate">📅 Closing Date</option>
                  <option value="openDate">🚀 Opening Date</option>
                  <option value="allotmentDate">🎯 Allotment Date</option>
                  <option value="listingDate">🔔 Listing Date</option>
                  <option value="gmp">📈 GMP</option>
                  <option value="companyName">🏢 Company Name</option>
                  <option value="issueSize">💰 Issue Size</option>
                  <option value="createdAt">🕒 Date Added</option>
                </select>
                <button type="button" class="btn-secondary" id="btn-sort-order" onclick="toggleManualSortOrder()" title="Toggle Sort Order (Ascending / Descending)" style="padding:7px 10px; font-size:13px; display:flex; align-items:center; gap:4px;">
                  <span id="sort-order-icon">↓</span>
                  <span id="sort-order-text">Desc</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Status Filter Pills -->
          <div class="status-filter-pills" style="margin-top:14px; margin-bottom:4px;">
            <button type="button" class="filter-pill active" id="pill-filter-OPEN" onclick="setStatusFilter('OPEN')">
              <span>Open</span><span class="pill-badge" id="count-pill-OPEN">0</span>
            </button>
            <button type="button" class="filter-pill" id="pill-filter-UPCOMING" onclick="setStatusFilter('UPCOMING')">
              <span>Upcoming</span><span class="pill-badge" id="count-pill-UPCOMING">0</span>
            </button>
            <button type="button" class="filter-pill" id="pill-filter-CLOSED" onclick="setStatusFilter('CLOSED')">
              <span>Closed</span><span class="pill-badge" id="count-pill-CLOSED">0</span>
            </button>
            <button type="button" class="filter-pill" id="pill-filter-ALLOTMENT_COMPLETED" onclick="setStatusFilter('ALLOTMENT_COMPLETED')">
              <span>Allotment Out</span><span class="pill-badge" id="count-pill-ALLOTMENT_COMPLETED">0</span>
            </button>
            <button type="button" class="filter-pill" id="pill-filter-LISTED" onclick="setStatusFilter('LISTED')">
              <span>Listed</span><span class="pill-badge" id="count-pill-LISTED">0</span>
            </button>
            <button type="button" class="filter-pill" id="pill-filter-ALL" onclick="setStatusFilter('ALL')">
              <span>All Statuses</span><span class="pill-badge" id="count-pill-ALL">0</span>
            </button>
          </div>

          <!-- Bulk Actions Toolbar (Visible when 1+ rows are selected) -->
          <div id="manual-bulk-bar" class="bulk-action-bar" style="display:none; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; padding:12px 18px; background:var(--bg-surface); border:1px solid var(--primary); border-radius:10px; margin-top:12px; box-shadow:0 4px 14px rgba(79,70,229,0.12);">
            <div style="display:flex; align-items:center; gap:12px;">
              <span id="bulk-selected-count-badge" style="background:var(--primary); color:#fff; font-weight:700; font-size:12px; padding:4px 10px; border-radius:6px;">0 Selected</span>
              <button type="button" class="btn-secondary" onclick="clearManualIpoSelection()" style="padding:4px 10px; font-size:12px; height:30px; min-height:30px;">Deselect All</button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <!-- Lifecycle Status Dropdown -->
              <div style="display:flex; align-items:center; gap:6px;">
                <label style="font-size:12px; font-weight:600; color:var(--text-muted);">Lifecycle Status:</label>
                <select id="bulk-lifecycle-select" onchange="onBulkStatusChange(this.value)" style="padding:6px 12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:12px; font-weight:600; cursor:pointer;">
                  <option value="" disabled selected>Change Status...</option>
                  <option value="OPEN">🟢 Live Now</option>
                  <option value="CLOSING_TODAY">🟠 Closing Today</option>
                  <option value="UPCOMING">🟡 Upcoming</option>
                  <option value="CLOSED">⚪ Closed</option>
                  <option value="ALLOTMENT_COMPLETED">🎯 Allotment Out</option>
                  <option value="LISTED">🔔 Listed</option>
                  <option value="DRAFT">📝 Draft</option>
                </select>
              </div>

              <!-- Publish Button -->
              <button type="button" class="btn-primary" onclick="bulkPublishSelectedIpos()" style="background:#8B5CF6; border-color:#8B5CF6; padding:6px 14px; font-size:12px; height:32px; min-height:32px; gap:6px;" title="Publish selected IPOs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                  <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                  <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                  <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                </svg>
                <span>Publish</span>
              </button>

              <!-- Unpublish Button -->
              <button type="button" class="btn-secondary" onclick="bulkUnpublishSelectedIpos()" style="padding:6px 14px; font-size:12px; height:32px; min-height:32px; gap:6px;" title="Unpublish selected IPOs (revert to Draft)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0050E5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
                <span>Unpublish</span>
              </button>

              <!-- Archive Button -->
              <button type="button" class="btn-secondary" onclick="bulkArchiveSelectedIpos()" style="padding:6px 14px; font-size:12px; height:32px; min-height:32px; gap:6px;" title="Archive selected IPOs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FB9816" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="21 8 21 21 3 21 3 8"></polyline>
                  <rect x="1" y="3" width="22" height="5" rx="1"></rect>
                  <line x1="10" y1="12" x2="14" y2="12"></line>
                </svg>
                <span>Archive</span>
              </button>

              <!-- Delete Button -->
              <button type="button" class="btn-danger" onclick="bulkDeleteSelectedIpos()" style="padding:6px 14px; font-size:12px; height:32px; min-height:32px; gap:6px;" title="Permanently delete selected IPOs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  <line x1="10" y1="11" x2="10" y2="17"></line>
                  <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
                <span>Delete</span>
              </button>
            </div>
          </div>

          <div class="grid-table-box" style="margin-top:8px;">
            <table>
              <thead>
                <tr>
                  <th style="width:40px; text-align:center;">
                    <input type="checkbox" id="bulk-select-all" title="Select All" onchange="toggleSelectAllManualIpos(this.checked)" style="cursor:pointer; width:16px; height:16px;" />
                  </th>
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
                <tr><td colspan="8" style="text-align:center; padding: 24px;">Loading Manual IPOs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 3. MANUAL IPO EDIT / CREATE TAB -->
        <div id="tab-manual-edit" class="section-view">
          <div class="form-header-bar" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <button type="button" class="btn-back-manual" onclick="switchTab('manual')">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F172A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              <span>Back</span>
            </button>
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <button type="button" class="btn-secondary" id="btn-import-json-detail" onclick="triggerJsonImportForCurrentIpo()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:13px; font-weight:600; border-radius:8px;" title="Upload JSON to fill empty or missing data for this IPO without overwriting existing data">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <span>Upload JSON (Fill Missing Data)</span>
              </button>
              <input type="file" id="json-detail-file-input" accept=".json,application/json" onchange="handleJsonDetailFileSelect(event)" style="display:none;" />
              <div class="form-action-group">
                <button type="button" class="form-action-btn" id="btn-save-action" title="Save IPO" onclick="saveManualIpo()">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A870" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                  </svg>
                </button>
                <button type="button" class="form-action-btn" id="btn-publish-action" title="Publish to Mobile App" onclick="publishCurrentIpo()">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9F4AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                    <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                  </svg>
                </button>
                <button type="button" class="form-action-btn" id="btn-unpublish-action" title="Unpublish (Draft)" onclick="unpublishCurrentIpo()">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0050E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                </button>
                <button type="button" class="form-action-btn" id="btn-archive-action" title="Archive IPO" onclick="archiveCurrentIpo()">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB9816" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8"></polyline>
                    <rect x="1" y="3" width="22" height="5" rx="1"></rect>
                    <line x1="10" y1="12" x2="14" y2="12"></line>
                  </svg>
                </button>
                <button type="button" class="form-action-btn" id="btn-delete-action" title="Delete IPO" onclick="deleteCurrentIpo()">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
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
                    <option value="CLOSING_TODAY">CLOSING TODAY</option>
                    <option value="CLOSED">CLOSED</option>
                    <option value="ALLOTMENT_COMPLETED">Allotment Out</option>
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
                <div class="form-group">
                  <label>Fresh Issue Size (₹ Cr)</label>
                  <input type="number" step="0.01" id="form-freshIssueSize" placeholder="e.g. 500.00" />
                </div>
                <div class="form-group">
                  <label>Offer for Sale Size (₹ Cr)</label>
                  <input type="number" step="0.01" id="form-ofsSize" placeholder="e.g. 200.00" />
                </div>
                <div class="form-group" style="grid-column: 1 / -1; margin-top: 10px;">
                  <h4 style="margin: 0; font-size: 13px; color: var(--primary); font-weight: 700; text-transform: uppercase;">Pre & Post IPO Metrics (Valuation & Shareholding)</h4>
                </div>
                <div class="form-group">
                  <label>Pre-IPO EPS (₹)</label>
                  <input type="number" step="0.01" id="form-preIpoEps" placeholder="e.g. 9.00" />
                </div>
                <div class="form-group">
                  <label>Post-IPO EPS (₹)</label>
                  <input type="number" step="0.01" id="form-postIpoEps" placeholder="e.g. 7.97" />
                </div>
                <div class="form-group">
                  <label>Pre-IPO P/E (x)</label>
                  <input type="number" step="0.01" id="form-preIpoPe" placeholder="e.g. 47.11" />
                </div>
                <div class="form-group">
                  <label>Post-IPO P/E (x)</label>
                  <input type="number" step="0.01" id="form-postIpoPe" placeholder="e.g. 53.20" />
                </div>
                <div class="form-group">
                  <label>Pre-IPO Promoter Holding (%)</label>
                  <input type="number" step="0.01" id="form-preIpoPromoterHolding" placeholder="e.g. 75.74" />
                </div>
                <div class="form-group">
                  <label>Post-IPO Promoter Holding (%)</label>
                  <input type="number" step="0.01" id="form-postIpoPromoterHolding" placeholder="e.g. 0.00" />
                </div>
                <div class="form-group">
                  <label>Pre-IPO Market Cap (₹ Cr)</label>
                  <input type="number" step="0.01" id="form-preIpoMarketCap" placeholder="e.g. 2500.00" />
                </div>
                <div class="form-group">
                  <label>Post-IPO Market Cap (₹ Cr)</label>
                  <input type="number" step="0.01" id="form-postIpoMarketCap" placeholder="e.g. 3153.36" />
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
                  <label>Refund Initiation Date</label>
                  <input type="date" id="form-refundDate" />
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

              <!-- Company Financial Ratios & Performance -->
              <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                <strong style="color:var(--primary); font-size:14px;">Company Financial Ratios & Performance</strong>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>Fiscal Period</label>
                  <input type="text" id="fin-period" placeholder="e.g. FY24 / 31 Mar 2024" />
                </div>
                <div class="form-group">
                  <label>ROE (%)</label>
                  <input type="number" step="0.01" id="fin-roe-pct" placeholder="e.g. 18.5" />
                </div>
                <div class="form-group">
                  <label>PAT Margin (%)</label>
                  <input type="number" step="0.01" id="fin-pat-margin-pct" placeholder="e.g. 12.4" />
                </div>
                <div class="form-group">
                  <label>EBITDA Margin (%)</label>
                  <input type="number" step="0.01" id="fin-ebitda-margin-pct" placeholder="e.g. 21.0" />
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>EPS (₹)</label>
                  <input type="number" step="0.01" id="fin-eps" placeholder="e.g. 8.50" />
                </div>
                <div class="form-group">
                  <label>ROCE (%)</label>
                  <input type="number" step="0.01" id="fin-roce-pct" placeholder="e.g. 22.1" />
                </div>
                <div class="form-group">
                  <label>Total Assets (₹ Cr)</label>
                  <input type="number" step="0.01" id="fin-assets" placeholder="e.g. 450.00" />
                </div>
                <div class="form-group">
                  <label>Total Revenue (₹ Cr)</label>
                  <input type="number" step="0.01" id="fin-revenue" placeholder="e.g. 620.00" />
                </div>
              </div>

              <div class="form-grid">
                <div class="form-group">
                  <label>PAT / Net Profit (₹ Cr)</label>
                  <input type="number" step="0.01" id="fin-pat" placeholder="e.g. 76.80" />
                </div>
                <div class="form-group">
                  <label>EBITDA (₹ Cr)</label>
                  <input type="number" step="0.01" id="fin-ebitda" placeholder="e.g. 130.20" />
                </div>
                <div class="form-group">
                  <label>Net Worth (₹ Cr)</label>
                  <input type="number" step="0.01" id="fin-networth" placeholder="e.g. 415.00" />
                </div>
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

              <!-- IPO Document Links -->
              <div style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                  <strong style="color:var(--primary); font-size:14px;">IPO Document Links</strong>
                  <button type="button" class="btn-secondary" onclick="addDocumentRow()" style="font-size:12px; padding:4px 10px;">+ Add Document</button>
                </div>

                <div class="grid-table-box" style="margin-bottom:12px;">
                  <table id="documents-table" style="min-width:650px;">
                    <thead>
                      <tr>
                        <th style="width:40px; text-align:center;">#</th>
                        <th style="width:180px;">Document Type</th>
                        <th>Document Title</th>
                        <th>Document URL</th>
                        <th style="width:70px; text-align:center;">Action</th>
                      </tr>
                    </thead>
                    <tbody id="documents-tbody">
                      <tr id="no-documents-row"><td colspan="5" style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">No documents added yet. Click "+ Add Document".</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <!-- Anchor Investors Allocation List (Accordion) -->
              <div class="accordion-item" style="border-top:1px solid var(--border-color); margin:12px 0; padding-top:12px;">
                <div class="accordion-header" onclick="toggleAnchorAccordion()" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; user-select:none; padding:4px 0;">
                  <div style="display:flex; align-items:center; gap:8px;">
                    <svg id="anchor-accordion-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s ease;">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                    <strong style="color:var(--primary); font-size:14px;">Anchor Investors Allocation List</strong>
                    <span id="anchor-count-badge" style="font-size:11px; padding:2px 8px; background:var(--primary-light); color:var(--primary); border-radius:12px; font-weight:600;">0 investors</span>
                  </div>
                  <div style="display:flex; gap:8px;" onclick="event.stopPropagation()">
                    <input type="file" id="anchor-csv-file-input" accept=".csv" style="display:none;" onchange="handleAnchorCsvFileSelect(event)" />
                    <button type="button" class="btn-secondary" onclick="triggerAnchorCsvUpload()" style="font-size:12px; padding:4px 10px;">Upload CSV</button>
                    <button type="button" class="btn-secondary" onclick="addAnchorInvestorRow(); openAnchorAccordion();" style="font-size:12px; padding:4px 10px;">+ Add Anchor Investor</button>
                  </div>
                </div>

                <div id="anchor-accordion-body" style="margin-top:12px;">
                  <div class="grid-table-box" style="margin-bottom:12px;">
                    <table id="anchor-investors-table" style="min-width:650px;">
                      <thead>
                        <tr>
                          <th style="width:40px; text-align:center;">#</th>
                          <th>Anchor Investor Name</th>
                          <th style="text-align:right;">Shares Allotted</th>
                          <th style="text-align:right;">Amt (₹ Cr)</th>
                          <th style="text-align:right;">% Allocated</th>
                          <th style="text-align:right;">% of Issue</th>
                          <th style="width:70px; text-align:center;">Action</th>
                        </tr>
                      </thead>
                      <tbody id="anchor-investors-tbody">
                        <tr id="no-anchor-row"><td colspan="7" style="text-align:center; padding:16px; color:var(--text-muted); font-size:12px;">No anchor investors added yet. Click "+ Add Anchor Investor".</td></tr>
                      </tbody>
                      <tfoot id="anchor-investors-tfoot" style="background-color:var(--bg-hover); font-weight:700;">
                        <tr>
                          <td colspan="2" style="padding:10px 12px; font-weight:700; color:var(--primary);">Total</td>
                          <td id="anchor-total-shares" style="text-align:right; padding:10px 12px; color:var(--primary);">0</td>
                          <td id="anchor-total-amt" style="text-align:right; padding:10px 12px; color:var(--primary);">₹0.00</td>
                          <td id="anchor-total-pct-allocated" style="text-align:right; padding:10px 12px; color:var(--primary);">0.00%</td>
                          <td id="anchor-total-pct-issue" style="text-align:right; padding:10px 12px; color:var(--primary);">0.00%</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:16px;">
                <div class="form-action-group">
                  <button type="button" class="form-action-btn" title="Save IPO" onclick="saveManualIpo()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A870" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                      <polyline points="17 21 17 13 7 13 7 21"></polyline>
                      <polyline points="7 3 7 8 15 8"></polyline>
                    </svg>
                  </button>
                  <button type="button" class="form-action-btn" title="Publish to Mobile App" onclick="publishCurrentIpo()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9F4AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
                    </svg>
                  </button>
                  <button type="button" class="form-action-btn" title="Unpublish (Draft)" onclick="unpublishCurrentIpo()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0050E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  </button>
                  <button type="button" class="form-action-btn" title="Archive IPO" onclick="archiveCurrentIpo()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB9816" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="21 8 21 21 3 21 3 8"></polyline>
                      <rect x="1" y="3" width="22" height="5" rx="1"></rect>
                      <line x1="10" y1="12" x2="14" y2="12"></line>
                    </svg>
                  </button>
                  <button type="button" class="form-action-btn" title="Delete IPO" onclick="deleteCurrentIpo()">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      <line x1="10" y1="11" x2="10" y2="17"></line>
                      <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>

          <!-- Allotment Configuration Form -->
          <div class="stat-card" style="padding:24px; margin-top:20px;">
            <div class="stat-title" style="margin-bottom:12px; font-size:14px; color:var(--primary);">Allotment Checker Mapping Configuration</div>
            <div class="form-grid">
              <div class="form-group">
                <label>Registrar Code *</label>
                <input type="text" id="allot-registrar-code" placeholder="KFINTECH / MUFG_INTIME / BIGSHARE" oninput="updateAllotmentWarning()" />
              </div>
              <div class="form-group">
                <label>Registrar IPO Code</label>
                <input type="text" id="allot-registrar-ipo-code" placeholder="e.g. 40580036070 or 00142" oninput="updateAllotmentWarning()" />
                <small style="color:var(--text-muted); font-size:11px; margin-top:4px; display:block;">Registrar IPO Code is the internal issue code used by the registrar's allotment system. It is separate from the IPOVault IPO ID.</small>
              </div>
              <div class="form-group" style="display:flex; align-items:center; gap:8px; margin-top:22px;">
                <input type="checkbox" id="allot-enabled" checked onchange="updateAllotmentWarning()" style="width:16px; height:16px; cursor:pointer;" />
                <label for="allot-enabled" style="cursor:pointer; font-weight:600; margin:0;">Enable Allotment Checker</label>
              </div>
            </div>

            <div id="allotment-warning-banner" style="display:none; margin-top:12px; padding:10px 14px; background-color:#FEF3C7; border:1px solid #F59E0B; border-radius:8px; color:#92400E; font-size:12px; font-weight:500;">
              ⚠️ Registrar IPO Code is required before allotment checking can be used.
            </div>

            <div style="display:flex; justify-content:flex-end; margin-top:12px;">
              <button type="button" class="btn-secondary" onclick="saveAllotmentConfig()">Save Allotment Config</button>
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

        <!-- 9. IPO GURU v2 TAB -->
        <div id="tab-ipo-guru" class="section-view">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
            <div>
              <div style="font-weight:700; font-size:17px; color:var(--text-main); margin-bottom:4px;">IPO Guru v2 Inspector</div>
              <div style="font-size:12px; color:var(--text-muted);">
                READ-ONLY. Fetches from <code style="font-family:monospace; background:var(--bg-hover); padding:1px 5px; border-radius:4px;">GET https://www.ipoguru.in/api/v2/ipos</code>
                via the backend using <code style="font-family:monospace; background:var(--bg-hover); padding:1px 5px; border-radius:4px;">IPOGURU_API_KEY</code>.
                <strong style="color:#F59E0B;">Rate limit: 10 req/day &middot; 1 req/min.</strong>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:10px; flex-shrink:0; flex-wrap:wrap;">
              <div id="ipo-guru-status-badge" style="display:none; font-size:11px; padding:3px 10px; border-radius:12px; font-weight:600;"></div>
              <button id="ipo-guru-fetch-btn" class="btn-secondary" onclick="fetchIpoGuruData()">
                <i data-feather="eye"></i>
                <span>Fetch IPO Guru Data</span>
              </button>
              <button id="ipo-guru-sync-btn" class="btn-primary" onclick="syncIpoGuruData()">
                <i data-feather="refresh-cw"></i>
                <span>Sync to IPO Database</span>
              </button>
            </div>
          </div>
          <!-- API Request Budget & Schedule Counter Grid -->
          <div style="margin-bottom:16px;">
            <div style="font-weight:700; font-size:13px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
              <span>API Request Budget &amp; Automatic Schedule</span>
              <span id="ig-ist-date-badge" style="font-size:11px; text-transform:none; font-weight:600; color:var(--primary); background:var(--bg-hover); padding:2px 8px; border-radius:6px;">IST Date: &mdash;</span>
            </div>
            <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
              <div class="stat-card" style="padding:10px;">
                <div class="stat-title">Requests Used Today</div>
                <div class="stat-value" id="ig-requests-used" style="font-size:17px; font-weight:700;">&mdash;</div>
              </div>
              <div class="stat-card" style="padding:10px;">
                <div class="stat-title">Requests Remaining Today</div>
                <div class="stat-value" id="ig-requests-remaining" style="font-size:17px; font-weight:700; color:#10B981;">&mdash;</div>
              </div>
              <div class="stat-card" style="padding:10px;">
                <div class="stat-title">Auto Requests Used Today</div>
                <div class="stat-value" id="ig-auto-requests-used" style="font-size:17px; font-weight:700; color:#4F46E5;">&mdash;</div>
              </div>
              <div class="stat-card" style="padding:10px;">
                <div class="stat-title">Next Scheduled Auto Sync</div>
                <div class="stat-value" id="ig-next-scheduled" style="font-size:13px; font-weight:700; color:#F59E0B;">&mdash;</div>
              </div>
              <div class="stat-card" style="padding:10px;">
                <div class="stat-title">Last Successful Fetch</div>
                <div class="stat-value" id="ig-last-success" style="font-size:12px; font-weight:600;">&mdash;</div>
              </div>
              <div class="stat-card" style="padding:10px;">
                <div class="stat-title">Last Fetch Status</div>
                <div class="stat-value" id="ig-last-status" style="font-size:12px; font-weight:600;">&mdash;</div>
              </div>
            </div>
          </div>

          <div id="ipo-guru-meta" style="display:none; padding:10px 14px; background:var(--bg-hover); border:1px solid var(--border-color); border-radius:10px; margin-bottom:14px; font-size:12px; color:var(--text-muted);">
            <span>Last Fetch: <strong id="ipo-guru-last-fetch" style="color:var(--text-main);">&mdash;</strong></span>&nbsp;&nbsp;
            <span>HTTP Status: <strong id="ipo-guru-http-status" style="color:var(--text-main);">&mdash;</strong></span>&nbsp;&nbsp;
            <span>Total IPOs: <strong id="ipo-guru-total" style="color:var(--primary);">&mdash;</strong></span>
          </div>
          <div id="ipo-guru-sync-summary" style="display:none; padding:14px 18px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:12px; margin-bottom:14px; box-shadow:var(--shadow-card);">
            <div style="font-weight:700; font-size:14px; margin-bottom:10px; color:var(--text-main); display:flex; justify-content:space-between; align-items:center;">
              <span>Database Synchronization Summary</span>
              <span id="ipo-guru-sync-time" style="font-size:11px; font-weight:normal; color:var(--text-muted);"></span>
            </div>
            <div class="stats-grid" style="margin-bottom:12px;">
              <div class="stat-card" style="padding:10px;"><div class="stat-title">Total Fetched</div><div class="stat-value" id="sync-total-fetched" style="font-size:18px;">0</div></div>
              <div class="stat-card" style="padding:10px;"><div class="stat-title">Matched & Updated</div><div class="stat-value" id="sync-matched-updated" style="font-size:18px; color:#10B981;">0</div></div>
              <div class="stat-card" style="padding:10px;"><div class="stat-title">Newly Created</div><div class="stat-value" id="sync-newly-created" style="font-size:18px; color:#4F46E5;">0</div></div>
              <div class="stat-card" style="padding:10px;"><div class="stat-title">Skipped / Errors</div><div class="stat-value" id="sync-skipped-errors" style="font-size:18px; color:#F59E0B;">0</div></div>
            </div>
            <div id="ipo-guru-sync-details" style="max-height:160px; overflow-y:auto; font-size:12px; border-top:1px solid var(--border-color); padding-top:8px;"></div>
          </div>
          <div id="ipo-guru-error" style="display:none; padding:12px 16px; background:#FEF2F2; border:1px solid #EF4444; border-radius:10px; color:#991B1B; font-size:13px; margin-bottom:14px;"></div>
          <div id="ipo-guru-table-wrap" style="display:none;">
            <div class="grid-table-box">
              <div style="padding:14px 18px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:600; font-size:14px;">IPO Guru v2 Data</span>
                <span id="ipo-guru-row-count" style="font-size:12px; color:var(--text-muted);"></span>
              </div>
              <table style="min-width:1400px;">
                <thead>
                  <tr>
                    <th style="width:36px;">#</th>
                    <th>IPO Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Open</th>
                    <th>Close</th>
                    <th>Allotment</th>
                    <th>Listing</th>
                    <th>Price Band</th>
                    <th style="text-align:right;">Issue Price</th>
                    <th style="text-align:right;">Lot Size</th>
                    <th style="text-align:right;">Issue Size (Cr)</th>
                    <th>Fresh/OFS</th>
                    <th>Exchange</th>
                    <th>Registrar</th>
                    <th style="text-align:right;">QIB (x)</th>
                    <th style="text-align:right;">NII (x)</th>
                    <th style="text-align:right;">Retail (x)</th>
                    <th style="text-align:right;">Total (x)</th>
                    <th style="text-align:right;">GMP (&#8377;)</th>
                    <th style="text-align:right;">GMP %</th>
                    <th>GMP Updated</th>
                    <th>Sub Updated</th>
                    <th style="width:80px; text-align:center;">Raw</th>
                  </tr>
                </thead>
                <tbody id="ipo-guru-table-body">
                  <tr><td colspan="24" style="text-align:center; padding:24px; color:var(--text-muted);">No data yet. Click &ldquo;Fetch IPO Guru Data&rdquo;.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div id="ipo-guru-raw-overlay" style="display:none; position:fixed; inset:0; background:rgba(15,23,42,0.75); backdrop-filter:blur(6px); z-index:10000; align-items:center; justify-content:center; padding:20px;">
            <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:14px; width:100%; max-width:720px; max-height:80vh; display:flex; flex-direction:column; overflow:hidden;">
              <div style="padding:14px 18px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:14px;">Raw API Data</strong>
                <button type="button" onclick="closeIpoGuruRaw()" style="background:transparent; border:none; cursor:pointer; color:var(--text-muted); font-size:18px; line-height:1;">&times;</button>
              </div>
              <pre id="ipo-guru-raw-pre" style="margin:0; padding:16px; overflow:auto; font-size:12px; font-family:monospace; background:var(--bg-hover); color:var(--text-main); flex:1; white-space:pre-wrap; word-break:break-all;"></pre>
            </div>
          </div>
          <div id="ipo-guru-empty" style="text-align:center; padding:48px 16px; color:var(--text-muted);">
            <div style="font-size:32px; margin-bottom:12px;">&#128202;</div>
            <div style="font-weight:600; margin-bottom:6px;">No data fetched yet</div>
        <!-- ADD-ONLY JSON IMPORT PREVIEW & COMMIT MODAL -->
        <div id="json-import-modal-overlay" style="display:none; position:fixed; inset:0; background:rgba(15,23,42,0.75); backdrop-filter:blur(6px); z-index:10000; align-items:center; justify-content:center; padding:20px;">
          <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:14px; width:100%; max-width:920px; max-height:88vh; display:flex; flex-direction:column; overflow:hidden; box-shadow:var(--shadow-card);">
            <div style="padding:16px 20px; border-bottom:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; background:var(--bg-hover);">
              <div>
                <div style="font-weight:700; font-size:16px; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                  <span>Add-Only JSON Import Preview</span>
                  <span style="font-size:11px; padding:2px 8px; border-radius:12px; background:rgba(16,185,129,0.15); color:#10B981; font-weight:600;">Add-Only Protection</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">
                  Only empty or missing fields will be populated. Existing non-empty values (including <strong>0</strong> and <strong>false</strong>) are strictly preserved and never overwritten.
                </div>
              </div>
              <button onclick="closeJsonImportModal()" style="background:none; border:none; font-size:22px; color:var(--text-muted); cursor:pointer; line-height:1;">&times;</button>
            </div>

            <!-- Summary Metrics -->
            <div style="padding:14px 20px; border-bottom:1px solid var(--border-color); background:var(--bg-surface);">
              <div class="stats-grid" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px;">
                <div class="stat-card" style="padding:10px;">
                  <div class="stat-title">Total Records</div>
                  <div class="stat-value" id="json-preview-total" style="font-size:18px;">0</div>
                </div>
                <div class="stat-card" style="padding:10px;">
                  <div class="stat-title">Matched IPOs</div>
                  <div class="stat-value" id="json-preview-matched" style="font-size:18px; color:#10B981;">0</div>
                </div>
                <div class="stat-card" style="padding:10px;">
                  <div class="stat-title">Fields to Fill</div>
                  <div class="stat-value" id="json-preview-fields-count" style="font-size:18px; color:#3B82F6;">0</div>
                </div>
                <div class="stat-card" style="padding:10px;">
                  <div class="stat-title">Unmatched</div>
                  <div class="stat-value" id="json-preview-unmatched" style="font-size:18px; color:#F59E0B;">0</div>
                </div>
                <div class="stat-card" style="padding:10px;">
                  <div class="stat-title">Ambiguous</div>
                  <div class="stat-value" id="json-preview-ambiguous" style="font-size:18px; color:#EF4444;">0</div>
                </div>
              </div>
            </div>

            <!-- Preview List Body -->
            <div id="json-preview-list" style="padding:16px 20px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:12px; max-height:calc(88vh - 210px);">
              <!-- Populated dynamically via JS -->
            </div>

            <!-- Modal Footer Actions -->
            <div style="padding:14px 20px; border-top:1px solid var(--border-color); background:var(--bg-hover); display:flex; justify-content:space-between; align-items:center;">
              <button class="btn-secondary" onclick="closeJsonImportModal()">Cancel</button>
              <button class="btn-primary" id="btn-confirm-json-import" onclick="commitAddOnlyJsonImport()" style="display:flex; align-items:center; gap:8px;">
                <span id="btn-confirm-json-text">Confirm & Apply Add-Only Import</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    </main>
  </div>

  <script>
    const API_BASE = window.location.pathname.replace(new RegExp('/+$'), '') + '/api';
    let currentTab = 'dashboard';
    let currentIpoData = null;
    let isAuthenticated = false;
    let consoleToken = '';
    try {
      consoleToken = localStorage.getItem('ipovault_console_token') || '';
    } catch (e) {}

    // Intercept 401 Unauthorized globally and inject authorization header for console API requests
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      let [resource, config] = args;
      config = config ? Object.assign({}, config) : {};
      const headers = new Headers(config.headers || {});
      if (consoleToken && !headers.has('Authorization')) {
        headers.set('Authorization', 'Bearer ' + consoleToken);
      }
      config.headers = headers;
      if (!config.credentials) {
        config.credentials = 'include';
      }

      const res = await originalFetch.call(this, resource, config);
      if (
        res.status === 401 &&
        typeof resource === 'string' &&
        resource.includes('/api/') &&
        !resource.endsWith('/login') &&
        !resource.endsWith('/session')
      ) {
        try { localStorage.removeItem('ipovault_console_token'); } catch (e) {}
        consoleToken = '';
        showLoginModal('Session expired or unauthorized. Please sign in again.');
      }
      return res;
    };

    function showLoginModal(errorMsg = '') {
      isAuthenticated = false;
      const overlay = document.getElementById('login-overlay');
      if (overlay) overlay.classList.remove('hidden');
      const errEl = document.getElementById('login-error-alert');
      if (errEl) {
        if (errorMsg) {
          errEl.textContent = errorMsg;
          errEl.style.display = 'block';
        } else {
          errEl.style.display = 'none';
        }
      }
      const passInput = document.getElementById('login-password');
      if (passInput) passInput.value = '';
    }

    function hideLoginModal() {
      isAuthenticated = true;
      const overlay = document.getElementById('login-overlay');
      if (overlay) overlay.classList.add('hidden');
      const errEl = document.getElementById('login-error-alert');
      if (errEl) errEl.style.display = 'none';
    }

    async function handleLogin(e) {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const usernameInput = document.getElementById('login-username');
      const passwordInput = document.getElementById('login-password');
      const submitBtn = document.getElementById('login-submit-btn');
      const errEl = document.getElementById('login-error-alert');

      const username = usernameInput ? usernameInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!username || !password) {
        if (errEl) {
          errEl.textContent = 'Please enter both username and password.';
          errEl.style.display = 'block';
        }
        return false;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Signing in...</span>';
      }
      if (errEl) errEl.style.display = 'none';

      try {
        const res = await originalFetch(API_BASE + '/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ username, password }),
        });

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.token) {
            consoleToken = data.token;
            try { localStorage.setItem('ipovault_console_token', data.token); } catch (e) {}
          }
          const userDisplay = document.getElementById('sidebar-user-name');
          if (userDisplay && (data.username || username)) {
            userDisplay.textContent = data.username || username;
          }
          hideLoginModal();
          initConsoleApp();
        } else {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.message || (res.status === 401 ? 'Invalid username or password.' : 'Sign in failed (HTTP ' + res.status + ').');
          if (errEl) {
            errEl.textContent = typeof msg === 'string' ? msg : JSON.stringify(msg);
            errEl.style.display = 'block';
          }
        }
      } catch (err) {
        if (errEl) {
          errEl.textContent = 'Network or connection error. Please verify the backend is reachable and try again.';
          errEl.style.display = 'block';
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Sign In</span>';
        }
      }
      return false;
    }

    async function handleLogout() {
      try { localStorage.removeItem('ipovault_console_token'); } catch (e) {}
      consoleToken = '';
      try {
        await originalFetch(API_BASE + '/logout', { method: 'POST', credentials: 'include' });
      } catch (err) {
        console.warn('Logout error:', err);
      }
      showLoginModal('You have been signed out.');
    }

    async function checkSessionAndInit() {
      if (localStorage.getItem('sidebar-collapsed') === 'true') {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
      }
      if (window.feather) feather.replace();

      try {
        const headers = {};
        if (consoleToken) headers['Authorization'] = 'Bearer ' + consoleToken;
        const res = await originalFetch(API_BASE + '/session', {
          credentials: 'include',
          headers: headers,
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          const userDisplay = document.getElementById('sidebar-user-name');
          if (userDisplay && data.username) {
            userDisplay.textContent = data.username;
          }
          hideLoginModal();
          initConsoleApp();
        } else {
          showLoginModal();
        }
      } catch (err) {
        showLoginModal();
      }
    }

    function initConsoleApp() {
      if (localStorage.getItem('sidebar-collapsed') === 'true') {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.classList.add('collapsed');
      }
      if (window.feather) feather.replace();
      loadDashboard();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkSessionAndInit);
    } else {
      checkSessionAndInit();
    }

    function toggleSidebar() {
      if (window.innerWidth <= 768) {
        document.body.classList.toggle('mobile-sidebar-open');
      } else {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;
        sidebar.classList.toggle('collapsed');
        const isCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebar-collapsed', isCollapsed ? 'true' : 'false');
      }
      if (window.feather) feather.replace();
    }

    function closeMobileSidebar() {
      document.body.classList.remove('mobile-sidebar-open');
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
      closeMobileSidebar();
      currentTab = tabId;
      document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('tab-' + tabId);
      if (target) target.classList.add('active');

      const workspaceEl = document.querySelector('.workspace-content');
      if (workspaceEl) workspaceEl.scrollTop = 0;
      window.scrollTo(0, 0);

      document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => el.classList.remove('active'));
      const activeNavBtn = document.getElementById('nav-btn-' + tabId);
      if (activeNavBtn) activeNavBtn.classList.add('active');

      const titleMap = {
        'dashboard': 'Dashboard',
        'manual': 'Manual IPO Manager',
        'manual-edit': 'Edit IPO',
        'explorer': 'IPO Explorer',
        'quality': 'Data Quality Overview',
        'sources': 'Upstream Source Health',
        'notifications': 'Notification Delivery Ops',
        'allotment': 'Allotment Check Ops',
        'ipo-guru': 'IPO Guru v2 Inspector'
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
      if (tabId === 'ipo-guru') fetchIpoGuruStatus();

      if (window.feather) feather.replace();
    }

    async function loadDashboard() {
      try {
        const res = await fetch(API_BASE + '/dashboard');
        const json = await res.json();
        const data = json.data || json;

        const totalVal = data.ipoCounts?.total ?? data.totalCanonicalIpos ?? 0;
        const pubVal = data.publicationBreakdown?.published ?? data.publishedIpos ?? 0;
        const openVal = data.ipoCounts?.open ?? data.openIpos ?? 0;
        const draftVal = data.publicationBreakdown?.draft ?? data.draftIpos ?? 0;

        const elTotal = document.getElementById('kpi-total');
        const elPub = document.getElementById('kpi-published');
        const elOpen = document.getElementById('kpi-open');
        const elDrafts = document.getElementById('kpi-drafts');

        if (elTotal) elTotal.textContent = totalVal;
        if (elPub) elPub.textContent = pubVal;
        if (elOpen) elOpen.textContent = openVal;
        if (elDrafts) elDrafts.textContent = draftVal;

        await fetchRecentDashboardIpos();
      } catch (err) {
        console.error('Dashboard load error:', err);
        fetchRecentDashboardIpos();
      }
    }

    async function rowSaveManualIpo(id, event) {
      if (event) event.stopPropagation();
      editManualIpo(id);
    }

    async function rowPublishManualIpo(id, event) {
      if (event) event.stopPropagation();
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/publish', { method: 'POST' });
        if (res.ok) {
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Publish failed: ' + (err.message || res.statusText));
        }
      } catch (err) {
        alert('Publish error: ' + err.message);
      }
    }

    async function rowUnpublishManualIpo(id, event) {
      if (event) event.stopPropagation();
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/unpublish', { method: 'POST' });
        if (res.ok) {
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Unpublish failed: ' + (err.message || res.statusText));
        }
      } catch (err) {
        alert('Unpublish error: ' + err.message);
      }
    }

    async function rowArchiveManualIpo(id, event) {
      if (event) event.stopPropagation();
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/archive', { method: 'POST' });
        if (res.ok) {
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Archive failed: ' + (err.message || res.statusText));
        }
      } catch (err) {
        alert('Archive error: ' + err.message);
      }
    }

    async function rowDeleteManualIpo(id, event) {
      if (event) event.stopPropagation();
      if (!confirm('Are you sure you want to permanently delete this IPO? This action cannot be undone.')) return;
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id, { method: 'DELETE' });
        if (res.ok) {
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Delete failed: ' + (err.message || res.statusText));
        }
      } catch (err) {
        alert('Delete error: ' + err.message);
      }
    }

    function renderTableRowActionIcons(id) {
      return \`
        <div class="table-action-group" onclick="event.stopPropagation()">
          <button type="button" class="table-action-btn" title="Publish" onclick="rowPublishManualIpo('\${id}', event)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9F4AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
              <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
              <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
            </svg>
          </button>
          <button type="button" class="table-action-btn" title="Unpublish" onclick="rowUnpublishManualIpo('\${id}', event)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0050E5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
              <line x1="1" y1="1" x2="23" y2="23"></line>
            </svg>
          </button>
          <button type="button" class="table-action-btn" title="Archive" onclick="rowArchiveManualIpo('\${id}', event)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FB9816" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="21 8 21 21 3 21 3 8"></polyline>
              <rect x="1" y="3" width="22" height="5" rx="1"></rect>
              <line x1="10" y1="12" x2="14" y2="12"></line>
            </svg>
          </button>
          <button type="button" class="table-action-btn" title="Delete" onclick="rowDeleteManualIpo('\${id}', event)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      \`;
    }

    // ==========================================
    // BULK OPERATIONS JAVASCRIPT HANDLERS
    // ==========================================

    function getSelectedManualIpoIds() {
      const checkboxes = document.querySelectorAll('.manual-ipo-checkbox:checked');
      return Array.from(checkboxes).map(cb => cb.value);
    }

    function toggleSelectAllManualIpos(checked) {
      const checkboxes = document.querySelectorAll('.manual-ipo-checkbox');
      checkboxes.forEach(cb => { cb.checked = checked; });
      updateBulkSelectionBar();
    }

    function clearManualIpoSelection() {
      const selectAll = document.getElementById('bulk-select-all');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      }
      const checkboxes = document.querySelectorAll('.manual-ipo-checkbox');
      checkboxes.forEach(cb => { cb.checked = false; });
      updateBulkSelectionBar();
    }

    function updateBulkSelectionBar() {
      const selected = getSelectedManualIpoIds();
      const bar = document.getElementById('manual-bulk-bar');
      const countBadge = document.getElementById('bulk-selected-count-badge');
      const selectAll = document.getElementById('bulk-select-all');
      const allCheckboxes = document.querySelectorAll('.manual-ipo-checkbox');

      if (selectAll && allCheckboxes.length > 0) {
        selectAll.checked = selected.length === allCheckboxes.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < allCheckboxes.length;
      }

      if (bar) {
        if (selected.length > 0) {
          bar.style.display = 'flex';
          if (countBadge) countBadge.textContent = selected.length + ' Selected';
        } else {
          bar.style.display = 'none';
        }
      }
    }

    async function onBulkStatusChange(status) {
      const select = document.getElementById('bulk-lifecycle-select');
      if (!status) return;
      const ids = getSelectedManualIpoIds();
      if (ids.length === 0) {
        alert('Please select at least one IPO.');
        if (select) select.value = '';
        return;
      }

      try {
        const res = await fetch(API_BASE + '/manual-ipos/bulk/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, status }),
        });
        const json = await res.json();
        if (res.ok) {
          showToast(json.message || \`Updated status for \${ids.length} IPO(s)\`, 'success');
          clearManualIpoSelection();
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          alert('Bulk status update failed: ' + (json.message || res.statusText));
        }
      } catch (err) {
        alert('Bulk status update error: ' + err.message);
      } finally {
        if (select) select.value = '';
      }
    }

    async function bulkPublishSelectedIpos() {
      const ids = getSelectedManualIpoIds();
      if (ids.length === 0) {
        alert('Please select at least one IPO.');
        return;
      }
      if (!confirm(\`Publish \${ids.length} selected IPO(s)?\`)) return;

      try {
        const res = await fetch(API_BASE + '/manual-ipos/bulk/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        if (res.ok) {
          showToast(json.message || \`Published \${ids.length} IPO(s)\`, 'success');
          clearManualIpoSelection();
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          alert('Bulk publish failed: ' + (json.message || res.statusText));
        }
      } catch (err) {
        alert('Bulk publish error: ' + err.message);
      }
    }

    async function bulkUnpublishSelectedIpos() {
      const ids = getSelectedManualIpoIds();
      if (ids.length === 0) {
        alert('Please select at least one IPO.');
        return;
      }
      if (!confirm(\`Unpublish \${ids.length} selected IPO(s) (revert to Draft)?\`)) return;

      try {
        const res = await fetch(API_BASE + '/manual-ipos/bulk/unpublish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        if (res.ok) {
          showToast(json.message || \`Unpublished \${ids.length} IPO(s)\`, 'success');
          clearManualIpoSelection();
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          alert('Bulk unpublish failed: ' + (json.message || res.statusText));
        }
      } catch (err) {
        alert('Bulk unpublish error: ' + err.message);
      }
    }

    async function bulkArchiveSelectedIpos() {
      const ids = getSelectedManualIpoIds();
      if (ids.length === 0) {
        alert('Please select at least one IPO.');
        return;
      }
      if (!confirm(\`Archive \${ids.length} selected IPO(s)?\`)) return;

      try {
        const res = await fetch(API_BASE + '/manual-ipos/bulk/archive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        if (res.ok) {
          showToast(json.message || \`Archived \${ids.length} IPO(s)\`, 'success');
          clearManualIpoSelection();
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          alert('Bulk archive failed: ' + (json.message || res.statusText));
        }
      } catch (err) {
        alert('Bulk archive error: ' + err.message);
      }
    }

    async function bulkDeleteSelectedIpos() {
      const ids = getSelectedManualIpoIds();
      if (ids.length === 0) {
        alert('Please select at least one IPO.');
        return;
      }
      if (!confirm(\`⚠️ PERMANENT DELETE\\n\\nAre you sure you want to permanently delete \${ids.length} selected IPO(s)? This action CANNOT be undone.\`)) return;

      try {
        const res = await fetch(API_BASE + '/manual-ipos/bulk/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json();
        if (res.ok) {
          showToast(json.message || \`Deleted \${ids.length} IPO(s)\`, 'success');
          clearManualIpoSelection();
          fetchManualIpos();
          fetchRecentDashboardIpos();
        } else {
          alert('Bulk delete failed: ' + (json.message || res.statusText));
        }
      } catch (err) {
        alert('Bulk delete error: ' + err.message);
      }
    }

    function showToast(message, type = 'success') {
      let container = document.getElementById('console-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'console-toast-container';
        container.style.position = 'fixed';
        container.style.bottom = '24px';
        container.style.right = '24px';
        container.style.zIndex = '999999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '8px';
        container.style.pointerEvents = 'none';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.style.padding = '10px 16px';
      toast.style.borderRadius = '8px';
      toast.style.fontSize = '13px';
      toast.style.fontWeight = '600';
      toast.style.boxShadow = '0 4px 14px rgba(0,0,0,0.18)';
      toast.style.transition = 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      toast.style.pointerEvents = 'auto';

      if (type === 'success') {
        toast.style.backgroundColor = '#10B981';
        toast.style.color = '#FFFFFF';
      } else if (type === 'error') {
        toast.style.backgroundColor = '#EF4444';
        toast.style.color = '#FFFFFF';
      } else {
        toast.style.backgroundColor = '#1E293B';
        toast.style.color = '#FFFFFF';
      }

      toast.textContent = message;
      container.appendChild(toast);

      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(() => toast.remove(), 300);
      }, 2500);
    }

    function renderStatusSelect(id, currentStatus) {
      const norm = (currentStatus || 'DRAFT').toUpperCase();
      let statusPillClass = norm.toLowerCase();
      if (norm === 'ALLOTMENT_COMPLETED' || norm === 'ALLOTMENT_OUT') statusPillClass = 'allotment-completed';
      else if (norm === 'CLOSING_TODAY') statusPillClass = 'closing-today';

      return \`
        <select class="status-pill-select \${statusPillClass}" 
                data-prev-status="\${norm}" 
                onclick="event.stopPropagation()" 
                onchange="updateRowLifecycleStatus('\${id}', this.value, this, event)"
                title="Change lifecycle status">
          <option value="OPEN" \${norm === 'OPEN' ? 'selected' : ''}>Live Now</option>
          <option value="CLOSING_TODAY" \${norm === 'CLOSING_TODAY' ? 'selected' : ''}>Closing Today</option>
          <option value="UPCOMING" \${norm === 'UPCOMING' ? 'selected' : ''}>Upcoming</option>
          <option value="CLOSED" \${norm === 'CLOSED' ? 'selected' : ''}>Closed</option>
          <option value="ALLOTMENT_COMPLETED" \${(norm === 'ALLOTMENT_COMPLETED' || norm === 'ALLOTMENT_OUT') ? 'selected' : ''}>Allotment Out</option>
          <option value="LISTED" \${norm === 'LISTED' ? 'selected' : ''}>Listed</option>
          <option value="DRAFT" \${norm === 'DRAFT' ? 'selected' : ''}>Draft</option>
        </select>
      \`;
    }

    async function updateRowLifecycleStatus(id, newStatus, selectEl, event) {
      if (event) event.stopPropagation();
      if (!id || !newStatus) return;

      const prevStatus = selectEl.getAttribute('data-prev-status') || selectEl.value;
      selectEl.classList.add('saving');

      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || 'HTTP ' + res.status);
        }

        selectEl.setAttribute('data-prev-status', newStatus);
        const norm = newStatus.toUpperCase();
        let statusPillClass = norm.toLowerCase();
        if (norm === 'ALLOTMENT_COMPLETED' || norm === 'ALLOTMENT_OUT') {
          statusPillClass = 'allotment-completed';
        } else if (norm === 'CLOSING_TODAY') {
          statusPillClass = 'closing-today';
        }
        selectEl.className = 'status-pill-select ' + statusPillClass;

        const label = norm === 'ALLOTMENT_COMPLETED' ? 'Allotment Out' : norm === 'CLOSING_TODAY' ? 'Closing Today' : norm === 'OPEN' ? 'Live Now' : norm;
        showToast('Status updated to ' + label, 'success');

        if (typeof fetchKpis === 'function') fetchKpis();
      } catch (err) {
        console.error('Failed to update status:', err);
        alert('Failed to update status: ' + (err.message || err));
        selectEl.value = prevStatus;
        const prevNorm = prevStatus.toUpperCase();
        let prevClass = prevNorm.toLowerCase();
        if (prevNorm === 'ALLOTMENT_COMPLETED' || prevNorm === 'ALLOTMENT_OUT') prevClass = 'allotment-completed';
        else if (prevNorm === 'CLOSING_TODAY') prevClass = 'closing-today';
        selectEl.className = 'status-pill-select ' + prevClass;
      } finally {
        selectEl.classList.remove('saving');
      }
    }

    async function fetchRecentDashboardIpos() {
      try {
        const res = await fetch(API_BASE + '/manual-ipos?limit=10');
        const json = await res.json();
        const items = json.data?.items || json.items || [];
        const tbody = document.getElementById('dashboard-recent-table-body');
        if (!tbody) return;

        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color:var(--text-muted);">No recent IPO records found.</td></tr>';
          return;
        }

        tbody.innerHTML = items.map(item => {
          return \`
            <tr class="clickable-row" onclick="editManualIpo('\${item.id}')" title="Click to view/edit details">
              <td><strong>\${item.legalName || 'N/A'}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${item.symbol || 'No Symbol'}</span></td>
              <td>\${item.marketSegment || 'MAINBOARD'}</td>
              <td onclick="event.stopPropagation()">\${renderStatusSelect(item.id, item.status)}</td>
              <td><span class="status-pill \${item.publicationStatus === 'PUBLISHED' ? 'published' : 'upcoming'}">\${item.publicationStatus || 'DRAFT'}</span></td>
              <td>₹\${item.priceBandLow || 0} - ₹\${item.priceBandHigh || 0}</td>
              <td style="font-size:12px;">\${item.openDate || 'TBD'} to \${item.closeDate || 'TBD'}</td>
              <td onclick="event.stopPropagation()" style="text-align:center;">
                \${renderTableRowActionIcons(item.id)}
              </td>
            </tr>
          \`;
        }).join('');
      } catch (err) {
        console.error('Dashboard recent fetch error:', err);
        const tbody = document.getElementById('dashboard-recent-table-body');
        if (tbody) {
          tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 24px; color:red;">Failed to load recent IPO records.</td></tr>';
        }
      }
    }

    let currentStatusFilter = 'OPEN';
    let currentManualSort = 'smart';
    let currentManualOrder = 'desc';

    function onManualSortChange() {
      const select = document.getElementById('man-sort-by');
      if (select) {
        currentManualSort = select.value;
        if (currentManualSort === 'companyName' || currentManualSort === 'openDate' || currentManualSort === 'closeDate') {
          currentManualOrder = 'asc';
        } else {
          currentManualOrder = 'desc';
        }
        updateSortOrderButtonUI();
        fetchManualIpos();
      }
    }

    function toggleManualSortOrder() {
      currentManualOrder = currentManualOrder === 'asc' ? 'desc' : 'asc';
      updateSortOrderButtonUI();
      fetchManualIpos();
    }

    function updateSortOrderButtonUI() {
      const icon = document.getElementById('sort-order-icon');
      const text = document.getElementById('sort-order-text');
      if (icon) icon.textContent = currentManualOrder === 'asc' ? '↑' : '↓';
      if (text) text.textContent = currentManualOrder === 'asc' ? 'Asc' : 'Desc';
    }

    function updateManualTabCounts(counts) {
      if (!counts) return;
      const st = counts.statuses || {};
      const pb = counts.publication || {};

      const setBadge = (id, cnt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = cnt !== undefined && cnt !== null ? cnt : '0';
      };

      setBadge('count-pill-OPEN', st.OPEN || 0);
      setBadge('count-pill-UPCOMING', st.UPCOMING || 0);
      setBadge('count-pill-CLOSED', st.CLOSED || 0);
      setBadge('count-pill-ALLOTMENT_COMPLETED', st.ALLOTMENT_COMPLETED || 0);
      setBadge('count-pill-LISTED', st.LISTED || 0);
      setBadge('count-pill-ALL', st.ALL || 0);

      const navBadge = document.getElementById('nav-manual-count');
      if (navBadge) {
        navBadge.textContent = st.ALL || 0;
      }

      // Update dashboard KPI stats
      const kpiTotal = document.getElementById('kpi-total');
      if (kpiTotal) kpiTotal.textContent = st.ALL || 0;
      const kpiPub = document.getElementById('kpi-published');
      if (kpiPub) kpiPub.textContent = pb.PUBLISHED || 0;
      const kpiOpen = document.getElementById('kpi-open');
      if (kpiOpen) kpiOpen.textContent = st.OPEN || 0;
      const kpiDrafts = document.getElementById('kpi-drafts');
      if (kpiDrafts) kpiDrafts.textContent = pb.DRAFT || 0;

      // Update publication filter options
      const pubSelect = document.getElementById('man-filter-pub');
      if (pubSelect && pubSelect.options) {
        if (pubSelect.options[0]) pubSelect.options[0].text = 'All Publication States (' + (pb.ALL || 0) + ')';
        if (pubSelect.options[1]) pubSelect.options[1].text = 'Published (' + (pb.PUBLISHED || 0) + ')';
        if (pubSelect.options[2]) pubSelect.options[2].text = 'Draft (' + (pb.DRAFT || 0) + ')';
        if (pubSelect.options[3]) pubSelect.options[3].text = 'Archived (' + (pb.ARCHIVED || 0) + ')';
      }
    }

    function setStatusFilter(filterKey) {
      currentStatusFilter = filterKey;
      ['OPEN', 'UPCOMING', 'CLOSED', 'ALLOTMENT_COMPLETED', 'LISTED', 'ALL'].forEach(k => {
        const btn = document.getElementById('pill-filter-' + k);
        if (btn) {
          if (k === filterKey) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      });
      const selectEl = document.getElementById('man-filter-status');
      if (selectEl) selectEl.value = filterKey;
      fetchManualIpos();
    }

    function onStatusSelectChange(val) {
      setStatusFilter(val || 'ALL');
    }

    async function fetchManualIpos() {
      try {
        const q = document.getElementById('man-search-q').value;
        const pub = document.getElementById('man-filter-pub').value;
        const filterKey = currentStatusFilter;

        let statusParam = '';
        if (filterKey === 'OPEN') {
          statusParam = 'DRAFT,OPEN,CLOSING_TODAY';
        } else if (filterKey === 'CLOSED') {
          statusParam = 'CLOSED';
        } else if (filterKey === 'ALLOTMENT_COMPLETED' || filterKey === 'ALLOTMENT_OUT') {
          statusParam = 'ALLOTMENT_COMPLETED';
        } else if (filterKey === 'UPCOMING') {
          statusParam = 'UPCOMING';
        } else if (filterKey === 'LISTED') {
          statusParam = 'LISTED';
        } else if (filterKey && filterKey !== 'ALL') {
          statusParam = filterKey;
        }

        const query = new URLSearchParams({ page: 1, limit: 100 });
        if (q) query.set('q', q);
        if (pub) query.set('publicationStatus', pub);
        if (statusParam) query.set('status', statusParam);
        if (currentManualSort) query.set('sort', currentManualSort);
        if (currentManualOrder) query.set('order', currentManualOrder);

        const res = await fetch(API_BASE + '/manual-ipos?' + query.toString());
        const json = await res.json();
        const dataObj = json.data || json;
        const items = dataObj.items || [];
        const counts = dataObj.counts || json.counts;

        if (counts) {
          updateManualTabCounts(counts);
        }

        const tbody = document.getElementById('manual-ipos-table-body');
        
        if (items.length === 0) {
          tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px; color:var(--text-muted);">No Manual IPOs found matching filter.</td></tr>';
          updateBulkSelectionBar();
          return;
        }

        tbody.innerHTML = items.map(item => {
          return \`
            <tr class="clickable-row" onclick="editManualIpo('\${item.id}')" title="Click to view/edit details">
              <td onclick="event.stopPropagation()" style="text-align:center;">
                <input type="checkbox" class="manual-ipo-checkbox" value="\${item.id}" onchange="updateBulkSelectionBar()" style="cursor:pointer; width:16px; height:16px;" />
              </td>
              <td><strong>\${item.legalName || 'N/A'}</strong><br/><span style="font-size:11px; color:var(--text-muted)">\${item.symbol || 'No Symbol'}</span></td>
              <td>\${item.marketSegment || 'MAINBOARD'}</td>
              <td onclick="event.stopPropagation()">\${renderStatusSelect(item.id, item.status)}</td>
              <td><span class="status-pill \${item.publicationStatus === 'PUBLISHED' ? 'published' : 'upcoming'}">\${item.publicationStatus || 'DRAFT'}</span></td>
              <td>₹\${item.priceBandLow || 0} - ₹\${item.priceBandHigh || 0}</td>
              <td style="font-size:12px;">\${item.openDate || 'TBD'} to \${item.closeDate || 'TBD'}</td>
              <td onclick="event.stopPropagation()" style="text-align:center;">
                \${renderTableRowActionIcons(item.id)}
              </td>
            </tr>
          \`;
        }).join('');
        updateBulkSelectionBar();
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

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/"/g, '&quot;');
    }

    function addAnchorInvestorRow(anchorName = '', sharesAllotted = '', amtCr = '', pctAllocated = '', pctOfIssue = '') {
      const tbody = document.getElementById('anchor-investors-tbody');
      if (!tbody) return;

      const noRow = document.getElementById('no-anchor-row');
      if (noRow) noRow.style.display = 'none';

      const rowCount = tbody.querySelectorAll('.anchor-row').length + 1;
      const tr = document.createElement('tr');
      tr.className = 'anchor-row';
      tr.innerHTML = \`
        <td style="text-align:center; font-weight:600; font-size:12px;" class="anchor-idx">\${rowCount}</td>
        <td>
          <input type="text" class="anchor-input-name" value="\${escapeHtml(anchorName)}" placeholder="e.g. KOTAK SPECIAL OPPORTUNITIES FUND" style="width:100%; padding:6px 10px; font-size:12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main);" />
        </td>
        <td>
          <input type="number" class="anchor-input-shares" value="\${sharesAllotted ?? ''}" placeholder="e.g. 117898" oninput="calculateAnchorTotals()" style="width:100%; padding:6px 10px; font-size:12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); text-align:right;" />
        </td>
        <td>
          <input type="number" step="0.01" class="anchor-input-amt" value="\${amtCr ?? ''}" placeholder="e.g. 7.97" oninput="calculateAnchorTotals()" style="width:100%; padding:6px 10px; font-size:12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); text-align:right;" />
        </td>
        <td>
          <input type="number" step="0.01" class="anchor-input-pct-allocated" value="\${pctAllocated ?? ''}" placeholder="e.g. 11.04" oninput="calculateAnchorTotals()" style="width:100%; padding:6px 10px; font-size:12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); text-align:right;" />
        </td>
        <td>
          <input type="number" step="0.01" class="anchor-input-pct-issue" value="\${pctOfIssue ?? ''}" placeholder="e.g. 4.97" oninput="calculateAnchorTotals()" style="width:100%; padding:6px 10px; font-size:12px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); text-align:right;" />
        </td>
        <td style="text-align:center;">
          <button type="button" class="btn-danger" onclick="removeAnchorInvestorRow(this)" style="padding:3px 8px; font-size:11px;">Delete</button>
        </td>
      \`;
      tbody.appendChild(tr);
      reindexAnchorRows();
    }

    function removeAnchorInvestorRow(btn) {
      const tr = btn.closest('tr');
      if (tr) tr.remove();
      reindexAnchorRows();
    }

    function calculateAnchorTotals() {
      const rows = document.querySelectorAll('#anchor-investors-tbody .anchor-row');
      let totalShares = 0;
      let totalAmt = 0;
      let totalPctAllocated = 0;
      let totalPctIssue = 0;

      rows.forEach(row => {
        const shares = parseInt(row.querySelector('.anchor-input-shares')?.value, 10);
        const amt = parseFloat(row.querySelector('.anchor-input-amt')?.value);
        const pctAlloc = parseFloat(row.querySelector('.anchor-input-pct-allocated')?.value);
        const pctIssue = parseFloat(row.querySelector('.anchor-input-pct-issue')?.value);

        if (!isNaN(shares)) totalShares += shares;
        if (!isNaN(amt)) totalAmt += amt;
        if (!isNaN(pctAlloc)) totalPctAllocated += pctAlloc;
        if (!isNaN(pctIssue)) totalPctIssue += pctIssue;
      });

      const elShares = document.getElementById('anchor-total-shares');
      const elAmt = document.getElementById('anchor-total-amt');
      const elPctAlloc = document.getElementById('anchor-total-pct-allocated');
      const elPctIssue = document.getElementById('anchor-total-pct-issue');

      if (elShares) elShares.textContent = totalShares ? totalShares.toLocaleString('en-IN') : '0';
      if (elAmt) elAmt.textContent = '₹' + totalAmt.toFixed(2);
      if (elPctAlloc) elPctAlloc.textContent = totalPctAllocated.toFixed(2) + '%';
      if (elPctIssue) elPctIssue.textContent = totalPctIssue.toFixed(2) + '%';
    }

    function toggleAnchorAccordion() {
      const body = document.getElementById('anchor-accordion-body');
      const icon = document.getElementById('anchor-accordion-icon');
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (icon) icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
    }

    function openAnchorAccordion() {
      const body = document.getElementById('anchor-accordion-body');
      const icon = document.getElementById('anchor-accordion-icon');
      if (body) body.style.display = 'block';
      if (icon) icon.style.transform = 'rotate(0deg)';
    }

    function reindexAnchorRows() {
      const tbody = document.getElementById('anchor-investors-tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('.anchor-row');
      const noRow = document.getElementById('no-anchor-row');

      if (rows.length === 0) {
        if (noRow) noRow.style.display = 'table-row';
      } else {
        if (noRow) noRow.style.display = 'none';
        rows.forEach((row, idx) => {
          const idxCell = row.querySelector('.anchor-idx');
          if (idxCell) idxCell.textContent = idx + 1;
        });
      }
      const badge = document.getElementById('anchor-count-badge');
      if (badge) badge.textContent = rows.length + (rows.length === 1 ? ' investor' : ' investors');
      calculateAnchorTotals();
    }

    function getAnchorInvestorsFromForm() {
      const rows = document.querySelectorAll('#anchor-investors-tbody .anchor-row');
      const list = [];
      rows.forEach(row => {
        const nameVal = row.querySelector('.anchor-input-name')?.value?.trim();
        const sharesVal = parseInt(row.querySelector('.anchor-input-shares')?.value, 10);
        const amtVal = parseFloat(row.querySelector('.anchor-input-amt')?.value);
        const pctAllocVal = parseFloat(row.querySelector('.anchor-input-pct-allocated')?.value);
        const pctIssueVal = parseFloat(row.querySelector('.anchor-input-pct-issue')?.value);
        if (nameVal) {
          list.push({
            anchorName: nameVal,
            sharesAllotted: !isNaN(sharesVal) ? sharesVal : undefined,
            amtCr: !isNaN(amtVal) ? amtVal : undefined,
            pctAllocated: !isNaN(pctAllocVal) ? pctAllocVal : undefined,
            pctOfIssue: !isNaN(pctIssueVal) ? pctIssueVal : undefined,
          });
        }
      });
      return list;
    }

    function triggerAnchorCsvUpload() {
      const input = document.getElementById('anchor-csv-file-input');
      if (input) input.click();
    }

    function handleAnchorCsvFileSelect(evt) {
      const file = evt.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          parseAndAppendAnchorCsv(text);
          evt.target.value = '';
        } catch (err) {
          alert('Failed to parse CSV file: ' + err.message);
        }
      };
      reader.readAsText(file);
    }

    function parseCsvLine(text) {
      const result = [];
      let cell = '';
      let inQuotes = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === ',' && !inQuotes) {
          result.push(cell.trim());
          cell = '';
        } else {
          cell += c;
        }
      }
      result.push(cell.trim());
      return result;
    }

    function parseAndAppendAnchorCsv(csvText) {
      const rawLines = csvText.split(new RegExp('\\r?\\n')).filter(line => line.trim().length > 0);
      if (rawLines.length === 0) return;

      const headers = parseCsvLine(rawLines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9%]/g, ''));
      
      let nameIdx = headers.findIndex(h => h.includes('anchor') || h.includes('investor') || h.includes('name'));
      let sharesIdx = headers.findIndex(h => h.includes('share'));
      let amtIdx = headers.findIndex(h => h.includes('amt') || h.includes('amount') || h.includes('cr'));
      let pctAllocIdx = headers.findIndex(h => h.includes('alloc'));
      let pctIssueIdx = headers.findIndex(h => h.includes('issue'));

      if (nameIdx === -1 && headers.length > 0) nameIdx = 0;
      if (sharesIdx === -1 && headers.length > 1) sharesIdx = 1;
      if (amtIdx === -1 && headers.length > 2) amtIdx = 2;
      if (pctAllocIdx === -1 && headers.length > 3) pctAllocIdx = 3;
      if (pctIssueIdx === -1 && headers.length > 4) pctIssueIdx = 4;

      let addedCount = 0;
      for (let i = 1; i < rawLines.length; i++) {
        const cols = parseCsvLine(rawLines[i]);
        if (cols.length === 0 || !cols[nameIdx]) continue;

        const anchorName = cols[nameIdx].replace(/^["']|["']$/g, '').trim();
        if (!anchorName || anchorName.toLowerCase() === 'total' || anchorName.toLowerCase() === 'total:') continue;

        const parseCleanNum = (val) => {
          if (!val) return '';
          const cleaned = String(val).replace(/[^0-9.-]/g, '');
          return cleaned !== '' ? cleaned : '';
        };

        const sharesAllotted = sharesIdx !== -1 && cols[sharesIdx] ? parseCleanNum(cols[sharesIdx]) : '';
        const amtCr = amtIdx !== -1 && cols[amtIdx] ? parseCleanNum(cols[amtIdx]) : '';
        const pctAllocated = pctAllocIdx !== -1 && cols[pctAllocIdx] ? parseCleanNum(cols[pctAllocIdx]) : '';
        const pctOfIssue = pctIssueIdx !== -1 && cols[pctIssueIdx] ? parseCleanNum(cols[pctIssueIdx]) : '';

        addAnchorInvestorRow(anchorName, sharesAllotted, amtCr, pctAllocated, pctOfIssue);
        addedCount++;
      }

      if (addedCount > 0) {
        calculateAnchorTotals();
        alert('Successfully imported ' + addedCount + ' anchor investor(s) from CSV!');
      } else {
        alert('No valid anchor investor rows found in CSV file.');
      }
    }

    function getDocTypeTitle(type) {
      const titles = {
        'DRHP': 'DRHP Document',
        'RHP': 'RHP Document',
        'PROSPECTUS': 'Prospectus Document',
        'ANCHOR_LIST': 'Anchor List Document',
        'BASIS_OF_ALLOTMENT': 'Basis of Allotment Document',
        'OTHER': 'Other Document',
      };
      return titles[type] || (type ? type + ' Document' : 'Document');
    }

    function onDocTypeChange(selectEl) {
      const row = selectEl.closest('.doc-row');
      if (!row) return;
      const titleInput = row.querySelector('.doc-title-input');
      if (titleInput) {
        titleInput.value = getDocTypeTitle(selectEl.value);
      }
    }

    function addDocumentRow(docType = 'DRHP', title = '', sourceUrl = '', id = '') {
      const tbody = document.getElementById('documents-tbody');
      if (!tbody) return;
      const noRow = document.getElementById('no-documents-row');
      if (noRow) noRow.style.display = 'none';

      const row = document.createElement('tr');
      row.className = 'doc-row';
      if (id) row.setAttribute('data-id', String(id));

      const escAttr = (val) => String(val || '').replace(/"/g, '&quot;');

      const docTypes = [
        { value: 'DRHP', label: 'DRHP' },
        { value: 'RHP', label: 'RHP' },
        { value: 'PROSPECTUS', label: 'Prospectus' },
        { value: 'ANCHOR_LIST', label: 'Anchor Allocation' },
        { value: 'BASIS_OF_ALLOTMENT', label: 'Basis of Allotment' },
        { value: 'OTHER', label: 'Other' },
      ];

      const selType = String(docType || 'DRHP').toUpperCase();
      const typeOptionsHtml = docTypes.map(function(t) {
        return '<option value="' + t.value + '" ' + (selType === t.value ? 'selected' : '') + '>' + t.label + '</option>';
      }).join('');

      const resolvedTitle = title ? title : getDocTypeTitle(selType);

      row.innerHTML =
        '<td class="doc-row-index" style="text-align:center; font-weight:600; font-size:12px; color:var(--text-muted);">1</td>' +
        '<td><select class="doc-type-select" onchange="onDocTypeChange(this)" style="padding:6px 8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:12px; width:100%;">' +
        typeOptionsHtml +
        '</select></td>' +
        '<td><input type="text" class="doc-title-input" value="' + escAttr(resolvedTitle) + '" placeholder="e.g. RHP Document" style="padding:6px 8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:12px; width:100%;" /></td>' +
        '<td><input type="url" class="doc-url-input" value="' + escAttr(sourceUrl) + '" placeholder="https://..." style="padding:6px 8px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-main); font-size:12px; width:100%;" /></td>' +
        '<td style="text-align:center;"><button type="button" onclick="removeDocumentRow(this)" style="background:none; border:none; color:var(--danger); cursor:pointer; padding:4px;" title="Remove Document">✕</button></td>';

      tbody.appendChild(row);
      reindexDocumentRows();
    }

    function removeDocumentRow(btn) {
      const row = btn.closest('.doc-row');
      if (row) row.remove();
      reindexDocumentRows();
    }

    function reindexDocumentRows() {
      const tbody = document.getElementById('documents-tbody');
      if (!tbody) return;
      const rows = tbody.querySelectorAll('.doc-row');
      const noRow = document.getElementById('no-documents-row');
      if (rows.length === 0) {
        if (noRow) noRow.style.display = '';
      } else {
        if (noRow) noRow.style.display = 'none';
        rows.forEach((row, idx) => {
          const idxEl = row.querySelector('.doc-row-index');
          if (idxEl) idxEl.textContent = String(idx + 1);
        });
      }
    }

    function getFinancialsFromForm() {
      const periodEl = document.getElementById('fin-period');
      const roeEl = document.getElementById('fin-roe-pct');
      const patMarginEl = document.getElementById('fin-pat-margin-pct');
      const ebitdaMarginEl = document.getElementById('fin-ebitda-margin-pct');
      const epsEl = document.getElementById('fin-eps');
      const roceEl = document.getElementById('fin-roce-pct');
      const assetsEl = document.getElementById('fin-assets');
      const revenueEl = document.getElementById('fin-revenue');
      const patEl = document.getElementById('fin-pat');
      const ebitdaEl = document.getElementById('fin-ebitda');
      const netWorthEl = document.getElementById('fin-networth');

      if (!periodEl || !roeEl) return undefined;

      const period = periodEl.value.trim();
      const roe = parseFloat(roeEl.value);
      const patMargin = parseFloat(patMarginEl.value);
      const ebitdaMargin = parseFloat(ebitdaMarginEl.value);
      const eps = parseFloat(epsEl.value);
      const roce = parseFloat(roceEl.value);
      const assets = parseFloat(assetsEl.value);
      const revenue = parseFloat(revenueEl.value);
      const pat = parseFloat(patEl.value);
      const ebitda = parseFloat(ebitdaEl.value);
      const netWorth = parseFloat(netWorthEl.value);

      const hasAnyValue = [roe, patMargin, ebitdaMargin, eps, roce, assets, revenue, pat, ebitda, netWorth].some(v => !isNaN(v));
      if (!hasAnyValue && !period) return undefined;

      return [{
        fiscalPeriod: period || 'FY24',
        periodType: 'ANNUAL',
        roePercentage: !isNaN(roe) ? roe : undefined,
        patMarginPercent: !isNaN(patMargin) ? patMargin : undefined,
        ebitdaMarginPercent: !isNaN(ebitdaMargin) ? ebitdaMargin : undefined,
        eps: !isNaN(eps) ? eps : undefined,
        rocePercentage: !isNaN(roce) ? roce : undefined,
        totalAssets: !isNaN(assets) ? assets : undefined,
        totalRevenue: !isNaN(revenue) ? revenue : undefined,
        pat: !isNaN(pat) ? pat : undefined,
        ebitda: !isNaN(ebitda) ? ebitda : undefined,
        netWorth: !isNaN(netWorth) ? netWorth : undefined,
      }];
    }

    function getDocumentsFromForm() {
      const tbody = document.getElementById('documents-tbody');
      if (!tbody) return [];
      const rows = tbody.querySelectorAll('.doc-row');
      const docs = [];
      rows.forEach(r => {
        const docId = r.getAttribute('data-id') || undefined;
        const typeSelect = r.querySelector('.doc-type-select');
        const titleInput = r.querySelector('.doc-title-input');
        const urlInput = r.querySelector('.doc-url-input');
        const documentType = typeSelect ? typeSelect.value : 'OTHER';
        const fileName = titleInput ? titleInput.value.trim() : '';
        const sourceUrl = urlInput ? urlInput.value.trim() : '';
        if (sourceUrl || documentType === 'ANCHOR_LIST') {
          docs.push({
            id: docId,
            documentType,
            fileName: fileName || undefined,
            title: fileName || undefined,
            sourceUrl: sourceUrl || undefined,
            url: sourceUrl || undefined
          });
        }
      });
      return docs;
    }

    function renderDocumentsTable(ipoData) {
      const tbody = document.getElementById('documents-tbody');
      if (tbody) {
        tbody.querySelectorAll('.doc-row').forEach(r => r.remove());
      }
      let loadedAny = false;
      if (ipoData && Array.isArray(ipoData.documents) && ipoData.documents.length > 0) {
        ipoData.documents.forEach(d => {
          const url = d.sourceUrl || d.documentUrl || d.url;
          if (url || d.title || d.documentType) {
            const title = d.title || getDocTypeTitle(d.documentType);
            addDocumentRow(d.documentType || 'OTHER', title, url ? String(url).trim() : '', d.id || '');
            loadedAny = true;
          }
        });
      }
      if (!loadedAny && ipoData) {
        if (ipoData.drhpUrl && String(ipoData.drhpUrl).trim()) {
          addDocumentRow('DRHP', 'DRHP Document', String(ipoData.drhpUrl).trim());
          loadedAny = true;
        }
        if (ipoData.rhpUrl && String(ipoData.rhpUrl).trim()) {
          addDocumentRow('RHP', 'RHP Document', String(ipoData.rhpUrl).trim());
          loadedAny = true;
        }
        if (ipoData.prospectusUrl && String(ipoData.prospectusUrl).trim()) {
          addDocumentRow('PROSPECTUS', 'Prospectus Document', String(ipoData.prospectusUrl).trim());
          loadedAny = true;
        }
        if (ipoData.anchorListUrl && String(ipoData.anchorListUrl).trim()) {
          addDocumentRow('ANCHOR_LIST', 'Anchor List Document', String(ipoData.anchorListUrl).trim());
          loadedAny = true;
        }
      }
      reindexDocumentRows();
    }

    function updateAllotmentWarning() {
      const codeVal = document.getElementById('allot-registrar-ipo-code')?.value?.trim();
      const enabledChecked = document.getElementById('allot-enabled')?.checked ?? true;
      const registrarCodeVal = document.getElementById('allot-registrar-code')?.value?.trim();
      const banner = document.getElementById('allotment-warning-banner');

      if (banner) {
        if (enabledChecked && registrarCodeVal && !codeVal) {
          banner.style.display = 'block';
        } else {
          banner.style.display = 'none';
        }
      }
    }

    function openCreateModal() {
      currentIpoData = null;
      document.getElementById('manual-ipo-form').reset();
      document.getElementById('form-ipo-id').value = '';
      document.getElementById('form-freshIssueSize').value = '';
      document.getElementById('form-ofsSize').value = '';
      document.getElementById('form-preIpoEps').value = '';
      document.getElementById('form-postIpoEps').value = '';
      document.getElementById('form-preIpoPe').value = '';
      document.getElementById('form-postIpoPe').value = '';
      document.getElementById('form-preIpoPromoterHolding').value = '';
      document.getElementById('form-postIpoPromoterHolding').value = '';
      document.getElementById('form-preIpoMarketCap').value = '';
      document.getElementById('form-postIpoMarketCap').value = '';
      document.getElementById('allot-registrar-code').value = '';
      document.getElementById('allot-registrar-ipo-code').value = '';
      const allotEnabledEl = document.getElementById('allot-enabled');
      if (allotEnabledEl) allotEnabledEl.checked = true;
      updateAllotmentWarning();
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
      document.getElementById('gmp-amount').value = '';
      document.getElementById('gmp-percentage').value = '';
      document.getElementById('gmp-est-profit').value = '';
      document.getElementById('sub-qib').value = '';
      document.getElementById('sub-nii').value = '';
      document.getElementById('sub-retail').value = '';
      document.getElementById('sub-total').value = '';
      document.getElementById('fin-period').value = '';
      document.getElementById('fin-roe-pct').value = '';
      document.getElementById('fin-pat-margin-pct').value = '';
      document.getElementById('fin-ebitda-margin-pct').value = '';
      document.getElementById('fin-eps').value = '';
      document.getElementById('fin-roce-pct').value = '';
      document.getElementById('fin-assets').value = '';
      document.getElementById('fin-revenue').value = '';
      document.getElementById('fin-pat').value = '';
      document.getElementById('fin-ebitda').value = '';
      document.getElementById('fin-networth').value = '';
      const tbody = document.getElementById('anchor-investors-tbody');
      if (tbody) {
        tbody.querySelectorAll('.anchor-row').forEach(r => r.remove());
      }
      reindexAnchorRows();
      renderDocumentsTable(null);
      updateFormStatusSections();
      switchTab('manual-edit');
    }

    async function editManualIpo(id) {
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id);
        const json = await res.json();
        currentIpoData = json.data || json;
        
        document.getElementById('form-ipo-id').value = currentIpoData.id;
        document.getElementById('form-legalName').value = currentIpoData.legalName || currentIpoData.company?.legalName || '';
        document.getElementById('form-displayName').value = currentIpoData.displayName || currentIpoData.company?.displayName || '';
        document.getElementById('form-cin').value = currentIpoData.cin || currentIpoData.company?.cin || '';
        document.getElementById('form-symbol').value = currentIpoData.symbol || '';
        document.getElementById('form-marketSegment').value = currentIpoData.marketSegment || 'MAINBOARD';
        document.getElementById('form-exchange').value = currentIpoData.exchange || 'NSE';
        document.getElementById('form-status').value = currentIpoData.status || 'DRAFT';
        document.getElementById('form-publicationStatus').value = currentIpoData.publicationStatus || 'DRAFT';
        document.getElementById('form-priceBandLow').value = currentIpoData.priceBandLow || '';
        document.getElementById('form-priceBandHigh').value = currentIpoData.priceBandHigh || '';
        document.getElementById('form-lotSize').value = currentIpoData.lotSize || '';
        document.getElementById('form-issueSize').value = currentIpoData.issueSize || '';
        document.getElementById('form-freshIssueSize').value = currentIpoData.freshIssueSize ?? '';
        document.getElementById('form-ofsSize').value = currentIpoData.ofsSize ?? '';
        document.getElementById('form-openDate').value = currentIpoData.openDate ? currentIpoData.openDate.split('T')[0] : '';
        document.getElementById('form-closeDate').value = currentIpoData.closeDate ? currentIpoData.closeDate.split('T')[0] : '';
        document.getElementById('form-allotmentDate').value = currentIpoData.allotmentDate ? currentIpoData.allotmentDate.split('T')[0] : '';
        document.getElementById('form-refundDate').value = currentIpoData.refundDate ? currentIpoData.refundDate.split('T')[0] : '';
        document.getElementById('form-listingDate').value = currentIpoData.listingDate ? currentIpoData.listingDate.split('T')[0] : '';
        document.getElementById('form-logoUrl').value = currentIpoData.logoUrl || currentIpoData.company?.logoUrl || '';
        document.getElementById('form-listingPrice').value = currentIpoData.listingPrice ?? '';
        document.getElementById('form-listingGainPct').value = currentIpoData.listingGainPct ?? '';
        document.getElementById('form-profitAmount').value = currentIpoData.profitAmount ?? '';
        document.getElementById('form-profitPercentage').value = currentIpoData.profitPercentage ?? '';
        document.getElementById('form-preIpoEps').value = currentIpoData.preIpoEps ?? '';
        document.getElementById('form-postIpoEps').value = currentIpoData.postIpoEps ?? '';
        document.getElementById('form-preIpoPe').value = currentIpoData.preIpoPe ?? '';
        document.getElementById('form-postIpoPe').value = currentIpoData.postIpoPe ?? '';
        document.getElementById('form-preIpoPromoterHolding').value = currentIpoData.preIpoPromoterHolding ?? '';
        document.getElementById('form-postIpoPromoterHolding').value = currentIpoData.postIpoPromoterHolding ?? '';
        document.getElementById('form-preIpoMarketCap').value = currentIpoData.preIpoMarketCap ?? '';
        document.getElementById('form-postIpoMarketCap').value = currentIpoData.postIpoMarketCap ?? '';

        // Populate Offer Breakup & Retail Category Terms
        const offerCats = currentIpoData.offerCategories || [];
        const catQib = offerCats.find(c => c.category === 'QIB');
        const catNii = offerCats.find(c => c.category === 'NII');
        const catRetail = offerCats.find(c => c.category === 'RETAIL');

        document.getElementById('cat-qib-pct').value = catQib?.allocationPct ?? '';
        document.getElementById('cat-nii-pct').value = catNii?.allocationPct ?? '';
        document.getElementById('cat-retail-pct').value = catRetail?.allocationPct ?? '';
        document.getElementById('cat-retail-min-lots').value = catRetail?.minLots ?? '';
        document.getElementById('cat-retail-max-lots').value = catRetail?.maxLots ?? '';
        document.getElementById('cat-retail-min-shares').value = catRetail?.minShares ?? '';
        document.getElementById('cat-retail-max-shares').value = catRetail?.maxShares ?? '';
        document.getElementById('cat-retail-min-amount').value = catRetail?.minAmount ?? '';
        document.getElementById('cat-retail-max-amount').value = catRetail?.maxAmount ?? '';

        // Populate Participants (Registrar & Lead Managers)
        const participants = currentIpoData.participants || [];
        const regPart = participants.find(p => p.role === 'REGISTRAR');
        const brlmParts = participants.filter(p => p.role === 'BRLM' || p.role === 'CO_BRLM' || p.role === 'LEAD_MANAGER');

        document.getElementById('part-reg-name').value = regPart?.name ?? '';
        document.getElementById('part-reg-phone').value = regPart?.phone ?? '';
        document.getElementById('part-reg-email').value = regPart?.email ?? '';
        document.getElementById('part-reg-website').value = regPart?.website ?? '';
        document.getElementById('part-brlm-name').value = brlmParts.length > 0 ? brlmParts.map(b => b.name).join(', ') : '';

        // Populate Company Financials & Ratios
        const fin = (currentIpoData.financials && currentIpoData.financials[0]) || (currentIpoData.company?.financials && currentIpoData.company.financials[0]);
        if (fin) {
          document.getElementById('fin-period').value = fin.fiscalPeriod || 'FY24';
          document.getElementById('fin-roe-pct').value = fin.roePercentage ?? '';
          document.getElementById('fin-pat-margin-pct').value = fin.patMarginPercent ?? '';
          document.getElementById('fin-ebitda-margin-pct').value = fin.ebitdaMarginPercent ?? (
            fin.ebitda != null && fin.totalRevenue != null && Number(fin.totalRevenue) > 0
              ? ((Number(fin.ebitda) / Number(fin.totalRevenue)) * 100).toFixed(2)
              : ''
          );
          document.getElementById('fin-eps').value = fin.eps ?? '';
          document.getElementById('fin-roce-pct').value = fin.rocePercentage ?? '';
          document.getElementById('fin-assets').value = fin.totalAssets ?? '';
          document.getElementById('fin-revenue').value = fin.totalRevenue ?? '';
          document.getElementById('fin-pat').value = fin.pat ?? '';
          document.getElementById('fin-ebitda').value = fin.ebitda ?? '';
          document.getElementById('fin-networth').value = fin.netWorth ?? '';
        } else {
          document.getElementById('fin-period').value = '';
          document.getElementById('fin-roe-pct').value = '';
          document.getElementById('fin-pat-margin-pct').value = '';
          document.getElementById('fin-ebitda-margin-pct').value = '';
          document.getElementById('fin-eps').value = '';
          document.getElementById('fin-roce-pct').value = '';
          document.getElementById('fin-assets').value = '';
          document.getElementById('fin-revenue').value = '';
          document.getElementById('fin-pat').value = '';
          document.getElementById('fin-ebitda').value = '';
          document.getElementById('fin-networth').value = '';
        }

        // Populate Subscription Observations
        const subs = currentIpoData.subscriptionObservations || [];
        const subQib = subs.find(s => s.category === 'QIB');
        const subNii = subs.find(s => s.category === 'NII');
        const subRetail = subs.find(s => s.category === 'RETAIL');
        const subTotal = subs.find(s => s.category === 'OTHER' || s.category === 'TOTAL');

        document.getElementById('sub-qib').value = subQib?.subscriptionMultiple ?? '';
        document.getElementById('sub-nii').value = subNii?.subscriptionMultiple ?? '';
        document.getElementById('sub-retail').value = subRetail?.subscriptionMultiple ?? '';
        document.getElementById('sub-total').value = subTotal?.subscriptionMultiple ?? '';

        const latestGmp = currentIpoData.latestGmp || currentIpoData.currentGmp || currentIpoData.gmp || (currentIpoData.gmpObservations && currentIpoData.gmpObservations[0]);
        if (latestGmp) {
          const amt = latestGmp.gmpAmount ?? latestGmp.gmp_amount ?? '';
          const pct = latestGmp.gmpPercentage ?? latestGmp.gmp_percent ?? '';
          const profit = latestGmp.estProfitPerLot ?? latestGmp.profit_per_lot ?? '';
          document.getElementById('gmp-amount').value = amt !== null && amt !== undefined ? amt : '';
          document.getElementById('gmp-percentage').value = pct !== null && pct !== undefined ? pct : '';
          document.getElementById('gmp-est-profit').value = profit !== null && profit !== undefined ? profit : '';
        } else {
          document.getElementById('gmp-amount').value = '';
          document.getElementById('gmp-percentage').value = '';
          document.getElementById('gmp-est-profit').value = '';
        }

        document.getElementById('allot-registrar-code').value = currentIpoData.allotmentConfig?.registrar || currentIpoData.allotmentConfig?.registrarCode || currentIpoData.allotmentRegistrarCode || '';
        document.getElementById('allot-registrar-ipo-code').value = currentIpoData.allotmentConfig?.registrarIpoCode || currentIpoData.allotmentRegistrarIpoCode || '';
        const allotEnabledEl = document.getElementById('allot-enabled');
        if (allotEnabledEl) {
          allotEnabledEl.checked = currentIpoData.allotmentConfig ? currentIpoData.allotmentConfig.enabled !== false : true;
        }
        updateAllotmentWarning();

        // Populate Anchor Investors Table
        const tbody = document.getElementById('anchor-investors-tbody');
        if (tbody) {
          tbody.querySelectorAll('.anchor-row').forEach(r => r.remove());
        }
        const anchors = currentIpoData.anchorInvestors || (currentIpoData.documents?.find(d => d.documentType === 'ANCHOR_LIST')?.extractionData)?.anchorInvestors || [];
        if (Array.isArray(anchors) && anchors.length > 0) {
          anchors.forEach(a => addAnchorInvestorRow(a.anchorName, a.sharesAllotted, a.amtCr, a.pctAllocated, a.pctOfIssue));
        } else {
          reindexAnchorRows();
        }

        renderDocumentsTable(currentIpoData);
        updateFormStatusSections();
        switchTab('manual-edit');
      } catch (err) {
        console.error('Error fetching manual IPO detail:', err);
      }
    }

    async function saveAllotmentConfig() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) { alert('Please save or select an IPO first before configuring allotment.'); return; }
      const registrarCode = document.getElementById('allot-registrar-code').value?.trim();
      const registrarIpoCode = document.getElementById('allot-registrar-ipo-code').value?.trim();
      const enabled = document.getElementById('allot-enabled')?.checked ?? true;
      if (!registrarCode) {
        alert('Please enter a Registrar Code (e.g. KFINTECH or MUFG_INTIME)');
        return;
      }
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/allotment-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrar: registrarCode, registrarCode, registrarIpoCode: registrarIpoCode || null, enabled })
        });
        if (!res.ok) throw new Error('Status ' + res.status);
        alert('Allotment checker configuration saved!');
      } catch (err) {
        alert('Failed to save allotment config: ' + err.message);
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
        preIpoEps: parseFloat(document.getElementById('form-preIpoEps').value) || undefined,
        postIpoEps: parseFloat(document.getElementById('form-postIpoEps').value) || undefined,
        preIpoPe: parseFloat(document.getElementById('form-preIpoPe').value) || undefined,
        postIpoPe: parseFloat(document.getElementById('form-postIpoPe').value) || undefined,
        preIpoPromoterHolding: parseFloat(document.getElementById('form-preIpoPromoterHolding').value) || undefined,
        postIpoPromoterHolding: parseFloat(document.getElementById('form-postIpoPromoterHolding').value) || undefined,
        preIpoMarketCap: parseFloat(document.getElementById('form-preIpoMarketCap').value) || undefined,
        postIpoMarketCap: parseFloat(document.getElementById('form-postIpoMarketCap').value) || undefined,
        issueSize: parseFloat(document.getElementById('form-issueSize').value) || undefined,
        freshIssueSize: parseFloat(document.getElementById('form-freshIssueSize').value) || undefined,
        ofsSize: parseFloat(document.getElementById('form-ofsSize').value) || undefined,
        openDate: document.getElementById('form-openDate').value || undefined,
        closeDate: document.getElementById('form-closeDate').value || undefined,
        allotmentDate: document.getElementById('form-allotmentDate').value || undefined,
        refundDate: document.getElementById('form-refundDate').value || undefined,
        listingDate: document.getElementById('form-listingDate').value || undefined,
        logoUrl: document.getElementById('form-logoUrl').value || undefined,
        anchorInvestors: getAnchorInvestorsFromForm(),
        financials: getFinancialsFromForm(),
      };

      const docsFromForm = getDocumentsFromForm();
      payload.documents = docsFromForm;
      const drhpDoc = docsFromForm.find(d => d.documentType === 'DRHP');
      if (drhpDoc) payload.drhpUrl = drhpDoc.sourceUrl;
      const rhpDoc = docsFromForm.find(d => d.documentType === 'RHP');
      if (rhpDoc) payload.rhpUrl = rhpDoc.sourceUrl;
      const prospectusDoc = docsFromForm.find(d => d.documentType === 'PROSPECTUS');
      if (prospectusDoc) payload.prospectusUrl = prospectusDoc.sourceUrl;
      const anchorDoc = docsFromForm.find(d => d.documentType === 'ANCHOR_LIST');
      if (anchorDoc) payload.anchorListUrl = anchorDoc.sourceUrl;

      // Offer Categories
      const offerCategories = [];
      const qibPctVal = parseFloat(document.getElementById('cat-qib-pct').value);
      const niiPctVal = parseFloat(document.getElementById('cat-nii-pct').value);
      const retailPctVal = parseFloat(document.getElementById('cat-retail-pct').value);
      const retMinLotsVal = parseInt(document.getElementById('cat-retail-min-lots').value, 10);
      const retMaxLotsVal = parseInt(document.getElementById('cat-retail-max-lots').value, 10);
      const retMinSharesVal = parseInt(document.getElementById('cat-retail-min-shares').value, 10);
      const retMaxSharesVal = parseInt(document.getElementById('cat-retail-max-shares').value, 10);
      const retMinAmtVal = parseFloat(document.getElementById('cat-retail-min-amount').value);
      const retMaxAmtVal = parseFloat(document.getElementById('cat-retail-max-amount').value);

      if (!isNaN(qibPctVal)) offerCategories.push({ category: 'QIB', allocationPct: qibPctVal });
      if (!isNaN(niiPctVal)) offerCategories.push({ category: 'NII', allocationPct: niiPctVal });
      if (!isNaN(retailPctVal) || !isNaN(retMinLotsVal) || !isNaN(retMaxLotsVal) || !isNaN(retMinSharesVal) || !isNaN(retMaxSharesVal) || !isNaN(retMinAmtVal) || !isNaN(retMaxAmtVal)) {
        offerCategories.push({
          category: 'RETAIL',
          allocationPct: !isNaN(retailPctVal) ? retailPctVal : undefined,
          minLots: !isNaN(retMinLotsVal) ? retMinLotsVal : undefined,
          maxLots: !isNaN(retMaxLotsVal) ? retMaxLotsVal : undefined,
          minShares: !isNaN(retMinSharesVal) ? retMinSharesVal : undefined,
          maxShares: !isNaN(retMaxSharesVal) ? retMaxSharesVal : undefined,
          minAmount: !isNaN(retMinAmtVal) ? retMinAmtVal : undefined,
          maxAmount: !isNaN(retMaxAmtVal) ? retMaxAmtVal : undefined,
        });
      }
      payload.offerCategories = offerCategories;

      // Participants
      const participants = [];
      const regName = document.getElementById('part-reg-name').value?.trim();
      const regPhone = document.getElementById('part-reg-phone').value?.trim();
      const regEmail = document.getElementById('part-reg-email').value?.trim();
      const regWebsite = document.getElementById('part-reg-website').value?.trim();
      const brlmNameStr = document.getElementById('part-brlm-name').value?.trim();

      if (regName) {
        participants.push({
          role: 'REGISTRAR',
          name: regName,
          phone: regPhone || undefined,
          email: regEmail || undefined,
          website: regWebsite || undefined,
        });
      }
      if (brlmNameStr) {
        const names = brlmNameStr.split(',').map(s => s.trim()).filter(Boolean);
        names.forEach((name, idx) => {
          participants.push({
            role: 'BRLM',
            name,
            displayOrder: idx + 1,
          });
        });
      }
      payload.participants = participants;

      // Subscriptions
      const subscription = [];
      const subQibVal = parseFloat(document.getElementById('sub-qib').value);
      const subNiiVal = parseFloat(document.getElementById('sub-nii').value);
      const subRetailVal = parseFloat(document.getElementById('sub-retail').value);
      const subTotalVal = parseFloat(document.getElementById('sub-total').value);

      if (!isNaN(subQibVal)) subscription.push({ category: 'QIB', subscriptionMultiple: subQibVal });
      if (!isNaN(subNiiVal)) subscription.push({ category: 'NII', subscriptionMultiple: subNiiVal });
      if (!isNaN(subRetailVal)) subscription.push({ category: 'RETAIL', subscriptionMultiple: subRetailVal });
      if (!isNaN(subTotalVal)) subscription.push({ category: 'OTHER', subscriptionMultiple: subTotalVal });

      payload.subscription = subscription;

      const gmpAmtEl = document.getElementById('gmp-amount');
      const gmpPctEl = document.getElementById('gmp-percentage');
      const gmpEstEl = document.getElementById('gmp-est-profit');
      const gmpAmtStr = gmpAmtEl && gmpAmtEl.value ? gmpAmtEl.value.trim() : '';
      const gmpPctStr = gmpPctEl && gmpPctEl.value ? gmpPctEl.value.trim() : '';
      const gmpEstStr = gmpEstEl && gmpEstEl.value ? gmpEstEl.value.trim() : '';

      if (gmpAmtStr !== '' || gmpPctStr !== '' || gmpEstStr !== '') {
        const amt = parseFloat(gmpAmtStr);
        payload.gmp = {
          gmpAmount: !isNaN(amt) ? amt : 0,
          gmpPercentage: gmpPctStr !== '' && !isNaN(parseFloat(gmpPctStr)) ? parseFloat(gmpPctStr) : undefined,
          estProfitPerLot: gmpEstStr !== '' && !isNaN(parseFloat(gmpEstStr)) ? parseFloat(gmpEstStr) : undefined,
        };
      }

      const registrarCodeVal = document.getElementById('allot-registrar-code')?.value?.trim();
      const registrarIpoCodeVal = document.getElementById('allot-registrar-ipo-code')?.value?.trim();
      if (registrarCodeVal) {
        payload.allotmentConfig = {
          registrar: registrarCodeVal,
          registrarIpoCode: registrarIpoCodeVal || undefined,
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
      if (!id) {
        alert('Please save the IPO first before publishing.');
        return;
      }
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/publish', { method: 'POST' });
        if (res.ok) { alert('Published to mobile live feed!'); switchTab('manual'); }
      } catch (err) { alert('Publish error: ' + err.message); }
    }

    async function unpublishCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) {
        alert('Please save the IPO first before unpublishing.');
        return;
      }
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/unpublish', { method: 'POST' });
        if (res.ok) { alert('Unpublished!'); switchTab('manual'); }
      } catch (err) { alert('Unpublish error: ' + err.message); }
    }

    async function archiveCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) {
        alert('Please save the IPO first before archiving.');
        return;
      }
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/archive', { method: 'POST' });
        if (res.ok) { alert('Archived IPO!'); switchTab('manual'); }
      } catch (err) { alert('Archive error: ' + err.message); }
    }

    async function deleteCurrentIpo() {
      const id = document.getElementById('form-ipo-id').value;
      if (!id) {
        alert('No IPO selected to delete.');
        return;
      }
      if (!confirm('Are you sure you want to permanently delete this IPO? This action cannot be undone.')) return;
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id, { method: 'DELETE' });
        if (res.ok) {
          alert('IPO deleted successfully!');
          switchTab('manual');
        } else {
          const err = await res.json().catch(() => ({}));
          alert('Delete failed: ' + (err.message || res.statusText));
        }
      } catch (err) {
        alert('Delete error: ' + err.message);
      }
    }

    function formatApiError(error) {
      if (!error) {
        return 'Unknown error occurred';
      }

      if (error instanceof Error) {
        return error.message;
      }

      if (typeof error === 'string') {
        return error;
      }

      if (typeof error === 'object') {
        const e = error;

        if (e.response && e.response.data) {
          return formatApiError(e.response.data);
        }

        if (e.data) {
          return formatApiError(e.data);
        }

        if (e.error && typeof e.error === 'object') {
          return formatApiError(e.error);
        }

        if (Array.isArray(e.message)) {
          return e.message.join('\\n');
        }

        if (Array.isArray(e.errors)) {
          return e.errors.map(function(err) {
            return typeof err === 'object' ? formatApiError(err) : String(err);
          }).join('\\n');
        }

        if (e.details) {
          const detailsStr = typeof e.details === 'object' ? JSON.stringify(e.details, null, 2) : String(e.details);
          if (typeof e.message === 'string' && e.message.trim()) {
            return e.message + '\\n' + detailsStr;
          }
          return detailsStr;
        }

        if (typeof e.message === 'string' && e.message.trim()) {
          return e.message;
        }

        if (typeof e.error === 'string' && e.error.trim()) {
          return e.error;
        }

        try {
          return JSON.stringify(e, null, 2);
        } catch {
          return 'Unknown JSON import error';
        }
      }

      return String(error);
    }

    function triggerJsonImportForCurrentIpo() {
      const input = document.getElementById('json-detail-file-input');
      if (input) input.click();
    }

    function triggerJsonImport() {
      const input = document.getElementById('json-detail-file-input') || document.getElementById('json-file-input');
      if (input) input.click();
    }

    function closeJsonImportModal() {
      const modal = document.getElementById('json-import-modal-overlay');
      if (modal) modal.style.display = 'none';
      window._pendingJsonPayload = null;
      window._pendingPreviewData = null;
      window._pendingDetailIpoId = null;
    }

    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function handleJsonDetailFileSelect(evt) {
      const file = evt.target.files[0];
      if (!file) return;
      const currentIpoId = document.getElementById('form-ipo-id')?.value;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          let jsonPayload = JSON.parse(e.target.result);

          // If payload is wrapped in { data: ... }, unwrap it
          if (jsonPayload && typeof jsonPayload === 'object' && !Array.isArray(jsonPayload) && jsonPayload.data && typeof jsonPayload.data === 'object') {
            jsonPayload = jsonPayload.data;
          }

          // If triggered inside IPO Details with an active IPO ID, bind target IPO ID if not explicitly specified
          if (currentIpoId) {
            window._pendingDetailIpoId = currentIpoId;
            if (Array.isArray(jsonPayload)) {
              if (jsonPayload.length === 1 && !jsonPayload[0].id && !jsonPayload[0].ipoId && !jsonPayload[0].targetIpoId) {
                jsonPayload[0].id = currentIpoId;
              }
            } else if (typeof jsonPayload === 'object' && jsonPayload !== null) {
              if (!jsonPayload.id && !jsonPayload.ipoId && !jsonPayload.targetIpoId) {
                jsonPayload.id = currentIpoId;
              }
            }
          } else {
            window._pendingDetailIpoId = null;
          }

          window._pendingJsonPayload = jsonPayload;

          const response = await fetch(API_BASE + '/manual-ipos/import-json/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPayload)
          });
          const rawText = await response.text();
          let body;
          try {
            body = rawText ? JSON.parse(rawText) : null;
          } catch {
            body = rawText;
          }

          if (!response.ok) {
            throw body || {
              statusCode: response.status,
              message: response.statusText,
            };
          }

          const previewData = body.data || body;
          window._pendingPreviewData = previewData;
          renderJsonImportPreview(previewData);

          const modal = document.getElementById('json-import-modal-overlay');
          if (modal) modal.style.display = 'flex';
        } catch (err) {
          alert('Failed to parse or preview JSON file:\\n' + formatApiError(err));
        } finally {
          evt.target.value = '';
        }
      };
      reader.readAsText(file);
    }

    function handleJsonFileSelect(evt) {
      return handleJsonDetailFileSelect(evt);
    }

    function renderJsonImportPreview(data) {
      document.getElementById('json-preview-total').textContent = data.totalRecords || 0;
      document.getElementById('json-preview-matched').textContent = data.matchedCount || 0;
      document.getElementById('json-preview-fields-count').textContent = data.fieldsToFillTotal || 0;
      document.getElementById('json-preview-unmatched').textContent = data.unmatchedCount || 0;
      document.getElementById('json-preview-ambiguous').textContent = data.ambiguousCount || 0;

      const btnConfirm = document.getElementById('btn-confirm-json-import');
      const btnText = document.getElementById('btn-confirm-json-text');

      if (!data.fieldsToFillTotal || data.fieldsToFillTotal === 0) {
        if (btnConfirm) btnConfirm.disabled = true;
        if (btnText) btnText.textContent = 'No Empty Fields to Populate';
      } else {
        if (btnConfirm) btnConfirm.disabled = false;
        if (btnText) btnText.textContent = 'Confirm & Populate ' + data.fieldsToFillTotal + ' Empty Fields';
      }

      const listContainer = document.getElementById('json-preview-list');
      if (!listContainer) return;

      if (!data.items || data.items.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-muted);">No records found.</div>';
        return;
      }

      listContainer.innerHTML = data.items.map(function(item) {
        let statusBadge = '';
        let borderColor = 'var(--border-color)';
        if (item.matchStatus === 'MATCHED') {
          statusBadge = '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:rgba(16,185,129,0.15); color:#10B981;">MATCHED</span>';
          borderColor = 'rgba(16,185,129,0.3)';
        } else if (item.matchStatus === 'AMBIGUOUS') {
          statusBadge = '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:rgba(239,68,68,0.15); color:#EF4444;">AMBIGUOUS</span>';
          borderColor = 'rgba(239,68,68,0.3)';
        } else {
          statusBadge = '<span style="font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; background:rgba(245,158,11,0.15); color:#F59E0B;">UNMATCHED</span>';
          borderColor = 'rgba(245,158,11,0.3)';
        }

        let toFillHtml = '';
        if (item.fieldsToFill && item.fieldsToFill.length > 0) {
          const chips = item.fieldsToFill.map(function(f) {
            const valStr = typeof f.newValue === 'object' ? JSON.stringify(f.newValue) : escapeHtml(f.newValue);
            return '<span style="font-size:11px; padding:3px 8px; border-radius:6px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.25); color:var(--text-main);"><strong>' + escapeHtml(f.field) + '</strong>: <span style="color:#10B981;">' + valStr + '</span></span>';
          }).join('');
          toFillHtml = '<div style="margin-top:8px;"><div style="font-size:11px; font-weight:700; color:#10B981; margin-bottom:4px;">FIELDS TO BE POPULATED (' + item.fieldsToFill.length + '):</div><div style="display:flex; flex-wrap:wrap; gap:6px;">' + chips + '</div></div>';
        } else if (item.matchStatus === 'MATCHED') {
          toFillHtml = '<div style="margin-top:6px; font-size:12px; color:var(--text-muted); font-style:italic;">No empty fields to populate (all target fields already populated).</div>';
        }

        let skippedHtml = '';
        if (item.fieldsSkipped && item.fieldsSkipped.length > 0) {
          const skipChips = item.fieldsSkipped.map(function(s) {
            return '<span style="font-size:11px; padding:3px 8px; border-radius:6px; background:var(--bg-hover); border:1px solid var(--border-color); color:var(--text-muted);"><strong>' + escapeHtml(s.field) + '</strong> (preserved: ' + escapeHtml(s.existingValue) + ')</span>';
          }).join('');
          skippedHtml = '<details style="margin-top:8px; font-size:12px;"><summary style="cursor:pointer; color:var(--text-muted); font-size:11px; font-weight:600;">Existing fields preserved (' + item.fieldsSkipped.length + ')</summary><div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;">' + skipChips + '</div></details>';
        }

        const symbolPart = item.inputSymbol ? ' <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">(' + escapeHtml(item.inputSymbol) + ')</span>' : '';
        const targetPart = item.matchedIpoName ? '<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">Target: <strong>' + escapeHtml(item.matchedIpoName) + '</strong> ' + (item.matchedSymbol ? '[' + escapeHtml(item.matchedSymbol) + ']' : '') + '</div>' : '';

        return '<div style="background:var(--bg-surface); border:1px solid ' + borderColor + '; border-radius:10px; padding:12px 16px;">'
          + '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">'
          + '<div><strong style="font-size:13px; color:var(--text-main);">' + escapeHtml(item.inputName) + '</strong>' + symbolPart + '</div>'
          + '<div style="display:flex; align-items:center; gap:8px;"><span style="font-size:11px; color:var(--text-muted);">' + escapeHtml(item.matchReason) + '</span>' + statusBadge + '</div>'
          + '</div>'
          + targetPart
          + toFillHtml
          + skippedHtml
          + '</div>';
      }).join('');
    }

    async function commitAddOnlyJsonImport() {
      if (!window._pendingJsonPayload) {
        alert('No pending import payload.');
        return;
      }

      const btnConfirm = document.getElementById('btn-confirm-json-import');
      const btnText = document.getElementById('btn-confirm-json-text');
      if (btnConfirm) btnConfirm.disabled = true;
      if (btnText) btnText.textContent = 'Applying Add-Only Updates...';

      const targetDetailIpoId = window._pendingDetailIpoId;

      try {
        const response = await fetch(API_BASE + '/manual-ipos/import-json/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: window._pendingJsonPayload })
        });

        const rawText = await response.text();
        let body;
        try {
          body = rawText ? JSON.parse(rawText) : null;
        } catch {
          body = rawText;
        }

        if (!response.ok) {
          throw body || {
            statusCode: response.status,
            message: response.statusText,
          };
        }

        const result = body.data || body;
        alert('Add-Only Import Complete!\\n\\nUpdated: ' + (result.updatedCount || 0) + ' IPOs\\nSkipped (No changes / Unmatched): ' + (result.skippedCount || 0) + '\\nFailed: ' + (result.failedCount || 0));
        closeJsonImportModal();
        if (targetDetailIpoId) {
          await editManualIpo(targetDetailIpoId);
        }
        fetchManualIpos();
      } catch (err) {
        alert('Add-only import commit failed:\\n' + formatApiError(err));
      } finally {
        if (btnConfirm) btnConfirm.disabled = false;
        if (btnText) btnText.textContent = 'Confirm & Apply Add-Only Import';
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


    // â”€â”€ IPO GURU v1 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let ipoGuruLastData = [];

    function igFmtVal(v) {
      if (v == null || v === '' || v === 'null') return '<span style="color:var(--text-subtle);">&#8212;</span>';
      return String(v).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function igFmtNum(v, decimals) {
      decimals = decimals == null ? 2 : decimals;
      if (v == null || v === '') return '<span style="color:var(--text-subtle);">&#8212;</span>';
      var n = parseFloat(String(v));
      return isNaN(n) ? igFmtVal(v) : n.toFixed(decimals);
    }

    function igFmtPriceBand(ipo) {
      if (ipo.price_band != null && ipo.price_band !== '') {
        return '\u20B9' + String(ipo.price_band).replace(/-/g, ' \u2013 \u20B9');
      }
      var lo = ipo.price_band_min || ipo.priceBandMin;
      var hi = ipo.price_band_max || ipo.priceBandMax;
      if (!lo && !hi) return '<span style="color:var(--text-subtle);">&#8212;</span>';
      if (lo && hi) return '\u20B9' + parseFloat(lo).toFixed(0) + ' \u2013 \u20B9' + parseFloat(hi).toFixed(0);
      return '\u20B9' + parseFloat(lo || hi).toFixed(0);
    }

    function igFmtFreshOfs(ipo) {
      var fresh = ipo.fresh_issue || ipo.freshIssue;
      var ofs = ipo.ofs;
      if (fresh || ofs) {
        var parts = [];
        if (fresh) parts.push('F: \u20B9' + parseFloat(fresh).toFixed(0) + ' Cr');
        if (ofs) parts.push('O: \u20B9' + parseFloat(ofs).toFixed(0) + ' Cr');
        return parts.join('<br/>');
      }
      return igFmtVal(ipo.sale_type || ipo.issue_type || ipo.issueType);
    }

    function igKnownKeys() {
      return ['id','name','company_name','symbol','isin','ipo_type','type','issue_type','sale_type','status',
        'open_date','close_date','allotment_date','listing_date','anchor_date',
        'price_band','price_band_min','price_band_max','issue_price','lot_size','min_investment',
        'issue_size','fresh_issue','ofs','exchange','listing_on','registrar',
        'subscription','qib_sub','nii_sub','retail_sub','employee_sub','total_sub','sub_updated_at',
        'gmp','gmp_pct','gmp_updated_at'];
    }

    function igBuildRaw(ipo) {
      var known = new Set(igKnownKeys());
      var extra = {};
      Object.keys(ipo).forEach(function(k) { if (!known.has(k)) extra[k] = ipo[k]; });
      return Object.assign({}, ipo, { _extra_keys: extra });
    }

    function showIpoGuruRaw(idx) {
      var ipo = ipoGuruLastData[idx];
      if (!ipo) return;
      var pre = document.getElementById('ipo-guru-raw-pre');
      if (pre) pre.textContent = JSON.stringify(igBuildRaw(ipo), null, 2);
      var overlay = document.getElementById('ipo-guru-raw-overlay');
      if (overlay) overlay.style.display = 'flex';
    }

    function closeIpoGuruRaw() {
      var overlay = document.getElementById('ipo-guru-raw-overlay');
      if (overlay) overlay.style.display = 'none';
    }

    function renderIpoGuruTable(ipos) {
      var tbody = document.getElementById('ipo-guru-table-body');
      if (!tbody) return;
      if (!ipos || ipos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="24" style="text-align:center;padding:24px;color:var(--text-muted);">No IPOs returned by the API.</td></tr>';
        return;
      }
      var rows = [];
      for (var i = 0; i < ipos.length; i++) {
        var ipo = ipos[i];
        var idx = i;
        var name = ipo.name || ipo.company_name || '';
        var sc = ipo.status === 'Open' ? '#10B981' : ipo.status === 'Upcoming' ? '#F59E0B' : ipo.status === 'Listed' ? '#4F46E5' : '#64748B';
        var dash = '<span style="color:var(--text-subtle);">&#8212;</span>';

        var ip = ipo.issue_price != null ? (String(ipo.issue_price).startsWith('\u20B9') ? ipo.issue_price : '\u20B9' + ipo.issue_price) : dash;
        var isz = ipo.issue_size != null ? igFmtVal(ipo.issue_size) : dash;

        var sub = ipo.subscription || {};
        var qibSub = sub.qib != null ? sub.qib : ipo.qib_sub;
        var niiSub = sub.nii != null ? sub.nii : ipo.nii_sub;
        var retSub = sub.retail != null ? sub.retail : ipo.retail_sub;
        var totSub = ipo.subscription_total != null ? ipo.subscription_total : (sub.total != null ? sub.total : ipo.total_sub);
        var subUpdated = sub.updated_at_label || sub.updated_at || ipo.sub_updated_at_label || ipo.sub_updated_at;

        var gmpObj = (ipo.gmp && typeof ipo.gmp === 'object') ? ipo.gmp : null;
        var gmpRaw = gmpObj ? gmpObj.price : ipo.gmp;
        var gmpPctRaw = gmpObj ? gmpObj.percentage : ipo.gmp_pct;
        var gmpUpdated = gmpObj ? (gmpObj.updated_at_label || gmpObj.updated_at) : (ipo.gmp_updated_at_label || ipo.gmp_updated_at);

        var gmpNum = parseFloat(gmpRaw);
        var gmpPctNum = parseFloat(gmpPctRaw);
        var gmpColor = !isNaN(gmpNum) && gmpNum > 0 ? '#10B981' : (!isNaN(gmpNum) && gmpNum < 0 ? '#EF4444' : '#64748B');
        var gmpVal = !isNaN(gmpNum) ? (gmpNum > 0 ? '+' : '') + gmpNum.toFixed(2) : (gmpRaw ? igFmtVal(gmpRaw) : dash);
        var gmpPctColor = !isNaN(gmpPctNum) && gmpPctNum > 0 ? '#10B981' : (!isNaN(gmpPctNum) && gmpPctNum < 0 ? '#EF4444' : '#64748B');
        var gmpPctVal = !isNaN(gmpPctNum) ? (gmpPctNum > 0 ? '+' : '') + gmpPctNum.toFixed(2) + '%' : (gmpPctRaw ? igFmtVal(gmpPctRaw) : dash);

        var sym = ipo.symbol ? '<br/><span style="font-size:10px;color:var(--text-muted);font-family:monospace;">' + ipo.symbol + '</span>' : '';
        rows.push('<tr>'
          + '<td style="color:var(--text-muted);font-size:11px;">' + (idx + 1) + '</td>'
          + '<td><strong style="font-size:12px;">' + igFmtVal(name) + '</strong>' + sym + '</td>'
          + '<td>' + igFmtVal(ipo.ipo_type || ipo.type) + '</td>'
          + '<td><span style="font-size:11px;font-weight:600;color:' + sc + ';">' + igFmtVal(ipo.status) + '</span></td>'
          + '<td style="font-family:monospace;font-size:11px;">' + igFmtVal(ipo.open_date) + '</td>'
          + '<td style="font-family:monospace;font-size:11px;">' + igFmtVal(ipo.close_date) + '</td>'
          + '<td style="font-family:monospace;font-size:11px;">' + igFmtVal(ipo.allotment_date) + '</td>'
          + '<td style="font-family:monospace;font-size:11px;">' + igFmtVal(ipo.listing_date) + '</td>'
          + '<td style="font-size:12px;">' + igFmtPriceBand(ipo) + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + ip + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + igFmtVal(ipo.lot_size) + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + isz + '</td>'
          + '<td style="font-size:11px;">' + igFmtFreshOfs(ipo) + '</td>'
          + '<td style="font-size:11px;">' + igFmtVal(ipo.exchange || ipo.listing_on) + '</td>'
          + '<td style="font-size:11px;">' + igFmtVal(ipo.registrar) + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + igFmtNum(qibSub) + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + igFmtNum(niiSub) + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + igFmtNum(retSub) + '</td>'
          + '<td style="text-align:right;font-family:monospace;">' + igFmtNum(totSub) + '</td>'
          + '<td style="text-align:right;font-family:monospace;color:' + gmpColor + ';">' + gmpVal + '</td>'
          + '<td style="text-align:right;font-family:monospace;color:' + gmpPctColor + ';">' + gmpPctVal + '</td>'
          + '<td style="font-family:monospace;font-size:10px;">' + igFmtVal(gmpUpdated) + '</td>'
          + '<td style="font-family:monospace;font-size:10px;">' + igFmtVal(subUpdated) + '</td>'
          + '<td style="text-align:center;"><button type="button" class="btn-secondary" style="font-size:10px;padding:3px 8px;min-height:28px;" onclick="showIpoGuruRaw(' + idx + ')">Raw</button></td>'
          + '</tr>');
      }
      tbody.innerHTML = rows.join('');
    }

    async function fetchIpoGuruData() {
      var btn = document.getElementById('ipo-guru-fetch-btn');
      var errEl = document.getElementById('ipo-guru-error');
      var metaEl = document.getElementById('ipo-guru-meta');
      var tableWrap = document.getElementById('ipo-guru-table-wrap');
      var emptyEl = document.getElementById('ipo-guru-empty');
      var badge = document.getElementById('ipo-guru-status-badge');

      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-feather="loader"></i> <span>Fetching...</span>'; if (window.feather) feather.replace(); }
      if (errEl) errEl.style.display = 'none';
      if (tableWrap) tableWrap.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'none';
      if (badge) badge.style.display = 'none';

      try {
        var res = await fetch(API_BASE + '/ipo-guru/fetch', { method: 'POST' });
        var json = await res.json();
        var result = json.data || json;

        if (metaEl) metaEl.style.display = 'block';
        var lastFetchEl = document.getElementById('ipo-guru-last-fetch');
        var httpEl = document.getElementById('ipo-guru-http-status');
        var totalEl = document.getElementById('ipo-guru-total');
        if (lastFetchEl) lastFetchEl.textContent = result.fetchedAt ? new Date(result.fetchedAt).toLocaleString() : '\u2014';
        if (httpEl) httpEl.textContent = result.httpStatus != null ? result.httpStatus : (res.status || '\u2014');
        if (totalEl) totalEl.textContent = result.total != null ? result.total : 0;

        if (!res.ok || json.error || result.error || (result.message && !result.ipos)) {
          var errMsg = (json.error && json.error.message) || (result.error && result.error.message) || result.details || result.message || ('HTTP ' + res.status);
          if (errEl) { errEl.textContent = '\u26A0\uFE0F Error: ' + errMsg; errEl.style.display = 'block'; }
          if (badge) { badge.textContent = 'HTTP ' + (result.httpStatus || res.status); badge.style.background = '#FEF2F2'; badge.style.color = '#991B1B'; badge.style.display = 'inline-block'; }
          if (emptyEl) emptyEl.style.display = 'block';
          return;
        }

        var ipos = result.ipos || [];
        ipoGuruLastData = ipos;

        var rowCountEl = document.getElementById('ipo-guru-row-count');
        if (rowCountEl) rowCountEl.textContent = ipos.length + ' IPOs';

        if (badge) {
          badge.textContent = 'HTTP ' + (result.httpStatus || 200);
          badge.style.background = '#DCFCE7';
          badge.style.color = '#15803D';
          badge.style.display = 'inline-block';
        }

        renderIpoGuruTable(ipos);
        if (tableWrap) tableWrap.style.display = 'block';

        fetchIpoGuruStatus();
      } catch (err) {
        console.error('IPO Guru fetch error:', err);
        if (errEl) { errEl.textContent = '\u26A0\uFE0F Network or parse error: ' + err.message; errEl.style.display = 'block'; }
        if (emptyEl) emptyEl.style.display = 'block';
        if (badge) { badge.textContent = 'Error'; badge.style.background = '#FEF2F2'; badge.style.color = '#991B1B'; badge.style.display = 'inline-block'; }
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-feather="download"></i> <span>Fetch IPO Guru Data</span>'; if (window.feather) feather.replace(); }
        fetchIpoGuruStatus();
      }
    }

    async function syncIpoGuruData() {
      var btn = document.getElementById('ipo-guru-sync-btn');
      var fetchBtn = document.getElementById('ipo-guru-fetch-btn');
      var errEl = document.getElementById('ipo-guru-error');
      var metaEl = document.getElementById('ipo-guru-meta');
      var summaryEl = document.getElementById('ipo-guru-sync-summary');
      var detailsEl = document.getElementById('ipo-guru-sync-details');
      var tableWrap = document.getElementById('ipo-guru-table-wrap');
      var emptyEl = document.getElementById('ipo-guru-empty');
      var badge = document.getElementById('ipo-guru-status-badge');

      if (btn) { btn.disabled = true; btn.innerHTML = '<i data-feather="loader"></i> <span>Syncing...</span>'; }
      if (fetchBtn) { fetchBtn.disabled = true; }
      if (window.feather) feather.replace();
      if (errEl) errEl.style.display = 'none';

      try {
        var payload = (ipoGuruLastData && Array.isArray(ipoGuruLastData) && ipoGuruLastData.length > 0)
          ? JSON.stringify({ ipos: ipoGuruLastData })
          : undefined;

        var res = await fetch(API_BASE + '/ipo-guru/sync', {
          method: 'POST',
          headers: payload ? { 'Content-Type': 'application/json' } : {},
          body: payload,
        });
        var json = await res.json();
        var result = json.data || json;

        if (!res.ok || json.error || result.error) {
          var errMsg = (json.error && json.error.message) || (result.error && result.error.message) || result.details || result.message || ('HTTP ' + res.status);
          if (errEl) { errEl.textContent = '\u26A0\uFE0F Sync Failed: ' + errMsg; errEl.style.display = 'block'; }
          if (badge) { badge.textContent = 'Sync Error'; badge.style.background = '#FEF2F2'; badge.style.color = '#991B1B'; badge.style.display = 'inline-block'; }
          return;
        }

        if (metaEl) metaEl.style.display = 'block';
        var lastFetchEl = document.getElementById('ipo-guru-last-fetch');
        var httpEl = document.getElementById('ipo-guru-http-status');
        var totalEl = document.getElementById('ipo-guru-total');
        if (lastFetchEl) lastFetchEl.textContent = new Date().toLocaleString();
        if (httpEl) httpEl.textContent = res.status || 200;
        if (totalEl) totalEl.textContent = result.totalFetched || 0;

        // Update Sync Summary KPI
        if (summaryEl) {
          document.getElementById('sync-total-fetched').textContent = result.totalFetched || 0;
          document.getElementById('sync-matched-updated').textContent = result.matchedUpdated || 0;
          document.getElementById('sync-newly-created').textContent = result.newlyCreated || 0;
          document.getElementById('sync-skipped-errors').textContent = (result.skipped || 0) + (result.errors || 0);
          document.getElementById('ipo-guru-sync-time').textContent = 'Completed at ' + new Date().toLocaleTimeString();

          // Render details
          if (detailsEl && Array.isArray(result.details)) {
            var detailRows = result.details.map(function(d) {
              var color = '#10B981';
              if (d.action === 'CREATED') color = '#4F46E5';
              else if (d.action === 'SKIPPED') color = '#F59E0B';
              else if (d.action === 'ERROR') color = '#EF4444';

              var text = '<div style="display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px dashed var(--border-color);">'
                + '<span><strong>' + igEsc(d.name) + '</strong>' + (d.symbol ? ' (' + igEsc(d.symbol) + ')' : '') + '</span>'
                + '<span><span style="display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700; color:#fff; background:' + color + ';">' + d.action + '</span>'
                + (d.reason ? ' <span style="color:var(--text-muted); font-size:11px;">' + igEsc(d.reason) + '</span>' : '') + '</span>'
                + '</div>';
              return text;
            });
            detailsEl.innerHTML = detailRows.join('');
          }
          summaryEl.style.display = 'block';
        }

        if (badge) {
          badge.textContent = 'Sync Success: ' + (result.matchedUpdated || 0) + ' Updated, ' + (result.newlyCreated || 0) + ' Created';
          badge.style.background = '#DCFCE7';
          badge.style.color = '#15803D';
          badge.style.display = 'inline-block';
        }

        if (Array.isArray(result.ipos) && result.ipos.length > 0) {
          ipoGuruLastData = result.ipos;
          var rowCountEl = document.getElementById('ipo-guru-row-count');
          if (rowCountEl) rowCountEl.textContent = result.ipos.length + ' IPOs';
          renderIpoGuruTable(result.ipos);
          if (tableWrap) tableWrap.style.display = 'block';
          if (emptyEl) emptyEl.style.display = 'none';
        }

        fetchIpoGuruStatus();
      } catch (err) {
        console.error('IPO Guru sync error:', err);
        if (errEl) { errEl.textContent = '\u26A0\uFE0F Sync error: ' + err.message; errEl.style.display = 'block'; }
        if (badge) { badge.textContent = 'Error'; badge.style.background = '#FEF2F2'; badge.style.color = '#991B1B'; badge.style.display = 'inline-block'; }
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-feather="refresh-cw"></i> <span>Sync to IPO Database</span>'; }
        if (fetchBtn) { fetchBtn.disabled = false; }
        if (window.feather) feather.replace();
        fetchIpoGuruStatus();
      }
    }

    async function fetchIpoGuruStatus() {
      try {
        var res = await fetch(API_BASE + '/ipo-guru/status');
        var json = await res.json();
        var data = json.data || json;
        if (!data || !data.istDate) return;

        var usedEl = document.getElementById('ig-requests-used');
        var remEl = document.getElementById('ig-requests-remaining');
        var autoEl = document.getElementById('ig-auto-requests-used');
        var nextEl = document.getElementById('ig-next-scheduled');
        var lastSuccessEl = document.getElementById('ig-last-success');
        var lastStatusEl = document.getElementById('ig-last-status');
        var dateBadge = document.getElementById('ig-ist-date-badge');

        if (usedEl) usedEl.textContent = data.requestsUsedToday + ' / 10';
        if (remEl) {
          remEl.textContent = data.requestsRemainingToday + ' total (' + data.manualRequestsRemaining + ' manual left)';
          remEl.style.color = data.requestsRemainingToday > 2 ? '#10B981' : (data.requestsRemainingToday > 0 ? '#F59E0B' : '#EF4444');
        }
        if (autoEl) autoEl.textContent = data.autoRequestsUsedToday + ' / ' + data.autoRequestsTotal;
        if (nextEl) nextEl.textContent = data.nextScheduledAutoSync || '\u2014';
        if (lastSuccessEl) lastSuccessEl.textContent = data.lastSuccessfulFetch || '\u2014';
        if (lastStatusEl) {
          lastStatusEl.textContent = data.lastFetchStatus || 'IDLE';
          lastStatusEl.style.color = String(data.lastFetchStatus).includes('200') ? '#10B981' : (data.lastFetchStatus === 'IDLE' ? 'var(--text-muted)' : '#EF4444');
        }
        if (dateBadge) dateBadge.textContent = 'IST Date: ' + data.istDate;
      } catch (e) {
        console.error('Failed to load IPO Guru status:', e);
      }
    }

    // Init handled by readyState check
  </script>
</body>
</html>`;
}

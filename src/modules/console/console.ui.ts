export function renderConsoleHtml(baseUrl = '/api/v1/console/api'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IPOVault — Backend Data Console</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --card-border: #1f293d;
      --card-hover: #1e293b;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --primary: #38bdf8;
      --primary-bg: rgba(56, 189, 248, 0.12);
      --success: #34d399;
      --warning: #fbbf24;
      --danger: #f87171;
      --border: #1f293d;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      min-height: 100vh;
      font-size: 14px;
    }
    /* Sidebar */
    .sidebar {
      width: 240px;
      background: #0f172a;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 20px 16px;
      gap: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.5px;
      color: var(--text);
    }
    .brand-badge {
      background: var(--primary-bg);
      color: var(--primary);
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid rgba(56, 189, 248, 0.3);
      text-transform: uppercase;
    }
    .nav-list { display: flex; flex-direction: column; gap: 4px; list-style: none; }
    .nav-item button {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      background: transparent;
      border: none;
      color: var(--muted);
      font-weight: 500;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
    }
    .nav-item button:hover { background: rgba(255,255,255,0.05); color: var(--text); }
    .nav-item button.active {
      background: var(--primary-bg);
      color: var(--primary);
      font-weight: 600;
    }
    /* Main Content */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .header {
      height: 64px;
      border-bottom: 1px solid var(--border);
      padding: 0 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(8px);
    }
    .header-title { font-size: 16px; font-weight: 600; }
    .header-tag {
      font-size: 11px;
      font-family: 'JetBrains Mono', monospace;
      color: var(--success);
      background: rgba(52, 211, 153, 0.1);
      padding: 4px 10px;
      border-radius: 9999px;
      border: 1px solid rgba(52, 211, 153, 0.25);
    }
    .content { padding: 28px; display: flex; flex-direction: column; gap: 24px; }

    /* Cards & Grids */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .card-title { font-size: 12px; color: var(--muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 24px; font-weight: 700; color: var(--text); }
    .card-sub { font-size: 11px; color: var(--muted); }

    /* Tables */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
    }
    .table-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .table-title { font-size: 14px; font-weight: 600; }
    .search-box {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #0b0f19;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 6px 12px;
    }
    .search-box input, .search-box select {
      background: transparent;
      border: none;
      color: var(--text);
      font-size: 13px;
      outline: none;
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      background: rgba(255,255,255,0.02);
      padding: 12px 20px;
      font-size: 11px;
      color: var(--muted);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 14px 20px;
      border-bottom: 1px solid var(--card-border);
      font-size: 13px;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }

    /* Badges */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-open { background: rgba(52, 211, 153, 0.15); color: var(--success); }
    .badge-upcoming { background: rgba(56, 189, 248, 0.15); color: var(--primary); }
    .badge-closed { background: rgba(156, 163, 175, 0.15); color: var(--muted); }
    .badge-warning { background: rgba(251, 191, 36, 0.15); color: var(--warning); }
    .badge-danger { background: rgba(248, 113, 113, 0.15); color: var(--danger); }
    .badge-published { background: rgba(52, 211, 153, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); }
    .badge-draft { background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); }
    .badge-archived { background: rgba(156, 163, 175, 0.2); color: #9ca3af; border: 1px solid rgba(156, 163, 175, 0.4); }

    .btn {
      background: var(--primary);
      color: #000;
      font-weight: 600;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-secondary { background: rgba(255,255,255,0.08); color: var(--text); }
    .btn-success { background: var(--success); color: #000; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-warning { background: var(--warning); color: #000; }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 11px;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
    }
    .form-group input, .form-group select {
      background: #0b0f19;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 13px;
      outline: none;
    }
    .form-group input:focus, .form-group select:focus {
      border-color: var(--primary);
    }
    .alert-box {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .alert-box.success { background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.3); color: var(--success); }
    .alert-box.danger { background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.3); color: var(--danger); }
    .alert-box.warning { background: rgba(251, 191, 36, 0.12); border: 1px solid rgba(251, 191, 36, 0.3); color: var(--warning); }

    .mono { font-family: 'JetBrains Mono', monospace; }
    .section-view { display: none; }
    .section-view.active { display: flex; flex-direction: column; gap: 24px; }
  </style>
</head>
<body>

  <!-- Sidebar -->
  <div class="sidebar">
    <div class="brand">
      <span>IPOVault Console</span>
      <span class="brand-badge">Admin Edition</span>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button class="active" onclick="switchTab('dashboard')">📊 Dashboard</button></li>
      <li class="nav-item"><button onclick="switchTab('manual')">📋 Manual IPOs</button></li>
      <li class="nav-item"><button onclick="switchTab('explorer')">🔍 IPO Explorer</button></li>
      <li class="nav-item"><button onclick="switchTab('quality')">🛡️ Data Quality</button></li>
      <li class="nav-item"><button onclick="switchTab('sources')">🔌 Source Health</button></li>
      <li class="nav-item"><button onclick="switchTab('notifications')">🔔 Notifications Ops</button></li>
      <li class="nav-item"><button onclick="switchTab('allotment')">🎯 Allotment Ops</button></li>
    </ul>
  </div>

  <!-- Main View -->
  <div class="main">
    <div class="header">
      <div class="header-title" id="page-title">Backend Observability Dashboard</div>
      <div class="header-tag">Live Admin Console</div>
    </div>

    <div class="content">

      <!-- DASHBOARD TAB -->
      <div id="tab-dashboard" class="section-view active">
        <div class="stats-grid" id="dashboard-kpis">
          <div class="card"><div class="card-title">Total IPOs</div><div class="card-value" id="kpi-total">-</div></div>
          <div class="card"><div class="card-title">Published to Mobile</div><div class="card-value" style="color:var(--success)" id="kpi-published">-</div></div>
          <div class="card"><div class="card-title">Open IPOs</div><div class="card-value" style="color:var(--primary)" id="kpi-open">-</div></div>
          <div class="card"><div class="card-title">Drafts</div><div class="card-value" style="color:var(--warning)" id="kpi-drafts">-</div></div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
          <div class="card">
            <div class="card-title">Data Quality Overview</div>
            <div style="font-size: 20px; font-weight: 700; margin-top: 8px;" id="dash-quality-status">Evaluating...</div>
            <div class="card-sub" id="dash-quality-sub">Canonical schema completeness & freshness</div>
          </div>
          <div class="card">
            <div class="card-title">Pipeline Health Summary</div>
            <div style="font-size: 20px; font-weight: 700; margin-top: 8px;" id="dash-pipeline-status">Healthy</div>
            <div class="card-sub" id="dash-pipeline-sub">Notifications & Allotment check jobs</div>
          </div>
        </div>
      </div>

      <!-- MANUAL IPOs TAB -->
      <div id="tab-manual" class="section-view">
        <div class="stats-grid">
          <div class="card"><div class="card-title">Total Manual IPOs</div><div class="card-value" id="man-total">-</div></div>
          <div class="card"><div class="card-title">Published to Mobile</div><div class="card-value" style="color:var(--success)" id="man-published">-</div></div>
          <div class="card"><div class="card-title">Drafts</div><div class="card-value" style="color:var(--warning)" id="man-drafts">-</div></div>
          <div class="card"><div class="card-title">Archived</div><div class="card-value" style="color:var(--muted)" id="man-archived">-</div></div>
        </div>

        <div class="table-container">
          <div class="table-header">
            <div style="display:flex; align-items:center; gap:16px;">
              <div class="table-title">Manual IPO Management</div>
              <button class="btn" onclick="openCreateModal()">+ Add Manual IPO</button>
            </div>
            <div class="search-box">
              <input type="text" id="man-search-q" placeholder="Search company or symbol..." oninput="debounceFetchManualIpos()" />
              <select id="man-filter-pub" onchange="fetchManualIpos()">
                <option value="">All Publication States</option>
                <option value="PUBLISHED">Published</option>
                <option value="DRAFT">Draft</option>
                <option value="ARCHIVED">Archived</option>
              </select>
              <select id="man-filter-status" onchange="fetchManualIpos()">
                <option value="">All Lifecycle Statuses</option>
                <option value="OPEN">Open</option>
                <option value="UPCOMING">Upcoming</option>
                <option value="CLOSED">Closed</option>
                <option value="ALLOTMENT_COMPLETED">Allotment Completed</option>
              </select>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Symbol / Company</th>
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

      <!-- MANUAL IPO DETAIL & EDITOR TAB -->
      <div id="tab-manual-edit" class="section-view">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <button class="btn btn-secondary" onclick="switchTab('manual')">← Back to Manual IPOs</button>
          <div style="display:flex; gap:10px;">
            <button class="btn btn-success" id="btn-publish-action" onclick="publishCurrentIpo()">🚀 PUBLISH TO MOBILE</button>
            <button class="btn btn-warning" id="btn-unpublish-action" onclick="unpublishCurrentIpo()">⏸️ Unpublish</button>
            <button class="btn btn-secondary" id="btn-archive-action" onclick="archiveCurrentIpo()">📦 Archive</button>
          </div>
        </div>

        <!-- Validation Banner -->
        <div id="validation-banner" style="display:none;" class="alert-box"></div>

        <!-- Document Ingestion Drawer -->
        <div class="card">
          <div class="card-title">RHP / DRHP Document Ingestion & SEBI PDF Parser</div>
          <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
            <div style="display:flex; gap:12px;">
              <input type="text" id="doc-url-input" placeholder="Paste SEBI HTML detail page URL or direct PDF URL..." style="flex:1; background:#0b0f19; border:1px solid var(--card-border); border-radius:8px; padding:8px 12px; color:var(--text);" />
              <button class="btn" onclick="parseDocumentUrl()">Parse URL</button>
            </div>
            <div style="display:flex; gap:12px; align-items:center;">
              <input type="file" id="doc-file-input" accept="application/pdf" style="flex:1; background:#0b0f19; border:1px solid var(--card-border); border-radius:8px; padding:6px 12px; color:var(--text);" />
              <button class="btn btn-secondary" onclick="uploadDocumentFile()">Upload & Parse PDF</button>
            </div>
          </div>
          <div id="parser-review-container" style="display:none; margin-top:14px; flex-direction:column; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <strong style="color:var(--primary); font-size:13px;">Extracted PDF Fields Review</strong>
              <button class="btn btn-secondary" onclick="applyExtractedValuesToForm()">Apply Extracted Fields to Form</button>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr><th>Field</th><th>Extracted Value</th><th>Extraction Status</th></tr>
                </thead>
                <tbody id="extraction-review-body"></tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Canonical IPO Editor Form -->
        <div class="card">
          <div class="card-title">Canonical IPO Information</div>
          <form id="manual-ipo-form" onsubmit="event.preventDefault(); saveManualIpo();" style="display:flex; flex-direction:column; gap:16px; margin-top:12px;">
            <input type="hidden" id="form-ipo-id" />

            <div class="form-grid">
              <div class="form-group">
                <label>Legal Company Name *</label>
                <input type="text" id="form-legalName" required />
              </div>
              <div class="form-group">
                <label>Display Name</label>
                <input type="text" id="form-displayName" />
              </div>
              <div class="form-group">
                <label>CIN</label>
                <input type="text" id="form-cin" placeholder="U27109HR1974PLC007126" />
              </div>
              <div class="form-group">
                <label>Trading Symbol</label>
                <input type="text" id="form-symbol" placeholder="MANIKA" />
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
                <label>Face Value (₹)</label>
                <input type="number" step="0.01" id="form-faceValue" />
              </div>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Total Issue Size (₹ Cr)</label>
                <input type="number" step="0.01" id="form-issueSize" />
              </div>
              <div class="form-group">
                <label>Fresh Issue Size (₹ Cr)</label>
                <input type="number" step="0.01" id="form-freshIssueSize" />
              </div>
              <div class="form-group">
                <label>OFS Size (₹ Cr)</label>
                <input type="number" step="0.01" id="form-ofsSize" />
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
                <label>Listing Date</label>
                <input type="date" id="form-listingDate" />
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
              <input type="text" id="allot-registrar-ipo-code" placeholder="e.g. MANIKA2026" />
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
                  \${ipo.publicationStatus !== 'PUBLISHED'
                    ? \`<button class="btn btn-success" onclick="publishManualIpoDirect('\${ipo.id}')">Publish</button>\`
                    : \`<button class="btn btn-warning" onclick="unpublishManualIpoDirect('\${ipo.id}')">Unpublish</button>\`
                  }
                </div>
              </td>
            </tr>
          \`;
        }).join('');
      } catch (err) {
        console.error('Error fetching manual IPOs:', err);
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
      document.getElementById('form-openDate').value = '';
      document.getElementById('form-closeDate').value = '';
      document.getElementById('form-listingDate').value = '';
      document.getElementById('validation-banner').style.display = 'none';

      switchTab('manual-edit');
    }

    async function editManualIpo(id) {
      switchTab('manual-edit');
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id);
        const json = await res.json();
        const ipo = json.data || json;

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
        document.getElementById('form-issueSize').value = ipo.issueSize ? (ipo.issueSize / 10000000).toFixed(2) : '';
        document.getElementById('form-freshIssueSize').value = ipo.freshIssueSize ? (ipo.freshIssueSize / 10000000).toFixed(2) : '';
        document.getElementById('form-ofsSize').value = ipo.ofsSize ? (ipo.ofsSize / 10000000).toFixed(2) : '';
        document.getElementById('form-openDate').value = ipo.openDate || '';
        document.getElementById('form-closeDate').value = ipo.closeDate || '';
        document.getElementById('form-listingDate').value = ipo.listingDate || '';

        // Allotment config
        if (ipo.allotmentConfig) {
          document.getElementById('allot-registrar-code').value = ipo.allotmentConfig.registrar || '';
          document.getElementById('allot-registrar-ipo-code').value = ipo.allotmentConfig.registrarIpoCode || '';
        } else {
          document.getElementById('allot-registrar-code').value = '';
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
        issueSize: issueSizeVal ? parseFloat(issueSizeVal) * 10000000 : undefined,
        freshIssueSize: freshSizeVal ? parseFloat(freshSizeVal) * 10000000 : undefined,
        ofsSize: ofsSizeVal ? parseFloat(ofsSizeVal) * 10000000 : undefined,
        openDate: document.getElementById('form-openDate').value || undefined,
        closeDate: document.getElementById('form-closeDate').value || undefined,
        listingDate: document.getElementById('form-listingDate').value || undefined,
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
      try {
        const res = await fetch(API_BASE + '/manual-ipos/' + id + '/archive', { method: 'POST' });
        if (res.ok) {
          alert('IPO archived.');
          if (document.getElementById('form-ipo-id').value === id) editManualIpo(id);
          else fetchManualIpos();
        }
      } catch (err) {
        console.error('Archive error:', err);
      }
    }

    async function parseDocumentUrl() {
      const url = document.getElementById('doc-url-input').value.trim();
      const ipoId = document.getElementById('form-ipo-id').value || undefined;
      if (!url) { alert('Please enter a SEBI detail page URL or PDF URL.'); return; }

      try {
        const res = await fetch(API_BASE + '/manual-ipos/parse-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, ipoId }),
        });
        const json = await res.json();
        const data = json.data || json;

        if (data.parsingStatus === 'FAILED') {
          alert('PDF parsing failed: ' + (data.errorMessage || 'Unknown error'));
          return;
        }

        lastExtractionReview = data.extraction;
        renderExtractionReview(data.extraction);
      } catch (err) {
        console.error('Parse URL error:', err);
      }
    }

    async function uploadDocumentFile() {
      const fileInput = document.getElementById('doc-file-input');
      const file = fileInput?.files?.[0];
      const ipoId = document.getElementById('form-ipo-id').value || undefined;
      if (!file) { alert('Please select a PDF file to upload.'); return; }

      const formData = new FormData();
      formData.append('file', file);

      let url = API_BASE + '/manual-ipos/upload';
      if (ipoId) url += '?ipoId=' + encodeURIComponent(ipoId);

      try {
        const res = await fetch(url, {
          method: 'POST',
          body: formData,
        });
        const json = await res.json();
        const data = json.data || json;

        if (data.parsingStatus === 'FAILED') {
          alert('PDF parsing failed: ' + (data.errorMessage || 'Unknown error'));
          return;
        }

        lastExtractionReview = data.extraction;
        renderExtractionReview(data.extraction);
      } catch (err) {
        console.error('Upload PDF error:', err);
      }
    }

    function renderExtractionReview(ext) {
      const container = document.getElementById('parser-review-container');
      const tbody = document.getElementById('extraction-review-body');
      if (!ext || !ext.fields) { container.style.display = 'none'; return; }

      tbody.innerHTML = Object.entries(ext.fields).map(([k, f]) => \`
        <tr>
          <td><strong>\${k}</strong></td>
          <td>\${f.value !== null && f.value !== undefined ? f.value : '<span style="color:var(--muted)">[null]</span>'}</td>
          <td><span class="badge \${f.status === 'FOUND' ? 'badge-open' : 'badge-closed'}">\${f.status}</span></td>
        </tr>
      \`).join('');

      container.style.display = 'flex';
    }

    function applyExtractedValuesToForm() {
      if (!lastExtractionReview || !lastExtractionReview.fields) return;
      const f = lastExtractionReview.fields;

      if (f.legalName?.value) document.getElementById('form-legalName').value = f.legalName.value;
      if (f.cin?.value) document.getElementById('form-cin').value = f.cin.value;
      if (f.priceBandLow?.value) document.getElementById('form-priceBandLow').value = f.priceBandLow.value;
      if (f.priceBandHigh?.value) document.getElementById('form-priceBandHigh').value = f.priceBandHigh.value;
      if (f.lotSize?.value) document.getElementById('form-lotSize').value = f.lotSize.value;
      if (f.faceValue?.value) document.getElementById('form-faceValue').value = f.faceValue.value;
      if (f.ofsSize?.value) document.getElementById('form-ofsSize').value = (f.ofsSize.value / 10000000).toFixed(2);
      if (f.openDate?.value) document.getElementById('form-openDate').value = f.openDate.value;
      if (f.closeDate?.value) document.getElementById('form-closeDate').value = f.closeDate.value;

      alert('Extracted values applied to form! Review and click Save Changes.');
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

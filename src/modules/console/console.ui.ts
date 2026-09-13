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
            <div style="display:flex; align-items:center; gap:12px;">
              <div class="table-title">Manual IPO Management</div>
              <button class="btn" onclick="openCreateModal()">+ Add Manual IPO</button>
              <button class="btn btn-secondary" onclick="triggerJsonImport()">📥 Import JSON</button>
              <input type="file" id="json-file-input" accept=".json,application/json" onchange="handleJsonFileSelect(event)" style="display:none;" />
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

        <!-- Canonical IPO Editor Form -->
        <div class="card">
          <div class="card-title">Canonical IPO Information</div>
          <form id="manual-ipo-form" autocomplete="off" onsubmit="event.preventDefault(); saveManualIpo();" style="display:flex; flex-direction:column; gap:16px; margin-top:12px;">
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
                <label>Total Issue Shares</label>
                <input type="number" id="form-issueShareCount" placeholder="e.g. 10000000" />
              </div>
              <div class="form-group">
                <label>Fresh Issue Shares</label>
                <input type="number" id="form-freshIssueShareCount" placeholder="e.g. 6000000" />
              </div>
              <div class="form-group">
                <label>OFS Shares</label>
                <input type="number" id="form-ofsShareCount" placeholder="e.g. 4000000" />
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

            <div style="border-top:1px solid var(--card-border); margin:12px 0; padding-top:12px;">
              <strong style="color:var(--primary); font-size:14px;">Company Information & Contact</strong>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Website</label>
                <input type="url" id="form-website" placeholder="https://..." />
              </div>
              <div class="form-group">
                <label>Industry</label>
                <input type="text" id="form-industry" placeholder="e.g. Electrical Equipment" />
              </div>
              <div class="form-group">
                <label>Sector</label>
                <input type="text" id="form-sector" placeholder="e.g. Capital Goods" />
              </div>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Phone</label>
                <input type="text" id="form-phone" placeholder="e.g. +91 120 1234567" />
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" id="form-email" placeholder="investors@company.com" />
              </div>
              <div class="form-group">
                <label>Contact Person</label>
                <input type="text" id="form-contactPerson" placeholder="Company Secretary / CS" />
              </div>
            </div>

            <div class="form-group">
              <label>About Company Description</label>
              <textarea id="form-aboutDescription" rows="3" placeholder="Enter company background and business overview..." style="background:#0b0f19; border:1px solid var(--card-border); border-radius:8px; padding:8px 12px; color:var(--text); font-family:inherit; font-size:13px;"></textarea>
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
                <input type="number" id="cat-retail-min-lots" placeholder="1" />
              </div>
              <div class="form-group">
                <label>Retail Max Lots</label>
                <input type="number" id="cat-retail-max-lots" placeholder="13" />
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

            <div style="border-top:1px solid var(--card-border); margin:12px 0; padding-top:12px;">
              <strong style="color:var(--primary); font-size:14px;">Financial History (Latest Fiscal Year)</strong>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>Fiscal Period</label>
                <input type="text" id="fin-period" placeholder="e.g. FY24" />
              </div>
              <div class="form-group">
                <label>Total Assets (₹ Cr)</label>
                <input type="number" step="0.01" id="fin-assets" />
              </div>
              <div class="form-group">
                <label>Total Revenue (₹ Cr)</label>
                <input type="number" step="0.01" id="fin-revenue" />
              </div>
              <div class="form-group">
                <label>PAT (₹ Cr)</label>
                <input type="number" step="0.01" id="fin-pat" />
              </div>
            </div>

            <div class="form-grid">
              <div class="form-group">
                <label>EBITDA (₹ Cr)</label>
                <input type="number" step="0.01" id="fin-ebitda" />
              </div>
              <div class="form-group">
                <label>Net Worth (₹ Cr)</label>
                <input type="number" step="0.01" id="fin-networth" />
              </div>
              <div class="form-group">
                <label>EPS (₹)</label>
                <input type="number" step="0.01" id="fin-eps" />
              </div>
            </div>

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
      document.getElementById('form-issueShareCount').value = '';
      document.getElementById('form-freshIssueShareCount').value = '';
      document.getElementById('form-ofsShareCount').value = '';
      document.getElementById('form-openDate').value = '';
      document.getElementById('form-closeDate').value = '';
      document.getElementById('form-allotmentDate').value = '';
      document.getElementById('form-listingDate').value = '';

      document.getElementById('form-website').value = '';
      document.getElementById('form-industry').value = '';
      document.getElementById('form-sector').value = '';
      document.getElementById('form-phone').value = '';
      document.getElementById('form-email').value = '';
      document.getElementById('form-contactPerson').value = '';
      document.getElementById('form-aboutDescription').value = '';

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

      document.getElementById('fin-period').value = '';
      document.getElementById('fin-assets').value = '';
      document.getElementById('fin-revenue').value = '';
      document.getElementById('fin-pat').value = '';
      document.getElementById('fin-ebitda').value = '';
      document.getElementById('fin-networth').value = '';
      document.getElementById('fin-eps').value = '';

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
        document.getElementById('form-issueShareCount').value = ipo.issueShareCount ?? '';
        document.getElementById('form-freshIssueShareCount').value = ipo.freshIssueShareCount ?? '';
        document.getElementById('form-ofsShareCount').value = ipo.ofsShareCount ?? '';
        document.getElementById('form-openDate').value = ipo.openDate || '';
        document.getElementById('form-closeDate').value = ipo.closeDate || '';
        document.getElementById('form-listingDate').value = ipo.listingDate || '';

        const allotmentEv = ipo.lifecycleEvents?.find(e => e.eventType === 'BASIS_OF_ALLOTMENT');
        document.getElementById('form-allotmentDate').value = allotmentEv ? allotmentEv.eventDate.slice(0, 10) : '';

        // Company
        document.getElementById('form-website').value = ipo.company?.website || '';
        document.getElementById('form-industry').value = ipo.company?.industry || '';
        document.getElementById('form-sector').value = ipo.company?.sector || '';
        document.getElementById('form-phone').value = ipo.company?.phone || '';
        document.getElementById('form-email').value = ipo.company?.email || '';
        document.getElementById('form-contactPerson').value = ipo.company?.contactPerson || '';
        document.getElementById('form-aboutDescription').value = ipo.company?.aboutDescription || '';

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
        const fin = ipo.financials?.[0] || ipo.company?.financials?.[0];
        document.getElementById('fin-period').value = fin?.fiscalPeriod || '';
        document.getElementById('fin-assets').value = fin?.totalAssets ?? '';
        document.getElementById('fin-revenue').value = fin?.totalRevenue ?? '';
        document.getElementById('fin-pat').value = fin?.pat ?? '';
        document.getElementById('fin-ebitda').value = fin?.ebitda ?? '';
        document.getElementById('fin-networth').value = fin?.netWorth ?? '';
        document.getElementById('fin-eps').value = fin?.eps ?? '';

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
        issueSize: issueSizeVal ? parseFloat(issueSizeVal) * 10000000 : undefined,
        freshIssueSize: freshSizeVal ? parseFloat(freshSizeVal) * 10000000 : undefined,
        ofsSize: ofsSizeVal ? parseFloat(ofsSizeVal) * 10000000 : undefined,
        issueShareCount: parseInt(document.getElementById('form-issueShareCount').value, 10) || undefined,
        freshIssueShareCount: parseInt(document.getElementById('form-freshIssueShareCount').value, 10) || undefined,
        ofsShareCount: parseInt(document.getElementById('form-ofsShareCount').value, 10) || undefined,
        openDate: document.getElementById('form-openDate').value || undefined,
        closeDate: document.getElementById('form-closeDate').value || undefined,
        listingDate: document.getElementById('form-listingDate').value || undefined,
        allotmentDate: document.getElementById('form-allotmentDate').value || undefined,

        website: document.getElementById('form-website').value || undefined,
        industry: document.getElementById('form-industry').value || undefined,
        sector: document.getElementById('form-sector').value || undefined,
        phone: document.getElementById('form-phone').value || undefined,
        email: document.getElementById('form-email').value || undefined,
        contactPerson: document.getElementById('form-contactPerson').value || undefined,
        aboutDescription: document.getElementById('form-aboutDescription').value || undefined,

        offerCategories: offerCategories.length > 0 ? offerCategories : undefined,
        participants: participants.length > 0 ? participants : undefined,
        financials: financials.length > 0 ? financials : undefined,
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
          alert('JSON Import Failed: ' + (data.message || res.statusText || 'Invalid JSON format'));
          return;
        }

        alert('✅ Canonical JSON Import Successful!\nIPO saved in DRAFT status with ID: ' + data.id);
        fetchManualIpos();
        editManualIpo(data.id);
      } catch (err: any) {
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

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
      padding: 2px 8px;
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

    .btn {
      background: var(--primary);
      color: #000;
      font-weight: 600;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn-secondary {
      background: rgba(255,255,255,0.08);
      color: var(--text);
    }

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
      <span class="brand-badge">Read-Only</span>
    </div>
    <ul class="nav-list">
      <li class="nav-item"><button class="active" onclick="switchTab('dashboard')">📊 Dashboard</button></li>
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
      <div class="header-tag">Read-Only PostgreSQL View</div>
    </div>

    <div class="content">

      <!-- DASHBOARD TAB -->
      <div id="tab-dashboard" class="section-view active">
        <div class="stats-grid" id="dashboard-kpis">
          <div class="card"><div class="card-title">Total IPOs</div><div class="card-value" id="kpi-total">-</div></div>
          <div class="card"><div class="card-title">Open IPOs</div><div class="card-value" style="color:var(--success)" id="kpi-open">-</div></div>
          <div class="card"><div class="card-title">Upcoming</div><div class="card-value" style="color:var(--primary)" id="kpi-upcoming">-</div></div>
          <div class="card"><div class="card-title">Mainboard / SME</div><div class="card-value" id="kpi-segment">-</div></div>
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

      <!-- EXPLORER TAB -->
      <div id="tab-explorer" class="section-view">
        <div class="table-container">
          <div class="table-header">
            <div class="table-title">Canonical IPO Records</div>
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
        <div class="stats-grid" id="qual-breakdown-grid">
          <!-- Populated dynamically -->
        </div>
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

    function switchTab(tabId) {
      document.querySelectorAll('.nav-item button').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.section-view').forEach(sec => sec.classList.remove('active'));

      const targetBtn = Array.from(document.querySelectorAll('.nav-item button')).find(b => b.textContent.toLowerCase().includes(tabId));
      if (targetBtn) targetBtn.classList.add('active');

      const targetSec = document.getElementById('tab-' + tabId);
      if (targetSec) targetSec.classList.add('active');

      document.getElementById('page-title').textContent = tabId.toUpperCase() + ' — Backend Data Console';

      if (tabId === 'dashboard') loadDashboard();
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
        document.getElementById('kpi-open').textContent = data.ipoCounts?.open ?? 0;
        document.getElementById('kpi-upcoming').textContent = data.ipoCounts?.upcoming ?? 0;
        document.getElementById('kpi-segment').textContent = (data.marketBreakdown?.mainboard ?? 0) + ' / ' + (data.marketBreakdown?.sme ?? 0);
        document.getElementById('dash-quality-status').textContent = 'Evaluated (' + (data.dataQuality?.complete ?? 0) + ' Complete)';
      } catch (err) {
        console.error('Dashboard load error:', err);
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

        // Load Lineage / Provenance
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

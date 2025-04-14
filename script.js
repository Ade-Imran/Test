// --- RemoteStorage Initialization ---
const remoteStorage = new RemoteStorage({ logging: true });
remoteStorage.access.claim('qr-configs',     'rw');
remoteStorage.access.claim('qr-codes',       'rw');
remoteStorage.access.claim('settings/qrGen', 'rw');
remoteStorage.caching.enable('/qr-configs/');
remoteStorage.caching.enable('/qr-codes/');
remoteStorage.caching.enable('/settings/qrGen/');
RemoteStorageWidget.attach(remoteStorage, 'remotestorage-connect-widget');

let qrConfigs = {};
let generatedQRCodes = [];
let qrGenEnabled = true;
let isAdmin = false;
let scanContext = null;
let selectedAdminCategory = null;
let navigationHistory = [];
let lastGeneratedQRCodeData = null;
let chartInstance = null;
let html5QrcodeScanner = null;
let currentQRCode = null;

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

// Load existing data on ready
remoteStorage.on('ready', () => {
  remoteStorage.store.getAll('qr-configs/').then(objs => { qrConfigs = objs || {}; updateQRGenButton(); });
  remoteStorage.store.getAll('qr-codes/').then(objs => { generatedQRCodes = Object.values(objs || {}); showStatistics(); });
  remoteStorage.store.getItem('settings/qrGen/qrGenEnabled').then(val => {
    if (val !== null) qrGenEnabled = (val === 'true');
    updateQRGenButton();
  });
});

// React to remote changes
remoteStorage.store.on('change', evt => {
  if (evt.origin !== 'remote') return;
  if (evt.path.startsWith('qr-configs/')) {
    const cat = evt.path.split('/')[1];
    if (evt.newValue) qrConfigs[cat] = evt.newValue;
    else delete qrConfigs[cat];
    if (selectedAdminCategory === cat) {
      const cfg = qrConfigs[cat] || {};
      document.getElementById('start-time').value = cfg.start || '';
      document.getElementById('end-time').value   = cfg.end   || '';
      document.getElementById('max-claims').value = cfg.maxClaims || 1;
    }
    updateQRGenButton();
  } else if (evt.path.startsWith('qr-codes/')) {
    remoteStorage.store.getAll('qr-codes/').then(objs => {
      generatedQRCodes = Object.values(objs || {});
      showStatistics();
    });
  } else if (evt.path === 'settings/qrGen/qrGenEnabled') {
    qrGenEnabled = (evt.newValue === 'true');
    updateQRGenButton();
  }
});

// UI helpers
function showElement(id) { document.getElementById(id).classList.remove('hidden'); }
function hideElement(id) { document.getElementById(id).classList.add('hidden'); }
function hideAllPanels() { document.querySelectorAll('.panel').forEach(p=>p.classList.add('hidden')); }

function navigateTo(panelId) {
  const current = document.querySelector('.panel:not(.hidden)');
  if (current) navigationHistory.push(current.id);
  hideAllPanels();
  showElement(panelId);
}

function backToPrevious() {
  if (navigationHistory.length) {
    const prev = navigationHistory.pop();
    hideAllPanels();
    showElement(prev);
  } else if (isAdmin) {
    hideAllPanels();
    showElement('admin-dashboard');
  } else {
    backToDashboard();
  }
}

function backToDashboard() {
  navigationHistory = [];
  hideAllPanels();
  showElement('dashboard');
}

function updateQRGenButton() {
  const btn = document.getElementById('qr-gen-btn');
  btn.disabled = !qrGenEnabled;
  btn.innerText = qrGenEnabled ? 'Generate QR Code' : 'QR Code Generation Disabled';
  const statusEl = document.getElementById('qr-gen-status');
  if (statusEl) statusEl.innerText = qrGenEnabled ? 'Enabled' : 'Disabled';
}

// Admin login/logout
function adminLogin() {
  const u = document.getElementById('admin-username').value;
  const p = document.getElementById('admin-password').value;
  if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
    hideElement('login-error');
    isAdmin = true;
    navigateTo('admin-dashboard');
    updateQRGenButton();
  } else {
    showElement('login-error');
    document.getElementById('admin-username').value = '';
    document.getElementById('admin-password').value = '';
  }
}

function logoutAdmin() {
  isAdmin = false;
  document.getElementById('admin-username').value = '';
  document.getElementById('admin-password').value = '';
  backToDashboard();
}

// Admin category selection
function selectAdminCategory(type) {
  if (type === 'male') navigateTo('admin-male-subcategories');
  else if (type === 'female') navigateTo('admin-female-subcategories');
}

function setAdminCategory(category) {
  selectedAdminCategory = category;
  navigationHistory = [];
  navigateTo('admin-settings-form');
  document.getElementById('selected-category-display').innerText = 'Settings for ' + category;
  const cfg = qrConfigs[category] || {};
  document.getElementById('start-time').value = cfg.start || '';
  document.getElementById('end-time').value   = cfg.end   || '';
  document.getElementById('max-claims').value = cfg.maxClaims || 1;
}

// Toggle QR generation
function toggleQRGeneration() {
  qrGenEnabled = !qrGenEnabled;
  remoteStorage.store.put('settings/qrGen/qrGenEnabled', String(qrGenEnabled))
    .then(() => { updateQRGenButton(); alert(`QR Code Generation is now ${qrGenEnabled ? 'Enabled' : 'Disabled'}.`); })
    .catch(console.error);
}

// Save/delete settings
function saveSettings() {
  if (!selectedAdminCategory) return alert('Please select a category first.');
  const start = document.getElementById('start-time').value;
  const end   = document.getElementById('end-time').value;
  const maxC  = parseInt(document.getElementById('max-claims').value,10);
  if (!start || !end || isNaN(maxC)) return alert('Please fill in all fields correctly.');
  const path = `qr-configs/${selectedAdminCategory}`;
  remoteStorage.store.put(path, { start, end, maxClaims: maxC })
    .then(() => alert(`Settings saved for ${selectedAdminCategory}`))
    .catch(console.error);
}

function deleteSettings() {
  if (!selectedAdminCategory) return alert('Please select a category first.');
  const path = `qr-configs/${selectedAdminCategory}`;
  remoteStorage.store.remove(path)
    .then(() => alert(`Settings deleted for ${selectedAdminCategory}`))
    .catch(console.error);
}

// User scanning
function startUserScannerForCategory(category) {
  scanContext = category;
  navigationHistory = [];
  navigateTo('scanner');
  document.getElementById('scanner-title').innerText = 'Scan Your QR Code';
  document.getElementById('qr-reader-results').innerText = '';
  hideElement('claim-btn');
  startScanner();
}

function startUserScanner(userType) {
  scanContext = userType;
  navigationHistory = [];
  navigateTo('scanner');
  document.getElementById('scanner-title').innerText = 'Scan Your QR Code';
  document.getElementById('qr-reader-results').innerText = '';
  hideElement('claim-btn');
  startScanner();
}

// Scanner
function startScanner() {
  document.getElementById('qr-reader-results').innerText = '';
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(console.error);
  }
  html5QrcodeScanner = new Html5QrcodeScanner('qr-reader', { fps: 10, qrbox: 250 }, false);
  html5QrcodeScanner.render(onScanSuccess, onScanError);
}

function onScanSuccess(decodedText) {
  html5QrcodeScanner.clear().catch(console.error);
  validateQRCode(decodedText);
}

function onScanError(err) {
  console.warn('QR scan error:', err);
}

function handleInvalidScan(msg) {
  alert(msg);
  startScanner();
}

// Validation & claim
function validateQRCode(scannedCode) {
  try {
    const data = JSON.parse(scannedCode);
    const match = generatedQRCodes.find(e =>
      e.membership===data.membership &&
      e.name===data.name &&
      e.category===data.category &&
      e.validFrom===data.validFrom &&
      e.validTo===data.validTo
    );
    if (!match) throw new Error('No match');

    const now = new Date();
    if (now < new Date(data.validFrom)) throw new Error('Not yet valid');
    if (now > new Date(data.validTo)) throw new Error('Expired');
    if (scanContext !== data.category) throw new Error('Wrong category');

    const cfg = qrConfigs[data.category];
    if (!cfg) throw new Error('No food available');

    if (match.claims >= cfg.maxClaims) throw new Error('Already claimed');

    currentQRCode = match;
    document.getElementById('qr-reader-results').innerHTML =
      `<strong>Name:</strong> ${match.name} |
       <strong>Membership:</strong> ${match.membership} |
       <strong>Claims:</strong> ${match.claims}/${cfg.maxClaims}`;
    showElement('claim-btn');
  }
  catch (e) {
    document.getElementById('qr-reader-results').innerText = '❌ ' + e.message;
    handleInvalidScan('Invalid QR Code. Please scan a valid one.');
  }
}

function claimFood() {
  if (!currentQRCode) return;
  const idx = generatedQRCodes.findIndex(e => e.membership === currentQRCode.membership);
  if (idx === -1) return;

  const cfg = qrConfigs[currentQRCode.category];
  const now = new Date();
  if (!cfg || now < new Date(cfg.start) || now > new Date(cfg.end) || generatedQRCodes[idx].claims >= cfg.maxClaims) {
    document.getElementById('qr-reader-results').innerText = 'No food available or already claimed!';
    hideElement('claim-btn');
    return;
  }

  generatedQRCodes[idx].claims++;
  currentQRCode = generatedQRCodes[idx];

  remoteStorage.store.update(`qr-codes/${currentQRCode.membership}`, currentQRCode)
    .then(() => {
      document.getElementById('qr-reader-results').innerHTML =
        `<strong>Name:</strong> ${currentQRCode.name} |
         <strong>Membership:</strong> ${currentQRCode.membership} |
         <strong>Claims:</strong> ${currentQRCode.claims}/${cfg.maxClaims}`;
      hideElement('claim-btn');
      showStatistics();
    })
    .catch(console.error);
}

// QR generation
function generateQRCode() {
  document.getElementById('qr-output').innerHTML = '';
  const membership = document.getElementById('membership-number').value.trim();
  const name       = document.getElementById('member-name').value.trim();
  const category   = document.getElementById('member-category').value;
  const validFrom  = document.getElementById('valid-from').value;
  const validTo    = document.getElementById('valid-to').value;

  if (!membership || !name || !validFrom || !validTo) return alert('Please fill in all fields.');
  if (new Date(validFrom) >= new Date(validTo)) return alert('Valid From must be earlier than Valid To.');

  const now = new Date();
  if (generatedQRCodes.find(e => e.membership===membership && new Date(e.validTo)>now)) {
    return alert('A valid QR Code for this membership already exists.');
  }

  const data = { membership, name, category, validFrom, validTo, claims: 0 };
  new QRCode(document.getElementById('qr-output'), {
    text: JSON.stringify(data), width: 128, height: 128
  });
  lastGeneratedQRCodeData = data;

  remoteStorage.store.put(`qr-codes/${membership}`, data)
    .then(() => {
      alert('QR Code generated and synced!');
      showElement('print-btn');
      generatedQRCodes.push(data);
      showStatistics();
    })
    .catch(console.error);
}

// Print
function printQRCode() {
  if (!lastGeneratedQRCodeData) return alert('No QR Code data available for printing.');
  const qrHTML = document.getElementById('qr-output').outerHTML;
  const w = window.open('', 'PrintWindow', 'width=600,height=600');
  w.document.write(`
    <html><head><title>Print QR Code</title>
      <style>
        body { font-family: Arial; margin: 20px; }
        .print-container { text-align: center; }
        .print-container h2, .print-container p { font-weight: bold; }
        @media print {
          body * { visibility: hidden; }
          .print-container, .print-container * { visibility: visible; }
          .print-container { position: absolute; top:0; left:0; width:100%; }
        }
      </style>
    </head><body>
      <div class="print-container" id="print-area">
        <h2>${lastGeneratedQRCodeData.name}</h2>
        <p>Membership Number: ${lastGeneratedQRCodeData.membership}</p>
        <p>Valid From: ${lastGeneratedQRCodeData.validFrom}</p>
        <p>Valid To: ${lastGeneratedQRCodeData.validTo}</p>
        ${qrHTML}
      </div>
      <script>window.print();</script>
    </body></html>
  `);
  w.document.close();
}

// Statistics
function showStatistics() {
  const now = new Date();
  const validCodes = generatedQRCodes.filter(e => new Date(e.validTo) > now);
  const totalRegistered = validCodes.length;
  const totalClaimed = validCodes.filter(e => e.claims > 0).length;
  document.getElementById('stats-summary').innerHTML =
    `<strong>Total Registered:</strong> ${totalRegistered} |
     <strong>Total Claimed:</strong> ${totalClaimed}`;

  const categoryData = {};
  validCodes.forEach(e => {
    categoryData[e.category] = categoryData[e.category] || { registered: 0, claimed: 0 };
    categoryData[e.category].registered++;
    if (e.claims > 0) categoryData[e.category].claimed++;
  });

  const labels = Object.keys(categoryData);
  const registeredData = labels.map(c => categoryData[c].registered);
  const claimedData    = labels.map(c => categoryData[c].claimed);

  const ctx = document.getElementById('chart-canvas').getContext('2d');
  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = registeredData;
    chartInstance.data.datasets[1].data = claimedData;
    chartInstance.update();
  } else {
    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Registered', data: registeredData },
          { label: 'Claimed',    data: claimedData }
        ]
      },
      options: {
        scales: { y: { beginAtZero: true, precision: 0 } },
        plugins: { legend: { display: true } }
      }
    });
  }

  const tbody = document.querySelector('#stats-table tbody');
  tbody.innerHTML = '';
  validCodes.forEach(entry => {
    const tr = document.createElement('tr');
    ['name','membership','category'].forEach(prop => {
      const td = document.createElement('td');
      td.textContent = entry[prop];
      tr.appendChild(td);
    });

    // Claim status
    const tdClaim = document.createElement('td');
    const cfg = qrConfigs[entry.category];
    if (cfg && now >= new Date(cfg.start) && now <= new Date(cfg.end)) {
      for (let i = 0; i < cfg.maxClaims; i++) {
        const span = document.createElement('span');
        span.className = 'claim-box' + (i < entry.claims ? ' claimed' : '');
        tdClaim.appendChild(span);
      }
    } else {
      tdClaim.textContent = 'No food available';
    }
    tr.appendChild(tdClaim);

    // Action
    const tdAct = document.createElement('td');
    const btn = document.createElement('button');
    btn.innerText = 'Delete';
    btn.onclick = () => remoteStorage.store.remove(`qr-codes/${entry.membership}`).catch(console.error);
    tdAct.appendChild(btn);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  });
}

// Search filter
document.getElementById('stats-search').addEventListener('input', () => {
  const val = document.getElementById('stats-search').value.toLowerCase();
  document.querySelectorAll('#stats-table tbody tr').forEach(row => {
    const name = row.cells[0].textContent.toLowerCase();
    const mem  = row.cells[1].textContent.toLowerCase();
    row.style.display = (name.includes(val) || mem.includes(val)) ? '' : 'none';
  });
});

// Initialize
updateQRGenButton();

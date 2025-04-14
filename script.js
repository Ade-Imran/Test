// --- RemoteStorage Initialization & Sync Setup ---
const remoteStorage = new RemoteStorage({ logging: true });

// Claim folders for settings, codes, and UI flags
remoteStorage.access.claim('qr-configs',     'rw');
remoteStorage.access.claim('qr-codes',       'rw');
remoteStorage.access.claim('settings/qrGen', 'rw');

// Enable two-way caching (auto‑sync)
remoteStorage.caching.enable('/qr-configs/');
remoteStorage.caching.enable('/qr-codes/');
remoteStorage.caching.enable('/settings/qrGen/');

// Attach the connect widget into the placeholder div in your HTML
RemoteStorageWidget.attach(remoteStorage, 'remotestorage-connect-widget');

// In‑memory mirrors of remote data
let qrConfigs        = {};   // mirrors all docs under /qr-configs/
let generatedQRCodes = [];   // mirrors all docs under /qr-codes/
let qrGenEnabled     = true; // mirrors /settings/qrGen/qrGenEnabled

// When RemoteStorage is ready, load existing data
remoteStorage.on('ready', () => {
  // Load admin settings
  remoteStorage.store.getAll('qr-configs/').then(objs => {
    qrConfigs = objs || {};
    updateQRGenButton();
  });
  // Load generated QR codes
  remoteStorage.store.getAll('qr-codes/').then(objs => {
    generatedQRCodes = Object.values(objs || {});
    showStatistics();
  });
  // Load QR‑gen toggle
  remoteStorage.store.getItem('settings/qrGen/qrGenEnabled')
    .then(val => {
      if (val !== null) qrGenEnabled = (val === 'true');
      updateQRGenButton();
    });
});

// React to remote changes and update UI in real time
remoteStorage.store.on('change', evt => {
  if (evt.origin !== 'remote') return;

  // Admin settings changed
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
  }
  // Generated QR codes changed
  else if (evt.path.startsWith('qr-codes/')) {
    remoteStorage.store.getAll('qr-codes/').then(objs => {
      generatedQRCodes = Object.values(objs || {});
      showStatistics();
    });
  }
  // QR‑gen toggle changed
  else if (evt.path === 'settings/qrGen/qrGenEnabled') {
    qrGenEnabled = (evt.newValue === 'true');
    updateQRGenButton();
  }
});



// --- Global Constants & Variables ---
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";

// Flag to indicate if admin is logged in.
let isAdmin = false;

// We now store claim count with each generated QR code (via a "claims" property)
let currentQRCode = null;

// (User scanning uses html5QrcodeScanner)
let html5QrcodeScanner = null;

// scanContext: for user scanning it will be the category (e.g. "male-atfal", "female-nasirat", "guest")
let scanContext = null;
let selectedAdminCategory = null;

// Navigation history stack for effective back navigation
let navigationHistory = [];

// Global variable to store last generated QR code data for printing.
let lastGeneratedQRCodeData = null;

// Global variable to hold our Chart.js instance.
let chartInstance = null;

// --- Utility Function to Restart Scanner on Invalid Scan ---
function handleInvalidScan(message) {
  alert(message);
  startScanner();
}

// --- UI Helper Functions ---
function showElement(id) {
  document.getElementById(id).classList.remove("hidden");
}

function hideElement(id) {
  document.getElementById(id).classList.add("hidden");
}

function hideAllPanels() {
  document.querySelectorAll(".panel").forEach(panel => panel.classList.add("hidden"));
}

function navigateTo(panelId) {
  const current = document.querySelector(".panel:not(.hidden)");
  if (current) {
    navigationHistory.push(current.id);
  }
  hideAllPanels();
  showElement(panelId);
}

function backToPrevious() {
  if (navigationHistory.length > 0) {
    const previousPanel = navigationHistory.pop();
    hideAllPanels();
    showElement(previousPanel);
  } else {
    if (isAdmin) {
      hideAllPanels();
      showElement("admin-dashboard");
    } else {
      backToDashboard();
    }
  }
}

function backToDashboard() {
  navigationHistory = [];
  hideAllPanels();
  showElement("dashboard");
}

function updateQRGenButton() {
  const btn = document.getElementById("qr-gen-btn");
  if (qrGenEnabled) {
    btn.disabled = false;
    btn.innerText = "Generate QR Code";
  } else {
    btn.disabled = true;
    btn.innerText = "QR Code Generation Disabled";
  }
  const statusEl = document.getElementById("qr-gen-status");
  if (statusEl) {
    statusEl.innerText = qrGenEnabled ? "Enabled" : "Disabled";
  }
}

// --- Admin Login Functions ---
function adminLogin() {
  const usernameInput = document.getElementById("admin-username");
  const passwordInput = document.getElementById("admin-password");
  const username = usernameInput.value;
  const password = passwordInput.value;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    hideElement("login-error");
    isAdmin = true;
    navigateTo("admin-dashboard");
    updateQRGenButton();
  } else {
    showElement("login-error");
    usernameInput.value = "";
    passwordInput.value = "";
  }
}

// Dedicated Log Out function for admin.
function logoutAdmin() {
  isAdmin = false;
  document.getElementById("admin-username").value = "";
  document.getElementById("admin-password").value = "";
  backToDashboard();
}

// --- Admin Dashboard & Category Selection ---
function selectAdminCategory(type) {
  hideElement("admin-dashboard");
  if (type === "male") {
    navigateTo("admin-male-subcategories");
  } else if (type === "female") {
    navigateTo("admin-female-subcategories");
  }
}

function setAdminCategory(category) {
  selectedAdminCategory = category;
  navigationHistory = [];
  navigateTo("admin-settings-form");
  document.getElementById("selected-category-display").innerText = "Settings for " + category;
  if (qrConfigs[category]) {
    document.getElementById("start-time").value = qrConfigs[category].start || "";
    document.getElementById("end-time").value = qrConfigs[category].end || "";
    document.getElementById("max-claims").value = qrConfigs[category].maxClaims || "1";
  } else {
    document.getElementById("start-time").value = "";
    document.getElementById("end-time").value = "";
    document.getElementById("max-claims").value = "1";
  }
}

// --- Admin Global Control for QR Code Generation ---
function toggleQRGeneration() {
  qrGenEnabled = !qrGenEnabled;
  remoteStorage.store.put('settings/qrGen/qrGenEnabled', String(qrGenEnabled))
    .then(() => {
      updateQRGenButton();
      alert("QR Code Generation is now " + (qrGenEnabled ? "Enabled" : "Disabled") + ".");
    })
    .catch(console.error);
}

// --- Admin Settings: Save & Delete ---
function saveSettings() {
  if (!selectedAdminCategory) {
    alert("Please select a category first.");
    return;
  }
  const start     = document.getElementById("start-time").value;
  const end       = document.getElementById("end-time").value;
  const maxClaims = parseInt(document.getElementById("max-claims").value, 10);
  if (!start || !end || isNaN(maxClaims)) {
    alert("Please fill in all fields correctly.");
    return;
  }
  const path = `qr-configs/${selectedAdminCategory}`;
  remoteStorage.store.put(path, { start, end, maxClaims })
    .then(() => alert("Settings saved for " + selectedAdminCategory))
    .catch(console.error);
}

function deleteSettings() {
  if (!selectedAdminCategory) {
    alert("Please select a category first.");
    return;
  }
  const path = `qr-configs/${selectedAdminCategory}`;
  remoteStorage.store.remove(path)
    .then(() => alert("Settings deleted for " + selectedAdminCategory))
    .catch(console.error);
}

// --- User Scanning Functions ---
function startUserScannerForCategory(category) {
  scanContext = category;
  navigationHistory = [];
  navigateTo("scanner");
  document.getElementById("scanner-title").innerText = "Scan Your QR Code";
  document.getElementById("qr-reader-results").innerText = "";
  hideElement("claim-btn");
  startScanner();
}

function startUserScanner(userType) {
  scanContext = userType;
  navigationHistory = [];
  navigateTo("scanner");
  document.getElementById("scanner-title").innerText = "Scan Your QR Code";
  document.getElementById("qr-reader-results").innerText = "";
  hideElement("claim-btn");
  startScanner();
}

// --- Scanning Functions using Html5QrcodeScanner ---
function startScanner() {
  document.getElementById("qr-reader-results").innerText = "";
  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 }, false);
  html5QrcodeScanner.render(onScanSuccess, onScanError);
}

function onScanSuccess(decodedText, decodedResult) {
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(error => {
      console.error("Failed to clear QR code scanner.", error);
    });
  }
  validateQRCode(decodedText);
}

function onScanError(errorMessage) {
  console.warn("QR scan error: " + errorMessage);
}

function stopScanner() {
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(error => {
      console.error("Failed to clear QR code scanner.", error);
    });
  }
  backToDashboard();
}

// --- Enhanced Validation & Claiming ---
function validateQRCode(scannedCode) {
  try {
    const data = JSON.parse(scannedCode);
    const match = generatedQRCodes.find(entry =>
      entry.membership === data.membership &&
      entry.name === data.name &&
      entry.category === data.category &&
      entry.validFrom === data.validFrom &&
      entry.validTo === data.validTo
    );
    if (!match) {
      document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    const now = new Date();
    if (now < new Date(data.validFrom)) {
      document.getElementById("qr-reader-results").innerText = "⏳ QR Code is not yet valid!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    } else if (now > new Date(data.validTo)) {
      document.getElementById("qr-reader-results").innerText = "❌ QR Code is expired!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    if (scanContext !== data.category) {
      document.getElementById("qr-reader-results").innerText = "Invalid category. Please scan in your respective category panel.";
      handleInvalidScan("Go collect your food at your respective category.");
      return;
    }
    const config = qrConfigs[data.category];
    if (!config) {
      document.getElementById("qr-reader-results").innerText = "Food not available!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    const startTime = new Date(config.start);
    const endTime = new Date(config.end);
    if (now < startTime || now > endTime) {
      document.getElementById("qr-reader-results").innerText = "No food available!";
      handleInvalidScan("No food available");
      return;
    }
    if (match.claims >= parseInt(config.maxClaims, 10)) {
      document.getElementById("qr-reader-results").innerText = "You have already claimed your meal!";
      handleInvalidScan("You have already claimed your meal!");
      return;
    }
    currentQRCode = match;
    document.getElementById("qr-reader-results").innerHTML =
      `<strong>Name:</strong> ${match.name} |
       <strong>Membership:</strong> ${match.membership} |
       <strong>Claims:</strong> ${match.claims}/${config.maxClaims}`;
    showElement("claim-btn");
  } catch (e) {
    console.error("Error parsing QR code data", e);
    document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
    handleInvalidScan("Invalid QR Code. Please scan a valid one.");
  }
}

function claimFood() {
  if (!currentQRCode) return;
  const idx = generatedQRCodes.findIndex(entry =>
    entry.membership === currentQRCode.membership &&
    entry.name === currentQRCode.name &&
    entry.category === currentQRCode.category &&
    entry.validFrom === currentQRCode.validFrom &&
    entry.validTo === currentQRCode.validTo
  );
  if (idx === -1) return;

  const config = qrConfigs[currentQRCode.category];
  const now = new Date();
  const startTime = new Date(config.start);
  const endTime = new Date(config.end);
  if (!config || now < startTime || now > endTime || generatedQRCodes[idx].claims >= parseInt(config.maxClaims,10)) {
    document.getElementById("qr-reader-results").innerText = "No food available or already claimed!";
    hideElement("claim-btn");
    return;
  }

  generatedQRCodes[idx].claims++;
  currentQRCode = generatedQRCodes[idx];

  remoteStorage.store.update(`qr-codes/${currentQRCode.membership}`, currentQRCode)
    .then(() => {
      document.getElementById("qr-reader-results").innerHTML =
        `<strong>Name:</strong> ${currentQRCode.name} |
         <strong>Membership:</strong> ${currentQRCode.membership} |
         <strong>Claims:</strong> ${currentQRCode.claims}/${config.maxClaims}`;
      hideElement("claim-btn");
    })
    .catch(console.error);
}

// --- QR Code Generation Functionality ---
function generateQRCode() {
  document.getElementById("qr-output").innerHTML = "";
  const membership = document.getElementById("membership-number").value.trim();
  const name       = document.getElementById("member-name").value.trim();
  const category   = document.getElementById("member-category").value;
  const validFrom  = document.getElementById("valid-from").value;
  const validTo    = document.getElementById("valid-to").value;

  if (!membership || !name || !validFrom || !validTo) {
    alert("Please fill in all fields.");
    return;
  }
  if (new Date(validFrom) >= new Date(validTo)) {
    alert("Valid From must be earlier than Valid To.");
    return;
  }

  const now = new Date();
  if (generatedQRCodes.find(e => e.membership===membership && new Date(e.validTo)>now)) {
    alert("A valid QR Code for this membership already exists.");
    return;
  }

  const data = { membership, name, category, validFrom, validTo, claims: 0 };
  new QRCode(document.getElementById("qr-output"), {
    text: JSON.stringify(data), width:128, height:128
  });
  lastGeneratedQRCodeData = data;

  remoteStorage.store.put(`qr-codes/${data.membership}`, data)
    .then(() => {
      alert("QR Code generated and synced!");
      showElement("print-btn");
      showStatistics();
    })
    .catch(console.error);
}

// --- Print Functionality ---
function printQRCode() {
  if (!lastGeneratedQRCodeData) {
    alert("No QR Code data available for printing.");
    return;
  }
  const qrOutputContent = document.getElementById("qr-output").outerHTML;
  const printWindow = window.open("", "PrintWindow", "width=600,height=600");
  printWindow.document.write(`
    <html>
      <head>
        <title>Print QR Code</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .print-container { text-align: center; }
          .print-container h2, .print-container p { font-weight: bold; }
          .details { margin-bottom: 20px; }
          .details p { margin: 5px 0; }
          @media print {
            body * { visibility: hidden; }
            .print-container, .print-container * { visibility: visible; }
            .print-container { position: absolute; top: 0; left: 0; width: 100%; }
          }
        </style>
      </head>
      <body>
        <div class="print-container" id="print-area">
          <h2>${lastGeneratedQRCodeData.name}</h2>
          <div class="details">
            <p>Membership Number: ${lastGeneratedQRCodeData.membership}</p>
            <p>Valid From: ${lastGeneratedQRCodeData.validFrom}</p>
            <p>Valid To: ${lastGeneratedQRCodeData.validTo}</p>
          </div>
          ${qrOutputContent}
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// --- Statistics Functionality (Admin Only) ---
function showStatistics() {
  const now = new Date();
  const validCodes = generatedQRCodes.filter(e => new Date(e.validTo) > now);

  const totalRegistered = validCodes.length;
  const totalClaimed    = validCodes.filter(e => e.claims>0).length;
  document.getElementById("stats-summary").innerHTML =
    `<strong>Total Registered:</strong> ${totalRegistered} |
     <strong>Total Claimed:</strong> ${totalClaimed}`;

  const categoryData = {};
  validCodes.forEach(e => {
    if (!categoryData[e.category]) categoryData[e.category] = { registered:0, claimed:0 };
    categoryData[e.category].registered++;
    if (e.claims>0) categoryData[e.category].claimed++;
  });

  const labels        = Object.keys(categoryData);
  const registeredData= labels.map(cat => categoryData[cat].registered);
  const claimedData   = labels.map(cat => categoryData[cat].claimed);

  const ctx = document.getElementById("chart-canvas").getContext("2d");
  if (chartInstance) {
    chartInstance.data.labels           = labels;
    chartInstance.data.datasets[0].data = registeredData;
    chartInstance.data.datasets[1].data = claimedData;
    chartInstance.update();
  } else {
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label:"Registered", data:registeredData },
          { label:"Claimed",    data:claimedData    }
        ]
      },
      options: {
        scales: { y:{ beginAtZero:true, precision:0 } },
        plugins:{ legend:{ display:true } }
      }
    });
  }

  const tbody = document.getElementById("stats-table").querySelector("tbody");
  tbody.innerHTML = "";
  validCodes.forEach(entry => {
    const row = document.createElement("tr");
    ["name","membership","category"].forEach(prop => {
      const td = document.createElement("td");
      td.textContent = entry[prop];
      row.appendChild(td);
    });
    // claim boxes cell
    const claimCell = document.createElement("td");
    const cfg = qrConfigs[entry.category];
    if (cfg && now>=new Date(cfg.start) && now<=new Date(cfg.end)) {
      for (let i=0; i<cfg.maxClaims; i++) {
        const span = document.createElement("span");
        span.className = "claim-box" + (i<entry.claims ? " claimed" : "");
        claimCell.appendChild(span);
      }
    } else {
      claimCell.textContent = "No food available";
    }
    row.appendChild(claimCell);
    // action cell
    const actionCell = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.innerText = "Delete";
    delBtn.onclick = () => {
      remoteStorage.store.remove(`qr-codes/${entry.membership}`)
        .catch(console.error);
    };
    actionCell.appendChild(delBtn);
    row.appendChild(actionCell);

    tbody.appendChild(row);
  });
}

// --- Search Functionality for Statistics ---
function filterStatsTable() {
  const searchValue = document.getElementById("stats-search").value.toLowerCase();
  document.querySelectorAll("#stats-table tbody tr").forEach(row => {
    const nameText       = row.cells[0].textContent.toLowerCase();
    const membershipText = row.cells[1].textContent.toLowerCase();
    row.style.display = (nameText.includes(searchValue) || membershipText.includes(searchValue))
      ? "" : "none";
  });
}

document.getElementById("stats-search").addEventListener("input", filterStatsTable);

// On page load, update the QR generator button state.
updateQRGenButton();

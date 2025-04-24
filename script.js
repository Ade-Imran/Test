// --- Session‑scoped localStorage helper ---
const BROWSER_ID = navigator.userAgent;
function lsKey(key) {
  return `${BROWSER_ID}::${key}`;
}
function lsGet(key, fallback) {
  const v = localStorage.getItem(lsKey(key));
  return v !== null ? JSON.parse(v) : fallback;
}
function lsSet(key, value) {
  localStorage.setItem(lsKey(key), JSON.stringify(value));
}

// --- Global Constants & Variables ---
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
let isAdmin = false;

// Now session‑scoped
let qrConfigs = lsGet("qrConfigs", {});
let currentQRCode = null;
let html5QrcodeScanner = null;
let scanContext = null;
let selectedAdminCategory = null;

// session‑scoped flag
let qrGenEnabled = lsGet("qrGenEnabled", true);

let navigationHistory = [];
let lastGeneratedQRCodeData = null;
let chartInstance = null;

// --- Utility Function to Restart Scanner on Invalid Scan ---
function handleInvalidScan(message) {
  alert(message);
  startScanner();
}

// --- UI Helper Functions ---
function showElement(id) { document.getElementById(id).classList.remove("hidden"); }
function hideElement(id) { document.getElementById(id).classList.add("hidden"); }
function hideAllPanels() { document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden")); }
function navigateTo(panelId) {
  const current = document.querySelector(".panel:not(.hidden)");
  if (current) navigationHistory.push(current.id);
  hideAllPanels();
  showElement(panelId);
}
function backToPrevious() {
  if (navigationHistory.length) {
    const prev = navigationHistory.pop();
    hideAllPanels();
    showElement(prev);
  } else {
    isAdmin ? navigateTo("admin-dashboard") : backToDashboard();
  }
}
function backToDashboard() {
  navigationHistory = [];
  hideAllPanels();
  showElement("dashboard");
}
function updateQRGenButton() {
  const btn = document.getElementById("qr-gen-btn");
  btn.disabled = !qrGenEnabled;
  btn.innerText = qrGenEnabled ? "Generate QR Code" : "QR Code Generation Disabled";
  const statusEl = document.getElementById("qr-gen-status");
  if (statusEl) statusEl.innerText = qrGenEnabled ? "Enabled" : "Disabled";
}

// --- Admin Login Functions ---
function adminLogin() {
  const u = document.getElementById("admin-username").value;
  const p = document.getElementById("admin-password").value;
  if (u === ADMIN_USERNAME && p === ADMIN_PASSWORD) {
    hideElement("login-error");
    isAdmin = true;
    navigateTo("admin-dashboard");
    updateQRGenButton();
  } else {
    showElement("login-error");
    document.getElementById("admin-username").value = "";
    document.getElementById("admin-password").value = "";
  }
}
function logoutAdmin() {
  isAdmin = false;
  document.getElementById("admin-username").value = "";
  document.getElementById("admin-password").value = "";
  backToDashboard();
}

// --- Admin Category Selection ---
function selectAdminCategory(type) {
  hideElement("admin-dashboard");
  navigateTo(type === "male" ? "admin-male-subcategories" : "admin-female-subcategories");
}
function setAdminCategory(category) {
  selectedAdminCategory = category;
  navigationHistory = [];
  navigateTo("admin-settings-form");
  document.getElementById("selected-category-display").innerText = "Settings for " + category;
  const cfg = qrConfigs[category] || {};
  document.getElementById("start-time").value = cfg.start || "";
  document.getElementById("end-time").value   = cfg.end   || "";
  document.getElementById("max-claims").value = cfg.maxClaims || "1";
}

// --- Admin Global Control for QR Generation ---
function toggleQRGeneration() {
  qrGenEnabled = !qrGenEnabled;
  lsSet("qrGenEnabled", qrGenEnabled);
  updateQRGenButton();
  alert("QR Code Generation is now " + (qrGenEnabled ? "Enabled" : "Disabled") + ".");
}

// --- Admin Settings: Save & Delete ---
function saveSettings() {
  if (!selectedAdminCategory) {
    alert("Please select a category first.");
    return;
  }
  const start = document.getElementById("start-time").value;
  const end   = document.getElementById("end-time").value;
  const maxC  = parseInt(document.getElementById("max-claims").value, 10);
  if (!start || !end || isNaN(maxC)) {
    alert("Please fill in all fields correctly.");
    return;
  }
  qrConfigs[selectedAdminCategory] = { start, end, maxClaims: maxC };
  lsSet("qrConfigs", qrConfigs);

  // reset claims for that category
  let codes = lsGet("generatedQRCodes", []);
  codes = codes.map(e => {
    if (e.category === selectedAdminCategory) e.claims = 0;
    return e;
  });
  lsSet("generatedQRCodes", codes);

  alert("Settings saved for " + selectedAdminCategory + ". Claim data cleared for fresh interval.");
}

function deleteSettings() {
  if (!selectedAdminCategory) {
    alert("Please select a category first.");
    return;
  }
  delete qrConfigs[selectedAdminCategory];
  lsSet("qrConfigs", qrConfigs);
  alert("Settings deleted for " + selectedAdminCategory);
}

// --- User Scanning Functions ---
function startUserScannerForCategory(cat) {
  scanContext = cat;
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

// --- Scanning via html5‑qrcode ---
function startScanner() {
  document.getElementById("qr-reader-results").innerText = "";
  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps:10, qrbox:250 }, false);
  html5QrcodeScanner.render(onScanSuccess, onScanError);
}
function onScanSuccess(decodedText) {
  html5QrcodeScanner.clear().catch(console.error);
  validateQRCode(decodedText);
}
function onScanError(err) { console.warn("QR scan error:", err); }
function stopScanner() {
  html5QrcodeScanner?.clear().catch(console.error);
  backToDashboard();
}

// --- Validation & Claiming ---
function validateQRCode(scannedCode) {
  try {
    const data = JSON.parse(scannedCode);
    let codes = lsGet("generatedQRCodes", []);
    const match = codes.find(e =>
      e.membership===data.membership &&
      e.name===data.name &&
      e.category===data.category &&
      e.validFrom===data.validFrom &&
      e.validTo===data.validTo
    );
    if (!match) {
      document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    const now = new Date();
    if (now < new Date(data.validFrom)) {
      document.getElementById("qr-reader-results").innerText = "⏳ Not yet valid!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    if (now > new Date(data.validTo)) {
      document.getElementById("qr-reader-results").innerText = "❌ Expired!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    if (scanContext !== data.category) {
      document.getElementById("qr-reader-results").innerText = "Invalid category.";
      handleInvalidScan("Go collect your food at your respective category.");
      return;
    }
    const cfg = qrConfigs[data.category];
    if (!cfg) {
      document.getElementById("qr-reader-results").innerText = "Food not available!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    if (now < new Date(cfg.start) || now > new Date(cfg.end)) {
      document.getElementById("qr-reader-results").innerText = "No food available!";
      handleInvalidScan("No food available");
      return;
    }
    if (match.claims >= cfg.maxClaims) {
      document.getElementById("qr-reader-results").innerText = "Already claimed!";
      handleInvalidScan("You have already claimed your meal!");
      return;
    }
    currentQRCode = match;
    document.getElementById("qr-reader-results").innerHTML =
      `<strong>Name:</strong> ${match.name} | <strong>Membership:</strong> ${match.membership} | <strong>Claims:</strong> ${match.claims}/${cfg.maxClaims}`;
    showElement("claim-btn");
  } catch (e) {
    console.error(e);
    document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
    handleInvalidScan("Invalid QR Code. Please scan a valid one.");
  }
}

function claimFood() {
  if (!currentQRCode) return;
  let codes = lsGet("generatedQRCodes", []);
  const idx = codes.findIndex(e =>
    e.membership===currentQRCode.membership &&
    e.name===currentQRCode.name &&
    e.category===currentQRCode.category &&
    e.validFrom===currentQRCode.validFrom &&
    e.validTo===currentQRCode.validTo
  );
  if (idx===-1) return;
  const cfg = qrConfigs[currentQRCode.category];
  const now = new Date();
  if (now < new Date(cfg.start) || now > new Date(cfg.end)) {
    document.getElementById("qr-reader-results").innerText = "No food available!";
    handleInvalidScan("No food available");
    return;
  }
  if (codes[idx].claims >= cfg.maxClaims) {
    document.getElementById("qr-reader-results").innerText = "Already claimed!";
    hideElement("claim-btn");
    return;
  }
  codes[idx].claims++;
  lsSet("generatedQRCodes", codes);
  currentQRCode = codes[idx];
  document.getElementById("qr-reader-results").innerHTML =
    `<strong>Name:</strong> ${currentQRCode.name} | <strong>Membership:</strong> ${currentQRCode.membership} | <strong>Claims:</strong> ${currentQRCode.claims}/${cfg.maxClaims}`;
  hideElement("claim-btn");
}

// --- QR Code Generation ---
function generateQRCode() {
  document.getElementById("qr-output").innerHTML = "";
  const membership = document.getElementById("membership-number").value.trim();
  const name       = document.getElementById("member-name").value.trim();
  const category   = document.getElementById("member-category").value;
  const validFrom  = document.getElementById("valid-from").value;
  const validTo    = document.getElementById("valid-to").value;
  if (!membership||!name||!validFrom||!validTo) {
    alert("Please fill in all fields."); return;
  }
  if (new Date(validFrom)>=new Date(validTo)) {
    alert("Valid From must be earlier than Valid To."); return;
  }
  let codes = lsGet("generatedQRCodes", []);
  const now = new Date();
  const dup = codes.find(e=>e.membership===membership && new Date(e.validTo)>now);
  if (dup) {
    alert("A QR Code with this membership number already exists."); return;
  }
  const data = { membership, name, category, validFrom, validTo, claims:0 };
  new QRCode(document.getElementById("qr-output"), {
    text: JSON.stringify(data), width:128, height:128,
    colorDark:"#000000", colorLight:"#ffffff"
  });
  codes.push(data);
  lsSet("generatedQRCodes", codes);
  lastGeneratedQRCodeData = data;
  alert("QR Code generated!");
  showElement("print-btn");
  showStatistics();
}

// --- Print ---
function printQRCode() {
  if (!lastGeneratedQRCodeData) {
    alert("No QR Code data available for printing."); return;
  }
  const qrOutputContent = document.getElementById("qr-output").outerHTML;
  const w = window.open("", "PrintWindow", "width=600,height=600");
  w.document.write(`
    <html><head><title>Print QR Code</title><style>
      body{font-family:Arial;margin:20px;}
      .print-container{text-align:center;}
      .print-container h2,.print-container p{font-weight:bold;}
      .details{margin-bottom:20px;}
      .details p{margin:5px 0;}
      @media print{body *{visibility:hidden}.print-container,*{visibility:visible}.print-container{position:absolute;top:0;left:0;width:100%;}}
    </style></head><body>
      <div class="print-container" id="print-area">
        <h2>${lastGeneratedQRCodeData.name}</h2>
        <div class="details">
          <p>Membership Number: ${lastGeneratedQRCodeData.membership}</p>
          <p>Valid From: ${lastGeneratedQRCodeData.validFrom}</p>
          <p>Valid To: ${lastGeneratedQRCodeData.validTo}</p>
        </div>
        ${qrOutputContent}
      </div>
      <script>window.print();<\/script>
    </body></html>
  `);
  w.document.close();
}

// --- Statistics ---
function showStatistics() {
  let codes = lsGet("generatedQRCodes", []);
  const now = new Date();
  const validCodes = codes.filter(e=>new Date(e.validTo)>now);
  if (codes.length!==validCodes.length) lsSet("generatedQRCodes", validCodes);

  document.getElementById("stats-summary").innerHTML =
    `<strong>Total Registered:</strong> ${validCodes.length} | <strong>Total Claimed:</strong> ${validCodes.filter(e=>e.claims>0).length}`;

  const categoryData = {};
  validCodes.forEach(e=>{
    if (!categoryData[e.category]) categoryData[e.category] = {registered:0,claimed:0};
    categoryData[e.category].registered++;
    if (e.claims>0) categoryData[e.category].claimed++;
  });

  const labels = Object.keys(categoryData);
  const registeredData = labels.map(l=>categoryData[l].registered);
  const claimedData    = labels.map(l=>categoryData[l].claimed);

  const ctx = document.getElementById("chart-canvas").getContext("2d");
  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = registeredData;
    chartInstance.data.datasets[1].data = claimedData;
    chartInstance.update();
  } else {
    chartInstance = new Chart(ctx, {
      type:"bar",
      data:{labels, datasets:[
        {label:"Registered", data:registeredData},
        {label:"Claimed", data:claimedData}
      ]},
      options:{scales:{y:{beginAtZero:true, precision:0}}, plugins:{legend:{display:true}}}
    });
  }

  const tbody = document.getElementById("stats-table").querySelector("tbody");
  tbody.innerHTML = "";
  validCodes.forEach(e=>{
    const row = document.createElement("tr");
    ["name","membership","category"].forEach(f=>{
      const td = document.createElement("td"); td.textContent = e[f]; row.appendChild(td);
    });
    const cfg = qrConfigs[e.category];
    const tdClaim = document.createElement("td");
    if (cfg && now>=new Date(cfg.start) && now<=new Date(cfg.end)) {
      let html="";
      for (let i=0;i<cfg.maxClaims;i++){
        html += i<e.claims ? "<span class='claim-box claimed'></span>" : "<span class='claim-box'></span>";
      }
      tdClaim.innerHTML = html;
    } else tdClaim.textContent = "No food available";
    row.appendChild(tdClaim);

    const tdAction = document.createElement("td");
    const btnDel = document.createElement("button");
    btnDel.innerText = "Delete";
    btnDel.onclick = ()=>{ 
      const all = lsGet("generatedQRCodes", []);
      lsSet("generatedQRCodes", all.filter(x=>x.membership!==e.membership));
      showStatistics();
    };
    tdAction.appendChild(btnDel);
    row.appendChild(tdAction);

    tbody.appendChild(row);
  });
}

// --- Search ---
function filterStatsTable() {
  const v = document.getElementById("stats-search").value.toLowerCase();
  document.querySelectorAll("#stats-table tbody tr").forEach(row=>{
    const n = row.cells[0].textContent.toLowerCase();
    const m = row.cells[1].textContent.toLowerCase();
    row.style.display = (n.includes(v)||m.includes(v)) ? "" : "none";
  });
}
document.getElementById("stats-search").addEventListener("input", filterStatsTable);

// On page load
updateQRGenButton();

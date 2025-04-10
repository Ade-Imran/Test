// --- Global Constants & Variables ---
const ADMIN_USERNAME = "Admin";
const ADMIN_PASSWORD = "admin123";

// Flag to indicate if admin is logged in.
let isAdmin = false;

// Admin only configures timeline and maximum claims.
let qrConfigs = JSON.parse(localStorage.getItem("qrConfigs")) || {};

// We now store claim count with each generated QR code (via a "claims" property)
let currentQRCode = null;

// (User scanning uses html5QrcodeScanner)
let html5QrcodeScanner = null;

// scanContext: for user scanning it will be the category (e.g. "male-atfal", "female-nasirat", "guest")
let scanContext = null;
let selectedAdminCategory = null;

// Global flag for QR Code Generation availability (default enabled)
let qrGenEnabled = localStorage.getItem("qrGenEnabled") === "false" ? false : true;

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
  localStorage.setItem("qrGenEnabled", qrGenEnabled);
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
  const end = document.getElementById("end-time").value;
  const maxClaims = parseInt(document.getElementById("max-claims").value, 10);
  if (!start || !end || isNaN(maxClaims)) {
    alert("Please fill in all fields correctly.");
    return;
  }
  qrConfigs[selectedAdminCategory] = { start, end, maxClaims };
  localStorage.setItem("qrConfigs", JSON.stringify(qrConfigs));
  
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  codes = codes.map(entry => {
    if (entry.category === selectedAdminCategory) {
      entry.claims = 0;
    }
    return entry;
  });
  localStorage.setItem("generatedQRCodes", JSON.stringify(codes));
  
  alert("Settings saved for " + selectedAdminCategory + ". Claim data cleared for fresh interval.");
}

function deleteSettings() {
  if (!selectedAdminCategory) {
    alert("Please select a category first.");
    return;
  }
  delete qrConfigs[selectedAdminCategory];
  localStorage.setItem("qrConfigs", JSON.stringify(qrConfigs));
  alert("Settings deleted for " + selectedAdminCategory);
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
    let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
    const match = codes.find(entry => {
      return entry.membership === data.membership &&
             entry.name === data.name &&
             entry.category === data.category &&
             entry.validFrom === data.validFrom &&
             entry.validTo === data.validTo;
    });
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
      "<strong>Name:</strong> " + match.name +
      " | <strong>Membership:</strong> " + match.membership +
      " | <strong>Claims:</strong> " + match.claims + "/" + config.maxClaims;
    showElement("claim-btn");
  } catch (e) {
    console.error("Error parsing QR code data", e);
    document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
    handleInvalidScan("Invalid QR Code. Please scan a valid one.");
  }
}

function claimFood() {
  if (!currentQRCode) return;
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  let index = codes.findIndex(entry =>
    entry.membership === currentQRCode.membership &&
    entry.name === currentQRCode.name &&
    entry.category === currentQRCode.category &&
    entry.validFrom === currentQRCode.validFrom &&
    entry.validTo === currentQRCode.validTo
  );
  if (index !== -1) {
    const config = qrConfigs[currentQRCode.category];
    if (!config) {
      document.getElementById("qr-reader-results").innerText = "Food not available!";
      return;
    }
    let now = new Date();
    let startTime = new Date(config.start);
    let endTime = new Date(config.end);
    if (now < startTime || now > endTime) {
      document.getElementById("qr-reader-results").innerText = "No food available!";
      handleInvalidScan("No food available");
      return;
    }
    if (codes[index].claims >= parseInt(config.maxClaims, 10)) {
      document.getElementById("qr-reader-results").innerText = "You have already claimed your meal!";
      hideElement("claim-btn");
      return;
    }
    codes[index].claims += 1;
    localStorage.setItem("generatedQRCodes", JSON.stringify(codes));
    currentQRCode = codes[index];
    document.getElementById("qr-reader-results").innerHTML =
      "<strong>Name:</strong> " + currentQRCode.name +
      " | <strong>Membership:</strong> " + currentQRCode.membership +
      " | <strong>Claims:</strong> " + currentQRCode.claims + "/" + config.maxClaims;
    hideElement("claim-btn");
  }
}

// --- QR Code Generation Functionality ---
// Modified duplicate check: allow registration unless a valid (unexpired) QR code already exists for the membership number.
function generateQRCode() {
  document.getElementById("qr-output").innerHTML = "";
  const membership = document.getElementById("membership-number").value.trim();
  const name = document.getElementById("member-name").value.trim();
  const category = document.getElementById("member-category").value;
  const validFrom = document.getElementById("valid-from").value;
  const validTo = document.getElementById("valid-to").value;
  if (!membership || !name || !validFrom || !validTo) {
    alert("Please fill in all fields.");
    return;
  }
  if (new Date(validFrom) >= new Date(validTo)) {
    alert("Valid From must be earlier than Valid To.");
    return;
  }
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  const now = new Date();
  // Only consider duplicates that are still valid (unexpired)
  const duplicate = codes.find(entry => entry.membership === membership && new Date(entry.validTo) > now);
  if (duplicate) {
    alert("A QR Code with this membership number already exists. Please use a different membership number.");
    return;
  }
  const data = { membership, name, category, validFrom, validTo, claims: 0 };
  new QRCode(document.getElementById("qr-output"), {
    text: JSON.stringify(data),
    width: 128,
    height: 128,
    colorDark: "#000000",
    colorLight: "#ffffff"
  });
  saveGeneratedQRCode(data);
  lastGeneratedQRCodeData = data;
  alert("QR Code generated!");
  showElement("print-btn");
  showStatistics();
}

function saveGeneratedQRCode(data) {
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  codes.push(data);
  localStorage.setItem("generatedQRCodes", JSON.stringify(codes));
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
        <script>
          window.print();
        <\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// --- Statistics Functionality (Admin Only) ---
function showStatistics() {
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  const now = new Date();
  // Remove expired codes.
  let validCodes = codes.filter(entry => new Date(entry.validTo) > now);
  if (codes.length !== validCodes.length) {
    localStorage.setItem("generatedQRCodes", JSON.stringify(validCodes));
  }
  
  let totalRegistered = validCodes.length;
  let totalClaimed = validCodes.filter(entry => entry.claims > 0).length;
  
  document.getElementById("stats-summary").innerHTML =
    "<strong>Total Registered:</strong> " + totalRegistered +
    " | <strong>Total Claimed:</strong> " + totalClaimed;
  
  let categoryData = {};
  validCodes.forEach(entry => {
    if (!categoryData[entry.category]) {
      categoryData[entry.category] = { registered: 0, claimed: 0 };
    }
    categoryData[entry.category].registered++;
    if (entry.claims > 0) {
      categoryData[entry.category].claimed++;
    }
  });
  
  const labels = Object.keys(categoryData);
  const registeredData = labels.map(cat => categoryData[cat].registered);
  const claimedData = labels.map(cat => categoryData[cat].claimed);
  
  const ctx = document.getElementById("chart-canvas").getContext("2d");
  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = registeredData;
    chartInstance.data.datasets[1].data = claimedData;
    chartInstance.update();
  } else {
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Registered",
            data: registeredData,
            backgroundColor: "rgba(54, 162, 235, 0.6)"
          },
          {
            label: "Claimed",
            data: claimedData,
            backgroundColor: "rgba(75, 192, 192, 0.6)"
          }
        ]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true,
            precision: 0
          }
        },
        plugins: {
          legend: { display: true }
        }
      }
    });
  }
  
  const tbody = document.getElementById("stats-table").getElementsByTagName("tbody")[0];
  tbody.innerHTML = "";
  validCodes.forEach(entry => {
    const row = document.createElement("tr");
    const cellName = document.createElement("td");
    cellName.textContent = entry.name;
    const cellMembership = document.createElement("td");
    cellMembership.textContent = entry.membership;
    const cellCategory = document.createElement("td");
    cellCategory.textContent = entry.category;
    const cellClaim = document.createElement("td");
    const cellAction = document.createElement("td");
    
    const config = qrConfigs[entry.category];
    if (config) {
      let startTime = config.start ? new Date(config.start) : null;
      let endTime = config.end ? new Date(config.end) : null;
      if (startTime && endTime && now >= startTime && now <= endTime) {
        let boxesHtml = "";
        const maxClaims = parseInt(config.maxClaims, 10);
        const currentClaims = entry.claims ? entry.claims : 0;
        for (let i = 0; i < maxClaims; i++) {
          boxesHtml += i < currentClaims
            ? "<span class='claim-box claimed'></span>"
            : "<span class='claim-box'></span>";
        }
        cellClaim.innerHTML = boxesHtml;
      } else {
        cellClaim.textContent = "No food available";
      }
    } else {
      cellClaim.textContent = "No food available";
    }
    
    const delBtn = document.createElement("button");
    delBtn.innerText = "Delete";
    delBtn.onclick = function() {
      deleteQRCode(entry.membership);
    };
    cellAction.appendChild(delBtn);
    
    row.appendChild(cellName);
    row.appendChild(cellMembership);
    row.appendChild(cellCategory);
    row.appendChild(cellClaim);
    row.appendChild(cellAction);
    tbody.appendChild(row);
  });
}

// --- Search Functionality for Statistics ---
function filterStatsTable() {
  const searchValue = document.getElementById("stats-search").value.toLowerCase();
  const tbody = document.getElementById("stats-table").getElementsByTagName("tbody")[0];
  Array.from(tbody.getElementsByTagName("tr")).forEach(row => {
    const nameText = row.cells[0].textContent.toLowerCase();
    const membershipText = row.cells[1].textContent.toLowerCase();
    if (nameText.includes(searchValue) || membershipText.includes(searchValue)) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

document.getElementById("stats-search").addEventListener("input", filterStatsTable);

// On page load, update the QR generator button state.
updateQRGenButton();

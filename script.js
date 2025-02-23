// --- Global Constants & Variables ---
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin1234";

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

// --- Utility Function to Restart Scanner on Invalid Scan ---
function handleInvalidScan(message) {
  // Show the alert. Once dismissed, restart the scanner.
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
    backToDashboard();
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
  const username = document.getElementById("admin-username").value;
  const password = document.getElementById("admin-password").value;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    hideElement("login-error");
    navigateTo("admin-dashboard");
    updateQRGenButton();
  } else {
    showElement("login-error");
  }
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
  alert("Settings saved for " + selectedAdminCategory);
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

// --- Scanning Functions using Html5QrcodeScanner (for Users) ---
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
  // Validate the scanned QR code with enhanced logic.
  // Note: The "QR Code detected" message is now output only for valid QR codes via validateQRCode().
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
// The validateQRCode function now only writes detection messages for valid QR codes.
// For any invalid scan, it calls handleInvalidScan() so that after the alert the scanner is restarted.
function validateQRCode(scannedCode) {
  try {
    const data = JSON.parse(scannedCode);
    let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
    // Check if the QR code was generated by this website by verifying it exists in the stored list.
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
    // Check QR code validity period.
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
    // Ensure the scanned category matches the panel.
    if (scanContext !== data.category) {
      document.getElementById("qr-reader-results").innerText = "Invalid category. Please scan in your respective category panel.";
      handleInvalidScan("Go collect your food at your respective category.");
      return;
    }
    // Check if admin settings exist for this category.
    const config = qrConfigs[data.category];
    if (!config) {
      document.getElementById("qr-reader-results").innerText = "Food not available!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }
    // Check if current time is within admin's set time window.
    const startTime = new Date(config.start);
    const endTime = new Date(config.end);
    if (now < startTime || now > endTime) {
      document.getElementById("qr-reader-results").innerText = "No food available!";
      handleInvalidScan("No food available");
      return;
    }
    // Check if this QR code has already been claimed to its max.
    if (match.claims >= parseInt(config.maxClaims, 10)) {
      document.getElementById("qr-reader-results").innerText = "You have already claimed your meal!";
      handleInvalidScan("You have already claimed your meal!");
      return;
    }
    // All checks passed – the QR code is valid.
    currentQRCode = match;
    document.getElementById("qr-reader-results").innerText = "✅ QR Code verified. Click below to claim your food.";
    showElement("claim-btn");
  } catch (e) {
    console.error("Error parsing QR code data", e);
    document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
    handleInvalidScan("Invalid QR Code. Please scan a valid one.");
  }
}

// When the user claims food, update the claim count on the QR code.
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
    // Check time window before allowing claim.
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
    currentQRCode = codes[index]; // update local copy
    document.getElementById("qr-reader-results").innerText = "🎉 Food claimed successfully!";
    hideElement("claim-btn");
  }
}

// --- QR Code Generation Functionality ---
// When generating a QR code, add a "claims" property to track claim counts.
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
  const data = { membership, name, category, validFrom, validTo, claims: 0 };
  new QRCode(document.getElementById("qr-output"), {
    text: JSON.stringify(data),
    width: 128,
    height: 128,
    colorDark: "#000000",
    colorLight: "#ffffff"
  });
  saveGeneratedQRCode(data);
  alert("QR Code generated!");
}

function saveGeneratedQRCode(data) {
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  codes.push(data);
  localStorage.setItem("generatedQRCodes", JSON.stringify(codes));
}

// --- Statistics Functionality (Admin Only) ---
function showStatistics() {
  let codes = JSON.parse(localStorage.getItem("generatedQRCodes")) || [];
  const now = new Date();
  const tbody = document.getElementById("stats-table").getElementsByTagName("tbody")[0];
  tbody.innerHTML = "";
  codes.forEach(entry => {
    const row = document.createElement("tr");
    const cellName = document.createElement("td");
    cellName.textContent = entry.name;
    const cellMembership = document.createElement("td");
    cellMembership.textContent = entry.membership;
    const cellCategory = document.createElement("td");
    cellCategory.textContent = entry.category;
    const cellClaim = document.createElement("td");
    
    const config = qrConfigs[entry.category];
    if (config) {
      const startTime = new Date(config.start);
      const endTime = new Date(config.end);
      if (now >= startTime && now <= endTime) {
        let boxesHtml = "";
        const maxClaims = parseInt(config.maxClaims, 10);
        const currentClaims = entry.claims ? entry.claims : 0;
        for (let i = 0; i < maxClaims; i++) {
          if (i < currentClaims) {
            boxesHtml += "<span class='claim-box claimed'></span>";
          } else {
            boxesHtml += "<span class='claim-box'></span>";
          }
        }
        cellClaim.innerHTML = boxesHtml;
      } else {
        cellClaim.textContent = "No food available";
      }
    } else {
      cellClaim.textContent = "No food available";
    }
    
    row.appendChild(cellName);
    row.appendChild(cellMembership);
    row.appendChild(cellCategory);
    row.appendChild(cellClaim);
    tbody.appendChild(row);
  });
}

// On page load, update the QR generator button state.
updateQRGenButton();
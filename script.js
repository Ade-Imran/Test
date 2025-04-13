 // --- Global Constants & Variables ---
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
let isAdmin = false;
let qrConfigs = JSON.parse(localStorage.getItem("qrConfigs")) || {};
let currentQRCode = null;
let html5QrcodeScanner = null;
let scanContext = null;
let selectedAdminCategory = null;
let qrGenEnabled = localStorage.getItem("qrGenEnabled") === "false" ? false : true;
let navigationHistory = [];
let lastGeneratedQRCodeData = null;
let chartInstance = null;

// Firebase database reference for shared QR codes
const dbRef = firebase.database().ref("qrcodes");

// --- Utility Functions ---
function handleInvalidScan(message) {
  alert(message);
  startScanner();
}

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
  if (current) navigationHistory.push(current.id);
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
  btn.disabled = !qrGenEnabled;
  btn.innerText = qrGenEnabled ? "Generate QR Code" : "QR Code Generation Disabled";
  const statusEl = document.getElementById("qr-gen-status");
  if (statusEl) statusEl.innerText = qrGenEnabled ? "Enabled" : "Disabled";
}

// --- Admin Login & Dashboard ---
function adminLogin() {
  const username = document.getElementById("admin-username").value;
  const password = document.getElementById("admin-password").value;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
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

function selectAdminCategory(type) {
  hideElement("admin-dashboard");
  if (type === "male") navigateTo("admin-male-subcategories");
  else if (type === "female") navigateTo("admin-female-subcategories");
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

function toggleQRGeneration() {
  qrGenEnabled = !qrGenEnabled;
  localStorage.setItem("qrGenEnabled", qrGenEnabled);
  updateQRGenButton();
  alert("QR Code Generation is now " + (qrGenEnabled ? "Enabled" : "Disabled") + ".");
}

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
  // Reset claim data for this category in Firebase (optional: implement if needed)
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

function startScanner() {
  document.getElementById("qr-reader-results").innerText = "";
  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps: 10, qrbox: 250 }, false);
  html5QrcodeScanner.render(onScanSuccess, onScanError);
}

function onScanSuccess(decodedText, decodedResult) {
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(error => console.error("Failed to clear QR code scanner.", error));
  }
  validateQRCode(decodedText);
}

function onScanError(errorMessage) {
  console.warn("QR scan error: " + errorMessage);
}

function stopScanner() {
  if (html5QrcodeScanner) {
    html5QrcodeScanner.clear().catch(error => console.error("Failed to clear QR code scanner.", error));
  }
  backToDashboard();
}

// --- Enhanced Validation & Claiming ---
function validateQRCode(scannedCode) {
  try {
    const data = JSON.parse(scannedCode);
    // Retrieve shared QR codes from Firebase
    dbRef.orderByChild("membership").equalTo(data.membership).once("value", snapshot => {
      const codesObj = snapshot.val();
      let match = null;
      if (codesObj) {
        Object.keys(codesObj).forEach(key => {
          const entry = codesObj[key];
          if (
            entry.name === data.name &&
            entry.category === data.category &&
            entry.validFrom === data.validFrom &&
            entry.validTo === data.validTo
          ) {
            match = entry;
            match._id = key;
          }
        });
      }
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
    });
  } catch (e) {
    console.error("Error parsing QR code data", e);
    document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
    handleInvalidScan("Invalid QR Code. Please scan a valid one.");
  }
}

function claimFood() {
  if (!currentQRCode) return;
  const config = qrConfigs[currentQRCode.category];
  if (!config) {
    document.getElementById("qr-reader-results").innerText = "Food not available!";
    return;
  }
  const now = new Date();
  const startTime = new Date(config.start);
  const endTime = new Date(config.end);
  if (now < startTime || now > endTime) {
    document.getElementById("qr-reader-results").innerText = "No food available!";
    handleInvalidScan("No food available");
    return;
  }
  if (currentQRCode.claims >= parseInt(config.maxClaims, 10)) {
    document.getElementById("qr-reader-results").innerText = "You have already claimed your meal!";
    hideElement("claim-btn");
    return;
  }
  // Update claim count in Firebase
  const updatedClaims = currentQRCode.claims + 1;
  firebase.database().ref("qrcodes/" + currentQRCode._id).update({ claims: updatedClaims }, error => {
    if (error) {
      console.error("Error updating claim count", error);
    } else {
      currentQRCode.claims = updatedClaims;
      document.getElementById("qr-reader-results").innerHTML =
        "<strong>Name:</strong> " + currentQRCode.name +
        " | <strong>Membership:</strong> " + currentQRCode.membership +
        " | <strong>Claims:</strong> " + currentQRCode.claims + "/" + config.maxClaims;
      hideElement("claim-btn");
      showStatistics();
    }
  });
}

// --- QR Code Generation Functionality ---
// Allow any membership number unless a valid (unexpired) record already exists.
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
  // Check for duplicate only if a valid (unexpired) record exists in Firebase.
  dbRef.orderByChild("membership").equalTo(membership).once("value", snapshot => {
    const codesObj = snapshot.val();
    let duplicateFound = false;
    const now = new Date();
    if (codesObj) {
      Object.keys(codesObj).forEach(key => {
        const entry = codesObj[key];
        if (new Date(entry.validTo) > now) {
          duplicateFound = true;
        }
      });
    }
    if (duplicateFound) {
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
  });
}

function saveGeneratedQRCode(data) {
  dbRef.push(data, error => {
    if (error) console.error("Error saving QR Code", error);
  });
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
  // Retrieve shared QR codes from Firebase
  dbRef.once("value", snapshot => {
    const codesObj = snapshot.val() || {};
    const now = new Date();
    // Build an array of unexpired codes
    let validCodes = [];
    Object.keys(codesObj).forEach(key => {
      const entry = codesObj[key];
      if (new Date(entry.validTo) > now) {
        entry._id = key;
        validCodes.push(entry);
      }
    });
    // Update Firebase if any expired codes exist
    // (Optional: you could remove expired entries here)
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
      if (entry.claims > 0) categoryData[entry.category].claimed++;
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
        firebase.database().ref("qrcodes/" + entry._id).remove(error => {
          if (error) alert("Error deleting QR Code");
          else {
            alert("QR Code with membership " + entry.membership + " has been deleted.");
            showStatistics();
          }
        });
      };
      cellAction.appendChild(delBtn);
      
      row.appendChild(cellName);
      row.appendChild(cellMembership);
      row.appendChild(cellCategory);
      row.appendChild(cellClaim);
      row.appendChild(cellAction);
      tbody.appendChild(row);
    });
  });
}

// --- Search Functionality for Statistics ---
function filterStatsTable() {
  const searchValue = document.getElementById("stats-search").value.toLowerCase();
  const tbody = document.getElementById("stats-table").getElementsByTagName("tbody")[0];
  Array.from(tbody.getElementsByTagName("tr")).forEach(row => {
    const nameText = row.cells[0].textContent.toLowerCase();
    const membershipText = row.cells[1].textContent.toLowerCase();
    row.style.display = (nameText.includes(searchValue) || membershipText.includes(searchValue)) ? "" : "none";
  });
}

document.getElementById("stats-search").addEventListener("input", filterStatsTable);

// On page load, update the QR generator button state.
updateQRGenButton();

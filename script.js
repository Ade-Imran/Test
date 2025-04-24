
// --- Firestore Helper Functions ---
const BROWSER_ID = navigator.userAgent;

async function lsKey(key) {
  return `${BROWSER_ID}::${key}`;
}

async function lsGet(key, fallback) {
  const docRef = db.collection('localStorage').doc(await lsKey(key));
  const doc = await docRef.get();
  return doc.exists ? doc.data().value : fallback;
}

async function lsSet(key, value) {
  const docRef = db.collection('localStorage').doc(await lsKey(key));
  await docRef.set({ value });
}

// --- Global Constants & Variables ---
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
let isAdmin = false;

// Now session‑scoped
let qrConfigs = await lsGet("qrConfigs", {});
let currentQRCode = null;
let html5QrcodeScanner = null;
let scanContext = null;
let selectedAdminCategory = null;

// session‑scoped flag
let qrGenEnabled = await lsGet("qrGenEnabled", true);

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
async function adminLogin() {
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
async function logoutAdmin() {
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
async function setAdminCategory(category) {
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
async function toggleQRGeneration() {
  qrGenEnabled = !qrGenEnabled;
  await lsSet("qrGenEnabled", qrGenEnabled);
  updateQRGenButton();
  alert("QR Code Generation is now " + (qrGenEnabled ? "Enabled" : "Disabled") + ".");
}

// --- Admin Settings: Save & Delete ---
async function saveSettings() {
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
  await lsSet("qrConfigs", qrConfigs);

  // reset claims for that category
  let codes = await lsGet("generatedQRCodes", []);
  codes = codes.map(e => {
    if (e.category === selectedAdminCategory) e.claims = 0;
    return e;
  });
  await lsSet("generatedQRCodes", codes);

  alert("Settings saved for " + selectedAdminCategory + ". Claim data cleared for fresh interval.");
}

async function deleteSettings() {
  if (!selectedAdminCategory) {
    alert("Please select a category first.");
    return;
  }
  delete qrConfigs[selectedAdminCategory];
  await lsSet("qrConfigs", qrConfigs);
  alert("Settings deleted for " + selectedAdminCategory);
}

// --- User Scanning Functions ---
async function startUserScannerForCategory(cat) {
  scanContext = cat;
  navigationHistory = [];
  navigateTo("scanner");
  document.getElementById("scanner-title").innerText = "Scan Your QR Code";
  document.getElementById("qr-reader-results").innerText = "";
  hideElement("claim-btn");
  startScanner();
}
async function startUserScanner(userType) {
  scanContext = userType;
  navigationHistory = [];
  navigateTo("scanner");
  document.getElementById("scanner-title").innerText = "Scan Your QR Code";
  document.getElementById("qr-reader-results").innerText = "";
  hideElement("claim-btn");
  startScanner();
}

// --- Scanning via html5-qrcode ---
function startScanner() {
  document.getElementById("qr-reader-results").innerText = "";
  html5QrcodeScanner = new Html5QrcodeScanner("qr-reader", { fps:10, qrbox:250 }, false);
  html5QrcodeScanner.render(onScanSuccess, onScanError);
}

function onScanSuccess(decodedText) {
  html5QrcodeScanner.clear().catch(console.error);
  validateQRCode(decodedText);
}

function onScanError(err) { 
  console.warn("QR scan error:", err); 
}

function stopScanner() {
  html5QrcodeScanner?.clear().catch(console.error);
  backToDashboard();
}

// --- Validation & Claiming ---
async function validateQRCode(scannedCode) {
  try {
    const data = JSON.parse(scannedCode);

    // Query Firestore to find a matching QR code document
    const q = query(collection(db, "generatedQRCodes"), 
                    where("membership", "==", data.membership),
                    where("name", "==", data.name),
                    where("category", "==", data.category),
                    where("validFrom", "==", data.validFrom),
                    where("validTo", "==", data.validTo));
    
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      document.getElementById("qr-reader-results").innerText = "❌ Invalid QR Code!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }

    const match = querySnapshot.docs[0].data();
    const now = new Date();

    if (now < new Date(match.validFrom)) {
      document.getElementById("qr-reader-results").innerText = "⏳ Not yet valid!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }

    if (now > new Date(match.validTo)) {
      document.getElementById("qr-reader-results").innerText = "❌ Expired!";
      handleInvalidScan("Invalid QR Code. Please scan a valid one.");
      return;
    }

    if (scanContext !== match.category) {
      document.getElementById("qr-reader-results").innerText = "Invalid category.";
      handleInvalidScan("Go collect your food at your respective category.");
      return;
    }

    const cfg = qrConfigs[match.category];
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

async function claimFood() {
  if (!currentQRCode) return;

  // Query Firestore to find the QR code document
  const q = query(collection(db, "generatedQRCodes"), 
                  where("membership", "==", currentQRCode.membership),
                  where("name", "==", currentQRCode.name),
                  where("category", "==", currentQRCode.category),
                  where("validFrom", "==", currentQRCode.validFrom),
                  where("validTo", "==", currentQRCode.validTo));

  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) return;

  const qrCodeDoc = querySnapshot.docs[0];
  const qrCodeData = qrCodeDoc.data();
  const cfg = qrConfigs[currentQRCode.category];
  const now = new Date();

  if (now < new Date(cfg.start) || now > new Date(cfg.end)) {
    document.getElementById("qr-reader-results").innerText = "No food available!";
    handleInvalidScan("No food available");
    return;
  }

  if (qrCodeData.claims >= cfg.maxClaims) {
    document.getElementById("qr-reader-results").innerText = "Already claimed!";
    hideElement("claim-btn");
    return;
  }

  // Increment claims and update Firestore
  await updateDoc(qrCodeDoc.ref, {
    claims: qrCodeData.claims + 1
  });

  currentQRCode.claims++;
  document.getElementById("qr-reader-results").innerHTML =
    `<strong>Name:</strong> ${currentQRCode.name} | <strong>Membership:</strong> ${currentQRCode.membership} | <strong>Claims:</strong> ${currentQRCode.claims}/${cfg.maxClaims}`;
  hideElement("claim-btn");
}

// --- QR Code Generation ---
async function generateQRCode() {
  document.getElementById("qr-output").innerHTML = "";

  const membership = document.getElementById("membership-number").value.trim();
  const name       = document.getElementById("member-name").value.trim();
  const category   = document.getElementById("member-category").value;
  const validFrom  = document.getElementById("valid-from").value;
  const validTo    = document.getElementById("valid-to").value;

  if (!membership || !name || !validFrom || !validTo) {
    alert("Please fill in all fields."); return;
  }

  if (new Date(validFrom) >= new Date(validTo)) {
    alert("Valid From must be earlier than Valid To."); return;
  }

  // Check for duplicates in Firestore
  const q = query(collection(db, "generatedQRCodes"), 
                  where("membership", "==", membership), 
                  where("validTo", ">", new Date()));

  const querySnapshot = await getDocs(q);
  if (!querySnapshot.empty) {
    alert("A QR Code with this membership number already exists."); return;
  }

  const data = { membership, name, category, validFrom, validTo, claims: 0 };
  
  // Generate QR Code and display
  new QRCode(document.getElementById("qr-output"), {
    text: JSON.stringify(data),
    width: 128,
    height: 128,
    colorDark: "#000000",
    colorLight: "#ffffff"
  });

  // Save QR code data to Firestore
  await addDoc(collection(db, "generatedQRCodes"), data);

  lastGeneratedQRCodeData = data;
  alert("QR Code generated!");
  showElement("print-btn");
  showStatistics();
}

// --- Statistics Display ---
async function showStatistics() {
  const q = query(collection(db, "generatedQRCodes"), where("validTo", ">", new Date()));
  const querySnapshot = await getDocs(q);
  
  const validCodes = querySnapshot.docs.map(doc => doc.data());
  document.getElementById("stats-summary").innerHTML =
    `<strong>Total Registered:</strong> ${validCodes.length} | <strong>Total Claimed:</strong> ${validCodes.filter(e => e.claims > 0).length}`;

  const categoryData = {};
  validCodes.forEach(e => {
    if (!categoryData[e.category]) categoryData[e.category] = { registered: 0, claimed: 0 };
    categoryData[e.category].registered++;
    if (e.claims > 0) categoryData[e.category].claimed++;
  });

  const labels = Object.keys(categoryData);
  const registeredData = labels.map(l => categoryData[l].registered);
  const claimedData = labels.map(l => categoryData[l].claimed);

  const ctx = document.getElementById("chart-canvas").getContext("2d");
  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = registeredData;
    chartInstance.data.datasets[1].data = claimedData;
    chartInstance.update();
  } else {
    chartInstance = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [
        { label: "Registered", data: registeredData },
        { label: "Claimed", data: claimedData }
      ]},
      options: { scales: { y: { beginAtZero: true, precision: 0 } }, plugins: { legend: { display: true } } }
    });
  }

  const tbody = document.getElementById("stats-table").querySelector("tbody");
  tbody.innerHTML = "";
  validCodes.forEach(e => {
    const row = document.createElement("tr");
    ["name", "membership", "category"].forEach(f => {
      const td = document.createElement("td");
      td.textContent = e[f]; row.appendChild(td);
    });

    const cfg = qrConfigs[e.category];
    const tdClaim = document.createElement("td");
    if (cfg && new Date() >= new Date(cfg.start) && new Date() <= new Date(cfg.end)) {
      let html = "";
      for (let i = 0; i < cfg.maxClaims; i++) {
        html += i < e.claims ? "<span class='claim-box claimed'></span>" : "<span class='claim-box'></span>";
      }
      tdClaim.innerHTML = html;
    } else tdClaim.textContent = "No food available";
    row.appendChild(tdClaim);

    const tdAction = document.createElement("td");
    const btnDel = document.createElement("button");
    btnDel.innerText = "Delete";
    btnDel.onclick = async () => { 
      const all = await getDocs(collection(db, "generatedQRCodes"));
      const docRef = all.docs.find(doc => doc.data().membership === e.membership).ref;
      await deleteDoc(docRef);
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
  document.querySelectorAll("#stats-table tbody tr").forEach(row => {
    const n = row.cells[0].textContent.toLowerCase();
    const m = row.cells[1].textContent.toLowerCase();
    row.style.display = (n.includes(v) || m.includes(v)) ? "" : "none";
  });
}
document.getElementById("stats-search").addEventListener("input", filterStatsTable);

// On page load
updateQRGenButton();


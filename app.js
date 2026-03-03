// ============================================
// FLIGHTLOG - Main App Logic
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  query, orderBy, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ---- FIREBASE CONFIG (replace with your config) ----
const firebaseConfig = {
  apiKey: "REPLACE_WITH_YOUR_API_KEY",
  authDomain: "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  projectId: "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket: "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId: "REPLACE_WITH_YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- STATE ----
let currentUser = null;
let allFlights = [];
let editingId = null;
let charts = {};
let unsubscribeFlights = null;

// ---- DOM REFS ----
const authScreen = document.getElementById('auth-screen');
const mainScreen = document.getElementById('main-screen');
const googleSigninBtn = document.getElementById('google-signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const userAvatar = document.getElementById('user-avatar');
const logList = document.getElementById('log-list');
const logSearch = document.getElementById('log-search');
const saveEntryBtn = document.getElementById('save-entry-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const summaryFilter = document.getElementById('summary-filter');
const summaryContent = document.getElementById('summary-content');
const entryModal = document.getElementById('entry-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const modalEditBtn = document.getElementById('modal-edit-btn');
const modalDeleteBtn = document.getElementById('modal-delete-btn');
const formTitle = document.getElementById('form-title');
const toast = document.getElementById('toast');

// ---- AUTH ----
googleSigninBtn.addEventListener('click', async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    showToast('Sign-in failed. Try again.');
  }
});

signoutBtn.addEventListener('click', async () => {
  if (unsubscribeFlights) unsubscribeFlights();
  await signOut(auth);
});

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (user) {
    authScreen.classList.remove('active');
    mainScreen.classList.add('active');
    userAvatar.src = user.photoURL || '';
    subscribeToFlights();
  } else {
    authScreen.classList.add('active');
    mainScreen.classList.remove('active');
    allFlights = [];
  }
});

// ---- FIRESTORE ----
function subscribeToFlights() {
  const q = query(collection(db, `users/${currentUser.uid}/flights`), orderBy('date', 'desc'));
  unsubscribeFlights = onSnapshot(q, snapshot => {
    allFlights = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderLogList();
    renderSummary();
    renderGraphs();
  });
}

async function saveFlight(data) {
  const col = collection(db, `users/${currentUser.uid}/flights`);
  if (editingId) {
    await updateDoc(doc(db, `users/${currentUser.uid}/flights`, editingId), data);
    showToast('Flight updated ✓');
  } else {
    await addDoc(col, data);
    showToast('Flight saved ✓');
  }
}

async function deleteFlight(id) {
  await deleteDoc(doc(db, `users/${currentUser.uid}/flights`, id));
  showToast('Flight deleted');
}

// ---- TAB NAVIGATION ----
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    if (tab === 'graphs') setTimeout(renderGraphs, 50);
  });
});

// ---- LOG LIST ----
function renderLogList(filter = '') {
  const filtered = allFlights.filter(f => {
    const q = filter.toLowerCase();
    return !q || (f.route || '').toLowerCase().includes(q)
      || (f.aircraftType || '').toLowerCase().includes(q)
      || (f.tail || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    logList.innerHTML = `<div class="empty-state">${filter ? 'No matching flights.' : 'No flights logged yet. Add your first entry!'}</div>`;
    return;
  }

  logList.innerHTML = filtered.map(f => {
    const tags = [];
    if (+f.xc > 0) tags.push('XC');
    if (+f.night > 0) tags.push('NIGHT');
    if (+f.actualImc > 0 || +f.simImc > 0) tags.push('IMC');
    if (+f.pic > 0) tags.push('PIC');

    return `
    <div class="log-entry" data-id="${f.id}">
      <div class="log-entry-left">
        <div class="log-date">${formatDate(f.date)}</div>
        <div class="log-route">${f.route || '—'}</div>
        <div class="log-aircraft">${[f.aircraftType, f.tail].filter(Boolean).join(' · ') || '—'}</div>
        ${tags.length ? `<div class="log-tags">${tags.map(t => `<span class="log-tag">${t}</span>`).join('')}</div>` : ''}
      </div>
      <div class="log-entry-right">
        <div class="log-total-time">${(+f.total || 0).toFixed(1)}</div>
        <div class="log-total-label">hrs</div>
      </div>
    </div>`;
  }).join('');

  logList.querySelectorAll('.log-entry').forEach(el => {
    el.addEventListener('click', () => openModal(el.dataset.id));
  });
}

logSearch.addEventListener('input', () => renderLogList(logSearch.value));

// ---- MODAL ----
function openModal(id) {
  const f = allFlights.find(x => x.id === id);
  if (!f) return;

  modalTitle.textContent = f.route || 'Flight Details';

  modalBody.innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Date</div><div class="detail-value">${formatDate(f.date)}</div></div>
      <div class="detail-item"><div class="detail-label">Aircraft</div><div class="detail-value">${f.aircraftType || '—'}</div></div>
      <div class="detail-item"><div class="detail-label">Tail Number</div><div class="detail-value">${f.tail || '—'}</div></div>
      <div class="detail-item"><div class="detail-label">Total Time</div><div class="detail-value">${(+f.total||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">Cross-Country</div><div class="detail-value">${(+f.xc||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">Night</div><div class="detail-value">${(+f.night||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">Actual IMC</div><div class="detail-value">${(+f.actualImc||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">Sim IMC</div><div class="detail-value">${(+f.simImc||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">PIC</div><div class="detail-value">${(+f.pic||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">Dual Received</div><div class="detail-value">${(+f.dual||0).toFixed(1)} hrs</div></div>
      <div class="detail-item"><div class="detail-label">Day Landings</div><div class="detail-value">${+f.dayLdg||0}</div></div>
      <div class="detail-item"><div class="detail-label">Night Landings</div><div class="detail-value">${+f.nightLdg||0}</div></div>
    </div>
    ${f.remarks ? `<div class="detail-remarks">${f.remarks}</div>` : ''}`;

  modalEditBtn.onclick = () => { closeModal(); loadEditForm(id); };
  modalDeleteBtn.onclick = async () => {
    if (confirm('Delete this flight?')) {
      await deleteFlight(id);
      closeModal();
    }
  };

  entryModal.style.display = 'flex';
}

function closeModal() { entryModal.style.display = 'none'; }
entryModal.addEventListener('click', e => { if (e.target === entryModal) closeModal(); });
document.querySelector('.modal-close').addEventListener('click', closeModal);

// ---- FORM ----
function getField(id) { return document.getElementById(id); }

function clearForm() {
  ['f-date','f-aircraft-type','f-tail','f-route','f-total','f-xc','f-night',
   'f-actual-imc','f-sim-imc','f-pic','f-dual','f-day-ldg','f-night-ldg','f-remarks'].forEach(id => {
    getField(id).value = '';
  });
  getField('edit-id').value = '';
  editingId = null;
  formTitle.textContent = 'New Flight Entry';
  cancelEditBtn.style.display = 'none';
  saveEntryBtn.textContent = 'Save Flight Entry';

  // Set today's date as default
  getField('f-date').value = new Date().toISOString().split('T')[0];
}

function loadEditForm(id) {
  const f = allFlights.find(x => x.id === id);
  if (!f) return;
  editingId = id;

  getField('f-date').value = f.date || '';
  getField('f-aircraft-type').value = f.aircraftType || '';
  getField('f-tail').value = f.tail || '';
  getField('f-route').value = f.route || '';
  getField('f-total').value = f.total || '';
  getField('f-xc').value = f.xc || '';
  getField('f-night').value = f.night || '';
  getField('f-actual-imc').value = f.actualImc || '';
  getField('f-sim-imc').value = f.simImc || '';
  getField('f-pic').value = f.pic || '';
  getField('f-dual').value = f.dual || '';
  getField('f-day-ldg').value = f.dayLdg || '';
  getField('f-night-ldg').value = f.nightLdg || '';
  getField('f-remarks').value = f.remarks || '';

  formTitle.textContent = 'Edit Flight Entry';
  cancelEditBtn.style.display = 'block';
  saveEntryBtn.textContent = 'Update Flight Entry';

  // Switch to new-entry tab
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('[data-tab="new-entry"]').classList.add('active');
  document.getElementById('tab-new-entry').classList.add('active');
}

cancelEditBtn.addEventListener('click', clearForm);

saveEntryBtn.addEventListener('click', async () => {
  const data = {
    date: getField('f-date').value,
    aircraftType: getField('f-aircraft-type').value.toUpperCase(),
    tail: getField('f-tail').value.toUpperCase(),
    route: getField('f-route').value.toUpperCase(),
    total: parseFloat(getField('f-total').value) || 0,
    xc: parseFloat(getField('f-xc').value) || 0,
    night: parseFloat(getField('f-night').value) || 0,
    actualImc: parseFloat(getField('f-actual-imc').value) || 0,
    simImc: parseFloat(getField('f-sim-imc').value) || 0,
    pic: parseFloat(getField('f-pic').value) || 0,
    dual: parseFloat(getField('f-dual').value) || 0,
    dayLdg: parseInt(getField('f-day-ldg').value) || 0,
    nightLdg: parseInt(getField('f-night-ldg').value) || 0,
    remarks: getField('f-remarks').value,
    updatedAt: new Date().toISOString()
  };

  if (!data.date) { showToast('Please enter a date'); return; }

  saveEntryBtn.disabled = true;
  saveEntryBtn.textContent = 'Saving...';
  try {
    await saveFlight(data);
    clearForm();
    // Go back to logbook
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('[data-tab="logbook"]').classList.add('active');
    document.getElementById('tab-logbook').classList.add('active');
  } catch(e) {
    showToast('Error saving. Try again.');
  }
  saveEntryBtn.disabled = false;
  saveEntryBtn.textContent = editingId ? 'Update Flight Entry' : 'Save Flight Entry';
});

// ---- SUMMARY ----
function getFilteredFlights() {
  const f = summaryFilter.value;
  const now = new Date();
  if (f === 'all') return allFlights;
  return allFlights.filter(fl => {
    const d = new Date(fl.date);
    if (f === 'year') return d.getFullYear() === now.getFullYear();
    if (f === '90') return (now - d) / 86400000 <= 90;
    if (f === '30') return (now - d) / 86400000 <= 30;
    return true;
  });
}

function sum(flights, key) {
  return flights.reduce((acc, f) => acc + (+f[key] || 0), 0);
}

function renderSummary() {
  const flights = getFilteredFlights();
  const totalHrs = sum(flights, 'total');
  const nightHrs = sum(flights, 'night');
  const xcHrs = sum(flights, 'xc');
  const picHrs = sum(flights, 'pic');
  const dualHrs = sum(flights, 'dual');
  const actualImc = sum(flights, 'actualImc');
  const simImc = sum(flights, 'simImc');
  const dayLdg = sum(flights, 'dayLdg');
  const nightLdg = sum(flights, 'nightLdg');

  summaryContent.innerHTML = `
    <div class="stat-card highlight wide">
      <div class="stat-label">Total Flight Time</div>
      <div class="stat-value">${totalHrs.toFixed(1)}</div>
      <div class="stat-sub">${flights.length} flights logged</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">PIC Time</div>
      <div class="stat-value">${picHrs.toFixed(1)}</div>
      <div class="stat-sub">hrs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Dual Received</div>
      <div class="stat-value">${dualHrs.toFixed(1)}</div>
      <div class="stat-sub">hrs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Cross-Country</div>
      <div class="stat-value">${xcHrs.toFixed(1)}</div>
      <div class="stat-sub">hrs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Night Time</div>
      <div class="stat-value">${nightHrs.toFixed(1)}</div>
      <div class="stat-sub">hrs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Actual IMC</div>
      <div class="stat-value">${actualImc.toFixed(1)}</div>
      <div class="stat-sub">hrs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Simulated IMC</div>
      <div class="stat-value">${simImc.toFixed(1)}</div>
      <div class="stat-sub">hrs</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Day Landings</div>
      <div class="stat-value">${dayLdg}</div>
      <div class="stat-sub">total</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">Night Landings</div>
      <div class="stat-value">${nightLdg}</div>
      <div class="stat-sub">total</div>
    </div>`;
}

summaryFilter.addEventListener('change', () => { renderSummary(); });

// ---- GRAPHS ----
function getChartColors() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    text: dark ? '#a8c0e8' : '#3a4d7a',
    grid: dark ? '#1e3a5f' : '#c8d4f0',
    accent: '#3b82f6',
    accent2: '#38bdf8',
    green: '#10b981',
    amber: '#f59e0b',
  };
}

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

function renderGraphs() {
  if (allFlights.length === 0) return;

  const c = getChartColors();
  const defaultOpts = {
    plugins: { legend: { labels: { color: c.text, font: { family: 'Chakra Petch' } } } },
    scales: {
      x: { ticks: { color: c.text, font: { family: 'DM Mono', size: 10 } }, grid: { color: c.grid } },
      y: { ticks: { color: c.text, font: { family: 'DM Mono', size: 10 } }, grid: { color: c.grid } }
    }
  };

  // Monthly hours
  const monthlyData = {};
  allFlights.forEach(f => {
    const key = f.date ? f.date.slice(0, 7) : 'unknown';
    monthlyData[key] = (monthlyData[key] || 0) + (+f.total || 0);
  });
  const sortedMonths = Object.keys(monthlyData).sort();
  destroyChart('monthly');
  charts['monthly'] = new Chart(document.getElementById('chart-monthly'), {
    type: 'bar',
    data: {
      labels: sortedMonths.map(m => {
        const [y, mo] = m.split('-');
        return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+mo-1]} ${y}`;
      }),
      datasets: [{ label: 'Hours', data: sortedMonths.map(m => +monthlyData[m].toFixed(1)), backgroundColor: c.accent, borderRadius: 4 }]
    },
    options: { ...defaultOpts, plugins: { ...defaultOpts.plugins, legend: { display: false } } }
  });

  // Cumulative
  const sortedFlights = [...allFlights].sort((a, b) => a.date > b.date ? 1 : -1);
  let cumTotal = 0;
  const cumData = sortedFlights.map(f => { cumTotal += +f.total || 0; return cumTotal; });
  destroyChart('cumulative');
  charts['cumulative'] = new Chart(document.getElementById('chart-cumulative'), {
    type: 'line',
    data: {
      labels: sortedFlights.map(f => formatDate(f.date)),
      datasets: [{
        label: 'Total Hours',
        data: cumData.map(v => +v.toFixed(1)),
        borderColor: c.accent2,
        backgroundColor: `${c.accent2}22`,
        fill: true,
        tension: 0.3,
        pointRadius: 2
      }]
    },
    options: { ...defaultOpts, plugins: { ...defaultOpts.plugins, legend: { display: false } } }
  });

  // Aircraft type
  const aircraftData = {};
  allFlights.forEach(f => {
    const type = f.aircraftType || 'Unknown';
    aircraftData[type] = (aircraftData[type] || 0) + (+f.total || 0);
  });
  const aircraftTypes = Object.keys(aircraftData);
  const colors = [c.accent, c.accent2, c.green, c.amber, '#a855f7', '#ec4899'];
  destroyChart('aircraft');
  charts['aircraft'] = new Chart(document.getElementById('chart-aircraft'), {
    type: 'doughnut',
    data: {
      labels: aircraftTypes,
      datasets: [{
        data: aircraftTypes.map(t => +aircraftData[t].toFixed(1)),
        backgroundColor: aircraftTypes.map((_, i) => colors[i % colors.length]),
        borderWidth: 0
      }]
    },
    options: {
      plugins: { legend: { labels: { color: c.text, font: { family: 'Chakra Petch', size: 11 } } } }
    }
  });

  // Night vs day
  const totalHrs = sum(allFlights, 'total');
  const nightHrs = sum(allFlights, 'night');
  const dayHrs = Math.max(0, totalHrs - nightHrs);
  destroyChart('nightday');
  charts['nightday'] = new Chart(document.getElementById('chart-nightday'), {
    type: 'doughnut',
    data: {
      labels: ['Day', 'Night'],
      datasets: [{
        data: [+dayHrs.toFixed(1), +nightHrs.toFixed(1)],
        backgroundColor: [c.amber, '#1e3a8a'],
        borderWidth: 0
      }]
    },
    options: {
      plugins: { legend: { labels: { color: c.text, font: { family: 'Chakra Petch', size: 11 } } } }
    }
  });
}

// ---- UTILS ----
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m-1]} ${y}`;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ---- INIT ----
clearForm();

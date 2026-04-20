// ============================================
// FLIGHTLOG - Main App Logic
// Uses Firebase compat SDK (loaded via CDN in index.html)
// ============================================

const auth = firebase.auth();
const db   = firebase.firestore();

// ---- STATE ----
let currentUser  = null;
let allFlights   = [];
let editingId    = null;
let charts       = {};
let unsubFlights = null;

// ---- DOM HELPER ----
const $ = id => document.getElementById(id);

// ============================================
// NAVIGATION
// ============================================

function navigate(page) {
  document.querySelectorAll('.nav-item').forEach(a =>
    a.classList.toggle('active', a.dataset.page === page)
  );
  document.querySelectorAll('.page').forEach(p => {
    const isTarget = p.id === `page-${page}`;
    p.classList.toggle('active', isTarget);
    p.classList.toggle('hidden', !isTarget);
  });
  $('page-title').textContent = {
    dashboard:  'Dashboard',
    logbook:    'Logbook',
    'new-entry':'New Flight',
    charts:     'Analytics'
  }[page] || page;
  closeSidebar();
  if (page === 'charts') setTimeout(renderCharts, 50);
}

document.querySelectorAll('[data-page]').forEach(el =>
  el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.page); })
);

// ============================================
// SIDEBAR
// ============================================

function openSidebar()  { $('sidebar').classList.add('open');    $('overlay').classList.remove('hidden'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('overlay').classList.add('hidden'); }

$('hamburger').addEventListener('click', openSidebar);
$('sidebar-close').addEventListener('click', closeSidebar);
$('overlay').addEventListener('click', closeSidebar);

// ============================================
// AUTH
// ============================================

$('login-btn').addEventListener('click', async () => {
  const email = $('login-email').value.trim();
  const pass  = $('login-password').value;
  if (!email || !pass) { showAuthErr('Please enter your email and password.'); return; }
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    showAuthErr(friendlyAuthError(e.code));
  }
});

$('register-btn').addEventListener('click', async () => {
  const name  = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const pass  = $('reg-password').value;
  if (!name || !email || !pass) { showAuthErr('All fields are required.'); return; }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      name, email, createdAt: new Date().toISOString()
    });
  } catch (e) {
    showAuthErr(friendlyAuthError(e.code));
  }
});

$('show-register').addEventListener('click', () => {
  $('login-form').classList.add('hidden');
  $('register-form').classList.remove('hidden');
  $('auth-error').classList.add('hidden');
});

$('show-login').addEventListener('click', () => {
  $('login-form').classList.remove('hidden');
  $('register-form').classList.add('hidden');
  $('auth-error').classList.add('hidden');
});

$('signout-btn').addEventListener('click', async () => {
  if (unsubFlights) { unsubFlights(); unsubFlights = null; }
  await auth.signOut();
});

function showAuthErr(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function friendlyAuthError(code) {
  const map = {
    'auth/user-not-found':       'No account found with that email.',
    'auth/wrong-password':       'Incorrect password.',
    'auth/invalid-email':        'Please enter a valid email address.',
    'auth/email-already-in-use': 'An account with that email already exists.',
    'auth/weak-password':        'Password must be at least 6 characters.',
    'auth/too-many-requests':    'Too many attempts. Please try again later.',
    'auth/invalid-credential':   'Invalid email or password.',
  };
  return map[code] || 'Authentication error. Please try again.';
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    $('auth-screen').classList.add('hidden');
    $('auth-screen').classList.remove('active');
    $('app-screen').classList.remove('hidden');
    $('app-screen').classList.add('active');

    const name = user.displayName || user.email;
    $('pilot-name-nav').textContent = name;
    $('pilot-avatar').textContent   = (name[0] || 'P').toUpperCase();
    $('topbar-date').textContent    = new Date().toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });

    subscribeToFlights();
    navigate('dashboard');
  } else {
    $('app-screen').classList.add('hidden');
    $('app-screen').classList.remove('active');
    $('auth-screen').classList.remove('hidden');
    $('auth-screen').classList.add('active');
    allFlights = [];
  }
});

// ============================================
// FIRESTORE
// ============================================

function subscribeToFlights() {
  // Flights stored in top-level collection with uid field (matches Firestore rules)
  const q = db.collection('flights')
    .where('uid', '==', currentUser.uid)
    .orderBy('date', 'desc');

  unsubFlights = q.onSnapshot(snap => {
    allFlights = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
    renderLogbook();
    updateAircraftFilter();
  }, err => console.error('Firestore snapshot error:', err));
}

async function saveFlight(data) {
  data.uid = currentUser.uid;
  if (editingId) {
    data.updatedAt = new Date().toISOString();
    await db.collection('flights').doc(editingId).update(data);
  } else {
    data.createdAt = new Date().toISOString();
    await db.collection('flights').add(data);
  }
}

async function deleteFlight(id) {
  await db.collection('flights').doc(id).delete();
}

// ============================================
// DASHBOARD
// ============================================

function renderDashboard() {
  const sum = key => allFlights.reduce((a, f) => a + (+f[key] || 0), 0);

  $('s-total').textContent     = sum('total').toFixed(1);
  $('s-pic').textContent       = sum('pic').toFixed(1);
  $('s-night').textContent     = sum('night').toFixed(1);
  $('s-xc').textContent        = sum('xc').toFixed(1);
  $('s-inst').textContent      = (sum('instActual') + sum('instSim')).toFixed(1);
  $('s-dual-given').textContent= sum('dualGiven').toFixed(1);
  $('s-landings').textContent  = sum('ldgDay') + sum('ldgNight');
  $('s-flights').textContent   = allFlights.length;

  // Endorsement badge hours
  [
    ['tailwheel', 'bv-tailwheel'],
    ['highperf',  'bv-highperf'],
    ['complex',   'bv-complex'],
    ['pressurized','bv-pressurized'],
    ['turbo',     'bv-turbo'],
    ['taa',       'bv-taa'],
    ['turbine',   'bv-turbine'],
  ].forEach(([key, elId]) => {
    const hrs = allFlights
      .filter(f => f[key])
      .reduce((a, f) => a + (+f.total || 0), 0);
    $(elId).textContent = hrs.toFixed(1) + 'h';
  });

  // Recent flights (5 most recent)
  const recent = allFlights.slice(0, 5);
  if (recent.length === 0) {
    $('recent-list').innerHTML =
      `<div class="empty-msg">No flights yet. <a class="nav-link-inline" data-page="new-entry">Log your first flight →</a></div>`;
    $('recent-list').querySelector('[data-page]')
      ?.addEventListener('click', e => { e.preventDefault(); navigate('new-entry'); });
    return;
  }

  $('recent-list').innerHTML = recent.map(f => `
    <div class="recent-row" data-id="${f.id}">
      <div class="rr-left">
        <span class="rr-date">${formatDate(f.date)}</span>
        <span class="rr-route">${[f.from, f.to].filter(Boolean).join(' → ') || '—'}</span>
        <span class="rr-ac">${[f.tail, f.makeModel].filter(Boolean).join(' · ') || '—'}</span>
      </div>
      <div class="rr-right">
        <span class="rr-hrs">${(+f.total || 0).toFixed(1)}</span>
        <span class="rr-unit">hrs</span>
      </div>
    </div>`).join('');

  $('recent-list').querySelectorAll('[data-id]').forEach(el =>
    el.addEventListener('click', () => startEdit(el.dataset.id))
  );
}

// ============================================
// LOGBOOK
// ============================================

function getFiltered() {
  const search   = $('search-input').value.toLowerCase();
  const typeVal  = $('filter-type').value;
  const catVal   = $('filter-cat').value;
  const dateFrom = $('f-date-from').value;
  const dateTo   = $('f-date-to').value;
  const catKey   = { tailwheel: 'tailwheel', 'high-perf': 'highperf', complex: 'complex', turbine: 'turbine', taa: 'taa' };

  return allFlights.filter(f => {
    if (search) {
      const hay = [f.tail, f.makeModel, f.acType, f.from, f.to, f.remarks].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (typeVal && f.acType !== typeVal) return false;
    if (catVal  && !f[catKey[catVal]]) return false;
    if (dateFrom && f.date < dateFrom) return false;
    if (dateTo   && f.date > dateTo)   return false;
    return true;
  });
}

function renderLogbook() {
  const filtered   = getFiltered();
  const isFiltered = $('search-input').value || $('filter-type').value ||
                     $('filter-cat').value   || $('f-date-from').value || $('f-date-to').value;

  $('filter-summary').textContent = isFiltered
    ? `Showing ${filtered.length} of ${allFlights.length} flights`
    : '';

  const tbody = $('log-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="17" class="empty-msg">${
      isFiltered ? 'No flights match your filters.' : 'No flights logged yet.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(f => {
    const flags = [
      f.tailwheel  && 'TW',
      f.highperf   && 'HP',
      f.complex    && 'CX',
      f.pressurized&& 'PR',
      f.turbo      && 'TC',
      f.taa        && 'TAA',
      f.turbine    && 'TB',
    ].filter(Boolean);

    return `<tr>
      <td>${formatDate(f.date)}</td>
      <td>${f.tail     || '—'}</td>
      <td>${f.makeModel|| '—'}</td>
      <td>${[f.from, f.to].filter(Boolean).join('–') || '—'}</td>
      <td>${(+f.total     ||0).toFixed(1)}</td>
      <td>${(+f.pic       ||0).toFixed(1)}</td>
      <td>${(+f.dualRecv  ||0).toFixed(1)}</td>
      <td>${(+f.dualGiven ||0).toFixed(1)}</td>
      <td>${(+f.xc        ||0).toFixed(1)}</td>
      <td>${(+f.night     ||0).toFixed(1)}</td>
      <td>${(+f.instActual||0).toFixed(1)}</td>
      <td>${(+f.instSim   ||0).toFixed(1)}</td>
      <td>${+f.ldgDay  ||0}</td>
      <td>${+f.ldgNight||0}</td>
      <td>${flags.map(fl => `<span class="flag-badge">${fl}</span>`).join('')}</td>
      <td class="remarks-cell">${esc(f.remarks || '')}</td>
      <td class="action-cell">
        <button class="btn-icon" data-edit="${f.id}" title="Edit">✏</button>
        <button class="btn-icon btn-del" data-del="${f.id}" title="Delete">✕</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  tbody.querySelectorAll('[data-del]' ).forEach(b => b.addEventListener('click', () => confirmDelete(b.dataset.del)));
}

function updateAircraftFilter() {
  const types = [...new Set(allFlights.map(f => f.acType).filter(Boolean))].sort();
  const sel   = $('filter-type');
  const cur   = sel.value;
  sel.innerHTML = `<option value="">All Aircraft</option>` +
    types.map(t => `<option value="${t}"${t === cur ? ' selected' : ''}>${t}</option>`).join('');
}

async function confirmDelete(id) {
  if (!confirm('Delete this flight? This cannot be undone.')) return;
  await deleteFlight(id);
}

['search-input', 'filter-type', 'filter-cat', 'f-date-from', 'f-date-to'].forEach(id => {
  $(id).addEventListener('input',  renderLogbook);
  $(id).addEventListener('change', renderLogbook);
});

$('clear-filters').addEventListener('click', () => {
  ['search-input', 'filter-type', 'filter-cat', 'f-date-from', 'f-date-to']
    .forEach(id => { $(id).value = ''; });
  renderLogbook();
});

// ============================================
// NEW ENTRY / EDIT FORM
// ============================================

const TEXT_FIELDS = ['f-date','f-from','f-to','f-tail','f-make-model','f-ac-type','f-remarks'];
const NUM_FIELDS  = ['f-total','f-pic','f-dual-recv','f-dual-given','f-xc','f-night','f-inst-actual','f-inst-sim','f-ldg-day','f-ldg-night'];
const CHK_FIELDS  = ['f-tailwheel','f-highperf','f-complex','f-pressurized','f-turbo','f-taa','f-turbine'];

function resetForm() {
  editingId = null;
  $('edit-id').value         = '';
  $('form-heading').textContent = 'LOG NEW FLIGHT';
  $('save-btn').textContent  = 'SAVE FLIGHT';
  $('cancel-edit').style.display = 'none';
  $('form-err').classList.add('hidden');

  TEXT_FIELDS.concat(NUM_FIELDS).forEach(id => { $(id).value = ''; });
  CHK_FIELDS.forEach(id => { $(id).checked = false; });
  $('f-date').value = new Date().toISOString().split('T')[0];
}

function startEdit(id) {
  const f = allFlights.find(x => x.id === id);
  if (!f) return;
  editingId = id;

  $('edit-id').value            = id;
  $('form-heading').textContent = 'EDIT FLIGHT';
  $('save-btn').textContent     = 'UPDATE FLIGHT';
  $('cancel-edit').style.display = '';
  $('form-err').classList.add('hidden');

  $('f-date').value      = f.date      || '';
  $('f-from').value      = f.from      || '';
  $('f-to').value        = f.to        || '';
  $('f-tail').value      = f.tail      || '';
  $('f-make-model').value= f.makeModel || '';
  $('f-ac-type').value   = f.acType    || '';
  $('f-remarks').value   = f.remarks   || '';

  $('f-total').value     = f.total     || '';
  $('f-pic').value       = f.pic       || '';
  $('f-dual-recv').value = f.dualRecv  || '';
  $('f-dual-given').value= f.dualGiven || '';
  $('f-xc').value        = f.xc        || '';
  $('f-night').value     = f.night     || '';
  $('f-inst-actual').value = f.instActual || '';
  $('f-inst-sim').value  = f.instSim   || '';
  $('f-ldg-day').value   = f.ldgDay    || '';
  $('f-ldg-night').value = f.ldgNight  || '';

  $('f-tailwheel').checked  = !!f.tailwheel;
  $('f-highperf').checked   = !!f.highperf;
  $('f-complex').checked    = !!f.complex;
  $('f-pressurized').checked= !!f.pressurized;
  $('f-turbo').checked      = !!f.turbo;
  $('f-taa').checked        = !!f.taa;
  $('f-turbine').checked    = !!f.turbine;

  navigate('new-entry');
}

$('cancel-edit').addEventListener('click', () => { resetForm(); navigate('logbook'); });

$('save-btn').addEventListener('click', async () => {
  const date  = $('f-date').value;
  const tail  = $('f-tail').value.trim();
  const total = parseFloat($('f-total').value);

  if (!date)           { showFormErr('Date is required.');                          return; }
  if (!tail)           { showFormErr('Tail number is required.');                   return; }
  if (!total || total <= 0) { showFormErr('Total time must be greater than 0.');    return; }

  $('form-err').classList.add('hidden');
  $('save-btn').disabled = true;

  const data = {
    date,
    from:       $('f-from').value.toUpperCase().trim(),
    to:         $('f-to').value.toUpperCase().trim(),
    tail:       tail.toUpperCase(),
    makeModel:  $('f-make-model').value.trim(),
    acType:     $('f-ac-type').value.trim(),
    tailwheel:  $('f-tailwheel').checked,
    highperf:   $('f-highperf').checked,
    complex:    $('f-complex').checked,
    pressurized:$('f-pressurized').checked,
    turbo:      $('f-turbo').checked,
    taa:        $('f-taa').checked,
    turbine:    $('f-turbine').checked,
    total:      parseFloat($('f-total').value)      || 0,
    pic:        parseFloat($('f-pic').value)        || 0,
    dualRecv:   parseFloat($('f-dual-recv').value)  || 0,
    dualGiven:  parseFloat($('f-dual-given').value) || 0,
    xc:         parseFloat($('f-xc').value)         || 0,
    night:      parseFloat($('f-night').value)      || 0,
    instActual: parseFloat($('f-inst-actual').value)|| 0,
    instSim:    parseFloat($('f-inst-sim').value)   || 0,
    ldgDay:     parseInt($('f-ldg-day').value)      || 0,
    ldgNight:   parseInt($('f-ldg-night').value)    || 0,
    remarks:    $('f-remarks').value.trim(),
  };

  try {
    await saveFlight(data);
    resetForm();
    navigate('logbook');
  } catch (e) {
    showFormErr('Error saving flight. Please try again.');
    console.error(e);
  }
  $('save-btn').disabled = false;
});

function showFormErr(msg) {
  const el = $('form-err');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ============================================
// CHARTS
// ============================================

function renderCharts() {
  if (allFlights.length === 0) return;

  const dark      = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const textColor = dark ? '#a8c0e8' : '#3a4d7a';
  const gridColor = dark ? 'rgba(30,58,95,0.35)' : 'rgba(200,212,240,0.5)';
  const blue      = '#1a56db';
  const sky       = '#0ea5e9';
  const amber     = '#f59e0b';

  const axis = {
    ticks: { color: textColor, font: { size: 11 } },
    grid:  { color: gridColor }
  };

  // Monthly hours bar chart (last 24 months)
  const monthMap = {};
  allFlights.forEach(f => {
    const key = (f.date || '').slice(0, 7);
    if (key) monthMap[key] = (monthMap[key] || 0) + (+f.total || 0);
  });
  const months = Object.keys(monthMap).sort().slice(-24);
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  destroyChart('monthly');
  charts.monthly = new Chart($('c-monthly'), {
    type: 'bar',
    data: {
      labels: months.map(m => { const [y, mo] = m.split('-'); return `${MON[+mo-1]} ${y.slice(2)}`; }),
      datasets: [{ data: months.map(m => +monthMap[m].toFixed(1)), backgroundColor: blue + 'cc', borderRadius: 4 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: axis, y: axis } }
  });

  // Cumulative hours line chart
  const sorted = [...allFlights].sort((a, b) => a.date > b.date ? 1 : -1);
  let cum = 0;
  const cumData = sorted.map(f => { cum += +f.total || 0; return +cum.toFixed(1); });

  destroyChart('cumulative');
  charts.cumulative = new Chart($('c-cumulative'), {
    type: 'line',
    data: {
      labels: sorted.map(f => formatDate(f.date)),
      datasets: [{
        data: cumData, borderColor: sky, backgroundColor: sky + '22',
        fill: true, tension: 0.3, pointRadius: 2
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { ...axis, ticks: { ...axis.ticks, maxTicksLimit: 8 } }, y: axis }
    }
  });

  // Aircraft type doughnut
  const acMap = {};
  allFlights.forEach(f => { const t = f.acType || 'Other'; acMap[t] = (acMap[t] || 0) + (+f.total || 0); });
  const acTypes  = Object.keys(acMap);
  const palette  = [blue, sky, '#10b981', amber, '#a855f7', '#ec4899', '#ef4444'];

  destroyChart('aircraft');
  charts.aircraft = new Chart($('c-aircraft'), {
    type: 'doughnut',
    data: {
      labels: acTypes,
      datasets: [{
        data: acTypes.map(t => +acMap[t].toFixed(1)),
        backgroundColor: acTypes.map((_, i) => palette[i % palette.length]),
        borderWidth: 0
      }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } } }
  });

  // Day vs Night doughnut
  const totalHrs = allFlights.reduce((a, f) => a + (+f.total || 0), 0);
  const nightHrs = allFlights.reduce((a, f) => a + (+f.night || 0), 0);
  const dayHrs   = Math.max(0, totalHrs - nightHrs);

  destroyChart('daynight');
  charts.daynight = new Chart($('c-daynight'), {
    type: 'doughnut',
    data: {
      labels: ['Day', 'Night'],
      datasets: [{
        data: [+dayHrs.toFixed(1), +nightHrs.toFixed(1)],
        backgroundColor: [amber, '#1e3a8a'],
        borderWidth: 0
      }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } } }
  });
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// ============================================
// UTILITIES
// ============================================

const MON_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d} ${MON_ABBR[+m - 1]} ${y}`;
}

function esc(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================
// INIT
// ============================================
resetForm();

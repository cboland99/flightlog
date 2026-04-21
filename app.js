// ============================================
// FLIGHTLOG - Main App Logic
// Uses Firebase compat SDK (loaded via CDN in index.html)
// ============================================

const auth = firebase.auth();
const db   = firebase.firestore();

// ---- STATE ----
let currentUser   = null;
let allFlights    = [];
let editingId     = null;
let charts        = {};
let unsubFlights  = null;
let allAircraft   = [];
let editingAcId   = null;
let unsubAircraft = null;

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
    charts:     'Analytics',
    aircraft:   'Aircraft'
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
  $('login-btn').disabled = true;
  try {
    await auth.signInWithEmailAndPassword(email, pass);
  } catch (e) {
    // Account doesn't exist yet — auto-create it on first login
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      try {
        const name = 'Connor Boland';
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        await cred.user.updateProfile({ displayName: name });
        await db.collection('users').doc(cred.user.uid).set({
          name, email, createdAt: new Date().toISOString()
        });
        // onAuthStateChanged handles the rest
      } catch (createErr) {
        showAuthErr(friendlyAuthError(createErr.code));
        $('login-btn').disabled = false;
      }
    } else {
      showAuthErr(friendlyAuthError(e.code));
      $('login-btn').disabled = false;
    }
  }
});

$('register-btn').addEventListener('click', async () => {
  const name  = $('reg-name').value.trim();
  const email = $('reg-email').value.trim();
  const pass  = $('reg-password').value;
  if (!name || !email || !pass) { showRegErr('All fields are required.'); return; }
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    await cred.user.updateProfile({ displayName: name });
    await db.collection('users').doc(cred.user.uid).set({
      name, email, createdAt: new Date().toISOString()
    });
  } catch (e) {
    showRegErr(friendlyAuthError(e.code));
  }
});

$('show-register').addEventListener('click', () => {
  $('auth-screen').classList.add('hidden');
  $('auth-screen').classList.remove('active');
  $('register-screen').classList.remove('hidden');
  $('register-screen').classList.add('active');
  $('reg-error').classList.add('hidden');
});

$('show-login').addEventListener('click', () => {
  $('register-screen').classList.add('hidden');
  $('register-screen').classList.remove('active');
  $('auth-screen').classList.remove('hidden');
  $('auth-screen').classList.add('active');
  $('auth-error').classList.add('hidden');
});

$('signout-btn').addEventListener('click', async () => {
  if (unsubFlights)  { unsubFlights();  unsubFlights  = null; }
  if (unsubAircraft) { unsubAircraft(); unsubAircraft = null; }
  await auth.signOut();
});

function showAuthErr(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function showRegErr(msg) {
  const el = $('reg-error');
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
    'auth/invalid-api-key':      'Firebase is not configured. Fill in your API key in firebase-config.js.',
    'auth/network-request-failed':'Network error. Check your internet connection.',
  };
  return map[code] || `Authentication error (${code}). Please try again.`;
}

auth.onAuthStateChanged(user => {
  currentUser = user;
  if (user) {
    $('auth-screen').classList.add('hidden');
    $('auth-screen').classList.remove('active');
    $('register-screen').classList.add('hidden');
    $('register-screen').classList.remove('active');
    $('app-screen').classList.remove('hidden');
    $('app-screen').classList.add('active');

    const name = user.displayName || user.email;
    $('pilot-name-nav').textContent = name;
    $('pilot-avatar').textContent   = (name[0] || 'P').toUpperCase();
    $('topbar-date').textContent    = new Date().toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });

    subscribeToFlights();
    subscribeToAircraft();
    navigate('dashboard');
  } else {
    $('app-screen').classList.add('hidden');
    $('app-screen').classList.remove('active');
    $('register-screen').classList.add('hidden');
    $('register-screen').classList.remove('active');
    $('auth-screen').classList.remove('hidden');
    $('auth-screen').classList.add('active');
    allFlights  = [];
    allAircraft = [];
    if (unsubAircraft) { unsubAircraft(); unsubAircraft = null; }
  }
});

// ============================================
// FIRESTORE
// ============================================

function subscribeToFlights() {
  // Flights stored in top-level collection with uid field (matches Firestore rules)
  const q = db.collection('flights').where('uid', '==', currentUser.uid);

  unsubFlights = q.onSnapshot(snap => {
    allFlights = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    renderDashboard();
    renderLogbook();
    updateAircraftFilter();
    updateTailDatalist();
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


  // Currency
  const today = new Date(); today.setHours(0,0,0,0);
  const d90 = new Date(today); d90.setDate(d90.getDate() - 90);
  const d6mo = new Date(today); d6mo.setMonth(d6mo.getMonth() - 6);
  const iso90  = d90.toISOString().split('T')[0];
  const iso6mo = d6mo.toISOString().split('T')[0];

  // Landing currency — broken down by class/category and tailwheel
  const acByTail = {};
  allAircraft.forEach(ac => { acByTail[ac.tail] = ac; });

  // Collect unique class+category combos from registered aircraft
  const combos = new Map();
  allAircraft.forEach(ac => {
    if (ac.class && ac.category) {
      const key = `${ac.class}|${ac.category}`;
      if (!combos.has(key)) combos.set(key, { cls: ac.class, cat: ac.category, ldg: 0 });
    }
  });
  const hasTailwheel = allAircraft.some(ac => ac.tailwheel);
  let twLdg = 0;

  allFlights.filter(f => f.date >= iso90).forEach(f => {
    const ac = acByTail[f.tail];
    if (!ac) return;
    const ldg = (+f.ldgDay || 0) + (+f.ldgNight || 0);
    const key = `${ac.class}|${ac.category}`;
    if (combos.has(key)) combos.get(key).ldg += ldg;
    if (ac.tailwheel) twLdg += ldg;
  });

  let ldgHtml = '';
  combos.forEach(({ cls, cat, ldg }) => {
    ldgHtml += `<div class="currency-card">
      <div class="currency-label">LANDINGS — ${esc(cls)} ${esc(cat.toUpperCase())}</div>
      <div class="currency-val">${ldg}</div>
      <div class="currency-sub">last 90 days · since ${formatDate(iso90)}</div>
    </div>`;
  });
  if (hasTailwheel) {
    ldgHtml += `<div class="currency-card">
      <div class="currency-label">LANDINGS — TAILWHEEL</div>
      <div class="currency-val">${twLdg}</div>
      <div class="currency-sub">last 90 days · since ${formatDate(iso90)}</div>
    </div>`;
  }
  if (!ldgHtml) {
    ldgHtml = `<div class="currency-card">
      <div class="currency-label">LANDINGS — LAST 90 DAYS</div>
      <div class="currency-val">—</div>
      <div class="currency-sub">Add aircraft to see breakdown by class</div>
    </div>`;
  }
  $('currency-ldg-grid').innerHTML = ldgHtml;

  const appr6mo = allFlights
    .filter(f => f.date >= iso6mo)
    .reduce((a, f) => a + (+f.apprActual || 0) + (+f.apprSim || 0), 0);
  $('c-appr-6mo').textContent     = appr6mo;
  $('c-appr-6mo-sub').textContent = `since ${formatDate(iso6mo)}`;

  // Recent flights — last 30 days
  const iso30 = (() => { const d = new Date(today); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]; })();
  const recent = allFlights.filter(f => f.date >= iso30);
  if (recent.length === 0) {
    $('recent-list').innerHTML =
      `<div class="empty-msg">No flights in the last 30 days. <a class="nav-link-inline" data-page="logbook">View all →</a></div>`;
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
  const dateFrom = $('f-date-from').value;
  const dateTo   = $('f-date-to').value;

  return allFlights.filter(f => {
    if (search) {
      const hay = [f.tail, f.makeModel, f.from, f.via, f.to, f.remarks].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (typeVal && f.tail !== typeVal) return false;
    if (dateFrom && f.date < dateFrom) return false;
    if (dateTo   && f.date > dateTo)   return false;
    return true;
  });
}

function renderLogbook() {
  const filtered   = getFiltered();
  const isFiltered = $('search-input').value || $('filter-type').value ||
                     $('f-date-from').value  || $('f-date-to').value;

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
    const route = [f.from, ...(f.via ? [f.via] : []), f.to].filter(Boolean).join(' → ') || '—';
    return `<tr>
      <td>${formatDate(f.date)}</td>
      <td>${f.tail      || '—'}</td>
      <td>${f.makeModel || '—'}</td>
      <td>${route}</td>
      <td>${(+f.total     ||0).toFixed(1)}</td>
      <td>${(+f.pic       ||0).toFixed(1)}</td>
      <td>${(+f.sic       ||0).toFixed(1)}</td>
      <td>${(+f.dualRecv  ||0).toFixed(1)}</td>
      <td>${(+f.dualGiven ||0).toFixed(1)}</td>
      <td>${(+f.dayTime   ||0).toFixed(1)}</td>
      <td>${(+f.xc        ||0).toFixed(1)}</td>
      <td>${(+f.night     ||0).toFixed(1)}</td>
      <td>${(+f.instActual||0).toFixed(1)}</td>
      <td>${(+f.instSim   ||0).toFixed(1)}</td>
      <td>${+f.apprActual||0}</td>
      <td>${+f.apprSim   ||0}</td>
      <td>${+f.ldgDay    ||0}</td>
      <td>${+f.ldgNight  ||0}</td>
      <td>${f.solo ? '✓' : ''}</td>
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
  const tails = [...new Set(allFlights.map(f => f.tail).filter(Boolean))].sort();
  const sel   = $('filter-type');
  const cur   = sel.value;
  sel.innerHTML = `<option value="">All Aircraft</option>` +
    tails.map(t => `<option value="${t}"${t === cur ? ' selected' : ''}>${t}</option>`).join('');
}

function updateTailDatalist() {
  const dl = $('tail-datalist');
  if (!dl) return;
  // Prefer aircraft database; fall back to flight history for tails not yet in the roster
  const seen = new Map();
  allAircraft.forEach(ac => {
    if (ac.tail) seen.set(ac.tail, [ac.make, ac.model, ac.variant].filter(Boolean).join(' '));
  });
  allFlights.forEach(f => {
    if (f.tail && !seen.has(f.tail)) seen.set(f.tail, f.makeModel || '');
  });
  dl.innerHTML = [...seen.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tail, name]) => `<option value="${tail}">${name ? tail + ' — ' + name : tail}</option>`)
    .join('');
}

async function confirmDelete(id) {
  if (!confirm('Delete this flight? This cannot be undone.')) return;
  await deleteFlight(id);
}

['search-input', 'filter-type', 'f-date-from', 'f-date-to'].forEach(id => {
  $(id).addEventListener('input',  renderLogbook);
  $(id).addEventListener('change', renderLogbook);
});

$('clear-filters').addEventListener('click', () => {
  ['search-input', 'filter-type', 'f-date-from', 'f-date-to']
    .forEach(id => { $(id).value = ''; });
  renderLogbook();
});

// ============================================
// NEW ENTRY / EDIT FORM
// ============================================

const TEXT_FIELDS = ['f-date','f-from','f-via','f-to','f-tail','f-make-model','f-remarks'];
const NUM_FIELDS  = ['f-total','f-pic','f-sic','f-dual-recv','f-dual-given','f-day','f-xc','f-night','f-inst-actual','f-inst-sim','f-appr-actual','f-appr-sim','f-ldg-day','f-ldg-night'];
const CHK_FIELDS  = ['f-solo'];

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

  $('f-date').value        = f.date      || '';
  $('f-from').value        = f.from      || '';
  $('f-via').value         = f.via       || '';
  $('f-to').value          = f.to        || '';
  $('f-tail').value        = f.tail      || '';
  $('f-make-model').value  = f.makeModel || '';
  $('f-remarks').value     = f.remarks   || '';

  $('f-total').value       = f.total      || '';
  $('f-pic').value         = f.pic        || '';
  $('f-sic').value         = f.sic        || '';
  $('f-dual-recv').value   = f.dualRecv   || '';
  $('f-dual-given').value  = f.dualGiven  || '';
  $('f-day').value         = f.dayTime    || '';
  $('f-xc').value          = f.xc         || '';
  $('f-night').value       = f.night      || '';
  $('f-inst-actual').value = f.instActual || '';
  $('f-inst-sim').value    = f.instSim    || '';
  $('f-appr-actual').value = f.apprActual || '';
  $('f-appr-sim').value    = f.apprSim    || '';
  $('f-ldg-day').value     = f.ldgDay     || '';
  $('f-ldg-night').value   = f.ldgNight   || '';

  $('f-solo').checked = !!f.solo;

  navigate('new-entry');
}

function makeModelForTail(tail) {
  const ac = allAircraft.find(a => a.tail === tail);
  if (ac) return [ac.make, ac.variant].filter(Boolean).join(' ');
  return allFlights.find(f => f.tail === tail)?.makeModel || '';
}

$('f-tail').addEventListener('change', () => {
  const tail = $('f-tail').value.trim().toUpperCase();
  const name = makeModelForTail(tail);
  if (name && !$('f-make-model').value) $('f-make-model').value = name;
});
$('f-tail').addEventListener('input', () => {
  const tail = $('f-tail').value.trim().toUpperCase();
  const name = makeModelForTail(tail);
  if (name) $('f-make-model').value = name;
});

$('cancel-edit').addEventListener('click', () => { resetForm(); navigate('logbook'); });

$('save-btn').addEventListener('click', async () => {
  const date  = $('f-date').value;
  const tail  = $('f-tail').value.trim();
  const total = parseFloat($('f-total').value);

  const errs = [];
  if (!date)                 errs.push('Date is required.');
  if (!tail)                 errs.push('Tail number is required.');
  if (!total || total <= 0)  errs.push('Total time must be greater than 0.');

  if (errs.length === 0) {
    const pic        = parseFloat($('f-pic').value)          || 0;
    const sic        = parseFloat($('f-sic').value)          || 0;
    const dualRecv   = parseFloat($('f-dual-recv').value)    || 0;
    const dualGiven  = parseFloat($('f-dual-given').value)   || 0;
    const dayTime    = parseFloat($('f-day').value)          || 0;
    const xc         = parseFloat($('f-xc').value)           || 0;
    const night      = parseFloat($('f-night').value)        || 0;
    const instActual = parseFloat($('f-inst-actual').value)  || 0;
    const instSim    = parseFloat($('f-inst-sim').value)     || 0;
    const apprActual = parseInt($('f-appr-actual').value)    || 0;
    const apprSim    = parseInt($('f-appr-sim').value)       || 0;
    const ldgDay     = parseInt($('f-ldg-day').value)        || 0;
    const ldgNight   = parseInt($('f-ldg-night').value)      || 0;
    const solo       = $('f-solo').checked;

    const round = v => Math.round(v * 100) / 100;

    if (round(pic + sic + dualRecv) < round(total))
      errs.push('PIC + SIC + Dual Received must be greater than or equal to Total time.');
    if (round(dayTime + night) !== round(total))
      errs.push('Day time + Night time must equal Total time.');
    if (ldgDay > 0 && dayTime <= 0)
      errs.push('Day time cannot be 0 when Day Landings are logged.');
    if (ldgNight > 0 && night <= 0)
      errs.push('Night time cannot be 0 when Night Landings are logged.');
    const timeFields = { PIC: pic, SIC: sic, 'Dual Received': dualRecv, 'Dual Given': dualGiven,
      Day: dayTime, 'Cross Country': xc, Night: night, 'Instrument Actual': instActual, 'Instrument Sim': instSim };
    for (const [label, val] of Object.entries(timeFields)) {
      if (round(val) > round(total)) errs.push(`${label} time cannot exceed Total time.`);
    }
    if (round(instActual + instSim) > round(total))
      errs.push('Instrument Actual + Instrument Sim cannot exceed Total time.');
    if (solo) {
      if (sic > 0 || dualRecv > 0 || dualGiven > 0 || instSim > 0 || apprSim > 0)
        errs.push('Solo flight: SIC, Dual Received, Dual Given, Instrument Sim, and Approaches Sim must all be 0.');
      if (ldgDay + ldgNight < 1)
        errs.push('Solo flight: Day Landings + Night Landings must be at least 1.');
    }
    if (apprActual > 0 && instActual <= 0)
      errs.push('Instrument Actual time must be > 0 when Actual Approaches > 0.');
    if (apprSim > 0 && instSim <= 0)
      errs.push('Instrument Sim time must be > 0 when Sim Approaches > 0.');
  }

  if (errs.length > 0) { showFormErr(errs.join(' ')); return; }

  $('form-err').classList.add('hidden');
  $('save-btn').disabled = true;

  const data = {
    date,
    from:       $('f-from').value.toUpperCase().trim(),
    via:        $('f-via').value.toUpperCase().trim(),
    to:         $('f-to').value.toUpperCase().trim(),
    tail:       tail.toUpperCase(),
    makeModel:  $('f-make-model').value.trim(),
    total:      parseFloat($('f-total').value)        || 0,
    pic:        parseFloat($('f-pic').value)          || 0,
    sic:        parseFloat($('f-sic').value)          || 0,
    dualRecv:   parseFloat($('f-dual-recv').value)    || 0,
    dualGiven:  parseFloat($('f-dual-given').value)   || 0,
    dayTime:    parseFloat($('f-day').value)          || 0,
    xc:         parseFloat($('f-xc').value)           || 0,
    night:      parseFloat($('f-night').value)        || 0,
    instActual: parseFloat($('f-inst-actual').value)  || 0,
    instSim:    parseFloat($('f-inst-sim').value)     || 0,
    apprActual: parseInt($('f-appr-actual').value)    || 0,
    apprSim:    parseInt($('f-appr-sim').value)       || 0,
    ldgDay:     parseInt($('f-ldg-day').value)        || 0,
    ldgNight:   parseInt($('f-ldg-night').value)      || 0,
    solo:       $('f-solo').checked,
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
// AIRCRAFT — FIRESTORE
// ============================================

function subscribeToAircraft() {
  const q = db.collection('aircraft').where('uid', '==', currentUser.uid);

  unsubAircraft = q.onSnapshot(snap => {
    allAircraft = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.tail || '').localeCompare(b.tail || ''));
    renderAircraftPage();
    updateTailDatalist();
  }, err => console.error('Aircraft snapshot error:', err));
}

async function saveAircraft(data) {
  data.uid = currentUser.uid;
  if (editingAcId) {
    data.updatedAt = new Date().toISOString();
    await db.collection('aircraft').doc(editingAcId).update(data);
  } else {
    data.createdAt = new Date().toISOString();
    await db.collection('aircraft').add(data);
  }
}

async function deleteAircraft(id) {
  await db.collection('aircraft').doc(id).delete();
}

// ============================================
// AIRCRAFT — RENDER
// ============================================

function renderAircraftPage() {
  const list = $('aircraft-list');
  if (allAircraft.length === 0) {
    list.innerHTML = `<div class="empty-msg">No aircraft added yet. Click "+ Add Aircraft" to get started.</div>`;
    return;
  }

  list.innerHTML = allAircraft.map(ac => {
    const name     = [ac.make, ac.model].filter(Boolean).join(' ') || '—';
    const metaLine1 = [ac.year, ac.variant].filter(Boolean).join(' ');
    const metaLine2 = [ac.class, ac.category, ac.type ? `Type: ${ac.type}` : ''].filter(Boolean).join(' · ');
    const activeChars = [
      ac.highPerf    && 'HP',
      ac.complex     && 'CX',
      ac.taa         && 'TAA',
      ac.turbine     && 'TB',
      ac.tailwheel   && 'TW',
      ac.pressurized && 'PR',
    ].filter(Boolean);
    return `
    <div class="aircraft-card">
      <div class="ac-card-body">
        <div class="ac-card-top">
          <span class="ac-tail-num">${ac.tail || '—'}</span>
          <span class="ac-full-name">${name}</span>
        </div>
        ${metaLine1 ? `<div class="ac-meta">${metaLine1}</div>` : ''}
        ${metaLine2 ? `<div class="ac-meta">${metaLine2}</div>` : ''}
        ${activeChars.length ? `<div class="ac-chars">${activeChars.map(c => `<span class="ac-char on">${c}</span>`).join('')}</div>` : ''}
      </div>
      <div class="ac-card-actions">
        <button class="btn-icon" data-ac-edit="${ac.id}" title="Edit">✏</button>
        <button class="btn-icon btn-del" data-ac-del="${ac.id}" title="Delete">✕</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-ac-edit]').forEach(b =>
    b.addEventListener('click', () => startEditAircraft(b.dataset.acEdit))
  );
  list.querySelectorAll('[data-ac-del]').forEach(b =>
    b.addEventListener('click', () => confirmDeleteAircraft(b.dataset.acDel))
  );
}

// ============================================
// AIRCRAFT — FORM
// ============================================

const AC_TEXT_FIELDS = ['ac-tail','ac-make','ac-model','ac-variant','ac-type'];
const AC_CHK_FIELDS  = ['ac-highperf','ac-complex','ac-taa','ac-turbine','ac-tailwheel','ac-pressurized'];

function resetAircraftForm() {
  editingAcId = null;
  $('ac-edit-id').value         = '';
  $('ac-form-heading').textContent = 'ADD AIRCRAFT';
  $('ac-save-btn').textContent  = 'SAVE AIRCRAFT';
  $('ac-form-err').classList.add('hidden');
  AC_TEXT_FIELDS.forEach(id => { $(id).value = ''; });
  $('ac-year').value     = '';
  $('ac-class').value    = '';
  $('ac-category').value = '';
  AC_CHK_FIELDS.forEach(id => { $(id).checked = false; });
}

function startEditAircraft(id) {
  const ac = allAircraft.find(x => x.id === id);
  if (!ac) return;
  editingAcId = id;

  $('ac-edit-id').value            = id;
  $('ac-form-heading').textContent = 'EDIT AIRCRAFT';
  $('ac-save-btn').textContent     = 'UPDATE AIRCRAFT';
  $('ac-form-err').classList.add('hidden');

  $('ac-tail').value     = ac.tail     || '';
  $('ac-make').value     = ac.make     || '';
  $('ac-model').value    = ac.model    || '';
  $('ac-variant').value  = ac.variant  || '';
  $('ac-year').value     = ac.year     || '';
  $('ac-class').value    = ac.class    || '';
  $('ac-category').value = ac.category || '';
  $('ac-type').value     = ac.type     || '';

  $('ac-highperf').checked    = !!ac.highPerf;
  $('ac-complex').checked     = !!ac.complex;
  $('ac-taa').checked         = !!ac.taa;
  $('ac-turbine').checked     = !!ac.turbine;
  $('ac-tailwheel').checked   = !!ac.tailwheel;
  $('ac-pressurized').checked = !!ac.pressurized;

  $('ac-form-wrap').classList.remove('hidden');
  $('ac-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function confirmDeleteAircraft(id) {
  const ac = allAircraft.find(x => x.id === id);
  const label = ac ? ac.tail : 'this aircraft';
  if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
  await deleteAircraft(id);
}

$('add-aircraft-btn').addEventListener('click', () => {
  resetAircraftForm();
  $('ac-form-wrap').classList.remove('hidden');
  $('ac-form-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

$('ac-cancel-btn').addEventListener('click', () => {
  resetAircraftForm();
  $('ac-form-wrap').classList.add('hidden');
});

$('ac-save-btn').addEventListener('click', async () => {
  const tail = $('ac-tail').value.trim().toUpperCase();
  if (!tail) {
    const el = $('ac-form-err');
    el.textContent = 'Tail number is required.';
    el.classList.remove('hidden');
    return;
  }
  $('ac-form-err').classList.add('hidden');
  $('ac-save-btn').disabled = true;

  const data = {
    tail,
    make:       $('ac-make').value.trim(),
    model:      $('ac-model').value.trim(),
    variant:    $('ac-variant').value.trim(),
    year:       parseInt($('ac-year').value) || null,
    class:      $('ac-class').value,
    category:   $('ac-category').value,
    type:       $('ac-type').value.trim(),
    highPerf:   $('ac-highperf').checked,
    complex:    $('ac-complex').checked,
    taa:        $('ac-taa').checked,
    turbine:    $('ac-turbine').checked,
    tailwheel:  $('ac-tailwheel').checked,
    pressurized:$('ac-pressurized').checked,
  };

  try {
    await saveAircraft(data);
    resetAircraftForm();
    $('ac-form-wrap').classList.add('hidden');
  } catch (e) {
    const el = $('ac-form-err');
    el.textContent = 'Error saving aircraft. Please try again.';
    el.classList.remove('hidden');
    console.error(e);
  }
  $('ac-save-btn').disabled = false;
});

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
// CSV BULK IMPORT
// ============================================

const CSV_COLUMNS = [
  'date','from','via','to','tail','makeModel',
  'total','pic','sic','dualRecv','dualGiven',
  'dayTime','xc','night','instActual','instSim',
  'apprActual','apprSim','ldgDay','ldgNight',
  'solo','remarks'
];

const CSV_ALIASES = {
  departure: 'from', 'departure airport': 'from',
  arrival: 'to', 'arrival airport': 'to',
  'points of landing': 'via', via: 'via',
  'tail number': 'tail', 'tail #': 'tail',
  'make & variant': 'makemodel', makemodel: 'makeModel', 'make/model': 'makeModel',
  'total time': 'total',
  'cross country': 'xc', 'cross-country': 'xc',
  'instrument actual': 'instActual', 'inst actual': 'instActual',
  'instrument sim': 'instSim', 'inst sim': 'instSim',
  'approaches actual': 'apprActual', 'appr actual': 'apprActual',
  'approaches sim': 'apprSim', 'appr sim': 'apprSim',
  'day landings': 'ldgDay', 'ldg day': 'ldgDay',
  'night landings': 'ldgNight', 'ldg night': 'ldgNight',
  'dual received': 'dualRecv', 'dual recv': 'dualRecv',
  'dual given': 'dualGiven',
  'day time': 'dayTime', day: 'dayTime',
};

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    rows.push(cols.map(c => c.trim()));
  }
  return rows;
}

function resolveHeader(raw) {
  const lower = raw.toLowerCase().trim();
  if (CSV_COLUMNS.includes(lower)) return lower;
  if (CSV_ALIASES[lower]) return CSV_ALIASES[lower];
  return lower;
}

function validateCsvRow(d, rowNum) {
  const errs = [];
  if (!d.date)              errs.push('date is required');
  if (!d.tail)              errs.push('tail is required');
  if (!d.total || d.total <= 0) errs.push('total must be > 0');
  const round = v => Math.round(v * 100) / 100;
  if (d.total > 0) {
    if (round(d.pic + d.sic + d.dualRecv) < round(d.total))
      errs.push('PIC+SIC+DualRecv < total');
    if ((d.dayTime > 0 || d.night > 0) && round(d.dayTime + d.night) !== round(d.total))
      errs.push('dayTime+night ≠ total');
    if (d.ldgDay > 0 && d.dayTime <= 0)   errs.push('dayTime must be > 0 when ldgDay > 0');
    if (d.ldgNight > 0 && d.night <= 0)   errs.push('night must be > 0 when ldgNight > 0');
    const timeFields = { pic: d.pic, sic: d.sic, dualRecv: d.dualRecv, dualGiven: d.dualGiven,
      dayTime: d.dayTime, xc: d.xc, night: d.night, instActual: d.instActual, instSim: d.instSim };
    for (const [k, v] of Object.entries(timeFields)) {
      if (round(v) > round(d.total)) errs.push(`${k} exceeds total`);
    }
    if (round(d.instActual + d.instSim) > round(d.total))
      errs.push('instActual+instSim exceeds total');
    if (d.solo) {
      if (d.sic > 0 || d.dualRecv > 0 || d.dualGiven > 0 || d.instSim > 0 || d.apprSim > 0)
        errs.push('solo: SIC/DualRecv/DualGiven/InstSim/ApprSim must be 0');
      if (d.ldgDay + d.ldgNight < 1)
        errs.push('solo: day+night landings must be ≥ 1');
    }
    if (d.apprActual > 0 && d.instActual <= 0) errs.push('instActual must be > 0 when apprActual > 0');
    if (d.apprSim    > 0 && d.instSim    <= 0) errs.push('instSim must be > 0 when apprSim > 0');
  }
  return errs;
}

function normalizeDateStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // MM/DD/YYYY or M/D/YYYY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, m, d, y] = slash;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  // DD-Mon-YYYY (e.g. 15-Jan-2024)
  const mon = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (mon) {
    const months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                    jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
    const m = months[mon[2].toLowerCase()];
    if (m) return `${mon[3]}-${m}-${mon[1].padStart(2,'0')}`;
  }
  // Fallback: let Date parse it and reformat
  const dt = new Date(s);
  if (!isNaN(dt)) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s;
}

function parseSolo(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y';
}

$('csv-template-btn').addEventListener('click', () => {
  const header = CSV_COLUMNS.join(',');
  const example = '2024-01-15,KSFO,KOAK,,N12345,Cessna 172,1.5,1.5,0,0,0,1.5,0,0,0,0,0,0,1,0,false,First solo XC';
  const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'flightlog_template.csv';
  a.click();
});

$('csv-import-btn').addEventListener('click', async () => {
  const file = $('csv-file-input').files[0];
  const errEl = $('csv-err');
  const statusEl = $('csv-status');

  errEl.classList.add('hidden');
  statusEl.classList.add('hidden');
  statusEl.innerHTML = '';

  if (!file) { errEl.textContent = 'Please select a CSV file.'; errEl.classList.remove('hidden'); return; }

  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length < 2) { errEl.textContent = 'CSV must have a header row and at least one data row.'; errEl.classList.remove('hidden'); return; }

  const headers = rows[0].map(resolveHeader);
  const dataRows = rows.slice(1);

  const valid = [], rowErrors = [];
  const originalHeaders = rows[0];

  for (let i = 0; i < dataRows.length; i++) {
    const cols = dataRows[i];
    if (cols.every(c => !c)) continue;
    const raw = {};
    headers.forEach((h, idx) => { raw[h] = cols[idx] || ''; });

    const d = {
      date:       normalizeDateStr(raw.date),
      from:       (raw.from || '').toUpperCase().trim(),
      via:        (raw.via  || '').toUpperCase().trim(),
      to:         (raw.to   || '').toUpperCase().trim(),
      tail:       (raw.tail || '').toUpperCase().trim(),
      makeModel:  (raw.makeModel || '').trim(),
      total:      parseFloat(raw.total)      || 0,
      pic:        parseFloat(raw.pic)        || 0,
      sic:        parseFloat(raw.sic)        || 0,
      dualRecv:   parseFloat(raw.dualRecv)   || 0,
      dualGiven:  parseFloat(raw.dualGiven)  || 0,
      dayTime:    parseFloat(raw.dayTime)    || 0,
      xc:         parseFloat(raw.xc)         || 0,
      night:      parseFloat(raw.night)      || 0,
      instActual: parseFloat(raw.instActual) || 0,
      instSim:    parseFloat(raw.instSim)    || 0,
      apprActual: parseInt(raw.apprActual)   || 0,
      apprSim:    parseInt(raw.apprSim)      || 0,
      ldgDay:     parseInt(raw.ldgDay)       || 0,
      ldgNight:   parseInt(raw.ldgNight)     || 0,
      solo:       parseSolo(raw.solo),
      remarks:    (raw.remarks || '').trim(),
    };

    const errs = validateCsvRow(d, i + 2);
    if (errs.length) { rowErrors.push({ row: i + 2, cols: dataRows[i], errs }); }
    else             { valid.push(d); }
  }

  if (rowErrors.length) {
    const errHtml = rowErrors.map(r =>
      `<div class="csv-row-err">Row ${r.row}: ${esc(r.errs.join(' · '))}</div>`
    ).join('');
    statusEl.innerHTML =
      `<div class="csv-summary err">` +
        `${rowErrors.length} row(s) failed validation. ` +
        `<button class="btn-text" id="csv-export-errors-btn" style="font-size:.75rem">Export failed rows →</button>` +
      `</div>${errHtml}`;
    statusEl.classList.remove('hidden');

    $('csv-export-errors-btn').addEventListener('click', () => {
      const csvEscVal = v => (String(v).includes(',') || String(v).includes('"') || String(v).includes('\n'))
        ? `"${String(v).replace(/"/g, '""')}"` : String(v);
      const headerRow = [...originalHeaders, 'failedReason'].map(csvEscVal).join(',');
      const dataRowsCsv = rowErrors.map(r => {
        const paddedCols = [...r.cols];
        while (paddedCols.length < originalHeaders.length) paddedCols.push('');
        return [...paddedCols, r.errs.join(' | ')].map(csvEscVal).join(',');
      });
      const blob = new Blob([[headerRow, ...dataRowsCsv].join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'flightlog_import_errors.csv';
      a.click();
    });

    if (!valid.length) return;
  }

  if (!valid.length) { errEl.textContent = 'No valid rows to import.'; errEl.classList.remove('hidden'); return; }

  $('csv-import-btn').disabled = true;
  $('csv-import-btn').textContent = `IMPORTING 0 / ${valid.length}…`;

  let saved = 0;
  for (const d of valid) {
    d.uid = currentUser.uid;
    d.createdAt = new Date().toISOString();
    await db.collection('flights').add(d);
    saved++;
    $('csv-import-btn').textContent = `IMPORTING ${saved} / ${valid.length}…`;
  }

  $('csv-import-btn').disabled = false;
  $('csv-import-btn').textContent = 'IMPORT FLIGHTS';
  $('csv-file-input').value = '';

  const summary = `<div class="csv-summary ok">${saved} flight(s) imported successfully.</div>`;
  if (statusEl.innerHTML) {
    statusEl.innerHTML = statusEl.innerHTML.replace(/<div class="csv-summary err">[\s\S]*?<\/div>/, summary);
  } else {
    statusEl.innerHTML = summary;
    statusEl.classList.remove('hidden');
  }
});

// ============================================
// INIT
// ============================================
resetForm();

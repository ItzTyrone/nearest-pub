// app.js — orchestration
import { haversine, bearing, normalizeAngle, smoothHeading, formatDistance, walkMinutes, compassDir, continuousAngle } from './geo.js';
import { fetchPubsEscalating, sortNearest } from './pubs.js';
import { Compass } from './compass.js';

const $ = (id) => document.getElementById(id);

const state = {
  pos: null,          // {lat, lon, accuracy}
  pubs: [],           // sorted nearest first
  radius: 0,
  index: 0,
  heading: null,      // smoothed heading degrees
  rawHeading: null,
  lastQuery: null,    // {lat, lon, ts}
  wakeLock: null,
  compass: new Compass(),
  needleAngle: 0,     // continuous displayed angle
  hasHeading: false,
};

// ---------- test override via ?lat=&lon= ----------
function parseOverride() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get('lat'));
  const lon = parseFloat(p.get('lon'));
  if (isFinite(lat) && isFinite(lon)) return { lat, lon };
  return null;
}
const override = parseOverride();

// ---------- ticks injection ----------
(function injectTicks() {
  const g = document.querySelector('.ticks');
  if (!g) return;
  const cx = 120, cy = 120;
  for (let i = 0; i < 12; i++) {
    const ang = (i * 30) * Math.PI / 180;
    // 0 deg = north = -90 deg in standard math
    const a = ang - Math.PI / 2;
    const r1 = 100, r2 = 112;
    const major = i % 3 === 0;
    const rr1 = major ? 98 : 104;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx + rr1 * Math.cos(a));
    line.setAttribute('y1', cy + rr1 * Math.sin(a));
    line.setAttribute('x2', cx + r2 * Math.cos(a));
    line.setAttribute('y2', cy + r2 * Math.sin(a));
    if (!major) line.classList.add('minor');
    g.appendChild(line);
  }
})();

// ---------- UI helpers ----------
function setStatus(msg) { $('status').textContent = msg; }
function setHint(msg) { $('hint').textContent = msg || ''; }

function showModal(title, body, { primary = 'OK', secondary = null, onPrimary = null, onSecondary = null } = {}) {
  $('modalTitle').textContent = title;
  $('modalBody').textContent = body;
  $('modalPrimary').textContent = primary;
  $('modalSecondary').textContent = secondary || 'Cancel';
  $('modalSecondary').style.display = secondary ? '' : 'none';
  $('modal').hidden = false;
  const p = $('modalPrimary'), s = $('modalSecondary');
  const cleanup = () => { $('modal').hidden = true; p.onclick = null; s.onclick = null; };
  p.onclick = () => { cleanup(); if (onPrimary) onPrimary(); };
  s.onclick = () => { cleanup(); if (onSecondary) onSecondary(); };
}

function hideModal() { $('modal').hidden = true; }

function showSheet(show) {
  $('sheet').hidden = !show;
  $('backdrop').hidden = !show;
}

// ---------- needle ----------
function updateNeedle() {
  const pub = state.pubs[state.index];
  if (!pub || !state.pos) return;
  const b = pub.bearing != null ? pub.bearing : bearing(state.pos.lat, state.pos.lon, pub.lat, pub.lon);
  let target;
  if (state.hasHeading && state.heading != null) {
    target = normalizeAngle(b - state.heading);
  } else {
    target = b; // point in absolute compass direction
  }
  state.needleAngle = continuousAngle(state.needleAngle, target);
  $('needleWrap').style.transform = `rotate(${state.needleAngle}deg)`;
}

function renderPub() {
  const pub = state.pubs[state.index];
  if (!pub) {
    $('distance').textContent = '--';
    $('distUnit').textContent = 'metres';
    $('pubName').textContent = state.pubs.length ? 'No pub' : 'No pubs nearby';
    $('walk').textContent = '';
    $('btn-go').disabled = true;
    return;
  }
  $('distance').textContent = formatDistance(pub.distance).split(' ')[0];
  $('distUnit').textContent = formatDistance(pub.distance).split(' ').slice(1).join(' ') || 'm';
  $('pubName').textContent = pub.name;
  $('walk').textContent = walkMinutes(pub.distance);
  $('btn-go').disabled = false;
  updateNeedle();
}

function renderList() {
  const ul = $('list');
  ul.innerHTML = '';
  state.pubs.slice(0, 12).forEach((p, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div><div class="name">${escapeHtml(p.name)}</div><div class="meta">${escapeHtml(p.address || '')}${p.opening ? ' · ' + escapeHtml(p.opening) : ''}</div></div><div class="dist">${formatDistance(p.distance)}</div>`;
    li.addEventListener('click', () => { state.index = i; renderPub(); showSheet(false); });
    ul.appendChild(li);
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- data loading ----------
let loadingPubs = false;
async function loadPubs(force = false) {
  if (!state.pos) return;
  if (loadingPubs) return;
  const now = Date.now();
  if (!force && state.lastQuery) {
    const moved = haversine(state.lastQuery.lat, state.lastQuery.lon, state.pos.lat, state.pos.lon);
    if (moved < 250 && (now - state.lastQuery.ts) < 5 * 60 * 1000) return;
  }
  loadingPubs = true;
  setStatus('Finding nearby pubs…');
  try {
    const res = await fetchPubsEscalating(state.pos.lat, state.pos.lon, 3, {});
    const sorted = sortNearest(state.pos.lat, state.pos.lon, res.data);
    state.pubs = sorted;
    state.radius = res.radius;
    state.index = 0;
    state.lastQuery = { lat: state.pos.lat, lon: state.pos.lon, ts: now };
    renderPub();
    renderList();
    if (sorted.length === 0) {
      setStatus('No pubs found within 6 km. Try moving or check your connection.');
    } else {
      setStatus(`${sorted.length} pub${sorted.length > 1 ? 's' : ''} nearby${res.cached ? ' (offline cache)' : ''}.`);
    }
  } catch (e) {
    console.error('loadPubs error', e);
    setStatus('Could not load pubs. Check your connection.');
    if (state.pubs.length === 0) {
      showModal('No pubs loaded', 'We could not reach the pub database. Check your internet connection and try again.', { primary: 'Retry', onPrimary: () => loadPubs(true) });
    }
  } finally {
    loadingPubs = false;
  }
}

// ---------- location ----------
function startLocation() {
  if (override) {
    state.pos = { lat: override.lat, lon: override.lon, accuracy: 5 };
    setStatus('Using test location.');
    loadPubs(true);
    return;
  }
  if (!('geolocation' in navigator)) {
    setStatus('Geolocation is not supported by this browser.');
    showModal('No GPS', 'This browser does not support location. Use a modern Chrome on Android.', { primary: 'OK' });
    return;
  }
  const onSuccess = (pos) => {
    const { latitude, longitude, accuracy } = pos.coords;
    state.pos = { lat: latitude, lon: longitude, accuracy };
    if (accuracy > 100) setHint('GPS accuracy low — move outdoors.');
    else setHint('');
    loadPubs();
    updateNeedle();
  };
  const onError = (err) => {
    console.warn('geo error', err);
    if (err.code === 1) {
      setStatus('Location permission denied.');
      showModal('Location needed', 'Nearest Pub needs your location to find the closest pub. Enable location in your browser settings, then reload.', { primary: 'Reload', onPrimary: () => location.reload() });
    } else {
      setStatus('Could not get your location. Retrying…');
    }
  };
  navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: true, maximumAge: 2000, timeout: 15000,
  });
}

// ---------- compass ----------
function onHeading(h) {
  state.rawHeading = h;
  state.heading = smoothHeading(state.heading, h, 0.3);
  state.hasHeading = true;
  $('btn-enable-compass').hidden = true;
  updateNeedle();
}

async function enableCompass() {
  const r = await state.compass.requestPermission();
  if (r !== 'granted') {
    showModal('Compass permission', 'Compass access was not granted. The arrow will still point in the right direction, but it will not rotate with you.', { primary: 'OK' });
    return;
  }
  state.compass.start();
  state.compass.onChange(onHeading);
  // if no events arrive, nudge
  setTimeout(() => {
    if (!state.compass.alive()) setHint('No compass sensor detected. Arrow shows bearing only.');
  }, 3000);
}

// auto-start on Android (no permission API)
(async function initCompass() {
  if (state.compass.needsPermission()) {
    $('btn-enable-compass').hidden = false;
    return;
  }
  state.compass.start();
  state.compass.onChange(onHeading);
  // attempt; if nothing arrives in 2s, show button anyway
  setTimeout(() => {
    if (!state.compass.alive()) {
      $('btn-enable-compass').hidden = false;
      setHint('Tap "Enable compass" if the arrow does not move.');
    }
  }, 2000);
})();

// ---------- wake lock ----------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    }
  } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.wakeLock) requestWakeLock();
});

// ---------- service worker ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw reg failed', e));
  });
}

// ---------- event wiring ----------
$('btn-list').addEventListener('click', () => showSheet(true));
$('backdrop').addEventListener('click', () => showSheet(false));
$('btn-prev').addEventListener('click', () => {
  if (!state.pubs.length) return;
  state.index = (state.index - 1 + state.pubs.length) % state.pubs.length;
  renderPub();
});
$('btn-next').addEventListener('click', () => {
  if (!state.pubs.length) return;
  state.index = (state.index + 1) % state.pubs.length;
  renderPub();
});
$('btn-go').addEventListener('click', () => {
  const pub = state.pubs[state.index];
  if (!pub) return;
  const url = `https://www.google.com/maps/dir/?api=1&destination=${pub.lat},${pub.lon}&travelmode=walking`;
  window.open(url, '_blank', 'noopener');
});
$('btn-enable-compass').addEventListener('click', enableCompass);

// tap anywhere to try compass on iOS
document.addEventListener('click', () => {
  if (state.compass.needsPermission() && !state.compass._started) enableCompass();
}, { once: true });

window.__state = state;
window.__loadPubs = loadPubs;
window.__updateNeedle = updateNeedle;
requestWakeLock();
try { startLocation(); } catch (e) { console.error('startLocation failed', e); }
window.__booted = 'yes';

// periodic re-render of needle when heading updates already handled via events
// safety: refresh needle on position updates
setInterval(() => { if (state.pubs.length) updateNeedle(); }, 1000);

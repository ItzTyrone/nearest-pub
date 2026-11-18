// pubs.js — Overpass queries, caching, nearest sorting
import { haversine, bearing } from './geo.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const TTL = 10 * 60 * 1000; // 10 min

function cacheKey(lat, lon, r) {
  return `pubs:${lat.toFixed(3)}:${lon.toFixed(3)}:${r}`;
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !Array.isArray(obj.data)) return null;
    return { data: obj.data, ts: obj.ts || 0, fresh: (Date.now() - (obj.ts || 0)) < TTL };
  } catch { return null; }
}

function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); }
  catch { /* quota — ignore */ }
}

function buildQuery(lat, lon, r) {
  return `[out:json][timeout:25];
(
  node["amenity"="pub"](around:${r},${lat},${lon});
  way["amenity"="pub"](around:${r},${lat},${lon});
);
out center tags;`;
}

function parseElement(el) {
  const lat = (el.lat != null) ? el.lat : (el.center && el.center.lat);
  const lon = (el.lon != null) ? el.lon : (el.center && el.center.lon);
  if (lat == null || lon == null) return null;
  const t = el.tags || {};
  const name = t.name || t['name:en'] || 'Unnamed pub';
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const city = t['addr:city'] || t['addr:town'] || t['addr:village'] || '';
  const address = [street, city].filter(Boolean).join(', ');
  return {
    id: `${el.type}/${el.id}`,
    name,
    lat, lon,
    address,
    opening: t.opening_hours || '',
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || '',
  };
}

async function fetchOnce(endpoint, query, signal) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: `data=${encodeURIComponent(query)}`,
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.elements)) throw new Error('bad response');
  return json.elements.map(parseElement).filter(Boolean);
}

export async function fetchPubs(lat, lon, radius, { signal } = {}) {
  const key = cacheKey(lat, lon, radius);
  const query = buildQuery(lat, lon, radius);
  let lastErr = null;
  for (const ep of ENDPOINTS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const data = await fetchOnce(ep, query, ctrl.signal);
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onAbort);
      writeCache(key, data);
      return { data, source: ep, cached: false };
    } catch (e) {
      console.warn('endpoint failed', ep, e && e.message);
      lastErr = e;
    }
  }
  // all endpoints failed — fall back to cache (any age)
  const c = readCache(key);
  if (c) return { data: c.data, source: 'cache', cached: true };
  // last resort: any nearby cached entry
  throw lastErr || new Error('no pubs found');
}

// escalate radius until we have at least `want` results
export async function fetchPubsEscalating(lat, lon, want = 3, { signal } = {}) {
  const radii = [800, 1500, 3000, 6000];
  let last = null;
  let hardFail = null;
  for (const r of radii) {
    try {
      const res = await fetchPubs(lat, lon, r, { signal });
      const data = res.data || [];
      last = { data, radius: r, source: res.source, cached: res.cached };
      if (data.length >= want) return last;
    } catch (e) {
      hardFail = e;
      break; // network/endpoint failure — larger radii will fail too
    }
  }
  if (last && last.data && last.data.length) return last;
  if (hardFail) throw hardFail;
  throw new Error('no pubs found nearby');
}

export function sortNearest(lat, lon, pubs) {
  return pubs
    .map(p => ({ ...p, distance: haversine(lat, lon, p.lat, p.lon), bearing: bearing(lat, lon, p.lat, p.lon) }))
    .sort((a, b) => a.distance - b.distance);
}

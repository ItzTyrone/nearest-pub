// geo.js — distance, bearing, formatting, heading smoothing helpers
export const toRad = (d) => d * Math.PI / 180;
export const toDeg = (r) => r * 180 / Math.PI;

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// initial bearing from point 1 to point 2, degrees 0..360
export function bearing(lat1, lon1, lat2, lon2) {
  const p1 = toRad(lat1), p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function normalizeAngle(a) { return ((a % 360) + 360) % 360; }

// smallest signed difference from a to b, range -180..180
export function angleDiff(a, b) {
  let d = ((b - a + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
}

// circular exponential moving average for a heading in degrees
export function smoothHeading(prev, next, alpha = 0.25) {
  if (prev == null || !isFinite(prev)) return normalizeAngle(next);
  if (next == null || !isFinite(next)) return prev;
  const px = Math.cos(toRad(prev)), py = Math.sin(toRad(prev));
  const nx = Math.cos(toRad(next)), ny = Math.sin(toRad(next));
  const x = (1 - alpha) * px + alpha * nx;
  const y = (1 - alpha) * py + alpha * ny;
  return normalizeAngle(toDeg(Math.atan2(y, x)));
}

export function formatDistance(m) {
  if (m == null || !isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function walkMinutes(m) {
  if (m == null || !isFinite(m)) return '';
  const mins = Math.max(1, Math.round(m / 80));
  return mins === 1 ? 'about 1 min walk' : `about ${mins} min walk`;
}

export function compassDir(deg) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(normalizeAngle(deg) / 45) % 8];
}

// keep a displayed angle continuous (no 359->1 jumps) given a target 0..360
export function continuousAngle(prev, target) {
  if (prev == null || !isFinite(prev)) return target;
  let t = target;
  while (t - prev > 180) t -= 360;
  while (prev - t > 180) t += 360;
  return t;
}

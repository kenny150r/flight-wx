export const EARTH_KM = 6371;

export function toRad(deg) {
  return (deg * Math.PI) / 180;
}

export function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function wrapDeg(az) {
  return ((az % 360) + 360) % 360;
}

export function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = (Math.sin(dLat / 2) ** 2)
    + (Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLon / 2) ** 2));
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return wrapDeg(toDeg(Math.atan2(y, x)));
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function utcDateClean(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

export function utcTimeHms(ms) {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function addUtcDays(dateClean, deltaDays) {
  const y = parseInt(dateClean.slice(0, 4), 10);
  const m = parseInt(dateClean.slice(4, 6), 10) - 1;
  const d = parseInt(dateClean.slice(6, 8), 10);
  const dt = new Date(Date.UTC(y, m, d + deltaDays));
  return utcDateClean(dt.getTime());
}

export function dateInputToClean(value) {
  return String(value || "").replace(/-/g, "");
}

export function cleanToDateInput(clean) {
  if (!clean || clean.length !== 8) return "";
  return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
}

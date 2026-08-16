export const SAT_STEP_MS = 15 * 60 * 1000;
export const IEM_SAT_ROOT = "https://mesonet.agron.iastate.edu/archive/data";

export function parseSatProduct(value) {
  return value === "ir" || value === "vis" ? value : "";
}

export function nearestSatTimeMs(timeMs) {
  if (!Number.isFinite(timeMs)) return NaN;
  return Math.round(timeMs / SAT_STEP_MS) * SAT_STEP_MS;
}

export function satNeighborTimeMs(timeMs) {
  if (!Number.isFinite(timeMs)) return NaN;
  const nearest = nearestSatTimeMs(timeMs);
  if (timeMs === nearest) return nearest - SAT_STEP_MS;
  const prev = nearest - SAT_STEP_MS;
  const next = nearest + SAT_STEP_MS;
  return Math.abs(timeMs - prev) <= Math.abs(timeMs - next) ? prev : next;
}

export function satFrameKey(product, timeMs) {
  const code = parseSatProduct(product);
  const snapped = nearestSatTimeMs(timeMs);
  if (!code || !Number.isFinite(snapped)) return "";
  return `${code}|${snapped}`;
}

export function satFrameUrl(product, timeMs) {
  const code = parseSatProduct(product);
  const snapped = nearestSatTimeMs(timeMs);
  if (!code || !Number.isFinite(snapped)) return "";
  const date = new Date(snapped);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${IEM_SAT_ROOT}/${yyyy}/${mm}/${dd}/GIS/sat/conus_goes_${code}4km_${hh}${mi}.tif`;
}

export function satCandidateTimes(timeMs) {
  const nearest = nearestSatTimeMs(timeMs);
  const neighbor = satNeighborTimeMs(timeMs);
  if (!Number.isFinite(nearest)) return [];
  if (!Number.isFinite(neighbor) || neighbor === nearest) return [nearest];
  return [nearest, neighbor];
}

export function upcomingSatTimes(samples, fromTimeMs, count = 3) {
  const start = nearestSatTimeMs(fromTimeMs);
  if (!Number.isFinite(start) || count < 1) return [];
  const seen = new Set([start]);
  const times = [];
  for (const sample of samples || []) {
    const t = nearestSatTimeMs(sample?.timeMs);
    if (!Number.isFinite(t) || t <= start || seen.has(t)) continue;
    seen.add(t);
    times.push(t);
    if (times.length >= count) break;
  }
  return times;
}

export function bboxToLeafletBounds(bbox) {
  if (!bbox || bbox.length < 4) return null;
  return [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
}

export function formatSatHud(product, timeMs, { loading = false, error = false } = {}) {
  const label = product === "ir" ? "GOES IR" : product === "vis" ? "GOES VIS" : "";
  if (!label) return "";
  if (loading) return `Loading ${label}…`;
  if (error) return `${label} unavailable`;
  const snapped = nearestSatTimeMs(timeMs);
  if (!Number.isFinite(snapped)) return label;
  const date = new Date(snapped);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${label} ${hh}:${mi}Z`;
}

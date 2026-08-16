import { parseSatProduct } from "./iemGoes.js";

export { parseSatProduct };

export const SAT_STEP_MS = 5 * 60 * 1000;
export const SAT_OFFSET_MS = 60 * 1000;
export const GOES_MAX_DT_MS = 10 * 60 * 1000;
export const G19_EAST_MS = Date.UTC(2025, 3, 7, 15, 10);
export const G18_WEST_MS = Date.UTC(2023, 0, 4);
export const GOES_WEST_LON = -105;

const CHANNEL = { ir: "13", vis: "02" };

export function goesChannel(product) {
  return CHANNEL[parseSatProduct(product)] || "";
}

export function nearestSatTimeMs(timeMs) {
  if (!Number.isFinite(timeMs)) return NaN;
  return Math.round((timeMs - SAT_OFFSET_MS) / SAT_STEP_MS) * SAT_STEP_MS + SAT_OFFSET_MS;
}

export function satNeighborTimeMs(timeMs) {
  if (!Number.isFinite(timeMs)) return NaN;
  const nearest = nearestSatTimeMs(timeMs);
  if (timeMs === nearest) return nearest - SAT_STEP_MS;
  const prev = nearest - SAT_STEP_MS;
  const next = nearest + SAT_STEP_MS;
  return Math.abs(timeMs - prev) <= Math.abs(timeMs - next) ? prev : next;
}

export function pickGoesSat(timeMs, lon) {
  const west = Number.isFinite(lon) && lon < GOES_WEST_LON;
  if (west) return timeMs >= G18_WEST_MS ? 18 : 17;
  return timeMs >= G19_EAST_MS ? 19 : 16;
}

export function goesSatCandidates(timeMs, lon) {
  const primary = pickGoesSat(timeMs, lon);
  const east = timeMs >= G19_EAST_MS ? [19, 16] : [16, 19];
  const west = timeMs >= G18_WEST_MS ? [18, 17] : [17, 18];
  const coast = primary === 18 || primary === 17 ? [...west, ...east] : [...east, ...west];
  return [...new Set([primary, ...coast])];
}

export function goesBucket(satId) {
  return `noaa-goes${satId}`;
}

export function utcDayOfYear(timeMs) {
  const d = new Date(timeMs);
  const y = d.getUTCFullYear();
  return Math.round((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 0)) / 86400000);
}

export function parseGoesStamp(stamp) {
  const s = String(stamp || "");
  if (!/^\d{14}$/.test(s)) return NaN;
  const year = Number(s.slice(0, 4));
  const doy = Number(s.slice(4, 7));
  const hh = Number(s.slice(7, 9));
  const mm = Number(s.slice(9, 11));
  const ss = Number(s.slice(11, 13));
  const tenth = Number(s.slice(13, 14));
  return Date.UTC(year, 0, doy, hh, mm, ss, tenth * 100);
}

export function goesHourPrefix(timeMs) {
  if (!Number.isFinite(timeMs)) return "";
  const d = new Date(timeMs);
  const y = d.getUTCFullYear();
  const doy = String(utcDayOfYear(timeMs)).padStart(3, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `ABI-L2-CMIPC/${y}/${doy}/${hh}/`;
}

export function goesListPrefixes(timeMs) {
  if (!Number.isFinite(timeMs)) return [];
  return [...new Set([timeMs - 3_600_000, timeMs, timeMs + 3_600_000].map(goesHourPrefix))];
}

export function parseGoesObject(key) {
  const m = String(key || "").match(/CMIPC-M(\d)C(\d{2})_G(\d{2})_s(\d{14})/);
  if (!m) return null;
  return {
    key,
    mode: Number(m[1]),
    channel: m[2],
    satId: Number(m[3]),
    startMs: parseGoesStamp(m[4]),
  };
}

export function pickNearestGoesObject(objects, timeMs, channel, satId) {
  const want = String(channel).padStart(2, "0");
  const sat = Number(satId);
  let best = null;
  let bestDt = Infinity;
  for (const obj of objects || []) {
    const parsed = parseGoesObject(obj.key);
    if (!parsed || parsed.channel !== want || parsed.satId !== sat) continue;
    if (!Number.isFinite(parsed.startMs)) continue;
    const dt = Math.abs(parsed.startMs - timeMs);
    if (dt < bestDt) {
      best = { ...obj, ...parsed };
      bestDt = dt;
    }
  }
  if (!best || bestDt > GOES_MAX_DT_MS) return null;
  return best;
}

export function satFrameKey(product, timeMs, satId) {
  const code = parseSatProduct(product);
  const snapped = nearestSatTimeMs(timeMs);
  if (!code || !Number.isFinite(snapped)) return "";
  return Number.isFinite(satId) && satId ? `${code}|${satId}|${snapped}` : `${code}|${snapped}`;
}

export function uniqueSatTimes(samples) {
  const seen = new Set();
  const times = [];
  for (const sample of samples || []) {
    const t = nearestSatTimeMs(sample?.timeMs);
    if (!Number.isFinite(t) || seen.has(t)) continue;
    seen.add(t);
    times.push(t);
  }
  return times;
}

export function uniqueSatSlots(samples) {
  const seen = new Set();
  const slots = [];
  for (const sample of samples || []) {
    const timeMs = nearestSatTimeMs(sample?.timeMs);
    if (!Number.isFinite(timeMs)) continue;
    const satId = pickGoesSat(sample.timeMs, sample.lon);
    const slotKey = `${satId}|${timeMs}`;
    if (seen.has(slotKey)) continue;
    seen.add(slotKey);
    slots.push({ timeMs, lon: sample.lon, satId });
  }
  return slots;
}

export function upcomingSatTimes(samples, fromTimeMs, count = 3) {
  const start = nearestSatTimeMs(fromTimeMs);
  if (!Number.isFinite(start) || count < 1) return [];
  return uniqueSatTimes(samples).filter((t) => t > start).slice(0, count);
}

export function defaultSatBbox(satId) {
  return satId === 17 || satId === 18
    ? { west: -175, east: -105, south: 18, north: 55 }
    : { west: -130, east: -60, south: 22, north: 54 };
}

export function satBoundsFromSamples(samples, pad = 3.5) {
  let west = 180;
  let east = -180;
  let south = 90;
  let north = -90;
  for (const sample of samples || []) {
    if (!Number.isFinite(sample?.lat) || !Number.isFinite(sample?.lon)) continue;
    west = Math.min(west, sample.lon);
    east = Math.max(east, sample.lon);
    south = Math.min(south, sample.lat);
    north = Math.max(north, sample.lat);
  }
  if (west > east) return null;
  if (east - west < 4) {
    const mid = (east + west) / 2;
    west = mid - 2;
    east = mid + 2;
  }
  if (north - south < 4) {
    const mid = (north + south) / 2;
    south = mid - 2;
    north = mid + 2;
  }
  return {
    west: Math.max(-180, west - pad),
    east: Math.min(-50, east + pad),
    south: Math.max(10, south - pad),
    north: Math.min(60, north + pad),
  };
}

export function formatSatHud(product, timeMs, { loading = false, error = false, satId } = {}) {
  const kind = product === "ir" ? "IR" : product === "vis" ? "VIS" : "";
  if (!kind) return "";
  const sat = Number.isFinite(satId) && satId ? `GOES-${satId}` : "GOES";
  const label = `${sat} ${kind}`;
  if (loading) return `Loading ${label}…`;
  if (error) return `${label} unavailable`;
  const snapped = nearestSatTimeMs(timeMs);
  const when = Number.isFinite(timeMs) ? timeMs : snapped;
  if (!Number.isFinite(when)) return label;
  const date = new Date(when);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${label} ${hh}:${mi}Z`;
}

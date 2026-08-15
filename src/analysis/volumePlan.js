import { addUtcDays, utcDateClean } from "./geo.js";
import { findClosestByTimeMs } from "../radar/decode/sweeps.js";
import { defaultConcurrency, mapPool } from "./pool.js";

export const MAX_VOLUMES = 80;
export const SCAN_TOLERANCE_SEC = 600;
export const DEFAULT_STRIDE_SEC = 60;

function datesAround(dateClean) {
  return [dateClean, addUtcDays(dateClean, -1), addUtcDays(dateClean, 1)];
}

function collectKeys(points, datesFor) {
  const listKeys = [];
  const seen = new Set();
  for (const point of points) {
    const dateClean = utcDateClean(point.timeMs);
    for (const date of datesFor(dateClean)) {
      const key = `${point.station.id}:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      listKeys.push({ key, stationId: point.station.id, dateClean: date });
    }
  }
  return listKeys;
}

async function listWithRetry(fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200 * (i + 1)));
    }
  }
  throw lastError;
}

async function listStationDays(listKeys, listScans) {
  const scanCache = new Map();
  let listErrors = 0;
  await mapPool(listKeys, defaultConcurrency("list"), async (item) => {
    try {
      const listed = await listWithRetry(() => listScans(item.stationId, item.dateClean));
      scanCache.set(item.key, listed);
    } catch {
      listErrors += 1;
      scanCache.set(item.key, { scans: [], listFailed: true });
    }
  });
  return { scanCache, listErrors };
}

function matchPoint(point, scanCache) {
  const dateClean = utcDateClean(point.timeMs);
  let listFailed = false;
  for (const date of datesAround(dateClean)) {
    const listed = scanCache.get(`${point.station.id}:${date}`) || { scans: [] };
    if (listed.listFailed) listFailed = true;
    const match = findClosestByTimeMs(listed.scans || [], date, point.timeMs, SCAN_TOLERANCE_SEC);
    if (match) return { match, usedDate: date, listFailed: false };
  }
  return { match: null, usedDate: dateClean, listFailed };
}

function capVolumes(volumes, maxVolumes) {
  if (volumes.length <= maxVolumes) return { volumes, capped: false };
  const sorted = [...volumes].sort((a, b) => {
    const ta = a.points[0]?.timeMs || 0;
    const tb = b.points[0]?.timeMs || 0;
    return ta - tb || a.key.localeCompare(b.key);
  });
  const keep = [];
  const used = new Set();
  const step = sorted.length / maxVolumes;
  for (let i = 0; i < maxVolumes; i++) {
    let idx = Math.min(sorted.length - 1, Math.floor(i * step));
    while (used.has(idx) && idx < sorted.length - 1) idx += 1;
    if (used.has(idx)) continue;
    used.add(idx);
    keep.push(sorted[idx]);
  }
  const kept = new Set(keep);
  for (const volume of sorted) {
    if (kept.has(volume)) continue;
    for (const point of volume.points) point.uncoveredReason = "volume_budget";
  }
  return { volumes: keep, capped: true };
}

export async function planVolumes(assigned, { listScans, maxVolumes = MAX_VOLUMES } = {}) {
  const covered = assigned.filter((p) => p.station);
  const scanCache = new Map();
  let listErrors = 0;

  const sameDay = await listStationDays(collectKeys(covered, (date) => [date]), listScans);
  sameDay.scanCache.forEach((value, key) => scanCache.set(key, value));
  listErrors += sameDay.listErrors;

  const unmatched = covered.filter((point) => !matchPoint(point, scanCache).match);
  if (unmatched.length) {
    const extra = collectKeys(unmatched, (date) => [addUtcDays(date, -1), addUtcDays(date, 1)])
      .filter((item) => !scanCache.has(item.key));
    if (extra.length) {
      const adjacent = await listStationDays(extra, listScans);
      adjacent.scanCache.forEach((value, key) => scanCache.set(key, value));
      listErrors += adjacent.listErrors;
    }
  }

  const volumeMap = new Map();
  for (const point of covered) {
    const { match, usedDate, listFailed } = matchPoint(point, scanCache);
    if (!match) {
      point.uncoveredReason = listFailed ? "list_failed" : "no_scan";
      continue;
    }
    if (!volumeMap.has(match.key)) {
      volumeMap.set(match.key, {
        station: point.station,
        dateClean: usedDate,
        timeClean: match.time.replace(/:/g, ""),
        key: match.key,
        size: match.size,
        points: [],
      });
    }
    volumeMap.get(match.key).points.push(point);
  }

  const planned = [...volumeMap.values()];
  const { volumes, capped } = capVolumes(planned, maxVolumes);
  return {
    volumes,
    overBudget: planned.length > maxVolumes,
    uniqueCount: planned.length,
    listErrors,
    capped,
  };
}

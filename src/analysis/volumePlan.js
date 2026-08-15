import { addUtcDays, utcDateClean, utcTimeHms } from "./geo.js";
import { findClosestByTime } from "../radar/decode/sweeps.js";

export const MAX_VOLUMES = 80;
export const SCAN_TOLERANCE_SEC = 360;
export const DEFAULT_STRIDE_SEC = 60;

function datesAround(dateClean) {
  return [addUtcDays(dateClean, -1), dateClean, addUtcDays(dateClean, 1)];
}

export async function planVolumes(assigned, { listScans, maxVolumes = MAX_VOLUMES } = {}) {
  const covered = assigned.filter((p) => p.station);
  const scanCache = new Map();

  async function scansFor(stationId, dateClean) {
    const key = `${stationId}:${dateClean}`;
    if (!scanCache.has(key)) {
      scanCache.set(key, listScans(stationId, dateClean).catch(() => ({ scans: [] })));
    }
    return scanCache.get(key);
  }

  const volumeMap = new Map();
  for (const point of covered) {
    const dateClean = utcDateClean(point.timeMs);
    const target = utcTimeHms(point.timeMs);
    let match = null;
    let usedDate = dateClean;
    for (const date of datesAround(dateClean)) {
      const listed = await scansFor(point.station.id, date);
      match = findClosestByTime(listed.scans || [], target, SCAN_TOLERANCE_SEC);
      if (match) {
        usedDate = date;
        break;
      }
    }
    if (!match) {
      point.uncoveredReason = "no_scan";
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

  const volumes = [...volumeMap.values()];
  return {
    volumes,
    overBudget: volumes.length > maxVolumes,
    uniqueCount: volumes.length,
  };
}

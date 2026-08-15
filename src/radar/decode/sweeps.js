export const LOWEST_ELEVATION_EPSILON_DEG = 0.05;
export const LOWEST_SWEEP_DUP_GAP_SECONDS = 60;

export function parseScanKey(key) {
  const filename = String(key || "").split("/").pop() || "";
  const match = filename.match(/([A-Z]{4})(\d{8})[_-](\d{6})(?:[_.-]|$)/);
  if (match) return { station: match[1], date: match[2], time: match[3] };
  return { station: null, date: null, time: null };
}

export function parseScanTime(filename) {
  const parsed = parseScanKey(filename);
  if (parsed.time) {
    return `${parsed.time.slice(0, 2)}:${parsed.time.slice(2, 4)}:${parsed.time.slice(4, 6)}`;
  }
  const match = String(filename).match(/_(\d{6})(?:_|\.|$)/);
  if (!match) return null;
  const t = match[1];
  return `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`;
}

export function parseL3KeyTime(key) {
  const withSec = String(key).match(/_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/);
  if (withSec) return `${withSec[4]}:${withSec[5]}:${withSec[6]}`;
  const noSec = String(key).match(/_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})$/);
  if (noSec) return `${noSec[4]}:${noSec[5]}:00`;
  return null;
}

export function timeToSeconds(t) {
  const parts = String(t || "").split(":");
  return (
    (parseInt(parts[0] || "0", 10) * 3600) +
    (parseInt(parts[1] || "0", 10) * 60) +
    (parseInt(parts[2] || "0", 10) || 0)
  );
}

export function findClosestByTime(items, targetTime, maxDeltaSec = 600) {
  if (!items.length) return null;
  const targetSec = timeToSeconds(targetTime);
  let best = null;
  let bestDelta = Infinity;
  for (const item of items) {
    const sec = timeToSeconds(item.time);
    let delta = Math.abs(sec - targetSec);
    delta = Math.min(delta, 86400 - delta);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = item;
    }
  }
  if (best && bestDelta <= maxDeltaSec) return best;
  return null;
}

export function listAvailableElevations(sweeps) {
  const rounded = sweeps
    .map((s) => s.elevation)
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.round(v * 10) / 10)
    .sort((a, b) => a - b);
  return [...new Set(rounded)];
}

export function getLowElevationSweepIndices(sweeps) {
  const finite = sweeps.filter((s) => Number.isFinite(s.elevation));
  if (!finite.length) return [];
  const minElev = Math.min(...finite.map((s) => Math.round(s.elevation * 10) / 10));
  return sweeps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Number.isFinite(s.elevation) && Math.abs(Math.round(s.elevation * 10) / 10 - minElev) <= LOWEST_ELEVATION_EPSILON_DEG)
    .map(({ i }) => i);
}

export function findSweepsForElevation(sweeps, elevation) {
  const finite = sweeps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => Number.isFinite(s.elevation));
  if (!finite.length) return { selected: null, indices: [] };
  const req = Number(elevation);
  let nearest = finite[0];
  for (const item of finite) {
    if (Math.abs(item.s.elevation - req) < Math.abs(nearest.s.elevation - req)) {
      nearest = item;
    }
  }
  const selected = nearest.s.elevation;
  const indices = finite
    .filter(({ s }) => Math.abs(s.elevation - selected) <= LOWEST_ELEVATION_EPSILON_DEG)
    .map(({ i }) => i);
  return { selected, indices };
}

export function dedupeLowestSweeps(sweeps, indices) {
  if (indices.length <= 1) return indices;
  const selected = [];
  for (const idx of indices) {
    const sweep = sweeps[idx];
    const ts = sweep.timestampMs != null ? sweep.timestampMs / 1000 : null;
    const valid = sweep.validCount || 0;
    if (!selected.length) {
      selected.push({ idx, ts, valid });
      continue;
    }
    const prev = selected[selected.length - 1];
    const nearDup = ts != null && prev.ts != null && Math.abs(ts - prev.ts) <= LOWEST_SWEEP_DUP_GAP_SECONDS;
    if (nearDup) {
      if (valid > prev.valid || (valid === prev.valid && idx > prev.idx)) {
        selected[selected.length - 1] = { idx, ts, valid };
      }
    } else {
      selected.push({ idx, ts, valid });
    }
  }
  return selected.map((item) => item.idx);
}

export function pickBestSweepByValidity(sweeps, indices) {
  if (!indices.length) throw new Error("No matching sweeps available for requested elevation");
  let best = indices[0];
  let bestValid = -1;
  for (const idx of indices) {
    const valid = sweeps[idx]?.validCount || 0;
    if (valid > bestValid) {
      bestValid = valid;
      best = idx;
    }
  }
  return best;
}

export function formatTimeParts(dateObj) {
  const hh = String(dateObj.getUTCHours()).padStart(2, "0");
  const mm = String(dateObj.getUTCMinutes()).padStart(2, "0");
  const ss = String(dateObj.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function localTimeFor(dateObj, timeZone) {
  if (!timeZone) {
    return {
      time_local: "",
      date_local: "",
      timezone: "",
      timezone_abbr: "",
    };
  }
  try {
    const timeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const dateFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const abbrFmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
    });
    const abbrParts = abbrFmt.formatToParts(dateObj);
    const abbr = abbrParts.find((p) => p.type === "timeZoneName")?.value || "";
    return {
      time_local: timeFmt.format(dateObj),
      date_local: dateFmt.format(dateObj),
      timezone: timeZone,
      timezone_abbr: abbr,
    };
  } catch {
    return {
      time_local: "",
      date_local: "",
      timezone: timeZone,
      timezone_abbr: "",
    };
  }
}

export function buildBounds(lat, lon, maxRangeKm) {
  const dlat = maxRangeKm / 111;
  const dlon = maxRangeKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return {
    south: lat - dlat,
    north: lat + dlat,
    west: lon - dlon,
    east: lon + dlon,
  };
}

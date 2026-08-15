export const MAX_TRACK_BYTES = 8 * 1024 * 1024;
const MIN_TIME_MS = Date.UTC(1991, 0, 1);

function parseTimeMs(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  const s = String(value).trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n < 1e12 ? n * 1000 : n;
  }
  const iso = Date.parse(s);
  if (Number.isFinite(iso)) return iso;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (compact) {
    return Date.UTC(
      Number(compact[1]),
      Number(compact[2]) - 1,
      Number(compact[3]),
      Number(compact[4]),
      Number(compact[5]),
      Number(compact[6]),
    );
  }
  return NaN;
}

function num(value) {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : NaN;
}

function headerIndex(headers, names) {
  const lower = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  for (const name of names) {
    const i = lower.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
}

export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  const text = String(line || "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        cur += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((c === "," || c === "\t") && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

function requireAnalysisPoints(points, kind) {
  const timed = points.filter((p) => Number.isFinite(p.timeMs) && p.timeMs >= MIN_TIME_MS);
  if (!timed.length) {
    throw new Error(`${kind} needs a UTC timestamp on each point. Synthetic or missing times are not used.`);
  }
  const ready = timed.filter((p) => Number.isFinite(p.altFt));
  if (!ready.length) {
    throw new Error(`${kind} needs altitude on each point (alt_ft / altitudes in feet, or alt_m / altitudes_m / coordinate Z in meters).`);
  }
  return ready.sort((a, b) => a.timeMs - b.timeMs);
}

export function parseCsvTrack(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one point");
  const headers = splitCsvLine(lines[0]);
  const iTime = headerIndex(headers, ["time", "timestamp", "datetime", "utc", "timeutc"]);
  const iLat = headerIndex(headers, ["lat", "latitude"]);
  const iLon = headerIndex(headers, ["lon", "lng", "longitude", "long"]);
  const iAlt = headerIndex(headers, ["altft", "altitudeft", "altbaro", "alt", "altitude", "baroaltitude"]);
  const iAltM = headerIndex(headers, ["altm", "altitudem", "altitudemeters"]);
  const iHdg = headerIndex(headers, ["heading", "headingdeg", "track", "hdg", "course", "truetrack"]);
  const iGs = headerIndex(headers, ["gskt", "gs", "groundspeed", "speedkt", "speed", "gndspd"]);
  const iVs = headerIndex(headers, ["vsfpm", "vs", "verticalrate", "barorate", "roc", "vsftmin"]);
  const iTas = headerIndex(headers, ["taskt", "tas"]);
  const iIas = headerIndex(headers, ["iaskt", "ias"]);
  if (iLat < 0 || iLon < 0) throw new Error("CSV must include lat and lon columns");
  if (iTime < 0) throw new Error("CSV must include a time column");
  if (iAlt < 0 && iAltM < 0) throw new Error("CSV must include an altitude column (alt_ft or alt_m)");
  const points = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const lat = num(cols[iLat]);
    const lon = num(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const timeMs = parseTimeMs(cols[iTime]);
    const altFt = iAlt >= 0 ? num(cols[iAlt]) : num(cols[iAltM]) * 3.28084;
    if (!Number.isFinite(timeMs) || timeMs < MIN_TIME_MS || !Number.isFinite(altFt)) continue;
    points.push({
      timeMs,
      lat,
      lon,
      altFt,
      headingDeg: iHdg >= 0 ? num(cols[iHdg]) : NaN,
      gsKt: iGs >= 0 ? num(cols[iGs]) : NaN,
      vsFpm: iVs >= 0 ? num(cols[iVs]) : NaN,
      tasKt: iTas >= 0 ? num(cols[iTas]) : NaN,
      iasKt: iIas >= 0 ? num(cols[iIas]) : NaN,
    });
  }
  if (!points.length) throw new Error("CSV contained no rows with valid time, lat, lon, and altitude");
  return requireAnalysisPoints(points, "CSV");
}

function pickAltitudeFt(props, index, coord) {
  const at = (value) => (Array.isArray(value) ? value[index] : value);
  const ft = num(at(props.alt_ft ?? props.altitude_ft ?? props.altitudes_ft));
  if (Number.isFinite(ft)) return ft;
  const meters = num(at(props.alt_m ?? props.altitude_m ?? props.altitudes_m));
  if (Number.isFinite(meters)) return meters * 3.28084;
  const generic = num(at(props.altitudes ?? props.alt ?? props.altitude));
  if (Number.isFinite(generic)) return generic;
  const coordM = Array.isArray(coord) && coord.length > 2 ? num(coord[2]) : NaN;
  return Number.isFinite(coordM) ? coordM * 3.28084 : NaN;
}

function pushCoord(points, coord, timeMs, altFt, extra = {}) {
  if (!Array.isArray(coord) || coord.length < 2) return;
  const lon = num(coord[0]);
  const lat = num(coord[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  points.push({
    timeMs: Number.isFinite(timeMs) ? timeMs : NaN,
    lat,
    lon,
    altFt: Number.isFinite(altFt) ? altFt : NaN,
    headingDeg: num(extra.headingDeg),
    gsKt: num(extra.gsKt),
    vsFpm: num(extra.vsFpm),
    tasKt: num(extra.tasKt),
    iasKt: num(extra.iasKt),
  });
}

function walkGeometry(geom, props, points) {
  if (!geom) return;
  const times = props.times || props.time || props.timestamps;
  if (geom.type === "Point") {
    pushCoord(
      points,
      geom.coordinates,
      parseTimeMs(props.time || props.timestamp),
      pickAltitudeFt(props, 0, geom.coordinates),
      {
        headingDeg: num(props.heading ?? props.track ?? props.hdg),
        gsKt: num(props.gs ?? props.groundspeed ?? props.speed),
        vsFpm: num(props.vs ?? props.vertical_rate ?? props.baro_rate),
        tasKt: num(props.tas),
        iasKt: num(props.ias),
      },
    );
  } else if (geom.type === "LineString" || geom.type === "MultiPoint") {
    geom.coordinates.forEach((c, i) => {
      const t = Array.isArray(times) ? parseTimeMs(times[i]) : parseTimeMs(times);
      pushCoord(points, c, t, pickAltitudeFt(props, i, c));
    });
  } else if (geom.type === "MultiLineString") {
    for (const line of geom.coordinates) walkGeometry({ type: "LineString", coordinates: line }, props, points);
  } else if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries || []) walkGeometry(g, props, points);
  }
}

export function parseGeoJsonTrack(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  const points = [];
  const features = data.type === "FeatureCollection" ? data.features
    : data.type === "Feature" ? [data]
      : [{ type: "Feature", geometry: data, properties: {} }];
  for (const feature of features) {
    walkGeometry(feature.geometry, feature.properties || {}, points);
  }
  if (!points.length) throw new Error("GeoJSON contained no coordinates");
  return requireAnalysisPoints(points, "GeoJSON");
}

export function parseTrackFile(name, text) {
  const lower = String(name || "").toLowerCase();
  const trimmed = String(text || "").trim();
  if (trimmed.length > MAX_TRACK_BYTES) throw new Error("Track file is too large (8 MB max).");
  if (lower.endsWith(".json") || lower.endsWith(".geojson") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseGeoJsonTrack(trimmed);
  }
  return parseCsvTrack(trimmed);
}

function normalizeCallsign(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "");
}

export function parseReadsbTrace(json, { callsign } = {}) {
  const base = Number(json.timestamp) * 1000;
  if (!Number.isFinite(base) || !Array.isArray(json.trace)) return [];
  const want = normalizeCallsign(callsign);
  const kept = [];
  let matched = 0;
  let other = 0;
  for (const row of json.trace) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const [dt, lat, lon, alt] = row;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const extra = row[8] && typeof row[8] === "object" ? row[8] : null;
    const flight = normalizeCallsign(extra?.flight);
    if (want && flight && flight !== want) {
      other += 1;
      continue;
    }
    if (want && flight === want) matched += 1;
    const gs = Number(extra?.gs ?? row[4]);
    const heading = Number(extra?.true_heading ?? extra?.track ?? row[5]);
    const vs = Number(extra?.baro_rate ?? extra?.geom_rate ?? row[7]);
    kept.push({
      timeMs: base + Number(dt) * 1000,
      lat,
      lon,
      altFt: alt === "ground" ? 0 : (Number.isFinite(Number(alt)) ? Number(alt) : 0),
      onGround: alt === "ground",
      headingDeg: Number.isFinite(heading) ? heading : NaN,
      gsKt: Number.isFinite(gs) ? gs : NaN,
      vsFpm: Number.isFinite(vs) ? vs : NaN,
      tasKt: Number.isFinite(Number(extra?.tas)) ? Number(extra.tas) : NaN,
      iasKt: Number.isFinite(Number(extra?.ias)) ? Number(extra.ias) : NaN,
    });
  }
  if (want && other && !matched) return [];
  return kept;
}

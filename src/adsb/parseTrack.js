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

export function parseCsvTrack(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV needs a header row and at least one point");
  const headers = lines[0].split(/,|\t/).map((h) => h.trim());
  const iTime = headerIndex(headers, ["time", "timestamp", "datetime", "utc", "timeutc"]);
  const iLat = headerIndex(headers, ["lat", "latitude"]);
  const iLon = headerIndex(headers, ["lon", "lng", "longitude", "long"]);
  const iAlt = headerIndex(headers, ["altft", "altitudeft", "altbaro", "alt", "altitude", "baroaltitude"]);
  if (iLat < 0 || iLon < 0) throw new Error("CSV must include lat and lon columns");
  const points = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(/,|\t/);
    const lat = num(cols[iLat]);
    const lon = num(cols[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const timeMs = iTime >= 0 ? parseTimeMs(cols[iTime]) : NaN;
    const altFt = iAlt >= 0 ? num(cols[iAlt]) : 0;
    points.push({
      timeMs: Number.isFinite(timeMs) ? timeMs : points.length,
      lat,
      lon,
      altFt: Number.isFinite(altFt) ? altFt : 0,
    });
  }
  if (!points.length) throw new Error("CSV contained no valid lat/lon rows");
  if (points.every((p) => p.timeMs === points.indexOf(p))) {
    const start = Date.now();
    points.forEach((p, i) => { p.timeMs = start + i * 60000; });
  }
  return points.sort((a, b) => a.timeMs - b.timeMs);
}

function pushCoord(points, coord, timeMs, altFt) {
  if (!Array.isArray(coord) || coord.length < 2) return;
  const lon = num(coord[0]);
  const lat = num(coord[1]);
  const altM = coord.length > 2 ? num(coord[2]) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  points.push({
    timeMs: Number.isFinite(timeMs) ? timeMs : points.length,
    lat,
    lon,
    altFt: Number.isFinite(altFt) ? altFt : (Number.isFinite(altM) ? altM * 3.28084 : 0),
  });
}

function walkGeometry(geom, props, points) {
  if (!geom) return;
  const times = props.times || props.time || props.timestamps;
  const alts = props.altitudes || props.alt_ft || props.alt;
  if (geom.type === "Point") {
    pushCoord(points, geom.coordinates, parseTimeMs(props.time || props.timestamp), num(props.alt_ft ?? props.alt ?? props.altitude));
  } else if (geom.type === "LineString" || geom.type === "MultiPoint") {
    geom.coordinates.forEach((c, i) => {
      const t = Array.isArray(times) ? parseTimeMs(times[i]) : parseTimeMs(times);
      const a = Array.isArray(alts) ? num(alts[i]) : num(alts);
      pushCoord(points, c, t, a);
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
  return points.sort((a, b) => a.timeMs - b.timeMs);
}

export function parseTrackFile(name, text) {
  const lower = String(name || "").toLowerCase();
  const trimmed = String(text || "").trim();
  if (lower.endsWith(".json") || lower.endsWith(".geojson") || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseGeoJsonTrack(trimmed);
  }
  return parseCsvTrack(trimmed);
}

export function parseReadsbTrace(json, { callsign } = {}) {
  const base = Number(json.timestamp) * 1000;
  if (!Number.isFinite(base) || !Array.isArray(json.trace)) return [];
  const want = callsign ? String(callsign).toUpperCase().replace(/\s+/g, "") : "";
  const all = [];
  const matched = [];
  for (const row of json.trace) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const [dt, lat, lon, alt] = row;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const extra = row[8];
    const flight = String(extra?.flight || "").toUpperCase().replace(/\s+/g, "");
    if (want && flight && flight !== want) continue;
    const point = {
      timeMs: base + Number(dt) * 1000,
      lat,
      lon,
      altFt: alt === "ground" ? 0 : (Number.isFinite(Number(alt)) ? Number(alt) : 0),
      onGround: alt === "ground",
    };
    all.push(point);
    if (want && flight === want) matched.push(point);
  }
  return matched.length ? matched : all;
}

const DBZ_COLORS = [
  [5, "#00ecec"],
  [20, "#00b4b4"],
  [30, "#00d400"],
  [40, "#ffff00"],
  [50, "#ff8000"],
  [60, "#ff0000"],
  [70, "#ff00ff"],
];

function dbzColor(dbz) {
  if (!Number.isFinite(dbz) || dbz < 5) return "#4a5560";
  let color = DBZ_COLORS[0][1];
  for (const [th, c] of DBZ_COLORS) {
    if (dbz >= th) color = c;
  }
  return color;
}

let map;
let layers = [];

export function initMap(el) {
  if (map) return map;
  map = L.map(el, { zoomControl: true, attributionControl: true }).setView([39.8, -98.5], 4);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 18,
  }).addTo(map);
  return map;
}

function clearLayers() {
  for (const layer of layers) map.removeLayer(layer);
  layers = [];
}

function addMarker(latlng, options, popup) {
  const marker = L.circleMarker(latlng, options).addTo(map);
  if (popup) marker.bindPopup(popup);
  layers.push(marker);
  return marker;
}

export function renderTrack(summary) {
  if (!map) return;
  clearLayers();
  const samples = summary.samples || [];
  const assigned = summary.assigned || [];
  const coords = (assigned.length ? assigned : samples).map((p) => [p.lat, p.lon]);
  if (coords.length) {
    const line = L.polyline(coords, { color: "#8b9aab", weight: 2, opacity: 0.5 }).addTo(map);
    layers.push(line);
    map.fitBounds(line.getBounds(), { padding: [32, 32] });
  }
  for (const sample of samples) {
    addMarker([sample.lat, sample.lon], {
      radius: 5,
      color: dbzColor(sample.dbz),
      fillColor: dbzColor(sample.dbz),
      fillOpacity: 0.9,
      weight: 1,
    }, `${sample.stationId || "n/a"} · ${Number.isFinite(sample.dbz) ? sample.dbz.toFixed(1) : "—"} dBZ`);
  }

  const peaks = [
    [summary.maxDbz?.sample, "#f0b429", "Max dBZ"],
    [summary.maxVr?.sample, "#3ee0b2", "Max |Vr|"],
    [summary.maxAzShear?.sample || summary.maxRadialShear?.sample, "#e85d4c", "Max shear"],
  ];
  for (const [sample, color, label] of peaks) {
    if (!sample) continue;
    addMarker([sample.lat, sample.lon], {
      radius: 9,
      color,
      fillColor: color,
      fillOpacity: 0.2,
      weight: 2,
    }, label);
  }
}

import { decodePolarData } from "./polarData.js";
import { RadarGLLayer } from "./radarLayer.js";

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

function sampleKey(sample) {
  return `${sample.timeMs}|${sample.stationId}|${sample.lat}|${sample.lon}`;
}

let map;
let trackLayers = [];
let radarLayer = null;
let selectedMarker = null;
let onSelectCb = null;

export function initMap(el) {
  if (map) return map;
  map = L.map(el, { zoomControl: true, attributionControl: true }).setView([39.8, -98.5], 4);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 18,
  }).addTo(map);
  return map;
}

function clearTrack() {
  for (const layer of trackLayers) map.removeLayer(layer);
  trackLayers = [];
  if (selectedMarker) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }
}

export function renderTrack(summary, { onSelect, selected } = {}) {
  if (!map) return;
  onSelectCb = onSelect || null;
  clearTrack();
  const samples = summary.samples || [];
  const assigned = summary.assigned || [];
  const coords = (assigned.length ? assigned : samples).map((p) => [p.lat, p.lon]);
  if (coords.length) {
    const line = L.polyline(coords, { color: "#8b9aab", weight: 2, opacity: 0.55 }).addTo(map);
    trackLayers.push(line);
    if (!radarLayer && !selected) map.fitBounds(line.getBounds(), { padding: [32, 32] });
  }
  for (const sample of samples) {
    const marker = L.circleMarker([sample.lat, sample.lon], {
      radius: 5,
      color: dbzColor(sample.dbz),
      fillColor: dbzColor(sample.dbz),
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(map);
    marker.on("click", () => onSelectCb?.(sample));
    trackLayers.push(marker);
  }
  highlightSample(selected);
}

export const EVENT_ZOOM = 9;

export function zoomToSample(sample, { zoom = EVENT_ZOOM } = {}) {
  if (!map || !sample || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return;
  map.flyTo([sample.lat, sample.lon], zoom, { duration: 0.55 });
}

export function highlightSample(sample, { openPopup = true, follow = false } = {}) {
  if (!map) return;
  if (selectedMarker) {
    map.removeLayer(selectedMarker);
    selectedMarker = null;
  }
  if (!sample) return;
  selectedMarker = L.circleMarker([sample.lat, sample.lon], {
    radius: 10,
    color: "#f0b429",
    fillColor: "#f0b429",
    fillOpacity: 0.15,
    weight: 2,
  }).addTo(map);
  selectedMarker.bindPopup(
    `${sample.stationId || "n/a"} · ${Number.isFinite(sample.elevation) ? `${sample.elevation.toFixed(1)}°` : "—"} · ${Number.isFinite(sample.dbz) ? `${sample.dbz.toFixed(1)} dBZ` : "—"}`,
  );
  if (openPopup) selectedMarker.openPopup();
  if (follow) map.panTo([sample.lat, sample.lon], { animate: true, duration: 0.35 });
}

export function showRadarFrame(frame, sample, { zoom = true } = {}) {
  if (!map || !frame) return;
  const decoded = decodePolarData(frame);
  if (radarLayer) {
    radarLayer.setData(frame, decoded);
  } else {
    radarLayer = new RadarGLLayer(frame, decoded, { opacity: 0.82 });
    radarLayer.addTo(map);
  }
  if (sample) {
    if (zoom) zoomToSample(sample);
    highlightSample(sample, { openPopup: false });
  }
}

export function clearRadar() {
  if (radarLayer) {
    map.removeLayer(radarLayer);
    radarLayer = null;
  }
}

export { sampleKey };

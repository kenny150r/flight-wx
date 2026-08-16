import { flightStatePopupHtml } from "../analysis/flightState.js";
import { decodePolarData } from "./polarData.js";
import { RadarGLLayer } from "./radarLayer.js";
import { createSatOverlay, updateSatOverlay } from "./satLayer.js";

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

const RING_KM = [50, 100, 150, 200, 250];

let map;
let trackLayers = [];
let radarLayer = null;
let satLayer = null;
let rangeRings = null;
let ringKey = "";
let selectedMarker = null;
let onSelectCb = null;

export function initMap(el) {
  if (map) return map;
  map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    fadeAnimation: false,
    zoomAnimation: true,
  }).setView([39.8, -98.5], 4);
  map.createPane("satPane");
  map.getPane("satPane").style.zIndex = 350;
  L.control.zoom({ position: "bottomleft" }).addTo(map);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "&copy; OpenStreetMap &copy; CARTO",
    maxZoom: 18,
    keepBuffer: 6,
    updateWhenZooming: false,
    updateWhenIdle: false,
  }).addTo(map);
  window.addEventListener("resize", invalidateMapSize);
  requestAnimationFrame(invalidateMapSize);
  return map;
}

export function invalidateMapSize() {
  map?.invalidateSize({ animate: false, pan: false });
}

export function drawRangeRings(lat, lon, maxRangeKm = 230, stationId = "") {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${Math.round(maxRangeKm || 0)}|${stationId}`;
  if (key === ringKey && rangeRings) return;
  clearRangeRings();
  rangeRings = L.layerGroup();
  const limit = Number.isFinite(maxRangeKm) ? maxRangeKm : 230;
  for (const km of RING_KM) {
    if (km > limit + 5) continue;
    L.circle([lat, lon], {
      radius: km * 1000,
      color: "rgba(0, 212, 255, 0.2)",
      fill: false,
      weight: 1,
      dashArray: "4 6",
      interactive: false,
    }).addTo(rangeRings);
  }
  L.circleMarker([lat, lon], {
    radius: 5,
    color: "#00d4ff",
    fillColor: "#00d4ff",
    fillOpacity: 1,
    weight: 2,
    interactive: false,
  }).addTo(rangeRings);
  if (stationId) {
    L.marker([lat, lon], {
      icon: L.divIcon({
        className: "radar-site-label",
        html: `<span>${String(stationId).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`,
        iconSize: [56, 14],
        iconAnchor: [28, -8],
      }),
      interactive: false,
    }).addTo(rangeRings);
  }
  rangeRings.addTo(map);
  ringKey = key;
}

export function clearRangeRings() {
  if (rangeRings && map) map.removeLayer(rangeRings);
  rangeRings = null;
  ringKey = "";
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

export function mapZoom() {
  return map?.getZoom() ?? 0;
}

export function zoomToSample(sample, { zoom = EVENT_ZOOM } = {}) {
  if (!map || !sample || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return;
  map.flyTo([sample.lat, sample.lon], zoom, { duration: 0.55 });
}

export function followSample(sample, { padding = 0.28 } = {}) {
  if (!map || !sample || !Number.isFinite(sample.lat) || !Number.isFinite(sample.lon)) return;
  const latlng = L.latLng(sample.lat, sample.lon);
  if (map.getBounds().pad(-padding).contains(latlng)) return;
  map.panTo(latlng, { animate: true, duration: 0.35, easeLinearity: 0.2 });
}

export function highlightSample(sample, { openPopup = true, follow = false } = {}) {
  if (!map) return;
  if (!sample) {
    if (selectedMarker) {
      map.removeLayer(selectedMarker);
      selectedMarker = null;
    }
    return;
  }
  const latlng = [sample.lat, sample.lon];
  const html = flightStatePopupHtml(sample);
  if (selectedMarker) {
    selectedMarker.setLatLng(latlng);
    selectedMarker.setPopupContent(html);
  } else {
    selectedMarker = L.circleMarker(latlng, {
      radius: 10,
      color: "#f0b429",
      fillColor: "#f0b429",
      fillOpacity: 0.15,
      weight: 2,
    }).addTo(map);
    selectedMarker.bindPopup(html, { maxWidth: 280, className: "wx-popup-wrap" });
  }
  if (openPopup) selectedMarker.openPopup();
  else selectedMarker.closePopup();
  if (follow) followSample(sample);
}

export function showRadarFrame(frame, sample, { zoom = false, highlight = false } = {}) {
  if (!map || !frame) return;
  const decoded = decodePolarData(frame);
  if (radarLayer) {
    radarLayer.setData(frame, decoded);
  } else {
    radarLayer = new RadarGLLayer(frame, decoded, { opacity: 0.82 });
    radarLayer.addTo(map);
  }
  drawRangeRings(frame.lat, frame.lon, frame.max_range_km, frame.station || sample?.stationId);
  if (sample) {
    if (zoom) zoomToSample(sample);
    if (highlight) highlightSample(sample, { openPopup: false });
  }
}

export function clearRadar() {
  if (radarLayer) {
    map.removeLayer(radarLayer);
    radarLayer = null;
  }
  clearRangeRings();
}

export function showSatFrame(frame) {
  if (!map || !frame?.canvas || !frame.bounds) return;
  if (satLayer) {
    updateSatOverlay(satLayer, frame);
  } else {
    satLayer = createSatOverlay(frame);
    satLayer.addTo(map);
  }
}

export function clearSat() {
  if (satLayer && map) map.removeLayer(satLayer);
  satLayer = null;
}

export { sampleKey };

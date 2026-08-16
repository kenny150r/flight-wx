import { formatFlightState, formatRadarWx } from "../analysis/flightState.js";
import { formatTrackTime } from "../analysis/time.js";
import { MS_TO_KT } from "../analysis/shear.js";
import { formatSatHud } from "../sat/iemGoes.js";
import { renderSeries, updateSeriesCursor } from "./series.js";

function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtTime(ms) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

function peakMeta(peak, { tiltLabel = "closest tilt" } = {}) {
  if (!peak?.sample) return "No sample";
  const s = peak.sample;
  const tilt = Number.isFinite(s.elevation) ? `${s.elevation.toFixed(1)}°` : "—";
  const beam = Number.isFinite(s.beamErrorFt) ? `${Math.round(s.beamErrorFt)} ft beam error` : "";
  return [
    fmtTime(s.timeMs),
    formatFlightState(s, { coords: true }),
    [s.stationId, `${tiltLabel} ${tilt}`, beam].filter(Boolean).join(" · "),
  ].filter(Boolean).join("\n");
}

function sameSample(a, b) {
  return a && b && a.timeMs === b.timeMs && a.stationId === b.stationId && a.lat === b.lat && a.lon === b.lon;
}

function bindSelect(el, handler) {
  if (!handler) {
    el.onclick = null;
    el.onkeydown = null;
    el.removeAttribute("tabindex");
    el.removeAttribute("role");
    return;
  }
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.onclick = handler;
  el.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handler();
    }
  };
}

export function setStatus(el, text, kind = "") {
  el.hidden = !text;
  el.textContent = text || "";
  el.dataset.kind = kind;
}

export function setProgress(els, { text, done, total, bytes } = {}) {
  els.wrap.hidden = false;
  els.text.textContent = text || "Working…";
  if (total) {
    const pct = Math.round((done / total) * 100);
    els.bar.style.width = `${pct}%`;
    const mb = bytes ? `${(bytes / 1e6).toFixed(1)} MB` : "";
    els.detail.textContent = `${done}/${total} volumes${mb ? ` · ${mb}` : ""}`;
  } else {
    els.bar.style.width = "15%";
    els.detail.textContent = "";
  }
}

export function hideProgress(els) {
  els.wrap.hidden = true;
}

export function renderReport(root, summary, meta, { onSelect, selected } = {}) {
  if (root) root.hidden = false;
  const bottom = document.getElementById("bottom");
  if (bottom) bottom.hidden = false;
  const maxDbz = summary.maxDbz?.value;
  const nearbyDbz = summary.maxNearbyDbz?.value;
  const meanDbz = summary.maxMeanDbz?.value;
  const maxComp = summary.maxCompositeDbz?.value;
  const nearbyComp = summary.maxNearbyCompositeDbz?.value;
  const vrKt = summary.maxVr?.kt;
  const nearbyVr = summary.maxNearbyVr?.kt;
  const horiz = summary.maxHorizShear || summary.maxAzShear;
  const vert = summary.maxVertShear;

  const setCard = (key, value, digits, title) => {
    const card = root.querySelector(`[data-card=${key}]`);
    if (!card) return;
    const metric = card.querySelector(".metric-value");
    if (metric) metric.textContent = fmt(value, digits);
    card.title = title || "";
  };
  setCard("dbz", maxDbz, 1, `Closest beam · nearby ${fmt(nearbyDbz, 1)} dBZ · 5 km mean ${fmt(meanDbz, 1)} dBZ\n${peakMeta(summary.maxDbz)}`);
  setCard("composite", maxComp, 1, `Column max · nearby ${fmt(nearbyComp, 1)} dBZ\n${peakMeta(summary.maxCompositeDbz, { tiltLabel: "composite tilt" })}`);
  setCard("vel", vrKt, 0, `Nearby max ${fmt(nearbyVr, 0)} kt radial\n${peakMeta(summary.maxVr)}`);
  setCard("hshear", horiz?.ktPerKm, 1, `Azimuthal · ${fmt(horiz?.perSec, 4)} s⁻¹\n${peakMeta(horiz)}`);
  setCard("vshear", vert?.ktPerKm, 1, `${fmt(vert?.perSec, 4)} s⁻¹ · ${fmt(vert?.ktPer1000Ft, 1)} kt / 1000 ft\n${peakMeta(vert)}`);

  const notes = [];
  if (meta?.route?.origin) notes.push(`Typical route ${meta.route.origin}→${meta.route.destination || "?"}`);
  if (meta?.source) notes.push(`Track source: ${meta.source}`);
  if (meta?.hex) notes.push(`Hex ${meta.hex}`);
  notes.push(`${summary.coveredCount}/${summary.trackCount} points in NEXRAD range (${fmt(summary.coveragePct, 0)}%)`);
  notes.push(`${summary.volumeCount} volumes · ${(summary.bytes / 1e6).toFixed(1)} MB · sites ${summary.sites.join(", ") || "none"}`);
  if (summary.strideSec && summary.strideSec > 60) notes.push(`Stride increased to ${summary.strideSec}s to stay under the volume budget.`);
  if (summary.volumeCapped) notes.push("Some scans were skipped after the volume cap.");
  if (summary.listErrors) notes.push(`${summary.listErrors} radar listing requests failed; those legs may look like missing scans.`);
  if (summary.ingestFailedCount) notes.push(`${summary.ingestFailedCount} volumes downloaded but did not decode.`);
  if (summary.samples?.some((s) => s.aliasSuspect)) notes.push("Some radial velocities are near typical Nyquist (~50 kt). No dealiasing; peak |Vr| or shear may be folded.");
  if (summary.lowConfidenceCount) notes.push(`${summary.lowConfidenceCount} low-confidence samples (beam miss or missing gate).`);
  if (meta?.notes?.length) notes.push(...meta.notes);
  notes.push("Max reflectivity is the closest-beam gate at flight level. The reflectivity chart overlays closest-beam, 5 km mean, and composite. Gaps in the lines are out of NEXRAD range or missing gates — those stretches are not connected. Drag the chart to zoom a time range, Expand for a larger window, then click a point to load that scan. Composite is the strongest gate in the column (any tilt) at that lat/lon. Use Closest Beam or Base on the map to switch the overlay tilt. Click a peak card to zoom to that event.");
  notes.push("Horizontal shear is azimuthal gate-to-gate Vr. Vertical shear is dVr/dz from neighboring tilts at the aircraft (along-beam fallback if only one velocity tilt). Velocity is radar radial Vr, not true wind. No dealiasing. CONUS WSR-88D only. Times are UTC; popups also show local time from longitude.");
  notes.push("Visible and IR on the map load the nearest 15-minute GOES CONUS frame under the radar (IEM 4 km archive; native ABI CONUS is ~5 minutes). IR is color-enhanced cloud-top temperature, not air temperature. Nighttime visible is dark. Play keeps that overlay and swaps frames when the 15-minute slot changes.");
  const notesEl = root.querySelector("[data-notes]");
  if (notesEl) notesEl.textContent = notes.join("\n");

  const cardMap = {
    dbz: { sample: summary.maxDbz?.sample, product: "reflectivity" },
    composite: { sample: summary.maxCompositeDbz?.sample, product: "reflectivity" },
    vel: { sample: summary.maxVr?.sample, product: "velocity" },
    hshear: { sample: horiz?.sample, product: "velocity" },
    vshear: { sample: vert?.sample, product: "velocity" },
  };
  for (const [key, { sample, product }] of Object.entries(cardMap)) {
    const card = root.querySelector(`[data-card=${key}]`);
    if (!card) continue;
    card.classList.toggle("is-selected", sameSample(selected, sample));
    bindSelect(card, sample ? () => onSelect?.(sample, { product, zoom: true }) : null);
  }

  renderSeries(document.getElementById("charts") || root, summary.samples, selected, onSelect);

  const tbody = document.querySelector("[data-table]");
  if (!tbody) return;
  tbody.replaceChildren();
  const rows = [...summary.samples].sort((a, b) => a.timeMs - b.timeMs);
  for (const s of rows) {
    const tr = document.createElement("tr");
    tr.dataset.key = `${s.timeMs}|${s.stationId}|${s.lat}|${s.lon}`;
    tr.className = sameSample(selected, s) ? "is-selected" : "";
    const cells = [
      fmtTime(s.timeMs),
      s.stationId || "—",
      fmt(s.dbz, 1),
      fmt(s.meanDbz, 1),
      fmt(s.compositeDbz, 1),
      fmt(Number.isFinite(s.vrMs) ? Math.abs(s.vrMs) * MS_TO_KT : NaN, 0),
      fmt(s.horizShearS ?? s.azShearS, 4),
      fmt(s.vertShearS, 4),
      s.lowConfidence ? s.reason || "low" : "",
    ];
    for (const value of cells) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    }
    bindSelect(tr, () => onSelect?.(s));
    tbody.appendChild(tr);
  }
}

export function updateRadarHud(el, {
  sample,
  product,
  tiltMode = "closest",
  loading,
  error,
  sat = "",
  satTimeMs,
  satLoading = false,
  satError = false,
} = {}) {
  if (!el) return;
  if (!sample && !loading && !error && !sat) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const tiltKind = tiltMode === "base"
    ? "base"
    : (sample?.tiltRole === "composite" ? "composite" : "closest beam");
  const tilt = tiltMode === "base"
    ? "base tilt"
    : (Number.isFinite(sample?.elevation) ? `${sample.elevation.toFixed(1)}° ${tiltKind}` : "tilt n/a");
  const when = sample ? formatTrackTime(sample.timeMs, { lon: sample.lon }).label : "";
  const radarTitle = loading
    ? (loading.text || "Loading radar…")
    : error
      ? error
      : sample
        ? `${sample.stationId} · ${when} · ${tilt}`
        : "";
  const satTitle = formatSatHud(sat, satTimeMs, { loading: satLoading, error: satError });
  el.querySelector("[data-hud-title]").textContent = [radarTitle, satTitle].filter(Boolean).join(" · ") || "Radar";
  const stateEl = el.querySelector("[data-hud-state]");
  if (stateEl) {
    stateEl.textContent = sample ? formatFlightState(sample) : "";
    stateEl.hidden = !sample;
  }
  const wxEl = el.querySelector("[data-hud-wx]");
  if (wxEl) {
    wxEl.textContent = sample ? formatRadarWx(sample) : "";
    wxEl.hidden = !sample;
  }
  el.querySelectorAll("[data-product]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.product === product);
  });
  el.querySelectorAll("[data-tilt]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.tilt === tiltMode);
  });
  el.querySelectorAll("[data-sat]").forEach((btn) => {
    const value = btn.dataset.sat === "off" ? "" : btn.dataset.sat;
    btn.classList.toggle("is-active", value === sat);
  });
  const legend = el.querySelector("[data-sat-legend]");
  if (legend) legend.hidden = sat !== "ir";
}

export function highlightReportSelection(root, summary, selected) {
  if (!root || !summary) return;
  const cardMap = {
    dbz: summary.maxDbz?.sample,
    composite: summary.maxCompositeDbz?.sample,
    vel: summary.maxVr?.sample,
    hshear: (summary.maxHorizShear || summary.maxAzShear)?.sample,
    vshear: summary.maxVertShear?.sample,
  };
  for (const [key, sample] of Object.entries(cardMap)) {
    root.querySelector(`[data-card=${key}]`)?.classList.toggle("is-selected", sameSample(selected, sample));
  }
  const key = selected ? `${selected.timeMs}|${selected.stationId}|${selected.lat}|${selected.lon}` : "";
  document.querySelectorAll("[data-table] tr").forEach((tr) => {
    tr.classList.toggle("is-selected", tr.dataset.key === key);
  });
  updateSeriesCursor(document.getElementById("charts") || root, summary.samples, selected);
}

export function setPlayButtons(playing, enabled) {
  document.querySelectorAll("[data-play-flight]").forEach((btn) => {
    btn.disabled = !enabled;
    btn.textContent = playing ? "Pause" : "Play flight";
  });
}

export function setPlaySlider({ enabled, index = 0, total = 0, label = "", cacheText = "" } = {}) {
  document.querySelectorAll("[data-play-slider]").forEach((el) => {
    el.disabled = !enabled;
    el.max = String(Math.max(0, total - 1));
    el.value = String(index);
  });
  document.querySelectorAll("[data-play-slider-label]").forEach((el) => {
    el.textContent = label;
  });
  document.querySelectorAll("[data-cache-progress]").forEach((el) => {
    el.textContent = cacheText;
  });
}

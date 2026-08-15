import { MS_TO_KT } from "../analysis/shear.js";
import { renderSeries, updateSeriesCursor } from "./series.js";

function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtTime(ms) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toISOString().replace(".000Z", "Z");
}

function peakMeta(peak) {
  if (!peak?.sample) return "No sample";
  const s = peak.sample;
  const fl = s.altFt ? `FL${String(Math.round(s.altFt / 100)).padStart(3, "0")}` : "";
  const tilt = Number.isFinite(s.elevation) ? `${s.elevation.toFixed(1)}°` : "—";
  const beam = Number.isFinite(s.beamErrorFt) ? `${Math.round(s.beamErrorFt)} ft beam error` : "";
  return [
    fmtTime(s.timeMs),
    `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`,
    [s.stationId, fl, `closest tilt ${tilt}`, beam].filter(Boolean).join(" · "),
  ].join("\n");
}

function sameSample(a, b) {
  return a && b && a.timeMs === b.timeMs && a.stationId === b.stationId && a.lat === b.lat && a.lon === b.lon;
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
  root.hidden = false;
  const maxDbz = summary.maxDbz?.value;
  const nearbyDbz = summary.maxNearbyDbz?.value;
  const vrKt = summary.maxVr?.kt;
  const nearbyVr = summary.maxNearbyVr?.kt;
  const rad = summary.maxRadialShear;
  const az = summary.maxAzShear;

  root.querySelector("[data-card=dbz] .metric-value").textContent = fmt(maxDbz, 1);
  root.querySelector("[data-card=dbz] .metric-sub").textContent = `Nearby max ${fmt(nearbyDbz, 1)} dBZ`;
  root.querySelector("[data-card=dbz] .metric-meta").textContent = peakMeta(summary.maxDbz);

  root.querySelector("[data-card=vel] .metric-value").textContent = fmt(vrKt, 0);
  root.querySelector("[data-card=vel] .metric-sub").textContent = `Nearby max ${fmt(nearbyVr, 0)} kt radial`;
  root.querySelector("[data-card=vel] .metric-meta").textContent = peakMeta(summary.maxVr);

  const shearPeak = (az?.value || 0) >= (rad?.value || 0) ? az : rad;
  const shearLabel = shearPeak === az ? "azimuthal" : "radial";
  root.querySelector("[data-card=shear] .metric-value").textContent = fmt(shearPeak?.ktPerKm, 1);
  root.querySelector("[data-card=shear] .metric-sub").textContent =
    `${shearLabel} · ${fmt(shearPeak?.perSec, 4)} s⁻¹ · radial ${fmt(rad?.ktPerKm, 1)} kt/km`;
  root.querySelector("[data-card=shear] .metric-meta").textContent = peakMeta(shearPeak);

  const notes = [];
  if (meta?.route?.origin) notes.push(`Typical route ${meta.route.origin}→${meta.route.destination || "?"}`);
  if (meta?.source) notes.push(`Track source: ${meta.source}`);
  if (meta?.hex) notes.push(`Hex ${meta.hex}`);
  notes.push(`${summary.coveredCount}/${summary.trackCount} points in NEXRAD range (${fmt(summary.coveragePct, 0)}%)`);
  notes.push(`${summary.volumeCount} volumes · ${(summary.bytes / 1e6).toFixed(1)} MB · sites ${summary.sites.join(", ") || "none"}`);
  if (summary.strideSec && summary.strideSec > 60) notes.push(`Stride increased to ${summary.strideSec}s to stay under the volume budget.`);
  if (summary.lowConfidenceCount) notes.push(`${summary.lowConfidenceCount} low-confidence samples (beam miss or missing gate).`);
  if (meta?.notes?.length) notes.push(...meta.notes);
  notes.push("Each point uses the tilt whose 4/3-earth beam height is closest to the aircraft. Play flight to step through those scans, or click a peak, chart, or table row.");
  notes.push("Velocity is radar radial Vr, not true wind. No dealiasing. CONUS WSR-88D only.");
  root.querySelector("[data-notes]").textContent = notes.join("\n");

  const cardMap = {
    dbz: summary.maxDbz?.sample,
    vel: summary.maxVr?.sample,
    shear: shearPeak?.sample,
  };
  for (const [key, sample] of Object.entries(cardMap)) {
    const card = root.querySelector(`[data-card=${key}]`);
    card.classList.toggle("is-selected", sameSample(selected, sample));
    card.onclick = sample ? () => onSelect?.(sample) : null;
  }

  renderSeries(root, summary.samples, selected, onSelect);

  const tbody = root.querySelector("[data-table]");
  tbody.replaceChildren();
  const rows = [...summary.samples].sort((a, b) => a.timeMs - b.timeMs).slice(0, 200);
  for (const s of rows) {
    const tr = document.createElement("tr");
    tr.dataset.key = `${s.timeMs}|${s.stationId}|${s.lat}|${s.lon}`;
    tr.className = sameSample(selected, s) ? "is-selected" : "";
    tr.innerHTML = `
      <td>${fmtTime(s.timeMs)}</td>
      <td>${s.stationId || "—"}</td>
      <td>${fmt(s.dbz, 1)}</td>
      <td>${fmt(Number.isFinite(s.vrMs) ? Math.abs(s.vrMs) * MS_TO_KT : NaN, 0)}</td>
      <td>${fmt(s.radialShearS, 4)}</td>
      <td>${fmt(s.azShearS, 4)}</td>
      <td>${s.lowConfidence ? s.reason || "low" : ""}</td>`;
    tr.addEventListener("click", () => onSelect?.(s));
    tbody.appendChild(tr);
  }
}

export function updateRadarHud(el, { sample, product, loading, error } = {}) {
  if (!el) return;
  if (!sample && !loading && !error) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const tilt = Number.isFinite(sample?.elevation) ? `${sample.elevation.toFixed(1)}° closest beam` : "tilt n/a";
  const when = sample ? new Date(sample.timeMs).toISOString().replace(".000Z", "Z") : "";
  const title = loading
    ? (loading.text || "Loading radar…")
    : error
      ? error
      : `${sample.stationId} · ${when} · ${tilt}`;
  el.querySelector("[data-hud-title]").textContent = title;
  el.querySelectorAll("[data-product]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.product === product);
  });
}

export function highlightReportSelection(root, summary, selected) {
  if (!root || !summary) return;
  const shearPeak = (summary.maxAzShear?.value || 0) >= (summary.maxRadialShear?.value || 0)
    ? summary.maxAzShear : summary.maxRadialShear;
  const cardMap = {
    dbz: summary.maxDbz?.sample,
    vel: summary.maxVr?.sample,
    shear: shearPeak?.sample,
  };
  for (const [key, sample] of Object.entries(cardMap)) {
    root.querySelector(`[data-card=${key}]`)?.classList.toggle("is-selected", sameSample(selected, sample));
  }
  const key = selected ? `${selected.timeMs}|${selected.stationId}|${selected.lat}|${selected.lon}` : "";
  root.querySelectorAll("[data-table] tr").forEach((tr) => {
    tr.classList.toggle("is-selected", tr.dataset.key === key);
  });
  updateSeriesCursor(root, summary.samples, selected);
}

export function setPlayButtons(playing, enabled) {
  document.querySelectorAll("[data-play-flight]").forEach((btn) => {
    btn.disabled = !enabled;
    btn.textContent = playing ? "Pause" : "Play flight";
  });
}

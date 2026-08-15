import { MS_TO_KT } from "../analysis/shear.js";

function fmt(n, digits = 1, suffix = "") {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}${suffix}`;
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
    [s.stationId, fl, `tilt ${tilt}`, beam].filter(Boolean).join(" · "),
  ].join("\n");
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

export function renderReport(root, summary, meta) {
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
  notes.push("Velocity is radar radial Vr, not true wind. No dealiasing. CONUS WSR-88D only.");
  root.querySelector("[data-notes]").textContent = notes.join("\n");

  const tbody = root.querySelector("[data-table]");
  tbody.replaceChildren();
  const rows = [...summary.samples].sort((a, b) => a.timeMs - b.timeMs).slice(0, 200);
  for (const s of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtTime(s.timeMs)}</td>
      <td>${s.stationId || "—"}</td>
      <td>${fmt(s.dbz, 1)}</td>
      <td>${fmt(Number.isFinite(s.vrMs) ? Math.abs(s.vrMs) * MS_TO_KT : NaN, 0)}</td>
      <td>${fmt(s.radialShearS, 4)}</td>
      <td>${fmt(s.azShearS, 4)}</td>
      <td>${s.lowConfidence ? s.reason || "low" : ""}</td>`;
    tbody.appendChild(tr);
  }
}

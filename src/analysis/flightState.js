import { bearingDeg, haversineKm } from "./geo.js";
import { MS_TO_KT } from "./shear.js";

export function flightLevel(altFt) {
  if (!Number.isFinite(altFt)) return "";
  return `FL${String(Math.max(0, Math.round(altFt / 100))).padStart(3, "0")}`;
}

export function flightPhase(altFt, vsFpm, onGround) {
  if (onGround || (Number.isFinite(altFt) && altFt < 50)) return "ground";
  if (Number.isFinite(vsFpm) && vsFpm > 400) return "climb";
  if (Number.isFinite(vsFpm) && vsFpm < -400) return "descent";
  return "cruise";
}

function deriveMotion(prev, curr, next) {
  const a = prev || curr;
  const b = next || curr;
  if (!a || !b || a === b) return { headingDeg: NaN, gsKt: NaN, vsFpm: NaN };
  const dt = (b.timeMs - a.timeMs) / 1000;
  if (!(dt > 0)) return { headingDeg: NaN, gsKt: NaN, vsFpm: NaN };
  const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
  return {
    headingDeg: bearingDeg(a.lat, a.lon, b.lat, b.lon),
    gsKt: ((km * 1000) / dt) * MS_TO_KT,
    vsFpm: (((b.altFt || 0) - (a.altFt || 0)) / dt) * 60,
  };
}

export function enrichFlightState(points) {
  const sorted = [...(points || [])].sort((a, b) => a.timeMs - b.timeMs);
  return sorted.map((point, i) => {
    const derived = deriveMotion(
      i > 0 ? sorted[i - 1] : null,
      point,
      i < sorted.length - 1 ? sorted[i + 1] : null,
    );
    const headingDeg = Number.isFinite(point.headingDeg) ? point.headingDeg : derived.headingDeg;
    const gsKt = Number.isFinite(point.gsKt) ? point.gsKt : derived.gsKt;
    const vsFpm = Number.isFinite(point.vsFpm) ? point.vsFpm : derived.vsFpm;
    return {
      ...point,
      headingDeg,
      gsKt,
      vsFpm,
      tasKt: Number.isFinite(point.tasKt) ? point.tasKt : NaN,
      iasKt: Number.isFinite(point.iasKt) ? point.iasKt : NaN,
      flightLevel: flightLevel(point.altFt),
      phase: flightPhase(point.altFt, vsFpm, point.onGround),
    };
  });
}

export function formatRadarWx(sample) {
  if (!sample) return "";
  return [
    Number.isFinite(sample.dbz) ? `${sample.dbz.toFixed(1)} dBZ` : "",
    Number.isFinite(sample.compositeDbz) ? `${sample.compositeDbz.toFixed(1)} comp` : "",
    Number.isFinite(sample.vrMs) ? `${(sample.vrMs * MS_TO_KT).toFixed(0)} kt Vr` : "",
    Number.isFinite(sample.horizShearS ?? sample.azShearS)
      ? `H ${(sample.horizShearS ?? sample.azShearS).toFixed(3)} s⁻¹`
      : "",
    Number.isFinite(sample.vertShearS) ? `V ${sample.vertShearS.toFixed(3)} s⁻¹` : "",
  ].filter(Boolean).join(" · ");
}

export function formatSampleOverlay(sample) {
  return [formatFlightState(sample), formatRadarWx(sample)].filter(Boolean).join("\n");
}

export function formatFlightState(sample, { coords = false } = {}) {
  if (!sample) return "";
  const fl = sample.flightLevel || flightLevel(sample.altFt);
  const alt = Number.isFinite(sample.altFt) ? `${Math.round(sample.altFt).toLocaleString("en-US")} ft` : "";
  const phase = sample.phase && sample.phase !== "cruise" ? sample.phase : "";
  const hdg = Number.isFinite(sample.headingDeg)
    ? `HDG ${String(Math.round(((sample.headingDeg % 360) + 360) % 360)).padStart(3, "0")}°`
    : "";
  const gs = Number.isFinite(sample.gsKt) ? `${Math.round(sample.gsKt)} kt GS` : "";
  const tas = Number.isFinite(sample.tasKt) ? `${Math.round(sample.tasKt)} kt TAS` : "";
  const ias = Number.isFinite(sample.iasKt) ? `${Math.round(sample.iasKt)} kt IAS` : "";
  const vs = Number.isFinite(sample.vsFpm)
    ? `${sample.vsFpm >= 0 ? "+" : "-"}${Math.round(Math.abs(sample.vsFpm))} fpm`
    : "";
  const lines = [
    [fl, alt, phase].filter(Boolean).join(" · "),
    [hdg, gs, tas, ias, vs].filter(Boolean).join(" · "),
  ];
  if (coords && Number.isFinite(sample.lat) && Number.isFinite(sample.lon)) {
    lines.push(`${sample.lat.toFixed(3)}, ${sample.lon.toFixed(3)}`);
  }
  return lines.filter(Boolean).join("\n");
}

export function flightStatePopupHtml(sample) {
  const when = Number.isFinite(sample?.timeMs)
    ? new Date(sample.timeMs).toISOString().replace(".000Z", "Z")
    : "";
  const radar = [
    sample?.stationId,
    Number.isFinite(sample?.elevation) ? `${sample.elevation.toFixed(1)}° beam` : "",
    Number.isFinite(sample?.dbz) ? `${sample.dbz.toFixed(1)} dBZ` : "",
    Number.isFinite(sample?.vrMs) ? `${(sample.vrMs * MS_TO_KT).toFixed(0)} kt Vr` : "",
  ].filter(Boolean).join(" · ");
  const state = formatFlightState(sample, { coords: true }).replace(/\n/g, "<br>");
  return `<div class="wx-popup">
    <div class="wx-popup-time">${when}</div>
    <div class="wx-popup-state">${state}</div>
    ${radar ? `<div class="wx-popup-radar">${radar}</div>` : ""}
  </div>`;
}

import { AIRPORTS } from "./examples.js";
import { parseCsvTrack } from "./parseTrack.js";
import { bearingDeg, haversineKm, interpolateGreatCircle } from "../analysis/geo.js";
import { MS_TO_KT } from "../analysis/shear.js";

const STEP_MS = 30000;

export function resolveExampleWaypoint(wp) {
  const airport = wp.icao ? AIRPORTS[wp.icao] : null;
  const lat = Number.isFinite(wp.lat) ? wp.lat : airport?.lat;
  const lon = Number.isFinite(wp.lon) ? wp.lon : airport?.lon;
  const altFt = Number.isFinite(wp.altFt) ? wp.altFt : airport?.elevFt;
  const timeMs = Date.parse(wp.time);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altFt) || !Number.isFinite(timeMs)) {
    throw new Error(`Invalid example waypoint ${JSON.stringify(wp)}`);
  }
  return { lat, lon, altFt, timeMs };
}

export function synthesizeExampleTrack(example, stepMs = STEP_MS) {
  const waypoints = (example.waypoints || []).map(resolveExampleWaypoint);
  if (waypoints.length < 2) return [];
  const points = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const dt = b.timeMs - a.timeMs;
    if (!(dt > 0)) continue;
    const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
    const headingDeg = bearingDeg(a.lat, a.lon, b.lat, b.lon);
    const gsKt = ((km * 1000) / (dt / 1000)) * MS_TO_KT;
    const vsFpm = ((b.altFt - a.altFt) / dt) * 60000;
    const steps = Math.max(1, Math.round(dt / stepMs));
    const prev = points[points.length - 1];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const { lat, lon } = interpolateGreatCircle(a, b, t);
      const incoming = k === 0 && prev;
      points.push({
        timeMs: a.timeMs + t * dt,
        lat,
        lon,
        altFt: a.altFt + t * (b.altFt - a.altFt),
        headingDeg: incoming ? prev.headingDeg : headingDeg,
        gsKt: incoming ? prev.gsKt : gsKt,
        vsFpm: incoming ? prev.vsFpm : vsFpm,
      });
    }
  }
  const last = waypoints[waypoints.length - 1];
  const prev = points[points.length - 1];
  if (!prev || prev.timeMs !== last.timeMs) {
    points.push({
      timeMs: last.timeMs,
      lat: last.lat,
      lon: last.lon,
      altFt: last.altFt,
      headingDeg: prev?.headingDeg,
      gsKt: prev?.gsKt,
      vsFpm: 0,
    });
  }
  return points;
}

export async function loadExampleTrack(example) {
  if (example.trackUrl) {
    const url = `${import.meta.env.BASE_URL}${example.trackUrl}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    return parseCsvTrack(await resp.text());
  }
  return synthesizeExampleTrack(example);
}

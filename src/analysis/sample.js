import { bearingDeg, haversineKm } from "./geo.js";
import { altFtToM, altMToFt, pickBestTilt } from "./beam.js";
import { neighborhoodMaxAbs, samplePolar } from "./polar.js";
import { computeShear } from "./shear.js";

export const NEIGHBOR_M = 5000;
export { samplePolar, neighborhoodMaxAbs } from "./polar.js";

export function sampleExtractedVolume(extracted, points) {
  const { lat, lon, altM: radarAltM, sweeps } = extracted;
  const samples = [];
  for (const point of points) {
    const rangeKm = haversineKm(lat, lon, point.lat, point.lon);
    const rangeM = rangeKm * 1000;
    const azDeg = bearingDeg(lat, lon, point.lat, point.lon);
    const aircraftAltM = altFtToM(point.altFt || 0);
    const tilt = pickBestTilt(sweeps, rangeM, aircraftAltM, radarAltM);
    const sweep = tilt.sweep;
    const ref = sweep?.reflectivity || null;
    const vel = sweep?.velocity || null;
    const dbz = samplePolar(ref, azDeg, rangeM);
    const vrMs = samplePolar(vel, azDeg, rangeM);
    const nearbyDbz = neighborhoodMaxAbs(ref, azDeg, rangeM, NEIGHBOR_M, false);
    const nearbyVrMs = neighborhoodMaxAbs(vel, azDeg, rangeM, NEIGHBOR_M, true);
    const shear = computeShear(vel, azDeg, rangeM);
    const missing = !Number.isFinite(dbz) && !Number.isFinite(vrMs);
    samples.push({
      timeMs: point.timeMs,
      lat: point.lat,
      lon: point.lon,
      altFt: point.altFt || 0,
      stationId: point.station?.id || extracted.stationId || null,
      rangeKm,
      azimuthDeg: azDeg,
      elevation: sweep?.elevation ?? null,
      beamHeightFt: Number.isFinite(tilt.beamHeightM) ? altMToFt(tilt.beamHeightM) : null,
      beamErrorFt: Number.isFinite(tilt.errorM) ? altMToFt(tilt.errorM) : null,
      dbz,
      nearbyDbz: Number.isFinite(nearbyDbz) ? nearbyDbz : NaN,
      vrMs,
      nearbyVrMs: Number.isFinite(nearbyVrMs) ? nearbyVrMs : NaN,
      radialShearS: shear.radialS,
      azShearS: shear.azimuthalS,
      lowConfidence: tilt.lowConfidence || missing,
      reason: missing ? "missing_gate" : (tilt.lowConfidence ? "beam_miss" : null),
    });
  }
  return samples;
}

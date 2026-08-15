import { bearingDeg, haversineKm } from "./geo.js";
import { altFtToM, altMToFt, pickBestTilt } from "./beam.js";
import { flightLevel, flightPhase } from "./flightState.js";
import { neighborhoodMaxAbs, samplePolar } from "./polar.js";
import { computeShear, computeVerticalShear, verticalFromRadial } from "./shear.js";

export const NEIGHBOR_M = 5000;
export { samplePolar, neighborhoodMaxAbs } from "./polar.js";

export function sampleCompositeReflectivity(sweeps, azDeg, rangeM, neighborM = NEIGHBOR_M) {
  let compositeDbz = NaN;
  let compositeElevation = NaN;
  let nearbyCompositeDbz = NaN;
  for (const sweep of sweeps || []) {
    const ref = sweep?.reflectivity;
    if (!ref) continue;
    const dbz = samplePolar(ref, azDeg, rangeM);
    if (Number.isFinite(dbz) && (!Number.isFinite(compositeDbz) || dbz > compositeDbz)) {
      compositeDbz = dbz;
      compositeElevation = sweep.elevation;
    }
    if (neighborM > 0) {
      const nearby = neighborhoodMaxAbs(ref, azDeg, rangeM, neighborM, false);
      if (Number.isFinite(nearby) && (!Number.isFinite(nearbyCompositeDbz) || nearby > nearbyCompositeDbz)) {
        nearbyCompositeDbz = nearby;
      }
    }
  }
  return { compositeDbz, compositeElevation, nearbyCompositeDbz };
}

export function compositeView(sample) {
  if (!sample) return sample;
  return {
    ...sample,
    elevation: Number.isFinite(sample.compositeElevation) ? sample.compositeElevation : sample.elevation,
    dbz: Number.isFinite(sample.compositeDbz) ? sample.compositeDbz : sample.dbz,
    tiltRole: "composite",
  };
}

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
    const composite = sampleCompositeReflectivity(sweeps, azDeg, rangeM);
    const shear = computeShear(vel, azDeg, rangeM);
    const vert = computeVerticalShear(sweeps, azDeg, rangeM, radarAltM, aircraftAltM);
    const vertShearS = Number.isFinite(vert.verticalS)
      ? vert.verticalS
      : verticalFromRadial(shear.radialS, rangeM, sweep?.elevation);
    const missing = !Number.isFinite(dbz) && !Number.isFinite(vrMs);
    samples.push({
      timeMs: point.timeMs,
      lat: point.lat,
      lon: point.lon,
      altFt: point.altFt || 0,
      flightLevel: point.flightLevel || flightLevel(point.altFt),
      headingDeg: point.headingDeg,
      gsKt: point.gsKt,
      vsFpm: point.vsFpm,
      tasKt: point.tasKt,
      iasKt: point.iasKt,
      phase: point.phase || flightPhase(point.altFt, point.vsFpm, point.onGround),
      stationId: point.station?.id || extracted.stationId || null,
      rangeKm,
      azimuthDeg: azDeg,
      elevation: sweep?.elevation ?? null,
      beamHeightFt: Number.isFinite(tilt.beamHeightM) ? altMToFt(tilt.beamHeightM) : null,
      beamErrorFt: Number.isFinite(tilt.errorM) ? altMToFt(tilt.errorM) : null,
      dbz,
      nearbyDbz: Number.isFinite(nearbyDbz) ? nearbyDbz : NaN,
      compositeDbz: composite.compositeDbz,
      compositeElevation: composite.compositeElevation,
      nearbyCompositeDbz: composite.nearbyCompositeDbz,
      vrMs,
      nearbyVrMs: Number.isFinite(nearbyVrMs) ? nearbyVrMs : NaN,
      radialShearS: shear.radialS,
      azShearS: shear.azimuthalS,
      horizShearS: shear.azimuthalS,
      vertShearS,
      lowConfidence: tilt.lowConfidence || missing,
      reason: missing ? "missing_gate" : (tilt.lowConfidence ? "beam_miss" : null),
    });
  }
  return samples;
}

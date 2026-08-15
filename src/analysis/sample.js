import { bearingDeg, haversineKm } from "./geo.js";
import { altFtToM, altMToFt, beamHeightM, BEAM_MISS_M } from "./beam.js";
import { flightLevel, flightPhase } from "./flightState.js";
import { neighborhoodMaxAbs, neighborhoodMaxAndMean, samplePolar } from "./polar.js";
import { computeShear, verticalFromRadial, verticalShearFromLayers } from "./shear.js";

export const NEIGHBOR_M = 5000;
export const NYQUIST_MS = 25;
export { samplePolar, neighborhoodMaxAbs, neighborhoodMean, neighborhoodMaxAndMean } from "./polar.js";

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

export function tiltHitFromSweep(sweep, azDeg, rangeM, aircraftAltM, radarAltM) {
  const height = beamHeightM(rangeM, sweep.elevation, radarAltM);
  const nearbyRef = neighborhoodMaxAndMean(sweep.reflectivity, azDeg, rangeM, NEIGHBOR_M);
  return {
    elevation: sweep.elevation,
    dbz: samplePolar(sweep.reflectivity, azDeg, rangeM),
    vrMs: samplePolar(sweep.velocity, azDeg, rangeM),
    nearbyDbz: nearbyRef.max,
    meanDbz: nearbyRef.mean,
    nearbyVrMs: neighborhoodMaxAbs(sweep.velocity, azDeg, rangeM, NEIGHBOR_M, true),
    shear: computeShear(sweep.velocity, azDeg, rangeM),
    beamHeightM: height,
    errorM: Math.abs(height - aircraftAltM),
  };
}

export function sampleFromTiltHits(point, hits, { stationId, rangeKm, azDeg } = {}) {
  const rangeM = (rangeKm || 0) * 1000;
  const aircraftAltM = altFtToM(point.altFt || 0);
  let best = null;
  let compositeDbz = NaN;
  let compositeElevation = NaN;
  let nearbyCompositeDbz = NaN;
  const layers = [];
  for (const hit of hits || []) {
    if (!Number.isFinite(hit.elevation)) continue;
    if (!best || hit.errorM < best.errorM) best = hit;
    if (Number.isFinite(hit.dbz) && (!Number.isFinite(compositeDbz) || hit.dbz > compositeDbz)) {
      compositeDbz = hit.dbz;
      compositeElevation = hit.elevation;
    }
    if (Number.isFinite(hit.nearbyDbz) && (!Number.isFinite(nearbyCompositeDbz) || hit.nearbyDbz > nearbyCompositeDbz)) {
      nearbyCompositeDbz = hit.nearbyDbz;
    }
    if (Number.isFinite(hit.vrMs) && Number.isFinite(hit.beamHeightM)) {
      layers.push({ z: hit.beamHeightM, vr: hit.vrMs, elevation: hit.elevation });
    }
  }
  const tilt = {
    sweep: best,
    beamHeightM: best?.beamHeightM,
    errorM: best?.errorM ?? Infinity,
    lowConfidence: !best || best.errorM > BEAM_MISS_M,
  };
  const dbz = best?.dbz;
  const vrMs = best?.vrMs;
  const nearbyDbz = best?.nearbyDbz;
  const meanDbz = best?.meanDbz;
  const nearbyVrMs = best?.nearbyVrMs;
  const shear = best?.shear || { radialS: NaN, azimuthalS: NaN };
  const vert = verticalShearFromLayers(layers, aircraftAltM);
  const vertShearS = Number.isFinite(vert.verticalS)
    ? vert.verticalS
    : verticalFromRadial(shear.radialS, rangeM, best?.elevation);
  const missing = !Number.isFinite(dbz) && !Number.isFinite(vrMs);
  return {
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
    stationId: point.station?.id || stationId || null,
    rangeKm,
    azimuthDeg: azDeg,
    elevation: best?.elevation ?? null,
    beamHeightFt: Number.isFinite(tilt.beamHeightM) ? altMToFt(tilt.beamHeightM) : null,
    beamErrorFt: Number.isFinite(tilt.errorM) ? altMToFt(tilt.errorM) : null,
    dbz,
    nearbyDbz: Number.isFinite(nearbyDbz) ? nearbyDbz : NaN,
    meanDbz: Number.isFinite(meanDbz) ? meanDbz : NaN,
    compositeDbz,
    compositeElevation,
    nearbyCompositeDbz,
    vrMs,
    nearbyVrMs: Number.isFinite(nearbyVrMs) ? nearbyVrMs : NaN,
    radialShearS: shear.radialS,
    azShearS: shear.azimuthalS,
    horizShearS: shear.azimuthalS,
    vertShearS,
    lowConfidence: tilt.lowConfidence || missing,
    reason: missing ? "missing_gate" : (tilt.lowConfidence ? "beam_miss" : null),
    aliasSuspect: Number.isFinite(vrMs) && Math.abs(vrMs) >= NYQUIST_MS,
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
    const hits = (sweeps || []).map((sweep) => tiltHitFromSweep(sweep, azDeg, rangeM, aircraftAltM, radarAltM));
    samples.push(sampleFromTiltHits(point, hits, {
      stationId: extracted.stationId,
      rangeKm,
      azDeg,
    }));
  }
  return samples;
}

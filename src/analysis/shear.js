import { beamHeightM, beamHeightSlope } from "./beam.js";
import { wrapDeg } from "./geo.js";
import { samplePolar } from "./polar.js";

export const SHEAR_WINDOW_M = 2500;
export const MS_TO_KT = 1.943844492;
export const MIN_VERT_DZ_M = 150;
const MIN_BEAM_SLOPE = 0.002;

export function computeShear(velSweep, azDeg, rangeM, windowM = SHEAR_WINDOW_M) {
  const half = windowM / 2;
  const r0 = samplePolar(velSweep, azDeg, rangeM - half);
  const r1 = samplePolar(velSweep, azDeg, rangeM + half);
  let radialS = NaN;
  if (Number.isFinite(r0) && Number.isFinite(r1) && windowM > 0) {
    radialS = Math.abs(r1 - r0) / windowM;
  }

  const dAzRad = windowM / Math.max(rangeM, 1);
  const dAzDeg = dAzRad * (180 / Math.PI);
  const a0 = samplePolar(velSweep, wrapDeg(azDeg - dAzDeg / 2), rangeM);
  const a1 = samplePolar(velSweep, wrapDeg(azDeg + dAzDeg / 2), rangeM);
  const arcM = rangeM * dAzRad;
  let azimuthalS = NaN;
  if (Number.isFinite(a0) && Number.isFinite(a1) && arcM > 0) {
    azimuthalS = Math.abs(a1 - a0) / arcM;
  }

  return { radialS, azimuthalS, horizS: azimuthalS };
}

export function verticalFromRadial(radialS, rangeM, elevDeg) {
  const slope = beamHeightSlope(rangeM, elevDeg);
  if (!Number.isFinite(radialS) || !Number.isFinite(slope) || slope < MIN_BEAM_SLOPE) return NaN;
  return radialS / slope;
}

export function computeVerticalShear(sweeps, azDeg, rangeM, radarAltM = 0, aircraftAltM = NaN) {
  const layers = [];
  for (const sweep of sweeps || []) {
    if (!sweep?.velocity || !Number.isFinite(sweep.elevation)) continue;
    const z = beamHeightM(rangeM, sweep.elevation, radarAltM);
    const vr = samplePolar(sweep.velocity, azDeg, rangeM);
    if (Number.isFinite(z) && Number.isFinite(vr)) layers.push({ z, vr, elevation: sweep.elevation });
  }
  layers.sort((a, b) => a.z - b.z);

  let bestS = NaN;
  let bestScore = Infinity;
  for (let i = 0; i < layers.length - 1; i++) {
    const a = layers[i];
    const b = layers[i + 1];
    const dz = b.z - a.z;
    if (dz < MIN_VERT_DZ_M) continue;
    const verticalS = Math.abs(b.vr - a.vr) / dz;
    const brackets = Number.isFinite(aircraftAltM) && aircraftAltM >= a.z && aircraftAltM <= b.z;
    const dist = Number.isFinite(aircraftAltM) ? Math.abs((a.z + b.z) / 2 - aircraftAltM) : 0;
    const score = (brackets ? 0 : 1e7) + dist;
    if (score < bestScore) {
      bestScore = score;
      bestS = verticalS;
    }
  }
  return { verticalS: bestS };
}

export function shearToKtPerKm(perSecond) {
  if (!Number.isFinite(perSecond)) return NaN;
  return perSecond * 1000 * MS_TO_KT;
}

export function shearToKtPer1000Ft(perSecond) {
  if (!Number.isFinite(perSecond)) return NaN;
  return perSecond * 304.8 * MS_TO_KT;
}

import { samplePolar } from "./polar.js";
import { wrapDeg } from "./geo.js";

export const SHEAR_WINDOW_M = 2500;
export const MS_TO_KT = 1.943844492;

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

  return { radialS, azimuthalS };
}

export function shearToKtPerKm(perSecond) {
  if (!Number.isFinite(perSecond)) return NaN;
  return perSecond * 1000 * MS_TO_KT;
}

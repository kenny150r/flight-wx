const RE_43_M = 8493 * 1000;
export const FT_PER_M = 3.280839895;
export const M_PER_FT = 0.3048;
export const MS_TO_KT = 1.943844492;
export const BEAM_MISS_M = 1000;

export function beamHeightM(rangeM, elevDeg, radarAltM = 0) {
  const el = (elevDeg * Math.PI) / 180;
  return radarAltM + rangeM * Math.sin(el) + (rangeM * rangeM) / (2 * RE_43_M);
}

export function altFtToM(altFt) {
  return altFt * M_PER_FT;
}

export function altMToFt(altM) {
  return altM * FT_PER_M;
}

export function pickBestTilt(sweeps, rangeM, aircraftAltM, radarAltM) {
  let best = null;
  let bestErr = Infinity;
  let bestHeight = NaN;
  for (const sweep of sweeps) {
    if (!Number.isFinite(sweep.elevation)) continue;
    const height = beamHeightM(rangeM, sweep.elevation, radarAltM);
    const err = Math.abs(height - aircraftAltM);
    if (err < bestErr) {
      bestErr = err;
      best = sweep;
      bestHeight = height;
    }
  }
  return {
    sweep: best,
    beamHeightM: bestHeight,
    errorM: bestErr,
    lowConfidence: !best || bestErr > BEAM_MISS_M,
  };
}

import { wrapDeg } from "./geo.js";

function findAzBracket(azimuths, azDeg) {
  const n = azimuths.length;
  if (!n) return null;
  const target = wrapDeg(azDeg);
  let lo = 0;
  let hi = n - 1;
  if (target <= azimuths[0] || target >= azimuths[n - 1]) {
    return {
      i0: n - 1,
      i1: 0,
      t: wrapFrac(azimuths[n - 1], azimuths[0] + 360, target < azimuths[0] ? target + 360 : target),
    };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (azimuths[mid] <= target) lo = mid;
    else hi = mid;
  }
  return { i0: lo, i1: hi, t: wrapFrac(azimuths[lo], azimuths[hi], target) };
}

function wrapFrac(a0, a1, target) {
  const span = a1 - a0;
  if (Math.abs(span) < 1e-6) return 0;
  return (target - a0) / span;
}

export function samplePolar(sweep, azDeg, rangeM) {
  if (!sweep?.values || !sweep.azimuths?.length) return NaN;
  const { azimuths, values, numGates, rangeStart, rangeStep } = sweep;
  const gateF = (rangeM - rangeStart) / rangeStep;
  if (gateF < 0 || gateF >= numGates - 1) return NaN;
  const bracket = findAzBracket(azimuths, azDeg);
  if (!bracket) return NaN;
  const g0 = Math.floor(gateF);
  const g1 = g0 + 1;
  const tg = gateF - g0;
  const v00 = values[bracket.i0 * numGates + g0];
  const v01 = values[bracket.i0 * numGates + g1];
  const v10 = values[bracket.i1 * numGates + g0];
  const v11 = values[bracket.i1 * numGates + g1];
  const a0 = Number.isFinite(v00) && Number.isFinite(v01) ? v00 * (1 - tg) + v01 * tg : (Number.isFinite(v00) ? v00 : v01);
  const a1 = Number.isFinite(v10) && Number.isFinite(v11) ? v10 * (1 - tg) + v11 * tg : (Number.isFinite(v10) ? v10 : v11);
  if (Number.isFinite(a0) && Number.isFinite(a1)) return a0 * (1 - bracket.t) + a1 * bracket.t;
  return Number.isFinite(a0) ? a0 : a1;
}

function forEachNeighborhoodGate(sweep, azDeg, rangeM, radiusM, visit) {
  if (!sweep?.values || !sweep.azimuths?.length) return;
  const { azimuths, values, numGates, rangeStart, rangeStep } = sweep;
  const dAzDeg = Math.max(0.5, (radiusM / Math.max(rangeM, 1000)) * (180 / Math.PI));
  for (let i = 0; i < azimuths.length; i++) {
    let dAz = Math.abs(wrapDeg(azimuths[i] - azDeg));
    if (dAz > 180) dAz = 360 - dAz;
    if (dAz > dAzDeg) continue;
    const azM = rangeM * (dAz * Math.PI / 180);
    for (let g = 0; g < numGates; g++) {
      const r = rangeStart + g * rangeStep;
      const dR = r - rangeM;
      if (Math.hypot(dR, azM) > radiusM) continue;
      const v = values[i * numGates + g];
      if (!Number.isFinite(v)) continue;
      visit(v);
    }
  }
}

export function neighborhoodMaxAbs(sweep, azDeg, rangeM, radiusM, signed = false) {
  let best = NaN;
  let bestAbs = -Infinity;
  forEachNeighborhoodGate(sweep, azDeg, rangeM, radiusM, (v) => {
    if (signed) {
      const mag = Math.abs(v);
      if (mag > bestAbs) {
        bestAbs = mag;
        best = v;
      }
    } else if (!Number.isFinite(best) || v > best) {
      best = v;
    }
  });
  return best;
}

export function neighborhoodMean(sweep, azDeg, rangeM, radiusM) {
  return neighborhoodMaxAndMean(sweep, azDeg, rangeM, radiusM).mean;
}

export function neighborhoodMaxAndMean(sweep, azDeg, rangeM, radiusM) {
  let max = NaN;
  let sum = 0;
  let n = 0;
  forEachNeighborhoodGate(sweep, azDeg, rangeM, radiusM, (v) => {
    if (!Number.isFinite(max) || v > max) max = v;
    sum += v;
    n += 1;
  });
  return { max, mean: n ? sum / n : NaN };
}

import { MS_TO_KT, shearToKtPerKm } from "./shear.js";

function peakBy(samples, getter) {
  let best = null;
  let bestVal = -Infinity;
  for (const sample of samples) {
    const value = getter(sample);
    if (!Number.isFinite(value)) continue;
    if (value > bestVal) {
      bestVal = value;
      best = sample;
    }
  }
  return best ? { sample: best, value: bestVal } : null;
}

export function summarizeSamples(samples, { trackCount, volumeCount, bytes } = {}) {
  const covered = samples.filter((s) => s.stationId);
  const maxDbz = peakBy(samples, (s) => s.dbz);
  const maxNearbyDbz = peakBy(samples, (s) => s.nearbyDbz);
  const maxVr = peakBy(samples, (s) => Math.abs(s.vrMs));
  const maxNearbyVr = peakBy(samples, (s) => Math.abs(s.nearbyVrMs));
  const maxRadial = peakBy(samples, (s) => s.radialShearS);
  const maxAz = peakBy(samples, (s) => s.azShearS);
  const sites = [...new Set(samples.map((s) => s.stationId).filter(Boolean))];
  const lowConf = samples.filter((s) => s.lowConfidence).length;

  return {
    samples,
    sites,
    volumeCount: volumeCount || 0,
    bytes: bytes || 0,
    trackCount: trackCount || samples.length,
    coveredCount: covered.length,
    coveragePct: trackCount ? (100 * covered.length) / trackCount : 0,
    lowConfidenceCount: lowConf,
    maxDbz,
    maxNearbyDbz,
    maxVr: maxVr && {
      ...maxVr,
      kt: Math.abs(maxVr.sample.vrMs) * MS_TO_KT,
      signedKt: maxVr.sample.vrMs * MS_TO_KT,
    },
    maxNearbyVr: maxNearbyVr && {
      ...maxNearbyVr,
      kt: Math.abs(maxNearbyVr.sample.nearbyVrMs) * MS_TO_KT,
    },
    maxRadialShear: maxRadial && {
      ...maxRadial,
      perSec: maxRadial.value,
      ktPerKm: shearToKtPerKm(maxRadial.value),
    },
    maxAzShear: maxAz && {
      ...maxAz,
      perSec: maxAz.value,
      ktPerKm: shearToKtPerKm(maxAz.value),
    },
  };
}

import { compositeView } from "./sample.js";
import { MS_TO_KT, shearToKtPer1000Ft, shearToKtPerKm } from "./shear.js";

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
  const covered = samples.filter((s) => s.stationId && s.reason !== "ingest_failed");
  const maxDbz = peakBy(samples, (s) => s.dbz);
  const maxNearbyDbz = peakBy(samples, (s) => s.nearbyDbz);
  const maxMeanDbz = peakBy(samples, (s) => s.meanDbz);
  const maxComposite = peakBy(samples, (s) => s.compositeDbz);
  const maxNearbyComposite = peakBy(samples, (s) => s.nearbyCompositeDbz);
  const maxVr = peakBy(samples, (s) => Math.abs(s.vrMs));
  const maxNearbyVr = peakBy(samples, (s) => Math.abs(s.nearbyVrMs));
  const maxRadial = peakBy(samples, (s) => s.radialShearS);
  const maxAz = peakBy(samples, (s) => s.horizShearS ?? s.azShearS);
  const maxVert = peakBy(samples, (s) => s.vertShearS);
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
    maxMeanDbz,
    maxCompositeDbz: maxComposite && {
      ...maxComposite,
      sample: compositeView(maxComposite.sample),
    },
    maxNearbyCompositeDbz: maxNearbyComposite,
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
    maxHorizShear: maxAz && {
      ...maxAz,
      perSec: maxAz.value,
      ktPerKm: shearToKtPerKm(maxAz.value),
    },
    maxVertShear: maxVert && {
      ...maxVert,
      perSec: maxVert.value,
      ktPerKm: shearToKtPerKm(maxVert.value),
      ktPer1000Ft: shearToKtPer1000Ft(maxVert.value),
    },
  };
}

function peakScore(peak, raw) {
  if (!peak?.sample || !Number.isFinite(raw) || raw <= 0) return -Infinity;
  return peak.sample.lowConfidence ? raw * 0.7 : raw;
}

export function headlineEvent(summary) {
  if (!summary) return null;
  const candidates = [
    { peak: summary.maxDbz, product: "reflectivity", score: peakScore(summary.maxDbz, (summary.maxDbz?.value ?? 0) / 45) },
    { peak: summary.maxCompositeDbz, product: "reflectivity", score: peakScore(summary.maxCompositeDbz, ((summary.maxCompositeDbz?.value ?? 0) / 55) * 0.8) },
    { peak: summary.maxVr, product: "velocity", score: peakScore(summary.maxVr, (summary.maxVr?.kt ?? 0) / 35) },
    { peak: summary.maxHorizShear, product: "velocity", score: peakScore(summary.maxHorizShear, (summary.maxHorizShear?.ktPerKm ?? 0) / 8) },
    { peak: summary.maxVertShear, product: "velocity", score: peakScore(summary.maxVertShear, (summary.maxVertShear?.ktPerKm ?? 0) / 8) },
  ];
  let best = null;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.score) || candidate.score === -Infinity) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best ? { sample: best.peak.sample, product: best.product, score: best.score } : null;
}

export const PLAY_STEP_MS = 450;

export function playbackFrameKey(sample, product = "reflectivity") {
  if (!sample?.s3Key) return "";
  const tilt = Number.isFinite(sample.elevation) ? sample.elevation.toFixed(1) : "auto";
  return `${sample.s3Key}|${tilt}|${product}`;
}

export function playableSamples(samples) {
  return [...(samples || [])]
    .filter((s) => s?.s3Key && s.stationId)
    .sort((a, b) => a.timeMs - b.timeMs);
}

export function samePlaySample(a, b) {
  return a && b
    && a.timeMs === b.timeMs
    && a.stationId === b.stationId
    && a.s3Key === b.s3Key;
}

export function playIndexOf(samples, selected) {
  if (!samples.length || !selected) return 0;
  const idx = samples.findIndex((s) => samePlaySample(s, selected));
  return idx < 0 ? 0 : idx;
}

export function nextPlayIndex(samples, selected) {
  if (!samples.length) return 0;
  if (!selected) return 0;
  const idx = playIndexOf(samples, selected);
  if (!samePlaySample(samples[idx], selected)) return 0;
  return idx + 1 < samples.length ? idx + 1 : 0;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

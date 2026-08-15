import { loadRadarForSample } from "./loadRadar.js";
import { playbackFrameKey, playableSamples } from "./playback.js";

const MAX_FRAMES = 64;
const cache = new Map();
const inflight = new Map();

export function uniquePlayFrames(samples, product = "reflectivity") {
  const seen = new Set();
  const out = [];
  for (const sample of playableSamples(samples)) {
    const key = playbackFrameKey(sample, product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ sample, key });
  }
  return out;
}

export function hasCachedFrame(key) {
  return Boolean(key) && cache.has(key);
}

export function getCachedFrame(key) {
  if (!key || !cache.has(key)) return null;
  const frame = cache.get(key);
  cache.delete(key);
  cache.set(key, frame);
  return frame;
}

export function setCachedFrame(key, frame) {
  if (!key || !frame) return;
  if (cache.has(key)) cache.delete(key);
  cache.set(key, frame);
  while (cache.size > MAX_FRAMES) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

export function clearFrameCache() {
  cache.clear();
  inflight.clear();
}

export function cachedFrameCount() {
  return cache.size;
}

export async function loadCachedRadar(sample, product = "reflectivity", { onProgress } = {}) {
  const key = playbackFrameKey(sample, product);
  if (!key) throw new Error("This sample has no radar volume to load.");
  const hit = getCachedFrame(key);
  if (hit) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const pending = loadRadarForSample(sample, product, { onProgress })
    .then((frame) => {
      setCachedFrame(key, frame);
      return frame;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

export async function prefetchPlayFrames(samples, product = "reflectivity", { concurrency = 1, onProgress } = {}) {
  const items = uniquePlayFrames(samples, product);
  const pending = items.filter((item) => !hasCachedFrame(item.key) && !inflight.has(item.key));
  let done = items.length - pending.length;
  onProgress?.({ done, total: items.length });
  let i = 0;
  async function worker() {
    while (i < pending.length) {
      const item = pending[i++];
      try {
        await loadCachedRadar(item.sample, product);
      } catch {
        // Keep scrubbing usable even if one volume fails.
      }
      done += 1;
      onProgress?.({ done, total: items.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length || 1) }, () => worker()));
  return { done, total: items.length };
}

import {
  clearSatCache as clearIemCache,
  getCachedSatFrame as getCachedIemFrame,
  loadSatFrame as loadIemSatFrame,
  prefetchSatFrames as prefetchIemFrames,
} from "./decodeTiff.js";
import {
  clearGoesCache,
  getCachedGoesFrame,
  loadGoesFrame,
  prefetchGoesFrames,
} from "./decodeGoes.js";
import { nearestSatTimeMs, parseSatProduct, uniqueSatTimes } from "./goesAbi.js";

export function getCachedSatFrame(product, timeMs, opts = {}) {
  return getCachedGoesFrame(product, timeMs, opts) || getCachedIemFrame(product, timeMs);
}

export function clearSatCache() {
  clearGoesCache();
  clearIemCache();
}

export async function loadSatFrame(product, timeMs, opts = {}) {
  const code = parseSatProduct(product);
  if (!code || !Number.isFinite(nearestSatTimeMs(timeMs))) {
    throw new Error("GOES request was invalid.");
  }
  try {
    return await loadGoesFrame(code, timeMs, opts);
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    return loadIemSatFrame(code, timeMs, { signal: opts.signal });
  }
}

export async function prefetchSatFrames(product, samples, opts = {}) {
  const code = parseSatProduct(product);
  if (!code) return;
  try {
    await prefetchGoesFrames(code, samples, opts);
  } catch (err) {
    if (err?.name === "AbortError") return;
    const times = uniqueSatTimes(samples);
    await prefetchIemFrames(code, times, { signal: opts.signal });
  }
}

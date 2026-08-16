import { fromArrayBuffer } from "geotiff";
import { bboxToLeafletBounds, nearestSatTimeMs, satCandidateTimes, satFrameKey, satFrameUrl } from "./iemGoes.js";
import { satRgba } from "./satPalette.js";

const MAX_FRAMES = 32;
const frames = new Map();
const inflight = new Map();

function cacheSet(key, frame) {
  if (!key || !frame) return;
  if (frames.has(key)) frames.delete(key);
  frames.set(key, frame);
  while (frames.size > MAX_FRAMES) {
    frames.delete(frames.keys().next().value);
  }
}

export function getCachedSatFrame(product, timeMs) {
  const key = satFrameKey(product, timeMs);
  if (!key || !frames.has(key)) return null;
  const frame = frames.get(key);
  frames.delete(key);
  frames.set(key, frame);
  return frame;
}

export function clearSatCache() {
  frames.clear();
  inflight.clear();
}

function rasterToCanvas(values, width, height, product) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const image = ctx.createImageData(width, height);
  satRgba(values, product, image.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

async function decodeBuffer(buffer, product) {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const rasters = await image.readRasters();
  const values = rasters[0];
  if (!values?.length) throw new Error("GOES frame was empty.");
  return {
    bounds: bboxToLeafletBounds(image.getBoundingBox()),
    canvas: rasterToCanvas(values, width, height, product),
    width,
    height,
  };
}

async function fetchSatTiff(url, signal) {
  const resp = await fetch(url, signal ? { signal } : undefined);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (resp.status === 404) {
    const err = new Error("GOES frame not found");
    err.status = 404;
    throw err;
  }
  if (!resp.ok) throw new Error(`GOES download failed (${resp.status})`);
  return resp.arrayBuffer();
}

async function decodeUrl(url, product, signal) {
  if (inflight.has(url)) return inflight.get(url);
  const pending = fetchSatTiff(url, signal)
    .then((buf) => decodeBuffer(buf, product))
    .finally(() => {
      if (inflight.get(url) === pending) inflight.delete(url);
    });
  inflight.set(url, pending);
  return pending;
}

export async function loadSatFrame(product, timeMs, { signal } = {}) {
  const requested = nearestSatTimeMs(timeMs);
  const cached = getCachedSatFrame(product, requested);
  if (cached) return cached;
  const times = satCandidateTimes(timeMs);
  let lastErr;
  for (const t of times) {
    const url = satFrameUrl(product, t);
    if (!url) continue;
    const hit = getCachedSatFrame(product, t);
    if (hit) {
      cacheSet(satFrameKey(product, requested), hit);
      return hit;
    }
    try {
      const decoded = await decodeUrl(url, product, signal);
      const frame = { ...decoded, timeMs: t, product, url };
      cacheSet(satFrameKey(product, t), frame);
      cacheSet(satFrameKey(product, requested), frame);
      return frame;
    } catch (err) {
      lastErr = err;
      if (err?.name === "AbortError") throw err;
      if (err?.status !== 404) throw err;
    }
  }
  throw lastErr || new Error("GOES frame not found");
}

export async function prefetchSatFrames(product, times, { signal } = {}) {
  for (const t of times || []) {
    if (signal?.aborted) return;
    try {
      await loadSatFrame(product, t, { signal });
    } catch {
      // Keep playback usable if one slot is missing.
    }
  }
}

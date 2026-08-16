import { getS3Object, listS3Prefix } from "../radar/data/s3.js";
import {
  defaultSatBbox,
  goesBucket,
  goesChannel,
  goesListPrefixes,
  goesSatCandidates,
  nearestSatTimeMs,
  parseSatProduct,
  pickGoesSat,
  pickNearestGoesObject,
  satFrameKey,
  uniqueSatSlots,
} from "./goesAbi.js";
import { bboxToLeafletBounds } from "./iemGoes.js";
import { goesNav, makeGoesLut, outputGrid, samplePacked } from "./goesProj.js";
import { satRgba } from "./satPalette.js";

const MAX_FRAMES = 24;
const MAX_LUTS = 6;
const frames = new Map();
const luts = new Map();
const inflight = new Map();
const hourLists = new Map();

let h5mod = null;

async function h5() {
  if (!h5mod) {
    const mod = await import("h5wasm");
    await mod.ready;
    h5mod = mod;
  }
  return h5mod;
}

function cacheSet(map, key, value, max) {
  if (!key || !value) return;
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

function attrNumber(ds, name, fallback = NaN) {
  const attr = ds?.attrs?.[name];
  if (!attr) return fallback;
  const v = attr.value;
  if (typeof v === "number") return v;
  if (v && typeof v[0] === "number") return v[0];
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function attrString(ds, name) {
  const attr = ds?.attrs?.[name];
  if (!attr) return "";
  const v = attr.value;
  return typeof v === "string" ? v : String(v ?? "");
}

export function getCachedGoesFrame(product, timeMs, { lon, satId } = {}) {
  const sat = satId || pickGoesSat(timeMs, lon);
  const key = satFrameKey(product, timeMs, sat);
  if (!key || !frames.has(key)) return null;
  const frame = frames.get(key);
  frames.delete(key);
  frames.set(key, frame);
  return frame;
}

export function clearGoesCache() {
  frames.clear();
  inflight.clear();
  hourLists.clear();
}

async function listGoesHour(satId, prefix, signal) {
  const cacheKey = `${satId}|${prefix}`;
  if (hourLists.has(cacheKey)) return hourLists.get(cacheKey);
  const pending = listS3Prefix(goesBucket(satId), prefix, { signal }).finally(() => {
    // Keep successful lists; drop failures so a retry can try again.
  });
  hourLists.set(cacheKey, pending);
  try {
    return await pending;
  } catch (err) {
    if (hourLists.get(cacheKey) === pending) hourLists.delete(cacheKey);
    throw err;
  }
}

export async function findGoesObject(product, timeMs, { lon, signal } = {}) {
  const channel = goesChannel(product);
  if (!channel || !Number.isFinite(timeMs)) return null;
  const prefixes = goesListPrefixes(timeMs);
  for (const satId of goesSatCandidates(timeMs, lon)) {
    const objects = [];
    for (const prefix of prefixes) {
      try {
        objects.push(...await listGoesHour(satId, prefix, signal));
      } catch (err) {
        if (err?.name === "AbortError") throw err;
      }
    }
    const hit = pickNearestGoesObject(objects, timeMs, channel, satId);
    if (hit) return hit;
  }
  return null;
}

function rasterToCanvas(values, width, height, product, units) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const image = ctx.createImageData(width, height);
  satRgba(values, product, image.data, { units });
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function lutFor(nav, grid, x0, dx, nx, y0, dy, ny, satId) {
  const key = [satId, nx, ny, x0, dx, y0, dy, grid.west, grid.south, grid.width, grid.height].join("|");
  if (luts.has(key)) return luts.get(key);
  const lut = makeGoesLut(nav, grid, x0, dx, nx, y0, dy, ny);
  cacheSet(luts, key, lut, MAX_LUTS);
  return lut;
}

function readGoesNc(mod, bytes) {
  const { FS, File } = mod;
  const name = `/goes-${Math.random().toString(36).slice(2)}.nc`;
  FS.writeFile(name, bytes);
  const file = new File(name, "r");
  try {
    const cmi = file.get("CMI");
    const x = file.get("x");
    const y = file.get("y");
    const projDs = file.get("goes_imager_projection");
    if (!cmi || !x || !y || !projDs) throw new Error("GOES file was missing CMI or projection.");
    const raw = Int16Array.from(cmi.value);
    const [ny, nx] = cmi.shape || [];
    if (!raw?.length || !nx || !ny) throw new Error("GOES CMI was empty.");
    return {
      raw,
      nx,
      ny,
      scale: attrNumber(cmi, "scale_factor", 1),
      offset: attrNumber(cmi, "add_offset", 0),
      fill: attrNumber(cmi, "_FillValue", -1),
      units: attrString(cmi, "units"),
      x0: attrNumber(x, "add_offset"),
      dx: attrNumber(x, "scale_factor"),
      y0: attrNumber(y, "add_offset"),
      dy: attrNumber(y, "scale_factor"),
      proj: {
        perspective_point_height: attrNumber(projDs, "perspective_point_height"),
        semi_major_axis: attrNumber(projDs, "semi_major_axis"),
        semi_minor_axis: attrNumber(projDs, "semi_minor_axis"),
        longitude_of_projection_origin: attrNumber(projDs, "longitude_of_projection_origin"),
      },
    };
  } finally {
    try { file.close(); } catch { /* ignore */ }
    try { FS.unlink(name); } catch { /* ignore */ }
  }
}

function decodeCmi(parsed, product, bbox, satId) {
  const nav = goesNav(parsed.proj);
  const nativeDeg = product === "vis" ? 0.005 : 0.02;
  const grid = outputGrid(bbox, nativeDeg);
  if (!grid) throw new Error("GOES output grid was empty.");
  const lut = lutFor(nav, grid, parsed.x0, parsed.dx, parsed.nx, parsed.y0, parsed.dy, parsed.ny, satId);
  const values = samplePacked(parsed.raw, lut, parsed.scale, parsed.offset, parsed.fill);
  const units = product === "ir" || parsed.units === "K" ? "kelvin" : "reflectance";
  return {
    bounds: bboxToLeafletBounds([grid.west, grid.south, grid.east, grid.north]),
    canvas: rasterToCanvas(values, grid.width, grid.height, product, units),
    width: grid.width,
    height: grid.height,
    units,
  };
}

async function decodeGoesBytes(bytes, product, bbox, satId) {
  const mod = await h5();
  return decodeCmi(readGoesNc(mod, bytes), product, bbox, satId);
}

export async function loadGoesFrame(product, timeMs, { lon, bbox, signal } = {}) {
  const code = parseSatProduct(product);
  const requested = nearestSatTimeMs(timeMs);
  if (!code || !Number.isFinite(requested)) throw new Error("GOES request was invalid.");
  const cached = getCachedGoesFrame(code, requested, { lon });
  if (cached) return cached;
  const object = await findGoesObject(code, timeMs, { lon, signal });
  if (!object) {
    const err = new Error("GOES frame not found");
    err.status = 404;
    throw err;
  }
  const satId = object.satId;
  const objectKey = `${code}|${satId}|${object.key}`;
  const hit = getCachedGoesFrame(code, object.startMs, { satId });
  if (hit) {
    cacheSet(frames, satFrameKey(code, requested, satId), hit, MAX_FRAMES);
    return hit;
  }
  if (inflight.has(objectKey)) {
    const frame = await inflight.get(objectKey);
    cacheSet(frames, satFrameKey(code, requested, satId), frame, MAX_FRAMES);
    return frame;
  }
  const area = bbox && bbox.east > bbox.west ? bbox : defaultSatBbox(satId);
  const pending = getS3Object(goesBucket(satId), object.key, { signal })
    .then((bytes) => decodeGoesBytes(bytes, code, area, satId))
    .then((decoded) => {
      const frame = {
        ...decoded,
        timeMs: object.startMs,
        product: code,
        satId,
        key: object.key,
        source: "abi",
        attribution: `GOES-${satId} ABI via NOAA / AWS`,
      };
      cacheSet(frames, satFrameKey(code, object.startMs, satId), frame, MAX_FRAMES);
      cacheSet(frames, satFrameKey(code, requested, satId), frame, MAX_FRAMES);
      return frame;
    })
    .finally(() => {
      if (inflight.get(objectKey) === pending) inflight.delete(objectKey);
    });
  inflight.set(objectKey, pending);
  return pending;
}

export async function prefetchGoesFrames(product, samples, { signal, bbox, fromTimeMs, limit } = {}) {
  const code = parseSatProduct(product);
  if (!code) return;
  const max = Number.isFinite(limit) ? limit : code === "vis" ? 2 : 16;
  const start = nearestSatTimeMs(fromTimeMs);
  let slots = uniqueSatSlots(samples);
  if (Number.isFinite(start)) slots = slots.filter((s) => s.timeMs >= start);
  for (const slot of slots.slice(0, max)) {
    if (signal?.aborted) return;
    try {
      await loadGoesFrame(code, slot.timeMs, { lon: slot.lon, bbox, signal });
    } catch {
      // Keep playback usable if one slot is missing.
    }
  }
}

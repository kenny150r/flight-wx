import { L2_BUCKET, getS3Object, listL2Prefix, listS3Prefix } from "../data/s3.js";
import { parseScanTime } from "./sweeps.js";
import { idbGet, idbSet } from "../cache/idb.js";

function scanFromObject(obj) {
  const filename = obj.key.split("/").pop() || "";
  if (filename.includes("_MDM") || filename.startsWith(".")) return null;
  const time = parseScanTime(filename);
  if (!time) return null;
  return { time, key: obj.key, filename, size: obj.size };
}

export async function listL2Scans(stationId, dateClean, { signal } = {}) {
  const prefix = listL2Prefix(stationId, dateClean);
  const objects = await listS3Prefix(L2_BUCKET, prefix, { signal });
  const scans = objects.map(scanFromObject).filter(Boolean);
  scans.sort((a, b) => a.time.localeCompare(b.time));
  return { station: stationId, date: dateClean, count: scans.length, scans };
}

const inflightDownloads = new Map();

function copyBytes(bytes) {
  if (!bytes) return bytes;
  return bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
}

async function getCachedBytes(key) {
  const rec = await idbGet(key);
  if (!rec?.value) return null;
  return rec.value instanceof Uint8Array ? rec.value : new Uint8Array(rec.value);
}

export async function downloadVolume(bucket, key, { signal, onProgress } = {}) {
  const cacheKey = `raw:${bucket}:${key}`;
  const cached = await getCachedBytes(cacheKey);
  if (cached) return copyBytes(cached);
  const existing = inflightDownloads.get(cacheKey);
  if (existing) return copyBytes(await existing);
  const pending = getS3Object(bucket, key, { signal, onProgress })
    .then(async (bytes) => {
      await idbSet(cacheKey, bytes, bytes.byteLength);
      return bytes;
    })
    .finally(() => inflightDownloads.delete(cacheKey));
  inflightDownloads.set(cacheKey, pending);
  return copyBytes(await pending);
}

export { L2_BUCKET };

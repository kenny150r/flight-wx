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

async function getCachedBytes(key) {
  const rec = await idbGet(key);
  if (!rec?.value) return null;
  return rec.value instanceof Uint8Array ? rec.value : new Uint8Array(rec.value);
}

export async function downloadVolume(bucket, key, { signal, onProgress } = {}) {
  const cacheKey = `raw:${bucket}:${key}`;
  const cached = await getCachedBytes(cacheKey);
  if (cached) return cached;
  const bytes = await getS3Object(bucket, key, { signal, onProgress });
  await idbSet(cacheKey, bytes, bytes.byteLength);
  return bytes;
}

export { L2_BUCKET };

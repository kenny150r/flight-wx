import { getStation } from "../radar/data/stations.js";
import { L2_BUCKET, downloadVolume } from "../radar/decode/radarClient.js";
import { decodeL2InWorker } from "../radar/decode/workers.js";

export async function loadRadarForSample(sample, product = "reflectivity", { signal, onProgress } = {}) {
  if (!sample?.s3Key || !sample.stationId) {
    throw new Error("This sample has no radar volume to load.");
  }
  const station = getStation(sample.stationId);
  if (!station) throw new Error(`Unknown station ${sample.stationId}`);
  onProgress?.({ text: `Loading ${station.id} ${product}…` });
  const bytes = await downloadVolume(L2_BUCKET, sample.s3Key, { signal, onProgress });
  onProgress?.({ text: `Decoding ${station.id} at ${Number.isFinite(sample.elevation) ? `${sample.elevation.toFixed(1)}°` : "auto"}…` });
  return decodeL2InWorker(bytes, {
    station,
    dateClean: sample.dateClean,
    timeClean: sample.timeClean,
    product,
    elevation: sample.elevation,
    s3Key: sample.s3Key,
  }, onProgress);
}

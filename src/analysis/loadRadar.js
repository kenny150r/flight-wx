import { getStation } from "../radar/data/stations.js";
import { L2_BUCKET, downloadVolume } from "../radar/decode/radarClient.js";
import { decodeL2InWorker } from "../radar/decode/workers.js";

export async function loadRadarForSample(sample, product = "reflectivity", {
  signal,
  onProgress,
  tiltMode = "closest",
} = {}) {
  if (!sample?.s3Key || !sample.stationId) {
    throw new Error("This sample has no radar volume to load.");
  }
  const station = getStation(sample.stationId);
  if (!station) throw new Error(`Unknown station ${sample.stationId}`);
  const elevation = tiltMode === "base" ? null : sample.elevation;
  const tiltLabel = tiltMode === "base"
    ? "base"
    : (Number.isFinite(elevation) ? `${elevation.toFixed(1)}°` : "auto");
  onProgress?.({ text: `Loading ${station.id} ${product}…` });
  const bytes = await downloadVolume(L2_BUCKET, sample.s3Key, { signal, onProgress });
  onProgress?.({ text: `Decoding ${station.id} ${tiltLabel} ${product}…` });
  return decodeL2InWorker(bytes, {
    station,
    dateClean: sample.dateClean,
    timeClean: sample.timeClean,
    product,
    elevation,
    s3Key: sample.s3Key,
  }, onProgress);
}

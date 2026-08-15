import { getStationList } from "../radar/data/stations.js";
import { L2_BUCKET, downloadVolume, listL2Scans } from "../radar/decode/radarClient.js";
import { sampleL2InWorker } from "../radar/decode/workers.js";
import { assignStations } from "./nearest.js";
import { resampleTrack } from "./resample.js";
import { summarizeSamples } from "./report.js";
import { DEFAULT_STRIDE_SEC, MAX_VOLUMES, planVolumes } from "./volumePlan.js";

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function analyzeTrack(points, { signal, onProgress } = {}) {
  if (!points.length) throw new Error("No track points to analyze");
  const stations = getStationList();
  let stride = DEFAULT_STRIDE_SEC;
  let assigned = [];
  let plan = { volumes: [] };

  for (;;) {
    const resampled = resampleTrack(points, stride);
    assigned = assignStations(resampled, stations);
    onProgress?.({ phase: "listing", text: `Planning radar volumes (stride ${stride}s)…` });
    plan = await planVolumes(assigned, { listScans: (id, date) => listL2Scans(id, date, { signal }) });
    if (!plan.overBudget || stride >= 600) break;
    stride *= 2;
  }

  const covered = assigned.filter((p) => p.station).length;
  if (!plan.volumes.length) {
    return summarizeSamples([], {
      trackCount: assigned.length,
      volumeCount: 0,
      bytes: 0,
    });
  }

  let bytes = 0;
  let done = 0;
  const sampleChunks = await mapPool(plan.volumes, 2, async (volume, idx) => {
    onProgress?.({
      phase: "download",
      text: `Downloading ${volume.station.id} ${volume.timeClean} (${idx + 1}/${plan.volumes.length})…`,
      done,
      total: plan.volumes.length,
      bytes,
    });
    const raw = await downloadVolume(L2_BUCKET, volume.key, {
      signal,
      onProgress: (p) => {
        onProgress?.({
          phase: "download",
          text: `Downloading ${volume.station.id}… ${p.total ? Math.round((p.loaded / p.total) * 100) : 0}%`,
          done,
          total: plan.volumes.length,
          bytes: bytes + (p.loaded || 0),
        });
      },
    });
    bytes += raw.byteLength;
    onProgress?.({
      phase: "decode",
      text: `Sampling ${volume.station.id} (${idx + 1}/${plan.volumes.length})…`,
      done,
      total: plan.volumes.length,
      bytes,
    });
    const { samples } = await sampleL2InWorker(raw, {
      station: volume.station,
      points: volume.points,
      s3Key: volume.key,
      dateClean: volume.dateClean,
      timeClean: volume.timeClean,
    }, (prog) => onProgress?.({ ...prog, done, total: plan.volumes.length, bytes }));
    done += 1;
    return samples;
  });

  const samples = sampleChunks.flat();
  const summary = summarizeSamples(samples, {
    trackCount: assigned.length,
    volumeCount: plan.volumes.length,
    bytes,
  });
  summary.strideSec = stride;
  summary.assigned = assigned;
  summary.uncoveredCount = assigned.length - covered;
  return summary;
}

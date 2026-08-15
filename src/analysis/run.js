import { getStationList } from "../radar/data/stations.js";
import { L2_BUCKET, downloadVolume, listL2Scans } from "../radar/decode/radarClient.js";
import { sampleL2InWorker } from "../radar/decode/workers.js";
import { enrichFlightState } from "./flightState.js";
import { assignStations } from "./nearest.js";
import { defaultConcurrency } from "./pool.js";
import { resampleTrack } from "./resample.js";
import { summarizeSamples } from "./report.js";
import { DEFAULT_STRIDE_SEC, planVolumes } from "./volumePlan.js";

export async function ingestVolumes(volumes, {
  signal,
  onProgress,
  download,
  sample,
  downloadLimit = defaultConcurrency("download"),
  sampleLimit = defaultConcurrency("decode"),
} = {}) {
  const downloadVolumeFn = download || ((volume) => downloadVolume(L2_BUCKET, volume.key, { signal }));
  const sampleVolumeFn = sample || ((raw, volume, onProg) => sampleL2InWorker(raw, {
    station: volume.station,
    points: volume.points,
    s3Key: volume.key,
    dateClean: volume.dateClean,
    timeClean: volume.timeClean,
  }, onProg));
  const queue = [];
  const waiters = [];
  let nextDownload = 0;
  let downloadsFinished = 0;
  let sampled = 0;
  let bytes = 0;
  const out = new Array(volumes.length);

  const wake = () => {
    while (waiters.length) waiters.shift()();
  };

  async function downloader() {
    while (nextDownload < volumes.length) {
      const idx = nextDownload++;
      const volume = volumes[idx];
      onProgress?.({
        phase: "download",
        text: `Downloading ${volume.station.id} (${Math.min(downloadsFinished + 1, volumes.length)}/${volumes.length})…`,
        done: sampled,
        total: volumes.length,
        bytes,
      });
      try {
        const raw = await downloadVolumeFn(volume);
        bytes += raw.byteLength;
        queue.push({ idx, volume, raw });
      } catch (error) {
        queue.push({ idx, volume, error });
      }
      downloadsFinished += 1;
      wake();
    }
  }

  async function sampler() {
    for (;;) {
      if (!queue.length) {
        if (downloadsFinished >= volumes.length) return;
        await new Promise((resolve) => {
          if (queue.length || downloadsFinished >= volumes.length) resolve();
          else waiters.push(resolve);
        });
        continue;
      }
      const item = queue.shift();
      if (item.error) {
        out[item.idx] = [];
      } else {
        onProgress?.({
          phase: "decode",
          text: `Sampling ${item.volume.station.id} (${sampled + 1}/${volumes.length})…`,
          done: sampled,
          total: volumes.length,
          bytes,
        });
        try {
          const { samples } = await sampleVolumeFn(
            item.raw,
            item.volume,
            (prog) => onProgress?.({ ...prog, done: sampled, total: volumes.length, bytes }),
          );
          out[item.idx] = samples.map((sample) => ({
            ...sample,
            s3Key: item.volume.key,
            dateClean: item.volume.dateClean,
            timeClean: item.volume.timeClean,
          }));
        } catch {
          out[item.idx] = [];
        }
      }
      sampled += 1;
      onProgress?.({
        phase: "decode",
        text: `Sampled ${sampled}/${volumes.length} volumes`,
        done: sampled,
        total: volumes.length,
        bytes,
      });
    }
  }

  const downloaders = Array.from(
    { length: Math.min(downloadLimit, volumes.length) },
    () => downloader(),
  );
  const samplers = Array.from(
    { length: Math.min(sampleLimit, volumes.length) },
    () => sampler(),
  );
  await Promise.all(downloaders);
  wake();
  await Promise.all(samplers);
  return { chunks: out.filter(Boolean), bytes };
}

export async function analyzeTrack(points, { signal, onProgress } = {}) {
  if (!points.length) throw new Error("No track points to analyze");
  const track = enrichFlightState(points);
  const stations = getStationList();
  let stride = DEFAULT_STRIDE_SEC;
  let assigned = [];
  let plan = { volumes: [] };

  for (;;) {
    const resampled = resampleTrack(track, stride);
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

  const { chunks, bytes } = await ingestVolumes(plan.volumes, { signal, onProgress });
  const samples = chunks.flat();
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

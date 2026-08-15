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
  maxQueue = Math.max(2, downloadLimit + sampleLimit),
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
  const spaceWaiters = [];
  let nextDownload = 0;
  let downloadsFinished = 0;
  let activeDownloads = 0;
  let sampled = 0;
  let bytes = 0;
  let firstError = null;
  const out = new Array(volumes.length);

  const wake = () => {
    while (waiters.length) waiters.shift()();
  };
  const wakeSpace = () => {
    while (spaceWaiters.length) spaceWaiters.shift()();
  };

  async function downloader() {
    for (;;) {
      if (nextDownload >= volumes.length) return;
      if (queue.length + activeDownloads >= maxQueue) {
        await new Promise((resolve) => {
          if (queue.length + activeDownloads < maxQueue || nextDownload >= volumes.length) resolve();
          else spaceWaiters.push(resolve);
        });
        continue;
      }
      const idx = nextDownload++;
      if (idx >= volumes.length) return;
      const volume = volumes[idx];
      activeDownloads += 1;
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
        if (!firstError) firstError = error;
        queue.push({ idx, volume, error });
      } finally {
        activeDownloads -= 1;
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
      wakeSpace();
      if (item.error) {
        out[item.idx] = failedPlaceholders(item.volume, item.error);
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
        } catch (error) {
          if (!firstError) firstError = error;
          out[item.idx] = failedPlaceholders(item.volume, error);
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
  wakeSpace();
  await Promise.all(samplers);
  return { chunks: out.filter(Boolean), bytes, firstError };
}

function failedPlaceholders(volume, error) {
  const reason = error?.message || "ingest_failed";
  return (volume.points || []).map((point) => ({
    timeMs: point.timeMs,
    lat: point.lat,
    lon: point.lon,
    altFt: point.altFt || 0,
    stationId: volume.station?.id || point.station?.id || null,
    s3Key: null,
    dateClean: volume.dateClean,
    timeClean: volume.timeClean,
    dbz: NaN,
    compositeDbz: NaN,
    vrMs: NaN,
    horizShearS: NaN,
    azShearS: NaN,
    vertShearS: NaN,
    lowConfidence: true,
    reason: "ingest_failed",
    ingestError: reason,
  }));
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
    const summary = summarizeSamples([], {
      trackCount: assigned.length,
      volumeCount: 0,
      bytes: 0,
    });
    summary.strideSec = stride;
    summary.assigned = assigned;
    summary.uncoveredCount = assigned.length - covered;
    summary.listErrors = plan.listErrors || 0;
    summary.emptyReason = covered === 0
      ? "outside_conus"
      : (plan.listErrors ? "list_failed" : "no_scans");
    return summary;
  }

  const { chunks, bytes, firstError } = await ingestVolumes(plan.volumes, { signal, onProgress });
  const samples = chunks.flat();
  const summary = summarizeSamples(samples, {
    trackCount: assigned.length,
    volumeCount: plan.volumes.length,
    bytes,
  });
  summary.strideSec = stride;
  summary.assigned = assigned;
  summary.uncoveredCount = assigned.length - covered;
  summary.listErrors = plan.listErrors || 0;
  summary.volumeCapped = Boolean(plan.capped);
  summary.ingestFailedCount = samples.filter((s) => s.reason === "ingest_failed").length;
  const usable = samples.filter((s) => s.s3Key);
  if (!usable.length) {
    summary.emptyReason = "ingest_failed";
    summary.emptyDetail = firstError?.message || "";
  }
  return summary;
}

import { EXAMPLE_FLIGHT } from "./adsb/ident.js";
import { lookupFlightTrack } from "./adsb/lookup.js";
import { parseTrackFile } from "./adsb/parseTrack.js";
import { clearFrameCache, getCachedFrame, loadCachedRadar, prefetchPlayFrames } from "./analysis/frameCache.js";
import { nextPlayIndex, PLAY_STEP_MS, playbackFrameKey, playableSamples, playIndexOf, sleep } from "./analysis/playback.js";
import { defaultConcurrency } from "./analysis/pool.js";
import { analyzeTrack } from "./analysis/run.js";
import { cleanToDateInput, dateInputToClean } from "./analysis/geo.js";
import { buildShareSearch, clampShareFrame, parseShareSearch } from "./analysis/shareUrl.js";
import { clearRadar, EVENT_ZOOM, highlightSample, initMap, invalidateMapSize, mapZoom, renderTrack, showRadarFrame, zoomToSample } from "./ui/map.js";
import {
  hideProgress,
  highlightReportSelection,
  renderReport,
  setPlayButtons,
  setPlaySlider,
  setProgress,
  setStatus,
  updateRadarHud,
} from "./ui/render.js";

const $ = (id) => document.getElementById(id);

function readParams() {
  return parseShareSearch(window.location.search);
}

function writeParams({ flight, date, hex, frame, play } = {}) {
  const query = buildShareSearch({ flight, date, hex, frame, play });
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === next) return;
  history.replaceState(null, "", next);
}

export function boot() {
  const form = $("analyze-form");
  const status = $("status");
  const progress = {
    wrap: $("progress"),
    text: $("progress-text"),
    bar: $("progress-bar"),
    detail: $("progress-detail"),
  };
  const report = $("report");
  const hud = $("radar-hud");
  initMap($("map"));

  let summary = null;
  let meta = null;
  let selected = null;
  let product = "reflectivity";
  let loadToken = 0;
  let loadedKey = "";
  let playing = false;
  let cacheText = "";

  const params = readParams();
  if (params.flight) $("flight").value = params.flight;
  if (params.date) $("date").value = cleanToDateInput(params.date) || params.date;
  if (params.hex) $("hex").value = params.hex;
  if (!$("date").value) $("date").value = new Date().toISOString().slice(0, 10);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await run();
  });

  $("example-flight").addEventListener("click", async () => {
    $("flight").value = EXAMPLE_FLIGHT.flight;
    $("date").value = EXAMPLE_FLIGHT.dateInput;
    $("hex").value = "";
    $("track-file").value = "";
    await run();
  });

  document.querySelectorAll("[data-play-flight]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (playing) stopPlayback();
      else playFlight();
    });
  });

  document.querySelectorAll("[data-play-slider]").forEach((el) => {
    el.addEventListener("input", () => {
      const samples = playableSamples(summary?.samples || []);
      const index = Number(el.value);
      if (!samples[index]) return;
      seekTo(index, { quiet: true, zoom: false, keepPlaying: playing });
    });
  });

  hud.querySelectorAll("[data-product]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      product = btn.dataset.product;
      loadedKey = "";
      startPrefetch();
      if (selected) await selectSample(selected, { reload: true });
    });
  });
  $("clear-radar").addEventListener("click", () => {
    stopPlayback();
    clearRadar();
    selected = null;
    loadedKey = "";
    updateRadarHud(hud, {});
    if (summary) refreshView();
    syncShareUrl({ frame: 0, play: false });
  });

  if (params.flight && params.date) run({ restore: { frame: params.frame, play: params.play } });

  function canPlay() {
    return playableSamples(summary?.samples || []).length > 0;
  }

  function setResultsVisible(visible) {
    report.hidden = !visible;
    const bottom = $("bottom");
    if (bottom) bottom.hidden = !visible;
    invalidateMapSize();
  }

  function setPlayStatus(text) {
    const el = $("play-status");
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !playing || !text;
  }

  function sliderLabel(samples, index) {
    const sample = samples[index];
    if (!sample) return "";
    const when = new Date(sample.timeMs).toISOString().slice(11, 16);
    return `${when}Z · ${sample.stationId} · ${index + 1}/${samples.length}`;
  }

  function syncSlider(index) {
    const samples = playableSamples(summary?.samples || []);
    const i = Number.isFinite(index) ? index : playIndexOf(samples, selected);
    setPlaySlider({
      enabled: canPlay(),
      index: i,
      total: samples.length,
      label: sliderLabel(samples, i),
      cacheText,
    });
  }

  function refreshView() {
    renderReport(report, summary, meta, { onSelect: (sample, opts) => selectSample(sample, opts), selected });
    renderTrack(summary, { onSelect: (sample, opts) => selectSample(sample, opts), selected });
    setPlayButtons(playing, canPlay());
    syncSlider();
  }

  function seekTo(index, opts = {}) {
    const samples = playableSamples(summary?.samples || []);
    const sample = samples[Math.max(0, Math.min(index, samples.length - 1))];
    if (!sample) return;
    syncSlider(index);
    return selectSample(sample, opts);
  }

  async function restoreShare(restore) {
    const samples = playableSamples(summary?.samples || []);
    const frame = clampShareFrame(restore?.frame, samples.length);
    if (restore?.play && samples.length) {
      await playFlight({ from: frame ? frame - 1 : 0 });
      return;
    }
    if (frame) {
      await seekTo(frame - 1, { quiet: true, zoom: true });
      return;
    }
    syncShareUrl({ play: false });
  }

  function shareFields(extra = {}) {
    const samples = playableSamples(summary?.samples || []);
    const index = playIndexOf(samples, selected);
    return {
      flight: $("flight").value.trim(),
      date: dateInputToClean($("date").value),
      hex: $("hex").value.trim(),
      frame: selected && samples.length ? index + 1 : 0,
      play: playing,
      ...extra,
    };
  }

  function syncShareUrl(extra) {
    writeParams(shareFields(extra));
  }

  function stopPlayback() {
    if (!playing) return;
    playing = false;
    setPlayButtons(false, canPlay());
    setPlayStatus("");
    syncShareUrl({ play: false });
  }

  async function playFlight({ from } = {}) {
    const samples = playableSamples(summary?.samples || []);
    if (!samples.length || playing) return;
    product = "reflectivity";
    playing = true;
    setPlayButtons(true, true);
    let i = Number.isFinite(from)
      ? Math.max(0, Math.min(from, samples.length - 1))
      : nextPlayIndex(samples, selected);
    if (mapZoom() < EVENT_ZOOM - 0.4) {
      zoomToSample(samples[i]);
      await sleep(500);
      if (!playing) return;
    }
    syncShareUrl({ play: true, frame: i + 1 });
    while (playing && i < samples.length) {
      await selectSample(samples[i], { quiet: true, keepPlaying: true });
      if (!playing) break;
      await sleep(PLAY_STEP_MS);
      i = playIndexOf(playableSamples(summary.samples), selected) + 1;
    }
    playing = false;
    setPlayButtons(false, canPlay());
    setPlayStatus("");
    syncShareUrl({ play: false });
  }

  async function selectSample(sample, { reload = false, quiet = false, product: nextProduct, zoom, keepPlaying = false } = {}) {
    if (!sample) return;
    if (!quiet && !keepPlaying) stopPlayback();
    if (nextProduct && nextProduct !== product) {
      product = nextProduct;
      reload = true;
      loadedKey = "";
    }
    const shouldZoom = zoom ?? !quiet;
    const frameKey = playbackFrameKey(sample, product);
    const cached = !reload && getCachedFrame(frameKey);
    const sameFrame = !reload && loadedKey && loadedKey === frameKey;
    selected = sample;
    if (shouldZoom) zoomToSample(sample);
    highlightSample(sample, { openPopup: !quiet, follow: quiet && !shouldZoom });
    if (quiet && summary) highlightReportSelection(report, summary, selected);
    else if (summary) refreshView();
    else syncSlider();
    if (playing) {
      const tilt = Number.isFinite(sample.elevation) ? `${sample.elevation.toFixed(1)}°` : "tilt n/a";
      const when = new Date(sample.timeMs).toISOString().slice(11, 16);
      setPlayStatus(`Playing · ${sample.stationId} · ${when}Z · ${tilt}`);
    }
    if (sameFrame) {
      updateRadarHud(hud, { sample, product });
      syncShareUrl();
      return;
    }
    if (cached) {
      loadedKey = frameKey;
      showRadarFrame(cached, sample);
      updateRadarHud(hud, { sample, product });
      prefetchAhead(sample);
      syncShareUrl();
      return;
    }
    const token = ++loadToken;
    updateRadarHud(hud, { sample, product, loading: { text: `Loading ${sample.stationId}…` } });
    try {
      const frame = await loadCachedRadar(sample, product, {
        onProgress: (p) => {
          if (token === loadToken) updateRadarHud(hud, { sample, product, loading: p });
        },
      });
      if (token !== loadToken) return;
      loadedKey = frameKey;
      showRadarFrame(frame, sample);
      updateRadarHud(hud, { sample, product });
      prefetchAhead(sample);
      syncShareUrl();
    } catch (err) {
      if (token !== loadToken) return;
      loadedKey = "";
      updateRadarHud(hud, { sample, product, error: err.message || String(err) });
      syncShareUrl();
    }
  }

  function prefetchAhead(fromSample) {
    const samples = playableSamples(summary?.samples || []);
    const i = playIndexOf(samples, fromSample);
    prefetchPlayFrames(samples.slice(i, i + 16), product, { concurrency: defaultConcurrency("decode") }).catch(() => {});
  }

  function startPrefetch() {
    const samples = playableSamples(summary?.samples || []);
    prefetchPlayFrames(samples, product, {
      concurrency: defaultConcurrency("decode"),
      onProgress: ({ done, total }) => {
        cacheText = done < total ? `Cached ${done}/${total} scans` : "Scans cached";
        syncSlider();
      },
    }).catch(() => {});
  }

  async function run({ restore } = {}) {
    const flight = $("flight").value.trim();
    const dateClean = dateInputToClean($("date").value);
    const hex = $("hex").value.trim();
    const file = $("track-file").files[0];
    writeParams({
      flight,
      date: dateClean,
      hex,
      frame: restore?.frame,
      play: restore?.play,
    });
    setResultsVisible(false);
    stopPlayback();
    selected = null;
    loadedKey = "";
    cacheText = "";
    clearFrameCache();
    clearRadar();
    updateRadarHud(hud, {});
    setStatus(status, "", "");
    setProgress(progress, { text: "Looking up flight track…" });

    try {
      let points = [];
      meta = { notes: [] };
      if (file) {
        const text = await file.text();
        points = parseTrackFile(file.name, text);
        meta = { source: "upload", notes: [`Loaded ${points.length} points from ${file.name}`] };
      } else {
        if (!flight || !dateClean) throw new Error("Enter a flight number and date, or upload a track.");
        setProgress(progress, { text: `Fetching public track for ${flight}…` });
        const found = await lookupFlightTrack({ flight, dateClean, hex });
        points = found.points;
        meta = found;
        if (!points.length) {
          hideProgress(progress);
          setStatus(status, `${found.notes.join(" ")} Upload a CSV or GeoJSON track to continue.`, "error");
          return;
        }
        if (found.source === "live-point") {
          setStatus(status, "Only a live position was found. Results will be a single point unless you upload a full track.", "warn");
        }
      }

      summary = await analyzeTrack(points, {
        onProgress: (p) => setProgress(progress, p),
      });
      hideProgress(progress);
      if (!summary.samples.length) {
        setStatus(status, "Track is outside CONUS NEXRAD coverage, or no Level II scans were found near those times.", "error");
        return;
      }
      refreshView();
      setResultsVisible(true);
      startPrefetch();
      setStatus(status, `Analyzed ${summary.samples.length} samples across ${summary.sites.length} radars. Play flight or drag the slider to scrub.`, "ok");
      await restoreShare(restore);
    } catch (err) {
      hideProgress(progress);
      setStatus(status, err.message || String(err), "error");
    }
  }
}

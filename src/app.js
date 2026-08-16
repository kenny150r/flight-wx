import { EXAMPLE_LIBRARY } from "./adsb/ident.js";
import { EXAMPLE_GROUPS } from "./adsb/examples.js";
import { lookupFlightTrack } from "./adsb/lookup.js";
import { MAX_TRACK_BYTES, parseTrackFile } from "./adsb/parseTrack.js";
import { clearFrameCache, getCachedFrame, loadCachedRadar, prefetchPlayFrames } from "./analysis/frameCache.js";
import { nextPlayIndex, PLAY_STEP_MS, playbackFrameKey, playableSamples, playIndexOf, sleep } from "./analysis/playback.js";
import { defaultConcurrency } from "./analysis/pool.js";
import { headlineEvent } from "./analysis/report.js";
import { analyzeTrack } from "./analysis/run.js";
import { cleanToDateInput, dateInputToClean, isCleanDate } from "./analysis/geo.js";
import { formatTrackTime } from "./analysis/time.js";
import { buildShareSearch, clampShareFrame, parseShareSearch } from "./analysis/shareUrl.js";
import { clearSatCache, getCachedSatFrame, loadSatFrame, prefetchSatFrames } from "./sat/satFrames.js";
import { formatSatHud, nearestSatTimeMs, parseSatProduct, pickGoesSat, satBoundsFromSamples, satFrameKey } from "./sat/goesAbi.js";
import { clearRadar, clearSat, EVENT_ZOOM, highlightSample, initMap, invalidateMapSize, mapZoom, renderTrack, showRadarFrame, showSatFrame, zoomToSample } from "./ui/map.js";
import { setSeriesViewAround } from "./ui/series.js";
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

function writeParams({ flight, date, hex, frame, play, tilt, sat } = {}) {
  const query = buildShareSearch({ flight, date, hex, frame, play, tilt, sat });
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
  let tiltMode = "closest";
  let satProduct = "";
  let satLoadedKey = "";
  let satValidMs = NaN;
  let satValidSatId = 0;
  let satBbox = null;
  let satError = false;
  let satLoading = false;
  let satLoadToken = 0;
  let satInflightKey = "";
  let satPrefetchAbort = null;
  let loadToken = 0;
  let runToken = 0;
  let runAbort = null;
  let prefetchAbort = null;
  let loadedKey = "";
  let playing = false;
  let cacheText = "";

  const params = readParams();
  if (params.tilt === "base") tiltMode = "base";
  satProduct = parseSatProduct(params.sat);
  if (params.flight) $("flight").value = params.flight;
  if (params.date) $("date").value = cleanToDateInput(params.date) || params.date;
  if (params.hex) $("hex").value = params.hex;
  if (!$("date").value) $("date").value = new Date().toISOString().slice(0, 10);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await run();
  });

  const exampleRoot = $("example-library");
  const exampleLib = exampleRoot?.closest("details");
  if (exampleRoot) {
    const hint = document.createElement("p");
    hint.className = "example-hint";
    hint.textContent = "Representative paths timed to the NTSB encounter. Public historical ADS-B is usually missing.";
    exampleRoot.append(hint);
    for (const group of EXAMPLE_GROUPS) {
      const items = EXAMPLE_LIBRARY.filter((ex) => ex.group === group.id);
      if (!items.length) continue;
      const heading = document.createElement("div");
      heading.className = "example-group";
      heading.textContent = group.label;
      exampleRoot.append(heading);
      for (const example of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "example-item";
        btn.dataset.example = example.id;
        btn.dataset.fit = example.fit || "";
        const sub = document.createElement("small");
        sub.textContent = [example.detail, example.ntsb].filter(Boolean).join(" · ");
        btn.append(example.label, sub);
        btn.addEventListener("click", async () => {
          if (exampleLib) exampleLib.open = false;
          $("flight").value = example.flight;
          $("date").value = example.dateInput;
          $("hex").value = "";
          $("track-file").value = "";
          await run({ focusHeadline: true });
        });
        exampleRoot.append(btn);
      }
    }
    document.addEventListener("click", (event) => {
      if (exampleLib?.open && !exampleLib.contains(event.target)) exampleLib.open = false;
    });
  }

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
  hud.querySelectorAll("[data-tilt]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      tiltMode = btn.dataset.tilt === "base" ? "base" : "closest";
      loadedKey = "";
      startPrefetch();
      syncShareUrl();
      if (selected) await selectSample(selected, { reload: true });
    });
  });
  hud.querySelectorAll("[data-sat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const next = parseSatProduct(btn.dataset.sat);
      satProduct = next;
      satError = false;
      satLoading = false;
      if (!satProduct) {
        satLoadToken += 1;
        satLoadedKey = "";
        satInflightKey = "";
        satValidMs = NaN;
        satValidSatId = 0;
        satPrefetchAbort?.abort();
        clearSat();
        updateRadarHud(hud, hudPayload());
        syncShareUrl();
        return;
      }
      startSatPrefetch();
      if (selected) await loadSatForSample(selected, { reload: true });
      else {
        updateRadarHud(hud, hudPayload());
        syncShareUrl();
      }
    });
  });
  $("clear-radar").addEventListener("click", () => {
    stopPlayback();
    clearRadar();
    selected = null;
    loadedKey = "";
    updateRadarHud(hud, hudPayload());
    if (summary) refreshView();
    syncShareUrl({ frame: 0, play: false });
  });

  ["flight", "date", "hex"].forEach((id) => {
    $(id).addEventListener("input", () => {
      if ($("track-file").files[0]) $("track-file").value = "";
    });
  });

  if (params.flight && isCleanDate(params.date)) run({ restore: { frame: params.frame, play: params.play } });

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
    const when = formatTrackTime(sample.timeMs, { lon: sample.lon });
    return `${when.local || when.utc} · ${sample.stationId} · ${index + 1}/${samples.length}`;
  }

  function syncSlider(index) {
    const samples = playableSamples(summary?.samples || []);
    const i = Number.isFinite(index) ? index : Math.max(0, playIndexOf(samples, selected));
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
      tilt: tiltMode,
      sat: satProduct,
      ...extra,
    };
  }

  function hudPayload(extra = {}) {
    return {
      sample: selected,
      product,
      tiltMode,
      sat: satProduct,
      satTimeMs: satValidMs,
      satId: satValidSatId,
      satError,
      satLoading,
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
    startSatPrefetch();
    void loadSatForSample(samples[i]);
    while (playing && i < samples.length) {
      await selectSample(samples[i], { quiet: true, keepPlaying: true });
      if (!playing) break;
      await sleep(PLAY_STEP_MS);
      const idx = playIndexOf(playableSamples(summary.samples), selected);
      if (idx < 0) break;
      i = idx + 1;
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
    const frameKey = playbackFrameKey(sample, product, tiltMode);
    const cached = !reload && getCachedFrame(frameKey);
    const sameFrame = !reload && loadedKey && loadedKey === frameKey;
    selected = sample;
    if (shouldZoom) zoomToSample(sample);
    highlightSample(sample, { openPopup: !quiet, follow: quiet && !shouldZoom });
    if (quiet && summary) highlightReportSelection(report, summary, selected);
    else if (summary) refreshView();
    else syncSlider();
    if (playing) {
      const tilt = tiltMode === "base"
        ? "base"
        : (Number.isFinite(sample.elevation) ? `${sample.elevation.toFixed(1)}°` : "tilt n/a");
      const when = formatTrackTime(sample.timeMs, { lon: sample.lon });
      const satBit = formatSatHud(satProduct, satValidMs || sample.timeMs, { satId: satValidSatId || pickGoesSat(sample.timeMs, sample.lon) });
      setPlayStatus(`Playing · ${sample.stationId} · ${when.local || when.utc} · ${tilt}${satBit ? ` · ${satBit}` : ""}`);
    }
    if (sameFrame) {
      updateRadarHud(hud, hudPayload());
      syncShareUrl();
      void loadSatForSample(sample);
      return;
    }
    if (cached) {
      loadedKey = frameKey;
      showRadarFrame(cached, sample);
      updateRadarHud(hud, hudPayload());
      prefetchAhead(sample);
      syncShareUrl();
      void loadSatForSample(sample);
      return;
    }
    const token = ++loadToken;
    updateRadarHud(hud, hudPayload({ loading: { text: `Loading ${sample.stationId}…` } }));
    void loadSatForSample(sample);
    try {
      const frame = await loadCachedRadar(sample, product, {
        tiltMode,
        onProgress: (p) => {
          if (token === loadToken) updateRadarHud(hud, hudPayload({ loading: p }));
        },
      });
      if (token !== loadToken) return;
      loadedKey = frameKey;
      showRadarFrame(frame, sample);
      updateRadarHud(hud, hudPayload());
      prefetchAhead(sample);
      syncShareUrl();
    } catch (err) {
      if (token !== loadToken) return;
      loadedKey = "";
      updateRadarHud(hud, hudPayload({ error: err.message || String(err) }));
      syncShareUrl();
    }
  }

  function applySatFrame(frame, key) {
    satLoadedKey = key || satFrameKey(satProduct, frame.timeMs, frame.satId);
    satValidMs = frame.timeMs;
    satValidSatId = frame.satId || 0;
    satError = false;
    satLoading = false;
    satInflightKey = "";
    showSatFrame(frame);
    updateRadarHud(hud, hudPayload());
  }

  async function loadSatForSample(sample, { reload = false } = {}) {
    if (!satProduct || !sample) return;
    const satId = pickGoesSat(sample.timeMs, sample.lon);
    const key = satFrameKey(satProduct, sample.timeMs, satId);
    if (!reload && key && key === satLoadedKey) return;
    if (!reload && key && key === satInflightKey) return;
    const cached = !reload && getCachedSatFrame(satProduct, sample.timeMs, { lon: sample.lon, satId });
    if (cached) {
      applySatFrame(cached, key);
      return;
    }
    const token = ++satLoadToken;
    satInflightKey = key;
    satValidMs = nearestSatTimeMs(sample.timeMs);
    satValidSatId = satId;
    satError = false;
    satLoading = true;
    updateRadarHud(hud, hudPayload());
    try {
      const frame = await loadSatFrame(satProduct, sample.timeMs, {
        lon: sample.lon,
        bbox: satBbox,
      });
      if (token !== satLoadToken) return;
      applySatFrame(frame, key);
      syncShareUrl();
    } catch (err) {
      if (token !== satLoadToken || err?.name === "AbortError") return;
      satLoadedKey = "";
      satInflightKey = "";
      satError = true;
      satLoading = false;
      updateRadarHud(hud, hudPayload());
    }
  }

  function startSatPrefetch() {
    satPrefetchAbort?.abort();
    satPrefetchAbort = new AbortController();
    if (!satProduct) return;
    const samples = playableSamples(summary?.samples || []);
    prefetchSatFrames(satProduct, samples, {
      signal: satPrefetchAbort.signal,
      bbox: satBbox,
      fromTimeMs: selected?.timeMs,
    }).catch(() => {});
  }

  function prefetchAhead(fromSample) {
    const samples = playableSamples(summary?.samples || []);
    const i = Math.max(0, playIndexOf(samples, fromSample));
    prefetchPlayFrames(samples.slice(i, i + 16), product, {
      concurrency: defaultConcurrency("decode"),
      tiltMode,
      signal: prefetchAbort?.signal,
    }).catch(() => {});
  }

  function startPrefetch() {
    prefetchAbort?.abort();
    prefetchAbort = new AbortController();
    const samples = playableSamples(summary?.samples || []);
    const signal = prefetchAbort.signal;
    prefetchPlayFrames(samples, product, {
      concurrency: defaultConcurrency("decode"),
      tiltMode,
      signal,
      onProgress: ({ done, total }) => {
        if (signal.aborted) return;
        cacheText = done < total ? `Cached ${done}/${total} scans` : "Scans cached";
        syncSlider();
      },
    }).catch(() => {});
  }

  async function run({ restore, focusHeadline = false } = {}) {
    runAbort?.abort();
    prefetchAbort?.abort();
    const token = ++runToken;
    const ac = new AbortController();
    runAbort = ac;
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
      tilt: tiltMode,
      sat: satProduct,
    });
    setResultsVisible(false);
    stopPlayback();
    summary = null;
    meta = null;
    selected = null;
    loadedKey = "";
    satLoadedKey = "";
    satValidMs = NaN;
    satValidSatId = 0;
    satBbox = null;
    satError = false;
    satLoading = false;
    satLoadToken += 1;
    satInflightKey = "";
    satPrefetchAbort?.abort();
    cacheText = "";
    setPlayButtons(false, false);
    clearFrameCache();
    clearSatCache();
    clearRadar();
    clearSat();
    updateRadarHud(hud, {});
    setStatus(status, "", "");
    setProgress(progress, { text: "Looking up flight track…" });

    try {
      let points = [];
      meta = { notes: [] };
      if (file) {
        if (file.size > MAX_TRACK_BYTES) throw new Error("Track file is too large (8 MB max).");
        const text = await file.text();
        if (token !== runToken) return;
        points = parseTrackFile(file.name, text);
        meta = { source: "upload", notes: [`Loaded ${points.length} points from ${file.name}`] };
      } else {
        if (!flight || !dateClean) throw new Error("Enter a flight number and date, or upload a track.");
        setProgress(progress, { text: `Fetching public track for ${flight}…` });
        const found = await lookupFlightTrack({ flight, dateClean, hex, signal: ac.signal });
        if (token !== runToken) return;
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

      const next = await analyzeTrack(points, {
        signal: ac.signal,
        onProgress: (p) => {
          if (token === runToken) setProgress(progress, p);
        },
      });
      if (token !== runToken) return;
      summary = next;
      satBbox = satBoundsFromSamples(summary.samples);
      if (satProduct) startSatPrefetch();
      hideProgress(progress);
      if (summary.emptyReason || !summary.samples.some((s) => s.s3Key)) {
        const emptyText = {
          outside_conus: "Track is outside CONUS NEXRAD coverage.",
          list_failed: "Could not list NEXRAD scans. Check your connection and try Analyze again.",
          no_scans: "No Level II scans were found near those times.",
          ingest_failed: summary.emptyDetail
            ? `Radar volumes downloaded but decode failed: ${summary.emptyDetail}`
            : "Radar volumes were found but could not be decoded. Try Analyze again.",
        };
        setStatus(status, emptyText[summary.emptyReason] || emptyText.no_scans, "error");
        return;
      }
      const event = focusHeadline ? headlineEvent(summary) : null;
      if (event?.sample) setSeriesViewAround(summary.samples, event.sample.timeMs);
      refreshView();
      setResultsVisible(true);
      startPrefetch();
      const extra = [];
      if (summary.ingestFailedCount) extra.push(`${summary.ingestFailedCount} volumes failed to decode.`);
      if (summary.listErrors) extra.push(`${summary.listErrors} radar listings failed.`);
      if (summary.volumeCapped) extra.push("Volume count was capped after the stride limit.");
      setStatus(status, `Analyzed ${summary.samples.filter((s) => s.s3Key).length} samples across ${summary.sites.length} radars. Play flight or drag the slider to scrub.${extra.length ? ` ${extra.join(" ")}` : ""}`, extra.length ? "warn" : "ok");
      if (event?.sample) {
        await selectSample(event.sample, { zoom: true, product: event.product });
        return;
      }
      await restoreShare(restore);
    } catch (err) {
      if (token !== runToken || err?.name === "AbortError") return;
      hideProgress(progress);
      setStatus(status, err.message || String(err), "error");
    }
  }
}

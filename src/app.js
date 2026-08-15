import { EXAMPLE_FLIGHT } from "./adsb/ident.js";
import { lookupFlightTrack } from "./adsb/lookup.js";
import { parseTrackFile } from "./adsb/parseTrack.js";
import { loadRadarForSample } from "./analysis/loadRadar.js";
import { analyzeTrack } from "./analysis/run.js";
import { cleanToDateInput, dateInputToClean } from "./analysis/geo.js";
import { clearRadar, highlightSample, initMap, renderTrack, showRadarFrame } from "./ui/map.js";
import { hideProgress, renderReport, setProgress, setStatus, updateRadarHud } from "./ui/render.js";

const $ = (id) => document.getElementById(id);

function readParams() {
  const q = new URLSearchParams(window.location.search);
  return {
    flight: q.get("flight") || "",
    date: q.get("date") || "",
    hex: q.get("hex") || "",
  };
}

function writeParams({ flight, date, hex }) {
  const q = new URLSearchParams();
  if (flight) q.set("flight", flight);
  if (date) q.set("date", date);
  if (hex) q.set("hex", hex);
  const next = `${window.location.pathname}${q.toString() ? `?${q}` : ""}${window.location.hash}`;
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

  hud.querySelectorAll("[data-product]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      product = btn.dataset.product;
      if (selected) await selectSample(selected, { reload: true });
    });
  });
  $("clear-radar").addEventListener("click", () => {
    clearRadar();
    selected = null;
    updateRadarHud(hud, {});
    if (summary) refreshView();
  });

  if (params.flight && params.date) run();

  function refreshView() {
    renderReport(report, summary, meta, { onSelect: (sample) => selectSample(sample), selected });
    renderTrack(summary, { onSelect: (sample) => selectSample(sample), selected });
  }

  async function selectSample(sample, { reload = false } = {}) {
    if (!sample) return;
    const same = selected && selected.timeMs === sample.timeMs && selected.s3Key === sample.s3Key
      && selected.elevation === sample.elevation;
    selected = sample;
    highlightSample(sample);
    if (summary) {
      renderReport(report, summary, meta, { onSelect: (next) => selectSample(next), selected });
    }
    if (same && !reload) return;
    const token = ++loadToken;
    updateRadarHud(hud, { sample, product, loading: { text: `Loading ${sample.stationId}…` } });
    try {
      const frame = await loadRadarForSample(sample, product, {
        onProgress: (p) => {
          if (token === loadToken) updateRadarHud(hud, { sample, product, loading: p });
        },
      });
      if (token !== loadToken) return;
      showRadarFrame(frame, sample);
      updateRadarHud(hud, { sample, product });
    } catch (err) {
      if (token !== loadToken) return;
      updateRadarHud(hud, { sample, product, error: err.message || String(err) });
    }
  }

  async function run() {
    const flight = $("flight").value.trim();
    const dateClean = dateInputToClean($("date").value);
    const hex = $("hex").value.trim();
    const file = $("track-file").files[0];
    writeParams({ flight, date: dateClean, hex });
    report.hidden = true;
    selected = null;
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
      setStatus(status, `Analyzed ${summary.samples.length} samples across ${summary.sites.length} radars. Click a peak or the time series to load that scan.`, "ok");
    } catch (err) {
      hideProgress(progress);
      setStatus(status, err.message || String(err), "error");
    }
  }
}

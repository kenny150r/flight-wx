import { EXAMPLE_FLIGHT } from "./adsb/ident.js";
import { lookupFlightTrack } from "./adsb/lookup.js";
import { parseTrackFile } from "./adsb/parseTrack.js";
import { analyzeTrack } from "./analysis/run.js";
import { cleanToDateInput, dateInputToClean } from "./analysis/geo.js";
import { initMap, renderTrack } from "./ui/map.js";
import { hideProgress, renderReport, setProgress, setStatus } from "./ui/render.js";

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
  const mapEl = $("map");
  initMap(mapEl);

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

  if (params.flight && params.date) run();

  async function run() {
    const flight = $("flight").value.trim();
    const dateClean = dateInputToClean($("date").value);
    const hex = $("hex").value.trim();
    const file = $("track-file").files[0];
    writeParams({ flight, date: dateClean, hex });
    report.hidden = true;
    setStatus(status, "", "");
    setProgress(progress, { text: "Looking up flight track…" });

    try {
      let points = [];
      let meta = { notes: [] };
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

      const summary = await analyzeTrack(points, {
        onProgress: (p) => setProgress(progress, p),
      });
      hideProgress(progress);
      if (!summary.samples.length) {
        setStatus(status, "Track is outside CONUS NEXRAD coverage, or no Level II scans were found near those times.", "error");
        return;
      }
      renderReport(report, summary, meta);
      renderTrack(summary);
      setStatus(status, `Analyzed ${summary.samples.length} samples across ${summary.sites.length} radars.`, "ok");
    } catch (err) {
      hideProgress(progress);
      setStatus(status, err.message || String(err), "error");
    }
  }
}

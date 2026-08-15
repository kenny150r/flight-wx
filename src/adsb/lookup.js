import { EXAMPLE_FLIGHT, identCandidates, isExampleFlight, normalizeHex, normalizeIdent } from "./ident.js";
import { parseCsvTrack, parseReadsbTrace } from "./parseTrack.js";

const LIVE_ENDPOINTS = [
  (id) => `https://api.adsb.lol/v2/callsign/${encodeURIComponent(id)}`,
  (id) => `https://api.adsb.fi/v2/callsign/${encodeURIComponent(id)}`,
  (id) => `https://api.airplanes.live/v2/callsign/${encodeURIComponent(id)}`,
];

const TRACE_HOSTS = [
  "https://globe.adsb.lol",
  "https://globe.adsb.fi",
];

function isToday(dateClean) {
  const now = new Date();
  const today = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  return dateClean === today;
}

async function fetchJson(url, { signal } = {}) {
  const resp = await fetch(url, { signal });
  if (!resp.ok) throw new Error(`${resp.status} ${url}`);
  const buf = new Uint8Array(await resp.arrayBuffer());
  let text;
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const { gunzipSync } = await import("fflate");
    text = new TextDecoder().decode(gunzipSync(buf));
  } else {
    text = new TextDecoder().decode(buf);
  }
  return JSON.parse(text);
}

async function fetchRoute(callsign, { signal } = {}) {
  try {
    const json = await fetchJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(callsign)}`, { signal });
    const route = json?.response?.flightroute;
    if (!route) return null;
    return {
      origin: route.origin?.icao_code || route.origin?.iata_code || null,
      destination: route.destination?.icao_code || route.destination?.iata_code || null,
      airline: route.airline?.name || null,
    };
  } catch {
    return null;
  }
}

async function fetchLiveAircraft(candidates, { signal } = {}) {
  for (const id of candidates) {
    for (const makeUrl of LIVE_ENDPOINTS) {
      try {
        const json = await fetchJson(makeUrl(id), { signal });
        const ac = json.ac?.[0] || json.aircraft?.[0];
        if (ac?.hex && Number.isFinite(ac.lat) && Number.isFinite(ac.lon)) {
          return {
            hex: String(ac.hex).toLowerCase(),
            flight: String(ac.flight || id).trim(),
            lat: ac.lat,
            lon: ac.lon,
            altFt: Number(ac.alt_baro === "ground" ? 0 : ac.alt_baro || ac.alt_geom || 0),
            headingDeg: Number(ac.track ?? ac.true_heading ?? ac.mag_heading),
            gsKt: Number(ac.gs),
            vsFpm: Number(ac.baro_rate ?? ac.geom_rate),
            tasKt: Number(ac.tas),
            iasKt: Number(ac.ias),
            timeMs: Date.now() - Math.round((Number(ac.seen) || 0) * 1000),
          };
        }
      } catch {
        // try next host
      }
    }
  }
  return null;
}

function traceUrls(hex, dateClean) {
  const last2 = hex.slice(-2);
  const y = dateClean.slice(0, 4);
  const m = dateClean.slice(4, 6);
  const d = dateClean.slice(6, 8);
  const urls = [];
  for (const host of TRACE_HOSTS) {
    urls.push(`${host}/globe_history/${y}/${m}/${d}/traces/${last2}/trace_full_${hex}.json`);
    if (isToday(dateClean)) {
      urls.push(`${host}/data/traces/${last2}/trace_full_${hex}.json`);
    }
  }
  return urls;
}

async function fetchTrace(hex, dateClean, callsign, { signal } = {}) {
  for (const url of traceUrls(hex, dateClean)) {
    try {
      const json = await fetchJson(url, { signal });
      const points = parseReadsbTrace(json, { callsign });
      if (points.length) return { points, source: url };
    } catch {
      // CORS or missing file
    }
  }
  return null;
}

export async function lookupFlightTrack({ flight, dateClean, hex, signal } = {}) {
  const callsign = normalizeIdent(flight);
  const candidates = identCandidates(flight);
  const hexNorm = normalizeHex(hex);
  const notes = [];
  const route = callsign ? await fetchRoute(callsign, { signal }) : null;

  if (hexNorm) {
    const traced = await fetchTrace(hexNorm, dateClean, callsign, { signal });
    if (traced) {
      return {
        points: traced.points,
        callsign,
        hex: hexNorm,
        route,
        source: "globe-history",
        notes,
      };
    }
    notes.push("No globe-history trace for that hex (CORS or missing day).");
  }

  if (isToday(dateClean)) {
    const live = await fetchLiveAircraft(candidates, { signal });
    if (live) {
      const traced = await fetchTrace(live.hex, dateClean, callsign || live.flight, { signal });
      if (traced) {
        return {
          points: traced.points,
          callsign: callsign || normalizeIdent(live.flight),
          hex: live.hex,
          route,
          source: "live+trace",
          notes,
        };
      }
      if (isToday(dateClean)) {
        notes.push("Live position found, but no full trace. Upload a track for a complete path.");
        return {
          points: [{
            timeMs: live.timeMs,
            lat: live.lat,
            lon: live.lon,
            altFt: live.altFt,
            headingDeg: live.headingDeg,
            gsKt: live.gsKt,
            vsFpm: live.vsFpm,
            tasKt: live.tasKt,
            iasKt: live.iasKt,
          }],
          callsign: callsign || normalizeIdent(live.flight),
          hex: live.hex,
          route,
          source: "live-point",
          notes,
        };
      }
    }
  }

  if (isExampleFlight(flight, dateClean)) {
    const bundled = await loadBundledExampleTrack();
    if (bundled.length) {
      return {
        points: bundled,
        callsign: "EDV4985",
        hex: hexNorm || null,
        route: route || {
          origin: "KJFK",
          destination: "KCVG",
          airline: "Endeavor Air",
        },
        source: "example-track",
        notes: [
          "Using the bundled Endeavor 4985 / 17 Jul 2025 JFK–CVG example track (public historical ADS-B was not available).",
          "Path is representative. Times are UTC, aligned to the NTSB encounter at 10:53 EDT (14:53Z) near 18,000 ft on descent (DCA25LA272 / N330PQ).",
        ],
      };
    }
  }

  return {
    points: [],
    callsign,
    hex: hexNorm || null,
    route,
    source: null,
    notes: notes.length ? notes : ["Could not find a public track for this flight and date."],
  };
}

export async function loadBundledExampleTrack() {
  const url = `${import.meta.env.BASE_URL}${EXAMPLE_FLIGHT.trackUrl}`;
  const resp = await fetch(url);
  if (!resp.ok) return [];
  return parseCsvTrack(await resp.text());
}

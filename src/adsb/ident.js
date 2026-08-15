import { IATA_TO_ICAO } from "./airlines.js";

/** Known marketed vs operating callsigns. Endeavor 4985 is sold as Delta 4985. */
const EXTRA_CALLSIGNS = {
  EDV4985: ["9E4985", "DL4985", "DAL4985"],
  "9E4985": ["EDV4985", "DL4985", "DAL4985"],
  DL4985: ["EDV4985", "9E4985"],
  DAL4985: ["EDV4985", "9E4985"],
};

export const EXAMPLE_FLIGHT = {
  flight: "EDV4985",
  dateClean: "20250717",
  dateInput: "2025-07-17",
  label: "Endeavor 4985 · 17 Jul 2025",
  detail: "JFK–CVG (Delta Connection)",
  trackUrl: "examples/edv4985-20250717.csv",
};

export function normalizeIdent(raw) {
  const s = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
  if (!s) return "";
  const m = s.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  if (m && IATA_TO_ICAO[m[1]]) return `${IATA_TO_ICAO[m[1]]}${m[2]}`;
  return s;
}

export function identCandidates(raw) {
  const original = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
  const normalized = normalizeIdent(raw);
  const out = [];
  for (const id of [normalized, original, ...(EXTRA_CALLSIGNS[normalized] || []), ...(EXTRA_CALLSIGNS[original] || [])]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function isExampleFlight(flight, dateClean) {
  const ids = new Set(identCandidates(flight));
  return dateClean === EXAMPLE_FLIGHT.dateClean && (ids.has("EDV4985") || ids.has("9E4985"));
}

export function normalizeHex(raw) {
  const hex = String(raw || "").trim().toLowerCase().replace(/^~/, "");
  if (!/^[0-9a-f]{6}$/.test(hex)) return "";
  return hex;
}

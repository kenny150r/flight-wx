import { IATA_TO_ICAO } from "./airlines.js";

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
  for (const id of [normalized, original]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function normalizeHex(raw) {
  const hex = String(raw || "").trim().toLowerCase().replace(/^~/, "");
  if (!/^[0-9a-f]{6}$/.test(hex)) return "";
  return hex;
}

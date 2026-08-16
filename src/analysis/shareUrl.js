import { isCleanDate } from "./geo.js";
import { parseSatProduct } from "../sat/iemGoes.js";

export function parseShareSearch(search = "") {
  const q = new URLSearchParams(String(search || "").replace(/^\?/, ""));
  const frame = Number.parseInt(q.get("frame") || "", 10);
  const rawDate = (q.get("date") || "").replace(/-/g, "");
  return {
    flight: q.get("flight") || "",
    date: isCleanDate(rawDate) ? rawDate : "",
    hex: q.get("hex") || "",
    frame: Number.isFinite(frame) && frame >= 1 ? frame : 0,
    play: q.get("play") === "1",
    tilt: q.get("tilt") === "base" ? "base" : "closest",
    sat: parseSatProduct(q.get("sat")),
  };
}

export function buildShareSearch({ flight, date, hex, frame, play, tilt, sat } = {}) {
  const q = new URLSearchParams();
  if (flight) q.set("flight", flight);
  if (date) q.set("date", date);
  if (hex) q.set("hex", hex);
  if (Number.isFinite(frame) && frame >= 1) q.set("frame", String(Math.floor(frame)));
  if (play) q.set("play", "1");
  if (tilt === "base") q.set("tilt", "base");
  if (sat === "ir" || sat === "vis") q.set("sat", sat);
  return q.toString();
}

export function clampShareFrame(frame, total) {
  if (!total || !Number.isFinite(frame) || frame < 1) return 0;
  return Math.min(Math.floor(frame), total);
}

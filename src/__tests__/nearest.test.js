import { describe, expect, it } from "vitest";
import { findNearestStation } from "../analysis/nearest.js";
import { resampleTrack } from "../analysis/resample.js";

const stations = [
  { id: "KTLX", lat: 35.333, lon: -97.278 },
  { id: "KFWS", lat: 32.573, lon: -97.303 },
];

describe("nearest station", () => {
  it("picks Oklahoma City for a nearby point", () => {
    const found = findNearestStation(35.4, -97.2, stations);
    expect(found.station.id).toBe("KTLX");
    expect(found.km).toBeLessThan(20);
  });

  it("returns null far offshore", () => {
    expect(findNearestStation(25, -50, stations)).toBeNull();
  });
});

describe("resample", () => {
  it("keeps endpoints and altitude breaks", () => {
    const start = Date.UTC(2013, 4, 20, 19, 0, 0);
    const points = [
      { timeMs: start, lat: 35, lon: -97, altFt: 1000 },
      { timeMs: start + 20000, lat: 35.01, lon: -97, altFt: 1100 },
      { timeMs: start + 40000, lat: 35.02, lon: -97, altFt: 3000 },
      { timeMs: start + 180000, lat: 35.1, lon: -97, altFt: 3100 },
    ];
    const out = resampleTrack(points, 60);
    expect(out[0]).toBe(points[0]);
    expect(out[out.length - 1]).toBe(points[3]);
    expect(out.some((p) => p.altFt === 3000)).toBe(true);
  });
});

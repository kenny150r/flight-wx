import { describe, expect, it } from "vitest";
import { enrichFlightState, flightLevel, formatFlightState } from "../analysis/flightState.js";

describe("flightState", () => {
  it("formats flight level", () => {
    expect(flightLevel(34000)).toBe("FL340");
    expect(flightLevel(850)).toBe("FL009");
  });

  it("derives heading, ground speed, and vertical speed from the path", () => {
    const t0 = Date.UTC(2025, 6, 17, 13, 0, 0);
    const points = enrichFlightState([
      { timeMs: t0, lat: 35, lon: -97, altFt: 10000 },
      { timeMs: t0 + 60000, lat: 35.1, lon: -97, altFt: 12000 },
    ]);
    expect(points[0].headingDeg).toBeCloseTo(0, 0);
    expect(points[0].gsKt).toBeGreaterThan(300);
    expect(points[0].vsFpm).toBeCloseTo(2000, 0);
    expect(points[0].flightLevel).toBe("FL100");
    expect(points[0].phase).toBe("climb");
  });

  it("keeps reported heading and speed when present", () => {
    const t0 = Date.UTC(2025, 6, 17, 13, 0, 0);
    const [point] = enrichFlightState([
      { timeMs: t0, lat: 35, lon: -97, altFt: 34000, headingDeg: 247, gsKt: 438, vsFpm: -50 },
      { timeMs: t0 + 60000, lat: 35.1, lon: -97, altFt: 34000 },
    ]);
    expect(point.headingDeg).toBe(247);
    expect(point.gsKt).toBe(438);
    expect(point.vsFpm).toBe(-50);
    expect(point.phase).toBe("cruise");
  });

  it("formats a clickable flight-state summary", () => {
    const text = formatFlightState({
      altFt: 34012,
      headingDeg: 247.4,
      gsKt: 438.2,
      vsFpm: -180,
      phase: "cruise",
    });
    expect(text).toContain("FL340");
    expect(text).toContain("HDG 247°");
    expect(text).toContain("438 kt GS");
    expect(text).toContain("-180 fpm");
  });
});

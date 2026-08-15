import { describe, expect, it } from "vitest";
import { bearingDeg, haversineKm, utcDateClean, wrapDeg } from "../analysis/geo.js";

describe("geo", () => {
  it("haversine is zero at the same point", () => {
    expect(haversineKm(35.2, -97.1, 35.2, -97.1)).toBeCloseTo(0, 6);
  });

  it("haversine matches a known short distance", () => {
    const km = haversineKm(35.333, -97.278, 35.4, -97.2);
    expect(km).toBeGreaterThan(9);
    expect(km).toBeLessThan(12);
  });

  it("bearing north is near 0", () => {
    expect(bearingDeg(35, -97, 36, -97)).toBeCloseTo(0, 0);
  });

  it("wraps azimuths", () => {
    expect(wrapDeg(-10)).toBeCloseTo(350, 5);
    expect(wrapDeg(370)).toBeCloseTo(10, 5);
  });

  it("formats UTC dates", () => {
    expect(utcDateClean(Date.UTC(2013, 4, 20, 19, 51, 11))).toBe("20130520");
  });
});

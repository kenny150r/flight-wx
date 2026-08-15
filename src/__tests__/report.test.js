import { describe, expect, it } from "vitest";
import { summarizeSamples } from "../analysis/report.js";

describe("summarizeSamples", () => {
  it("tracks max horizontal and vertical shear separately", () => {
    const samples = [
      {
        timeMs: 1, lat: 40, lon: -74, stationId: "KOKX",
        dbz: 10, nearbyDbz: 12, vrMs: 5, nearbyVrMs: 6,
        horizShearS: 0.001, azShearS: 0.001, vertShearS: 0.008, radialShearS: 0.0005,
      },
      {
        timeMs: 2, lat: 39, lon: -84, stationId: "KILN",
        dbz: 20, nearbyDbz: 22, vrMs: -15, nearbyVrMs: -16,
        horizShearS: 0.004, azShearS: 0.004, vertShearS: 0.001, radialShearS: 0.0008,
      },
    ];
    const summary = summarizeSamples(samples, { trackCount: 2, volumeCount: 1, bytes: 0 });
    expect(summary.maxHorizShear.sample.stationId).toBe("KILN");
    expect(summary.maxHorizShear.ktPerKm).toBeGreaterThan(0);
    expect(summary.maxVertShear.sample.stationId).toBe("KOKX");
    expect(summary.maxVertShear.ktPer1000Ft).toBeGreaterThan(0);
  });
});

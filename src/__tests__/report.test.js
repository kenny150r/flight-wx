import { describe, expect, it } from "vitest";
import { headlineEvent, summarizeSamples } from "../analysis/report.js";

describe("summarizeSamples", () => {
  it("tracks max horizontal and vertical shear separately", () => {
    const samples = [
      {
        timeMs: 1, lat: 40, lon: -74, stationId: "KOKX",
        dbz: 10, nearbyDbz: 12, meanDbz: 11, compositeDbz: 41, nearbyCompositeDbz: 44, vrMs: 5, nearbyVrMs: 6,
        horizShearS: 0.001, azShearS: 0.001, vertShearS: 0.008, radialShearS: 0.0005,
      },
      {
        timeMs: 2, lat: 39, lon: -84, stationId: "KILN",
        dbz: 20, nearbyDbz: 22, meanDbz: 18, compositeDbz: 25, nearbyCompositeDbz: 28, vrMs: -15, nearbyVrMs: -16,
        horizShearS: 0.004, azShearS: 0.004, vertShearS: 0.001, radialShearS: 0.0008,
      },
    ];
    const summary = summarizeSamples(samples, { trackCount: 2, volumeCount: 1, bytes: 0 });
    expect(summary.maxHorizShear.sample.stationId).toBe("KILN");
    expect(summary.maxHorizShear.ktPerKm).toBeGreaterThan(0);
    expect(summary.maxVertShear.sample.stationId).toBe("KOKX");
    expect(summary.maxVertShear.ktPer1000Ft).toBeGreaterThan(0);
    expect(summary.maxDbz.sample.stationId).toBe("KILN");
    expect(summary.maxCompositeDbz.sample.stationId).toBe("KOKX");
    expect(summary.maxCompositeDbz.value).toBe(41);
    expect(summary.maxMeanDbz.sample.stationId).toBe("KILN");
    expect(summary.maxMeanDbz.value).toBe(18);
  });

  it("picks strong reflectivity over weak shear as the headline event", () => {
    const summary = summarizeSamples([
      {
        timeMs: 1, lat: 35, lon: -86, stationId: "KOHX",
        dbz: 58, compositeDbz: 62, vrMs: 4,
        horizShearS: 0.001, azShearS: 0.001, vertShearS: 0.001, radialShearS: 0.001,
      },
      {
        timeMs: 2, lat: 35, lon: -87, stationId: "KHPX",
        dbz: 12, compositeDbz: 14, vrMs: 6,
        horizShearS: 0.002, azShearS: 0.002, vertShearS: 0.001, radialShearS: 0.001,
      },
    ]);
    const event = headlineEvent(summary);
    expect(event.sample.stationId).toBe("KOHX");
    expect(event.product).toBe("reflectivity");
  });

  it("picks strong shear when reflectivity is weak", () => {
    const summary = summarizeSamples([
      {
        timeMs: 1, lat: 40, lon: -112, stationId: "KMTX",
        dbz: 8, compositeDbz: 10, vrMs: 3,
        horizShearS: 0.012, azShearS: 0.012, vertShearS: 0.002, radialShearS: 0.002,
      },
      {
        timeMs: 2, lat: 40, lon: -111, stationId: "KICX",
        dbz: 14, compositeDbz: 16, vrMs: 5,
        horizShearS: 0.001, azShearS: 0.001, vertShearS: 0.001, radialShearS: 0.001,
      },
    ]);
    const event = headlineEvent(summary);
    expect(event.sample.stationId).toBe("KMTX");
    expect(event.product).toBe("velocity");
  });
});

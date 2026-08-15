import { describe, expect, it } from "vitest";
import { beamHeightM, pickBestTilt } from "../analysis/beam.js";

describe("beam", () => {
  it("0.5° beam at 100 km is a few km AGL", () => {
    const h = beamHeightM(100000, 0.5, 300);
    expect(h).toBeGreaterThan(1000);
    expect(h).toBeLessThan(2500);
  });

  it("picks the tilt closest to cruise altitude", () => {
    const sweeps = [
      { elevation: 0.5 },
      { elevation: 1.5 },
      { elevation: 3.1 },
      { elevation: 6.0 },
    ];
    const picked = pickBestTilt(sweeps, 150000, 10668, 300);
    expect(picked.sweep.elevation).toBe(3.1);
    expect(picked.lowConfidence).toBe(false);
  });

  it("flags a beam miss when every tilt is far from the aircraft", () => {
    const picked = pickBestTilt([{ elevation: 0.5 }], 20000, 10668, 300);
    expect(picked.lowConfidence).toBe(true);
  });
});

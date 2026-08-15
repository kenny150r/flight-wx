import { describe, expect, it } from "vitest";
import { beamHeightM } from "../analysis/beam.js";
import { computeShear, computeVerticalShear, shearToKtPer1000Ft, shearToKtPerKm, verticalFromRadial } from "../analysis/shear.js";

function velSweep(fill, numGates = 20) {
  const numAz = 8;
  const values = new Float32Array(numAz * numGates);
  const azimuths = [];
  for (let i = 0; i < numAz; i++) {
    azimuths.push(i * 45);
    for (let g = 0; g < numGates; g++) {
      values[i * numGates + g] = fill == null ? g * 2 + i : fill;
    }
  }
  return {
    azimuths,
    values,
    numGates,
    rangeStart: 0,
    rangeStep: 1000,
  };
}

describe("shear", () => {
  it("computes radial shear from a range gradient", () => {
    const { radialS } = computeShear(velSweep(), 0, 10000, 2000);
    expect(radialS).toBeCloseTo(0.002, 3);
  });

  it("converts s^-1 to kt/km and kt/1000 ft", () => {
    expect(shearToKtPerKm(0.001)).toBeCloseTo(1.9438, 3);
    expect(shearToKtPer1000Ft(0.001)).toBeCloseTo(0.5925, 3);
  });

  it("computes vertical shear from neighboring tilts at the aircraft", () => {
    const rangeM = 100000;
    const radarAltM = 300;
    const z0 = beamHeightM(rangeM, 1.5, radarAltM);
    const z1 = beamHeightM(rangeM, 3.1, radarAltM);
    const { verticalS } = computeVerticalShear([
      { elevation: 1.5, velocity: velSweep(10, 200) },
      { elevation: 3.1, velocity: velSweep(20, 200) },
    ], 0, rangeM, radarAltM, (z0 + z1) / 2);
    expect(verticalS).toBeCloseTo(10 / (z1 - z0), 6);
  });

  it("projects along-beam radial shear into the vertical when slope is usable", () => {
    expect(verticalFromRadial(0.002, 100000, 3.1)).toBeGreaterThan(0.002);
    expect(Number.isNaN(verticalFromRadial(0.002, 5000, 0.05))).toBe(true);
  });
});

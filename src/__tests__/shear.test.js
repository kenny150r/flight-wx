import { describe, expect, it } from "vitest";
import { computeShear, shearToKtPerKm } from "../analysis/shear.js";

function velSweep() {
  const numAz = 8;
  const numGates = 20;
  const values = new Float32Array(numAz * numGates);
  const azimuths = [];
  for (let i = 0; i < numAz; i++) {
    azimuths.push(i * 45);
    for (let g = 0; g < numGates; g++) {
      values[i * numGates + g] = g * 2 + i;
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

  it("converts s^-1 to kt/km", () => {
    expect(shearToKtPerKm(0.001)).toBeCloseTo(1.9438, 3);
  });
});

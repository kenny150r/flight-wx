import { describe, expect, it } from "vitest";
import { neighborhoodMaxAbs, samplePolar } from "../analysis/polar.js";
import { sampleExtractedVolume } from "../analysis/sample.js";

function grid({ value = 30, spike, numGates = 8 } = {}) {
  const numAz = 4;
  const values = new Float32Array(numAz * numGates);
  values.fill(value);
  if (spike) values[spike.az * numGates + spike.gate] = spike.value;
  return {
    azimuths: [0, 90, 180, 270],
    values,
    numGates,
    rangeStart: 0,
    rangeStep: 1000,
  };
}

describe("polar sample", () => {
  it("reads a uniform field", () => {
    expect(samplePolar(grid({ value: 41 }), 0, 1500)).toBeCloseTo(41, 5);
  });

  it("returns NaN past the last gate", () => {
    expect(Number.isNaN(samplePolar(grid(), 0, 20000))).toBe(true);
  });

  it("finds a nearby spike", () => {
    const sweep = grid({ value: 10, spike: { az: 0, gate: 2, value: 55 } });
    expect(neighborhoodMaxAbs(sweep, 0, 2000, 1500, false)).toBeCloseTo(55, 5);
  });
});

describe("sampleExtractedVolume", () => {
  it("samples reflectivity at a point east of the radar", () => {
    const ref = grid({ value: 28 });
    const vel = grid({ value: 12 });
    const extracted = {
      lat: 35,
      lon: -97,
      altM: 300,
      stationId: "KTLX",
      sweeps: [{ elevation: 2.4, reflectivity: ref, velocity: vel }],
    };
    const samples = sampleExtractedVolume(extracted, [{
      timeMs: Date.UTC(2013, 4, 20, 19, 51, 0),
      lat: 35,
      lon: -96.99,
      altFt: 2000,
      station: { id: "KTLX" },
    }]);
    expect(samples).toHaveLength(1);
    expect(samples[0].dbz).toBeCloseTo(28, 5);
    expect(samples[0].vrMs).toBeCloseTo(12, 5);
    expect(samples[0].stationId).toBe("KTLX");
    expect(samples[0].horizShearS).toBe(samples[0].azShearS);
    expect(samples[0].compositeDbz).toBeCloseTo(28, 5);
    expect(samples[0].compositeElevation).toBe(2.4);
  });

  it("takes composite reflectivity from the strongest tilt in the column", () => {
    const extracted = {
      lat: 35,
      lon: -97,
      altM: 300,
      stationId: "KTLX",
      sweeps: [
        { elevation: 0.5, reflectivity: grid({ value: 22, numGates: 80 }), velocity: grid({ value: 5, numGates: 80 }) },
        { elevation: 6.4, reflectivity: grid({ value: 48, numGates: 80 }), velocity: grid({ value: 5, numGates: 80 }) },
      ],
    };
    const samples = sampleExtractedVolume(extracted, [{
      timeMs: Date.UTC(2013, 4, 20, 19, 51, 0),
      lat: 35,
      lon: -96.5,
      altFt: 2000,
      station: { id: "KTLX" },
    }]);
    expect(samples[0].dbz).toBeCloseTo(22, 5);
    expect(samples[0].compositeDbz).toBeCloseTo(48, 5);
    expect(samples[0].compositeElevation).toBe(6.4);
  });

  it("uses neighboring tilts for vertical shear", () => {
    const extracted = {
      lat: 35,
      lon: -97,
      altM: 300,
      stationId: "KTLX",
      sweeps: [
        { elevation: 1.5, reflectivity: grid({ value: 20, numGates: 80 }), velocity: grid({ value: 5, numGates: 80 }) },
        { elevation: 3.1, reflectivity: grid({ value: 20, numGates: 80 }), velocity: grid({ value: 15, numGates: 80 }) },
      ],
    };
    const samples = sampleExtractedVolume(extracted, [{
      timeMs: Date.UTC(2013, 4, 20, 19, 51, 0),
      lat: 35,
      lon: -96.5,
      altFt: 8000,
      station: { id: "KTLX" },
    }]);
    expect(samples[0].vertShearS).toBeGreaterThan(0);
  });
});

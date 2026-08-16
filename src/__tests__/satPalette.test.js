import { describe, expect, it } from "vitest";
import { irColor, satRgba } from "../sat/satPalette.js";

describe("satPalette", () => {
  it("leaves missing gates transparent", () => {
    const rgba = satRgba([0, 80], "vis", new Uint8ClampedArray(8));
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(Array.from(rgba.slice(4))).toEqual([80, 80, 80, 255]);
  });

  it("colorizes colder IR values and keeps warm values gray", () => {
    const warm = irColor(70);
    expect(warm[0]).toBe(warm[1]);
    expect(warm[1]).toBe(warm[2]);
    const cold = irColor(210);
    expect(cold[0]).toBeGreaterThan(200);
    expect(cold[2]).toBeGreaterThan(100);
    const rgba = satRgba([210], "ir", new Uint8ClampedArray(4));
    expect(rgba[3]).toBe(255);
    expect(rgba[0]).not.toBe(rgba[1]);
  });
});

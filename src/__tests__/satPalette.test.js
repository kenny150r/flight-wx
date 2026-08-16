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

  it("colorizes ABI Kelvin and visible reflectance", () => {
    const cold = satRgba([195.15], "ir", new Uint8ClampedArray(4), { units: "kelvin" });
    const warm = satRgba([313.15], "ir", new Uint8ClampedArray(4), { units: "kelvin" });
    expect(cold[3]).toBe(255);
    expect(cold[0]).toBeGreaterThan(warm[0] - 1);
    expect(Array.from(satRgba([NaN], "ir", new Uint8ClampedArray(4), { units: "kelvin" }))).toEqual([0, 0, 0, 0]);
    const vis = satRgba([0.25], "vis", new Uint8ClampedArray(4), { units: "reflectance" });
    expect(vis[0]).toBe(vis[1]);
    expect(vis[0]).toBe(Math.round(Math.sqrt(0.25) * 255));
  });
});

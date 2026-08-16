import { describe, expect, it } from "vitest";
import { GRS80, goesNav, makeGoesLut, outputGrid, samplePacked } from "../sat/goesProj.js";

const PUG = {
  x: -0.024052,
  y: 0.095340,
  lon0: -75,
  lat: 33.846162,
  lon: -84.690932,
  a: 1.000061039,
  b: -83921070.03,
  c: 1.73714e15,
  rs: 37116295.87,
  sx: 36937048.73,
  sy: 892635.0779,
  sz: 3532287.213,
};

describe("goesProj", () => {
  const nav = goesNav({
    perspective_point_height: GRS80.perspectiveHeight,
    semi_major_axis: GRS80.semiMajor,
    semi_minor_axis: GRS80.semiMinor,
    longitude_of_projection_origin: PUG.lon0,
  });

  it("matches the PUG east CONUS scan-to-lat/lon example", () => {
    const geo = nav.scanToLonLat(PUG.x, PUG.y);
    expect(geo.a).toBeCloseTo(PUG.a, 8);
    expect(geo.b / 1e6).toBeCloseTo(PUG.b / 1e6, 3);
    expect(geo.c / 1e12).toBeCloseTo(PUG.c / 1e12, 1);
    expect(geo.rs / 1e3).toBeCloseTo(PUG.rs / 1e3, 2);
    expect(geo.sx / 1e3).toBeCloseTo(PUG.sx / 1e3, 2);
    expect(geo.sy).toBeCloseTo(PUG.sy, 0);
    expect(geo.sz / 1e3).toBeCloseTo(PUG.sz / 1e3, 2);
    expect(geo.lat).toBeCloseTo(PUG.lat, 5);
    expect(geo.lon).toBeCloseTo(PUG.lon, 5);
  });

  it("inverts the PUG lat/lon example back to scan angles", () => {
    const scan = nav.lonLatToScan(PUG.lon, PUG.lat);
    expect(scan.x).toBeCloseTo(PUG.x, 6);
    expect(scan.y).toBeCloseTo(PUG.y, 6);
  });

  it("builds a north-up lookup and samples packed CMI", () => {
    const grid = outputGrid({ west: -85.2, east: -84.2, south: 33.3, north: 34.3 }, 0.05);
    expect(grid.width).toBe(20);
    expect(grid.height).toBe(20);
    const x0 = -0.101332;
    const dx = 0.000056;
    const y0 = 0.128212;
    const dy = -0.000056;
    const lut = makeGoesLut(nav, grid, x0, dx, 2500, y0, dy, 1500);
    const hits = lut.filter((v) => v >= 0);
    expect(hits.length).toBeGreaterThan(grid.width * grid.height * 0.8);
    const raw = new Int16Array(1500 * 2500);
    raw.fill(-1);
    raw[hits[0]] = 2000;
    const values = samplePacked(raw, lut, 0.06145332, 89.62, -1);
    expect(values.filter((v) => Number.isFinite(v)).length).toBeGreaterThan(0);
    expect(Math.max(...values.filter(Number.isFinite))).toBeCloseTo(2000 * 0.06145332 + 89.62, 3);
  });
});

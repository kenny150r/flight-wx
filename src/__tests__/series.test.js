import { describe, expect, it } from "vitest";
import { nearestSampleByX, seriesGapMs, splitSeriesSegments, timeSpan } from "../ui/series.js";

describe("series", () => {
  const samples = [
    { timeMs: 1000, dbz: 10 },
    { timeMs: 2000, dbz: 20 },
    { timeMs: 3000, dbz: 40 },
  ];

  it("picks the first sample at the left edge", () => {
    expect(nearestSampleByX(samples, 0, 100).timeMs).toBe(1000);
  });

  it("picks the last sample at the right edge", () => {
    expect(nearestSampleByX(samples, 100, 100).timeMs).toBe(3000);
  });

  it("picks the middle sample near the center", () => {
    expect(nearestSampleByX(samples, 50, 100).timeMs).toBe(2000);
  });

  it("picks within a zoomed time range", () => {
    expect(nearestSampleByX(samples, 0, 100, { t0: 2000, t1: 3000 }).timeMs).toBe(2000);
    expect(nearestSampleByX(samples, 100, 100, { t0: 2000, t1: 3000 }).timeMs).toBe(3000);
  });
});

describe("splitSeriesSegments", () => {
  it("keeps a continuous finite run as one segment", () => {
    const samples = [
      { timeMs: 0, dbz: 10 },
      { timeMs: 60_000, dbz: 12 },
      { timeMs: 120_000, dbz: 14 },
    ];
    expect(splitSeriesSegments(samples, (s) => s.dbz)).toHaveLength(1);
  });

  it("breaks across missing gates instead of connecting them", () => {
    const samples = [
      { timeMs: 0, dbz: 10 },
      { timeMs: 60_000, dbz: NaN },
      { timeMs: 120_000, dbz: 14 },
    ];
    const segs = splitSeriesSegments(samples, (s) => s.dbz);
    expect(segs.map((seg) => seg.map((s) => s.timeMs))).toEqual([[0], [120_000]]);
  });

  it("breaks across a long out-of-range gap", () => {
    const samples = [
      { timeMs: 0, dbz: 10 },
      { timeMs: 60_000, dbz: 12 },
      { timeMs: 3_600_000, dbz: 8 },
      { timeMs: 3_660_000, dbz: 9 },
    ];
    const segs = splitSeriesSegments(samples, (s) => s.dbz);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(2);
  });

  it("uses the sample cadence to decide how large a gap is", () => {
    const samples = [
      { timeMs: 0, dbz: 1 },
      { timeMs: 60_000, dbz: 1 },
      { timeMs: 120_000, dbz: 1 },
    ];
    expect(seriesGapMs(samples)).toBe(150_000);
  });

  it("clamps a zoomed time span to the data", () => {
    const samples = [{ timeMs: 1000 }, { timeMs: 5000 }];
    expect(timeSpan(samples, { t0: 0, t1: 8000 })).toEqual({ t0: 1000, t1: 5000 });
  });
});

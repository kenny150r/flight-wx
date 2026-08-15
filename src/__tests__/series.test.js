import { describe, expect, it } from "vitest";
import { nearestSampleByX } from "../ui/series.js";

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
});

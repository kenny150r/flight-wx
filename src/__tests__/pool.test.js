import { describe, expect, it } from "vitest";
import { defaultConcurrency, mapPool } from "../analysis/pool.js";

describe("mapPool", () => {
  it("preserves order with a concurrency limit", async () => {
    const seen = [];
    const out = await mapPool([10, 20, 30, 40], 2, async (n, idx) => {
      seen.push(idx);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return n * 2;
    });
    expect(out).toEqual([20, 40, 60, 80]);
    expect(seen).toHaveLength(4);
  });

  it("runs more than one item at a time", async () => {
    let inflight = 0;
    let max = 0;
    await mapPool([1, 2, 3, 4], 3, async () => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inflight -= 1;
    });
    expect(max).toBeGreaterThan(1);
  });

  it("picks useful default limits", () => {
    expect(defaultConcurrency("download")).toBeGreaterThanOrEqual(3);
    expect(defaultConcurrency("decode")).toBeGreaterThanOrEqual(2);
    expect(defaultConcurrency("list")).toBeGreaterThanOrEqual(4);
  });
});

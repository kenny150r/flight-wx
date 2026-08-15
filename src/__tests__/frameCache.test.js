import { describe, expect, it } from "vitest";
import { clearFrameCache, getCachedFrame, hasCachedFrame, setCachedFrame, uniquePlayFrames } from "../analysis/frameCache.js";

describe("frameCache", () => {
  it("stores and returns a decoded frame by key", () => {
    clearFrameCache();
    const frame = { station: "KOKX", data: new Uint8Array([1, 2, 3]) };
    setCachedFrame("vol|2.4|reflectivity", frame);
    expect(hasCachedFrame("vol|2.4|reflectivity")).toBe(true);
    expect(getCachedFrame("vol|2.4|reflectivity")).toBe(frame);
  });

  it("lists unique play frames in time order", () => {
    const frames = uniquePlayFrames([
      { timeMs: 3000, stationId: "KILN", s3Key: "b", elevation: 1.5 },
      { timeMs: 1000, stationId: "KOKX", s3Key: "a", elevation: 2.4 },
      { timeMs: 2000, stationId: "KOKX", s3Key: "a", elevation: 2.4 },
    ], "reflectivity");
    expect(frames.map((f) => f.sample.timeMs)).toEqual([1000, 3000]);
    expect(frames[0].key).toContain("a|2.4|reflectivity");
  });
});

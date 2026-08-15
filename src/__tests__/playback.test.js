import { describe, expect, it } from "vitest";
import { nextPlayIndex, playbackFrameKey, playableSamples, playIndexOf } from "../analysis/playback.js";

const samples = [
  { timeMs: 2000, stationId: "KILN", s3Key: "b", elevation: 1.5 },
  { timeMs: 1000, stationId: "KOKX", s3Key: "a", elevation: 2.4 },
  { timeMs: 1500, stationId: "KOKX", elevation: 2.4 },
];

describe("playback", () => {
  it("keeps the same frame key when only time changes", () => {
    const a = { s3Key: "vol", elevation: 2.4 };
    const b = { s3Key: "vol", elevation: 2.4 };
    expect(playbackFrameKey(a, "reflectivity")).toBe(playbackFrameKey(b, "reflectivity"));
  });

  it("changes frame key when tilt or product changes", () => {
    const sample = { s3Key: "vol", elevation: 2.4 };
    expect(playbackFrameKey(sample, "reflectivity")).not.toBe(playbackFrameKey({ ...sample, elevation: 3.1 }, "reflectivity"));
    expect(playbackFrameKey(sample, "reflectivity")).not.toBe(playbackFrameKey(sample, "velocity"));
    expect(playbackFrameKey(sample, "reflectivity", "base")).toBe("vol|base|reflectivity");
    expect(playbackFrameKey(sample, "reflectivity", "base")).not.toBe(playbackFrameKey(sample, "reflectivity", "closest"));
  });

  it("sorts playable samples and drops those without a volume", () => {
    const playable = playableSamples(samples);
    expect(playable.map((s) => s.timeMs)).toEqual([1000, 2000]);
  });

  it("resumes after the selected sample and wraps to the start", () => {
    const playable = playableSamples(samples);
    expect(playIndexOf(playable, playable[0])).toBe(0);
    expect(nextPlayIndex(playable, playable[0])).toBe(1);
    expect(nextPlayIndex(playable, playable[1])).toBe(0);
  });
});

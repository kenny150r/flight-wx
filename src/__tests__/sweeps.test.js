import { describe, expect, it } from "vitest";
import { findClosestByTimeMs, scanTimeMs } from "../radar/decode/sweeps.js";

describe("findClosestByTimeMs", () => {
  it("ignores the same clock time on another day", () => {
    const target = Date.UTC(2025, 6, 17, 12, 56, 0);
    const match = findClosestByTimeMs(
      [{ time: "12:56:20", key: "yday" }],
      "20250716",
      target,
      360,
    );
    expect(match).toBeNull();
    expect(scanTimeMs("20250717", "12:56:20")).toBe(Date.UTC(2025, 6, 17, 12, 56, 20));
  });

  it("keeps a midnight-crossing neighbor", () => {
    const target = Date.UTC(2025, 6, 17, 0, 2, 0);
    const match = findClosestByTimeMs(
      [{ time: "23:58:00", key: "prev" }],
      "20250716",
      target,
      360,
    );
    expect(match?.key).toBe("prev");
  });
});

import { describe, expect, it } from "vitest";
import { planVolumes } from "../analysis/volumePlan.js";

describe("planVolumes", () => {
  it("lists station-days in parallel", async () => {
    let inflight = 0;
    let max = 0;
    const listScans = async (id, date) => {
      inflight += 1;
      max = Math.max(max, inflight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inflight -= 1;
      return { scans: [{ time: "12:00:00", key: `${id}-${date}-120000`, size: 1 }] };
    };
    const t0 = Date.UTC(2025, 6, 17, 12, 0, 0);
    const assigned = [
      { timeMs: t0, station: { id: "KOKX" }, lat: 40, lon: -74 },
      { timeMs: t0 + 120000, station: { id: "KDIX" }, lat: 40, lon: -75 },
    ];
    const plan = await planVolumes(assigned, { listScans });
    expect(plan.volumes.length).toBe(2);
    expect(plan.volumes.map((v) => v.dateClean).sort()).toEqual(["20250717", "20250717"]);
    expect(max).toBeGreaterThan(1);
  });

  it("does not treat yesterday's same clock time as the matching scan", async () => {
    const listScans = async (id, date) => ({
      scans: [{ time: "12:56:20", key: `${id}-${date}`, size: 1 }],
    });
    const plan = await planVolumes([
      { timeMs: Date.UTC(2025, 6, 17, 12, 56, 0), station: { id: "KOKX" }, lat: 40, lon: -74 },
    ], { listScans });
    expect(plan.volumes).toHaveLength(1);
    expect(plan.volumes[0].dateClean).toBe("20250717");
    expect(plan.volumes[0].key).toBe("KOKX-20250717");
  });

  it("can use the previous day across midnight", async () => {
    const listScans = async (id, date) => {
      if (date === "20250717") return { scans: [] };
      return { scans: [{ time: "23:58:00", key: `${id}-${date}`, size: 1 }] };
    };
    const plan = await planVolumes([
      { timeMs: Date.UTC(2025, 6, 17, 0, 2, 0), station: { id: "KOKX" }, lat: 40, lon: -74 },
    ], { listScans });
    expect(plan.volumes[0].dateClean).toBe("20250716");
    expect(plan.volumes[0].key).toBe("KOKX-20250716");
  });

  it("caps volumes and marks dropped points", async () => {
    const listScans = async (id, date) => ({
      scans: [{ time: "12:00:00", key: `${id}-${date}-120000`, size: 1 }],
    });
    const t0 = Date.UTC(2025, 6, 17, 12, 0, 0);
    const assigned = Array.from({ length: 6 }, (_, i) => ({
      timeMs: t0 + i * 60000,
      station: { id: `K${i}OKX` },
      lat: 40,
      lon: -74,
    }));
    const plan = await planVolumes(assigned, { listScans, maxVolumes: 3 });
    expect(plan.volumes.length).toBe(3);
    expect(plan.capped).toBe(true);
    expect(plan.overBudget).toBe(true);
    expect(assigned.filter((p) => p.uncoveredReason === "volume_budget").length).toBeGreaterThan(0);
  });

  it("marks list failures separately from missing scans", async () => {
    const listScans = async () => {
      throw new Error("network");
    };
    const plan = await planVolumes([
      { timeMs: Date.UTC(2025, 6, 17, 12, 0, 0), station: { id: "KOKX" }, lat: 40, lon: -74 },
    ], { listScans });
    expect(plan.volumes).toHaveLength(0);
    expect(plan.listErrors).toBeGreaterThan(0);
  });
});

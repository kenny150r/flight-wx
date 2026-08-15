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
    expect(max).toBeGreaterThan(1);
  });
});

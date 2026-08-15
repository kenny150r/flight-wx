import { describe, expect, it } from "vitest";
import { ingestVolumes } from "../analysis/run.js";

function volume(id) {
  return {
    station: { id },
    key: `key-${id}`,
    dateClean: "20250717",
    timeClean: "120000",
    points: [{ lat: 40, lon: -74 }],
  };
}

describe("ingestVolumes", () => {
  it("downloads and samples more than one volume at a time", async () => {
    let downloading = 0;
    let sampling = 0;
    let maxDown = 0;
    let maxSample = 0;
    const volumes = [volume("KOKX"), volume("KDIX"), volume("KDOX"), volume("KLWX")];
    const { chunks } = await ingestVolumes(volumes, {
      downloadLimit: 3,
      sampleLimit: 2,
      download: async (item) => {
        downloading += 1;
        maxDown = Math.max(maxDown, downloading);
        await new Promise((resolve) => setTimeout(resolve, 20));
        downloading -= 1;
        return new Uint8Array([item.station.id.length]);
      },
      sample: async (_raw, item) => {
        sampling += 1;
        maxSample = Math.max(maxSample, sampling);
        await new Promise((resolve) => setTimeout(resolve, 15));
        sampling -= 1;
        return { samples: [{ stationId: item.station.id, dbz: 1 }] };
      },
    });
    expect(chunks.flat().map((s) => s.stationId).sort()).toEqual(["KDIX", "KDOX", "KLWX", "KOKX"]);
    expect(maxDown).toBeGreaterThan(1);
    expect(maxSample).toBeGreaterThan(1);
  });

  it("keeps going when a volume fails", async () => {
    const volumes = [volume("KOKX"), volume("KDIX")];
    const { chunks } = await ingestVolumes(volumes, {
      downloadLimit: 2,
      sampleLimit: 2,
      download: async (item) => {
        if (item.station.id === "KOKX") throw new Error("nope");
        return new Uint8Array([1]);
      },
      sample: async (_raw, item) => ({ samples: [{ stationId: item.station.id }] }),
    });
    expect(chunks.flat()).toEqual([
      expect.objectContaining({ stationId: "KDIX", s3Key: "key-KDIX" }),
    ]);
  });

  it("limits queued downloads while sampling is busy", async () => {
    let started = 0;
    let finished = 0;
    let maxHeld = 0;
    const volumes = ["KOKX", "KDIX", "KDOX", "KLWX", "KCCX"].map(volume);
    await ingestVolumes(volumes, {
      downloadLimit: 4,
      sampleLimit: 1,
      maxQueue: 2,
      download: async () => {
        started += 1;
        maxHeld = Math.max(maxHeld, started - finished);
        await new Promise((resolve) => setTimeout(resolve, 8));
        return new Uint8Array([1]);
      },
      sample: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        finished += 1;
        return { samples: [{ stationId: "X" }] };
      },
    });
    expect(maxHeld).toBeLessThanOrEqual(3);
  });
});

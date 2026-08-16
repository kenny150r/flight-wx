import { describe, expect, it } from "vitest";
import {
  formatSatHud,
  goesChannel,
  goesHourPrefix,
  goesListPrefixes,
  goesSatCandidates,
  nearestSatTimeMs,
  parseGoesObject,
  parseGoesStamp,
  pickGoesSat,
  pickNearestGoesObject,
  satBoundsFromSamples,
  satFrameKey,
  uniqueSatTimes,
  utcDayOfYear,
} from "../sat/goesAbi.js";

const EDV = Date.UTC(2025, 6, 17, 14, 53, 0);

describe("goesAbi", () => {
  it("snaps Endeavor 4985 14:53Z to the 14:51Z CONUS slot", () => {
    expect(nearestSatTimeMs(EDV)).toBe(Date.UTC(2025, 6, 17, 14, 51, 0));
    expect(nearestSatTimeMs(Date.UTC(2025, 6, 17, 14, 54, 0))).toBe(Date.UTC(2025, 6, 17, 14, 56, 0));
    expect(satFrameKey("ir", EDV, 19)).toBe(`ir|19|${Date.UTC(2025, 6, 17, 14, 51, 0)}`);
  });

  it("picks GOES-East/West by date and longitude", () => {
    expect(pickGoesSat(EDV, -84)).toBe(19);
    expect(pickGoesSat(EDV, -118)).toBe(18);
    expect(pickGoesSat(Date.UTC(2025, 3, 7, 15, 0), -84)).toBe(16);
    expect(pickGoesSat(Date.UTC(2022, 6, 1), -118)).toBe(17);
    expect(goesSatCandidates(EDV, -84)[0]).toBe(19);
    expect(goesChannel("ir")).toBe("13");
    expect(goesChannel("vis")).toBe("02");
  });

  it("parses ABI filenames and hour prefixes", () => {
    expect(utcDayOfYear(EDV)).toBe(198);
    expect(goesHourPrefix(EDV)).toBe("ABI-L2-CMIPC/2025/198/14/");
    expect(goesListPrefixes(EDV)).toEqual([
      "ABI-L2-CMIPC/2025/198/13/",
      "ABI-L2-CMIPC/2025/198/14/",
      "ABI-L2-CMIPC/2025/198/15/",
    ]);
    expect(parseGoesStamp("20251981501179")).toBe(Date.UTC(2025, 6, 17, 15, 1, 17, 900));
    const parsed = parseGoesObject(
      "ABI-L2-CMIPC/2025/198/15/OR_ABI-L2-CMIPC-M6C13_G19_s20251981501179_e20251981503564_c20251981504058.nc",
    );
    expect(parsed).toMatchObject({ channel: "13", satId: 19, mode: 6 });
    expect(parsed.startMs).toBe(Date.UTC(2025, 6, 17, 15, 1, 17, 900));
  });

  it("picks the nearest CONUS scan for a satellite and channel", () => {
    const objects = [
      { key: "ABI-L2-CMIPC/2025/198/14/OR_ABI-L2-CMIPC-M6C13_G19_s20251981451179_e20251981453564_c20251981454058.nc" },
      { key: "ABI-L2-CMIPC/2025/198/14/OR_ABI-L2-CMIPC-M6C02_G19_s20251981451179_e20251981453552_c20251981454241.nc" },
      { key: "ABI-L2-CMIPC/2025/198/14/OR_ABI-L2-CMIPC-M6C13_G19_s20251981456179_e20251981458564_c20251981459042.nc" },
    ];
    const hit = pickNearestGoesObject(objects, EDV, "13", 19);
    expect(hit.key).toContain("s20251981451179");
    expect(pickNearestGoesObject(objects, EDV, "13", 16)).toBeNull();
  });

  it("lists unique 5-minute slots and a padded track bbox", () => {
    const samples = [
      { timeMs: EDV, lat: 42.3, lon: -83.7 },
      { timeMs: Date.UTC(2025, 6, 17, 14, 54, 0), lat: 42.4, lon: -83.5 },
      { timeMs: Date.UTC(2025, 6, 17, 15, 2, 0), lat: 42.6, lon: -83.1 },
    ];
    expect(uniqueSatTimes(samples)).toEqual([
      Date.UTC(2025, 6, 17, 14, 51, 0),
      Date.UTC(2025, 6, 17, 14, 56, 0),
      Date.UTC(2025, 6, 17, 15, 1, 0),
    ]);
    const bbox = satBoundsFromSamples(samples);
    expect(bbox.west).toBeLessThan(-83.7);
    expect(bbox.east).toBeGreaterThan(-83.1);
    expect(bbox.north - bbox.south).toBeGreaterThan(4);
  });

  it("formats the HUD with satellite number and scan time", () => {
    expect(formatSatHud("ir", EDV, { satId: 19 })).toBe("GOES-19 IR 14:53Z");
    expect(formatSatHud("vis", Date.UTC(2025, 6, 17, 14, 51, 17), { satId: 19 })).toBe("GOES-19 VIS 14:51Z");
    expect(formatSatHud("ir", EDV, { satId: 19, loading: true })).toBe("Loading GOES-19 IR…");
    expect(formatSatHud("vis", EDV, { error: true })).toBe("GOES VIS unavailable");
  });
});

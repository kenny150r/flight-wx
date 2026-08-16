import { describe, expect, it } from "vitest";
import {
  bboxToLeafletBounds,
  formatSatHud,
  nearestSatTimeMs,
  parseSatProduct,
  satCandidateTimes,
  satFrameKey,
  satFrameUrl,
  satNeighborTimeMs,
  uniqueSatTimes,
  upcomingSatTimes,
} from "../sat/iemGoes.js";

const EDV = Date.UTC(2025, 6, 17, 14, 53, 0);

describe("iemGoes", () => {
  it("accepts only vis and ir share values", () => {
    expect(parseSatProduct("ir")).toBe("ir");
    expect(parseSatProduct("vis")).toBe("vis");
    expect(parseSatProduct("wv")).toBe("");
    expect(parseSatProduct("")).toBe("");
  });

  it("snaps Endeavor 4985 14:53Z to the 15:00Z slot", () => {
    expect(nearestSatTimeMs(EDV)).toBe(Date.UTC(2025, 6, 17, 15, 0, 0));
    expect(satNeighborTimeMs(EDV)).toBe(Date.UTC(2025, 6, 17, 14, 45, 0));
    expect(satFrameUrl("ir", EDV)).toBe(
      "https://mesonet.agron.iastate.edu/archive/data/2025/07/17/GIS/sat/conus_goes_ir4km_1500.tif",
    );
    expect(satFrameUrl("vis", EDV)).toBe(
      "https://mesonet.agron.iastate.edu/archive/data/2025/07/17/GIS/sat/conus_goes_vis4km_1500.tif",
    );
    expect(satFrameKey("ir", EDV)).toBe(`ir|${Date.UTC(2025, 6, 17, 15, 0, 0)}`);
  });

  it("tries the neighboring 15-minute slot after the nearest", () => {
    expect(satCandidateTimes(EDV)).toEqual([
      Date.UTC(2025, 6, 17, 15, 0, 0),
      Date.UTC(2025, 6, 17, 14, 45, 0),
    ]);
    expect(satFrameUrl("ir", satCandidateTimes(EDV)[1])).toBe(
      "https://mesonet.agron.iastate.edu/archive/data/2025/07/17/GIS/sat/conus_goes_ir4km_1445.tif",
    );
  });

  it("uses the UTC day folder when a slot crosses midnight", () => {
    const late = Date.UTC(2025, 6, 17, 23, 58, 0);
    expect(nearestSatTimeMs(late)).toBe(Date.UTC(2025, 6, 18, 0, 0, 0));
    expect(satFrameUrl("vis", late)).toBe(
      "https://mesonet.agron.iastate.edu/archive/data/2025/07/18/GIS/sat/conus_goes_vis4km_0000.tif",
    );
  });

  it("lists unique and upcoming 15-minute slots for prefetch", () => {
    const samples = [
      { timeMs: EDV },
      { timeMs: Date.UTC(2025, 6, 17, 15, 4, 0) },
      { timeMs: Date.UTC(2025, 6, 17, 15, 8, 0) },
      { timeMs: Date.UTC(2025, 6, 17, 15, 20, 0) },
      { timeMs: Date.UTC(2025, 6, 17, 15, 40, 0) },
    ];
    expect(uniqueSatTimes(samples)).toEqual([
      Date.UTC(2025, 6, 17, 15, 0, 0),
      Date.UTC(2025, 6, 17, 15, 15, 0),
      Date.UTC(2025, 6, 17, 15, 45, 0),
    ]);
    expect(upcomingSatTimes(samples, EDV, 3)).toEqual([
      Date.UTC(2025, 6, 17, 15, 15, 0),
      Date.UTC(2025, 6, 17, 15, 45, 0),
    ]);
  });

  it("converts a GeoTIFF bbox to Leaflet bounds", () => {
    expect(bboxToLeafletBounds([-130, 22, -60, 52])).toEqual([[22, -130], [52, -60]]);
  });

  it("formats the HUD sat label", () => {
    expect(formatSatHud("ir", EDV)).toBe("GOES IR 15:00Z");
    expect(formatSatHud("vis", EDV)).toBe("GOES VIS 15:00Z");
    expect(formatSatHud("ir", EDV, { loading: true })).toBe("Loading GOES IR…");
    expect(formatSatHud("vis", EDV, { error: true })).toBe("GOES VIS unavailable");
    expect(formatSatHud("", EDV)).toBe("");
  });
});

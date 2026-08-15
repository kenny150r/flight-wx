import { describe, expect, it } from "vitest";
import { EXAMPLE_LIBRARY, extraCallsignsFromLibrary, findExample } from "../adsb/examples.js";
import { synthesizeExampleTrack } from "../adsb/exampleTrack.js";
import { findExampleForIdent } from "../adsb/ident.js";
import { haversineKm } from "../analysis/geo.js";

describe("example library", () => {
  it("has unique ids and a loadable track for every case", () => {
    const ids = EXAMPLE_LIBRARY.map((ex) => ex.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of EXAMPLE_LIBRARY) {
      expect(example.flight && example.dateClean && example.ntsb).toBeTruthy();
      expect(Boolean(example.trackUrl) || (example.waypoints || []).length >= 2).toBe(true);
    }
  });

  it("maps codeshare aliases both ways", () => {
    const extras = extraCallsignsFromLibrary();
    expect(extras.SWA2231).toContain("WN2231");
    expect(extras.WN2231).toContain("SWA2231");
    expect(findExample("WN2231", "20250502")?.id).toBe("swa2231");
    expect(findExampleForIdent("DL56", "20250730")?.id).toBe("dal56");
  });

  it("accepts the local date alias for overnight UTC encounters", () => {
    expect(findExample("AAL1286", "20250622")?.dateClean).toBe("20250623");
    expect(findExample("UAL2857", "20250615")?.id).toBe("ual2857");
    expect(findExample("SKW5971", "20250828")?.id).toBe("skw5971");
  });
});

describe("example tracks", () => {
  it("puts Southwest 2231 through the Centerville hail encounter", () => {
    const points = synthesizeExampleTrack(findExample("SWA2231", "20250502"));
    const eventMs = Date.UTC(2025, 4, 2, 17, 0, 0);
    const event = points.find((p) => Math.abs(p.timeMs - eventMs) < 20000);
    expect(event).toBeTruthy();
    expect(haversineKm(event.lat, event.lon, 35.779, -87.467)).toBeLessThan(5);
    expect(event.altFt).toBeCloseTo(28000, -2);
    expect(event.gsKt).toBeGreaterThan(150);
  });

  it("times American 1286 at FL250 seventeen minutes after Miami", () => {
    const points = synthesizeExampleTrack(findExample("AAL1286", "20250623"));
    const eventMs = Date.UTC(2025, 5, 23, 1, 30, 0);
    const event = points.find((p) => Math.abs(p.timeMs - eventMs) < 20000);
    expect(event.altFt).toBeCloseTo(25000, -2);
    expect(event.lat).toBeGreaterThan(26);
    expect(event.lat).toBeLessThan(29);
  });

  it("keeps the Little Rock takeoff short and low", () => {
    const points = synthesizeExampleTrack(findExample("N55PC", "20230222"));
    expect(points.length).toBeGreaterThan(2);
    expect(points[0].altFt).toBeLessThan(500);
    expect(points[points.length - 1].timeMs).toBe(Date.UTC(2023, 1, 22, 17, 56, 0));
  });
});

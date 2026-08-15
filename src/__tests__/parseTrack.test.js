import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { identCandidates, isExampleFlight, normalizeHex, normalizeIdent } from "../adsb/ident.js";
import { parseCsvTrack, parseGeoJsonTrack, parseReadsbTrace, parseTrackFile } from "../adsb/parseTrack.js";

describe("ident", () => {
  it("maps IATA to ICAO", () => {
    expect(normalizeIdent("ua123")).toBe("UAL123");
    expect(normalizeIdent("UAL123")).toBe("UAL123");
  });

  it("keeps unknown 2-letter prefixes", () => {
    expect(normalizeIdent("ZZ999")).toBe("ZZ999");
  });

  it("normalizes hex", () => {
    expect(normalizeHex("A1B2C3")).toBe("a1b2c3");
    expect(normalizeHex("nope")).toBe("");
  });

  it("returns lookup candidates", () => {
    expect(identCandidates("UA123")).toContain("UAL123");
  });

  it("includes Endeavor codeshares for Delta 4985", () => {
    expect(identCandidates("DL4985")).toContain("EDV4985");
    expect(identCandidates("9E4985")).toContain("EDV4985");
  });

  it("recognizes example-library flights and UTC date aliases", () => {
    expect(isExampleFlight("9E4985", "20250717")).toBe(true);
    expect(isExampleFlight("DL4985", "20250717")).toBe(true);
    expect(isExampleFlight("EDV4985", "20250716")).toBe(false);
    expect(isExampleFlight("WN2231", "20250502")).toBe(true);
    expect(isExampleFlight("AA1286", "20250622")).toBe(true);
    expect(isExampleFlight("N47WT", "20240515")).toBe(true);
  });
});

describe("track parse", () => {
  it("parses CSV", () => {
    const csv = "time,lat,lon,alt_ft\n2013-05-20T19:51:11Z,35.2,-97.1,35000\n2013-05-20T19:52:11Z,35.3,-97.0,35100\n";
    const points = parseCsvTrack(csv);
    expect(points).toHaveLength(2);
    expect(points[0].lat).toBeCloseTo(35.2);
    expect(points[0].altFt).toBe(35000);
  });

  it("parses optional heading and speed columns", () => {
    const csv = "time,lat,lon,alt_ft,heading,gs,vs\n2013-05-20T19:51:11Z,35.2,-97.1,35000,247,420,-100\n";
    const points = parseCsvTrack(csv);
    expect(points[0].headingDeg).toBe(247);
    expect(points[0].gsKt).toBe(420);
    expect(points[0].vsFpm).toBe(-100);
  });

  it("parses GeoJSON LineString", () => {
    const gj = {
      type: "Feature",
      properties: { times: ["2013-05-20T19:51:11Z", "2013-05-20T19:52:11Z"], altitudes: [10000, 11000] },
      geometry: { type: "LineString", coordinates: [[-97.1, 35.2], [-97.0, 35.3]] },
    };
    const points = parseGeoJsonTrack(JSON.stringify(gj));
    expect(points).toHaveLength(2);
    expect(points[1].altFt).toBe(11000);
  });

  it("parses a readsb trace and filters callsign", () => {
    const json = {
      timestamp: 1369079471,
      trace: [
        [0, 35.2, -97.1, 12000, 400, 90, 0, 0, { flight: "UAL123" }],
        [60, 35.3, -97.0, 12100, 400, 90, 0, 0, { flight: "AAL99" }],
        [120, 35.4, -96.9, 12200, 400, 90, 0, 0, { flight: "UAL123" }],
      ],
    };
    const points = parseReadsbTrace(json, { callsign: "UAL123" });
    expect(points).toHaveLength(2);
    expect(points[1].lat).toBeCloseTo(35.4);
    expect(points[0].gsKt).toBe(400);
    expect(points[0].headingDeg).toBe(90);
  });

  it("detects JSON from file contents", () => {
    const points = parseTrackFile("track.csv", '{"type":"Feature","properties":{"time":"2013-05-20T19:51:11Z","alt_ft":10000},"geometry":{"type":"Point","coordinates":[-97,35]}}');
    expect(points).toHaveLength(1);
    expect(points[0].altFt).toBe(10000);
  });

  it("rejects CSV without timestamps instead of using now", () => {
    expect(() => parseCsvTrack("lat,lon,alt_ft\n35.2,-97.1,35000\n")).toThrow(/time/i);
  });

  it("parses quoted CSV fields", () => {
    const csv = "time,lat,lon,alt_ft,note\n\"2013-05-20T19:51:11Z\",35.2,-97.1,35000,\"ok, go\"\n";
    const points = parseCsvTrack(csv);
    expect(points).toHaveLength(1);
    expect(points[0].altFt).toBe(35000);
  });

  it("treats GeoJSON altitudes_m as meters", () => {
    const gj = {
      type: "Feature",
      properties: { times: ["2013-05-20T19:51:11Z"], altitudes_m: [3048] },
      geometry: { type: "LineString", coordinates: [[-97.1, 35.2]] },
    };
    const points = parseGeoJsonTrack(JSON.stringify(gj));
    expect(points[0].altFt).toBeCloseTo(10000, 0);
  });

  it("does not fall back to the whole hex day when another callsign is present", () => {
    const json = {
      timestamp: 1369079471,
      trace: [
        [0, 35.2, -97.1, 12000, 400, 90, 0, 0, { flight: "AAL99" }],
        [60, 35.3, -97.0, 12100, 400, 90, 0, 0, { flight: "AAL99" }],
      ],
    };
    expect(parseReadsbTrace(json, { callsign: "UAL123" })).toEqual([]);
  });

  it("parses the bundled Endeavor 4985 example track", () => {
    const csv = readFileSync(new URL("../../public/examples/edv4985-20250717.csv", import.meta.url), "utf8");
    const points = parseCsvTrack(csv);
    expect(points.length).toBeGreaterThan(100);
    expect(points[0].lat).toBeCloseTo(40.64, 1);
    expect(points[points.length - 1].lon).toBeCloseTo(-84.67, 1);
  });
});

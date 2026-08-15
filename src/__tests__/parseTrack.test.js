import { describe, expect, it } from "vitest";
import { identCandidates, normalizeHex, normalizeIdent } from "../adsb/ident.js";
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
});

describe("track parse", () => {
  it("parses CSV", () => {
    const csv = "time,lat,lon,alt_ft\n2013-05-20T19:51:11Z,35.2,-97.1,35000\n2013-05-20T19:52:11Z,35.3,-97.0,35100\n";
    const points = parseCsvTrack(csv);
    expect(points).toHaveLength(2);
    expect(points[0].lat).toBeCloseTo(35.2);
    expect(points[0].altFt).toBe(35000);
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
  });

  it("detects JSON from file contents", () => {
    const points = parseTrackFile("track.csv", '{"type":"Point","coordinates":[-97,35]}');
    expect(points).toHaveLength(1);
  });
});

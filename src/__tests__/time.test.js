import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsvTrack } from "../adsb/parseTrack.js";
import { formatTrackTime, timeZoneForLon } from "../analysis/time.js";

describe("track time", () => {
  it("uses Eastern time near Cincinnati", () => {
    expect(timeZoneForLon(-84.67)).toBe("America/New_York");
    const formatted = formatTrackTime(Date.UTC(2025, 6, 17, 14, 53, 0), { lon: -83.62 });
    expect(formatted.utc).toBe("2025-07-17T14:53:00Z");
    expect(formatted.local).toMatch(/10:53/);
    expect(formatted.local).toMatch(/EDT/);
  });

  it("times the example 18k descent at the NTSB encounter", () => {
    const csv = readFileSync(new URL("../../public/examples/edv4985-20250717.csv", import.meta.url), "utf8");
    const points = parseCsvTrack(csv);
    const event = points.find((p) => p.altFt > 17000 && p.altFt < 19000 && p.lon < -82);
    expect(event).toBeTruthy();
    expect(event.timeMs).toBe(Date.UTC(2025, 6, 17, 14, 53, 0));
    expect(formatTrackTime(event.timeMs, { lon: event.lon }).local).toMatch(/10:53/);
  });
});

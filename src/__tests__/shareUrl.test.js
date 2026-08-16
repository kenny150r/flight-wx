import { describe, expect, it } from "vitest";
import { buildShareSearch, clampShareFrame, parseShareSearch } from "../analysis/shareUrl.js";

describe("shareUrl", () => {
  it("round-trips flight, frame, and play state", () => {
    const query = buildShareSearch({
      flight: "EDV4985",
      date: "20250717",
      frame: 12,
      play: true,
    });
    expect(query).toBe("flight=EDV4985&date=20250717&frame=12&play=1");
    expect(parseShareSearch(`?${query}`)).toEqual({
      flight: "EDV4985",
      date: "20250717",
      hex: "",
      frame: 12,
      play: true,
      tilt: "closest",
      sat: "",
    });
  });

  it("omits paused play and invalid frames", () => {
    expect(buildShareSearch({ flight: "UAL1", date: "20260815", frame: 0, play: false })).toBe("flight=UAL1&date=20260815");
    expect(parseShareSearch("flight=UAL1&play=0&frame=abc")).toEqual({
      flight: "UAL1",
      date: "",
      hex: "",
      frame: 0,
      play: false,
      tilt: "closest",
      sat: "",
    });
    expect(buildShareSearch({ flight: "EDV4985", date: "20250717", tilt: "base" })).toBe("flight=EDV4985&date=20250717&tilt=base");
  });

  it("round-trips a GOES overlay product", () => {
    expect(buildShareSearch({ flight: "EDV4985", date: "20250717", sat: "ir" })).toBe("flight=EDV4985&date=20250717&sat=ir");
    expect(parseShareSearch("flight=EDV4985&date=20250717&sat=vis")).toMatchObject({ sat: "vis" });
    expect(parseShareSearch("flight=EDV4985&sat=wv").sat).toBe("");
  });

  it("clamps a shared frame to the playable range", () => {
    expect(clampShareFrame(12, 40)).toBe(12);
    expect(clampShareFrame(99, 40)).toBe(40);
    expect(clampShareFrame(0, 40)).toBe(0);
  });

  it("drops invalid dates", () => {
    expect(parseShareSearch("flight=UAL1&date=abcdefgh")).toEqual({
      flight: "UAL1",
      date: "",
      hex: "",
      frame: 0,
      play: false,
      tilt: "closest",
      sat: "",
    });
  });
});

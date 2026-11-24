import { arrivedFrom, endpointFor, ratioBand } from "./telemetry";

describe("usage counts", () => {
  it("only send from the live site, unless an address is set at build time", () => {
    expect(endpointFor("jayfox.design", "")).toMatch(/lab-events$/);
    expect(endpointFor("www.jayfox.design", "")).toMatch(/lab-events$/);
    expect(endpointFor("localhost", "")).toBeUndefined();
    expect(endpointFor("jayfox.design.evil.com", "")).toBeUndefined();
    expect(endpointFor("localhost", "https://example.test/x")).toBe("https://example.test/x");
  });

  it("record where a visit came from as one coarse word, never the address", () => {
    expect(arrivedFrom("")).toBe("direct");
    expect(arrivedFrom("https://jayfox.design/lab")).toBe("lab");
    expect(arrivedFrom("https://jayfox.design/lab/")).toBe("lab");
    expect(arrivedFrom("https://jayfox.design/work")).toBe("site");
    expect(arrivedFrom("https://www.google.com/search?q=contrast")).toBe("other");
    expect(arrivedFrom("not a url")).toBe("direct");
  });

  it("band a ratio instead of sending it, at the WCAG thresholds", () => {
    expect(ratioBand(2.99)).toBe("under_3");
    expect(ratioBand(3)).toBe("3_to_4.5");
    expect(ratioBand(4.499)).toBe("3_to_4.5");
    expect(ratioBand(4.5)).toBe("4.5_to_7");
    expect(ratioBand(21)).toBe("7_plus");
  });
});

import {
  composite,
  deltaE,
  oklchToRgb,
  parseColor,
  quantize,
  rgbToOklch,
  toHex,
  type Rgb,
} from "./color";
import { contrastRatio, criterion, evaluate, formatRatio, luminance } from "./contrast";
import { paletteGrid, passingPairs, type Swatch } from "./palette";
import { decodeShare, encodeShare } from "./share";
import { bestPossible, nearestPassing } from "./suggest";

const hex = (s: string): Rgb => {
  const r = parseColor(s);
  if (!r.ok) throw new Error(r.error);
  return r.color;
};

// Reference values were computed separately in Python from the WCAG formula.
describe("contrast ratio (WCAG 2.2)", () => {
  it.each([
    ["#000000", "#ffffff", 21],
    ["#777777", "#ffffff", 4.478089453577214],
    ["#767676", "#ffffff", 4.542224959605253],
    ["#595959", "#ffffff", 7.004729208035935],
    ["#949494", "#ffffff", 3.0334698257384747],
    ["#000052", "#ffdf3f", 14.154297753329208],
    ["#ff0000", "#ffffff", 3.9984767707539985],
  ])("%s on %s is %f", (a, b, expected) => {
    expect(contrastRatio(hex(a), hex(b))).toBeCloseTo(expected, 10);
  });

  it("doesn't depend on which color is the text", () => {
    expect(contrastRatio(hex("#000052"), hex("#ffdf3f"))).toBe(
      contrastRatio(hex("#ffdf3f"), hex("#000052")),
    );
  });

  it("luminance runs from 0 (black) to 1 (white)", () => {
    expect(luminance(hex("#000"))).toBe(0);
    expect(luminance(hex("#fff"))).toBeCloseTo(1, 12);
  });
});

describe("pass or fail", () => {
  it("has no rounding: #777 on white (4.478) fails body text, #767676 (4.54) passes", () => {
    const fail = evaluate(hex("#777777"), hex("#ffffff"));
    const pass = evaluate(hex("#767676"), hex("#ffffff"));
    const aa = (e: ReturnType<typeof evaluate>) =>
      e.checks.find((c) => c.criterion.id === "aa-text")!.pass;
    expect(aa(fail)).toBe(false);
    expect(aa(pass)).toBe(true);
  });

  it("checks each criterion against its own minimum", () => {
    const e = evaluate(hex("#949494"), hex("#ffffff")); // 3.03
    const by = Object.fromEntries(e.checks.map((c) => [c.criterion.id, c.pass]));
    expect(by).toEqual({
      "aa-text": false,
      "aa-large": true,
      "non-text": true,
      "aaa-text": false,
      "aaa-large": false,
    });
  });

  it("shows the ratio rounded down, so a failing pair never displays a passing number", () => {
    expect(formatRatio(4.478089453577214)).toBe("4.47");
    expect(formatRatio(4.4999)).toBe("4.49");
    expect(formatRatio(4.5)).toBe("4.50");
    expect(formatRatio(21)).toBe("21.00");
  });

  it("paints transparent text over the background before measuring", () => {
    const e = evaluate(hex("#00000080"), hex("#ffffff"));
    const grey = composite(hex("#00000080"), hex("#ffffff"));
    expect(e.ratio).toBeCloseTo(contrastRatio(grey, hex("#ffffff")), 12);
    expect(e.ratio).toBeLessThan(21);
  });

  it("50% black over white matches the hand calculation", () => {
    const e = evaluate({ r: 0, g: 0, b: 0, a: 0.5 }, hex("#fff"));
    expect(e.ratio).toBeCloseTo(3.976653024912438, 10);
  });
});

describe("reading colors", () => {
  it.each([
    ["#1a2b3c", { r: 26, g: 43, b: 60, a: 1 }],
    ["1a2b3c", { r: 26, g: 43, b: 60, a: 1 }],
    ["#abc", { r: 170, g: 187, b: 204, a: 1 }],
    ["#FFF", { r: 255, g: 255, b: 255, a: 1 }],
    ["rgb(26 43 60)", { r: 26, g: 43, b: 60, a: 1 }],
    ["rgb(26, 43, 60)", { r: 26, g: 43, b: 60, a: 1 }],
    ["rgba(26, 43, 60, 0.5)", { r: 26, g: 43, b: 60, a: 0.5 }],
    ["rgb(100% 0% 0% / 50%)", { r: 255, g: 0, b: 0, a: 0.5 }],
  ])("reads %s", (input, expected) => {
    const r = parseColor(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.color.r).toBeCloseTo(expected.r, 6);
      expect(r.color.g).toBeCloseTo(expected.g, 6);
      expect(r.color.b).toBeCloseTo(expected.b, 6);
      expect(r.color.a).toBeCloseTo(expected.a, 6);
    }
  });

  it("reads 8-digit hex alpha", () => {
    expect(hex("#00000080").a).toBeCloseTo(128 / 255, 10);
  });

  it("reads hsl() (checked against Python's colorsys)", () => {
    const c = hex("hsl(210 40% 17%)");
    expect(c.r).toBeCloseTo(26.01, 2);
    expect(c.g).toBeCloseTo(43.35, 2);
    expect(c.b).toBeCloseTo(60.69, 2);
  });

  it("reads oklch() and round-trips through it", () => {
    const red = rgbToOklch(hex("#ff0000"));
    expect(red.l).toBeCloseTo(0.6279553606, 6);
    expect(red.c).toBeCloseTo(0.2576833077, 6);
    expect(red.h).toBeCloseTo(29.2338851923, 4);
    expect(toHex(quantize(hex("oklch(0.6279553606 0.2576833077 29.2338851923)")))).toBe("#ff0000");
  });

  it("keeps a color a screen can't show inside the screen's range", () => {
    const c = oklchToRgb({ l: 0.7, c: 0.4, h: 150 });
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it.each([
    ["", "Type a color"],
    ["#12", "3, 4, 6 or 8 digits"],
    ["#ggg", "3, 4, 6 or 8 digits"],
    ["rgb(1 2)", "three numbers"],
    ["rgb(a b c)", "numbers 0-255"],
    ["hsl(red 1 2)", "hue in degrees"],
    ["banana", "isn't a color"],
    ["lab(50 20 30)", "lab() isn't supported"],
  ])("explains what's wrong with %j", (input, message) => {
    const r = parseColor(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});

describe("nearest passing color", () => {
  const white = hex("#ffffff");

  it("nudges #777 on white to the closest grey that passes body text", () => {
    const [first] = nearestPassing(hex("#777777"), white, 4.5, "text");
    expect(first).toBeDefined();
    expect(first!.direction).toBe("darker");
    expect(toHex(first!.color)).toBe("#767676");
    expect(first!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("every suggestion passes when checked again from its own hex code", () => {
    const cases: [string, string, number, "text" | "background"][] = [
      ["#ff6b6b", "#ffffff", 4.5, "text"],
      ["#3a7bd5", "#1b1b1b", 7, "text"],
      ["#ffdf3f", "#ffffff", 3, "text"],
      ["#2e7d32", "#e8f5e9", 4.5, "background"],
      ["#9c27b0", "#000052", 4.5, "background"],
    ];
    for (const [adjust, other, min, role] of cases) {
      const out = nearestPassing(hex(adjust), hex(other), min, role);
      expect(out.length).toBeGreaterThan(0);
      for (const s of out) {
        const again = hex(toHex(s.color));
        const ratio =
          role === "text" ? contrastRatio(again, hex(other)) : contrastRatio(hex(other), again);
        expect(ratio).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it("keeps the hue: a red stays red", () => {
    const [s] = nearestPassing(hex("#ff6b6b"), white, 4.5, "text");
    const before = rgbToOklch(hex("#ff6b6b")).h;
    const after = rgbToOklch(s!.color).h;
    expect(Math.abs(after - before)).toBeLessThan(6);
  });

  it("offers the closer of darker and lighter first", () => {
    const out = nearestPassing(hex("#808080"), hex("#808080"), 3, "text");
    expect(out.map((s) => s.direction).sort()).toEqual(["darker", "lighter"]);
    expect(out[0]!.change).toBeLessThanOrEqual(out[1]!.change);
  });

  it("says nothing passes when no color could (7:1 on mid grey)", () => {
    expect(bestPossible(hex("#777777"))).toBeCloseTo(4.68949989000882, 10);
    expect(nearestPassing(hex("#000000"), hex("#777777"), 7, "text")).toEqual([]);
  });

  it("keeps a transparent text color's alpha", () => {
    const [s] = nearestPassing(hex("#ff0000cc"), white, 4.5, "text");
    expect(s!.color.a).toBeCloseTo(204 / 255, 10);
    const bg = white;
    expect(contrastRatio(composite(s!.color, bg), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("finds nothing when the opacity itself is the limit (50% black on white is only 3.98)", () => {
    expect(nearestPassing(hex("#ff000080"), white, 4.5, "text")).toEqual([]);
  });

  it("change is the perceptual distance from the original", () => {
    const [s] = nearestPassing(hex("#777777"), white, 4.5, "text");
    expect(s!.change).toBeCloseTo(deltaE(hex("#777777"), s!.color), 12);
    expect(s!.change).toBeLessThan(0.01); // one step darker: barely visible
  });
});

describe("palette", () => {
  const sw = (id: string, input: string): Swatch => ({
    id,
    input,
    name: id,
    color: hex(input),
  });
  const grid = paletteGrid([
    sw("navy", "#000052"),
    sw("yellow", "#ffdf3f"),
    sw("white", "#ffffff"),
  ]);

  it("measures every pair, both ways", () => {
    expect(grid).toHaveLength(3);
    expect(grid[0]![1]!.ratio).toBeCloseTo(14.154297753329208, 10);
    expect(grid[1]![0]!.ratio).toBeCloseTo(14.154297753329208, 10);
    expect(grid[0]![0]!.ratio).toBe(1);
  });

  it("lists passing pairs highest first, skipping a color on itself", () => {
    const aa = passingPairs(grid, criterion("aa-text").min);
    expect(aa[0]!.ratio).toBeGreaterThanOrEqual(aa.at(-1)!.ratio);
    expect(aa.every((p) => p.text.id !== p.background.id)).toBe(true);
    expect(aa.map((p) => `${p.text.id}/${p.background.id}`)).toContain("navy/white");
    expect(aa.map((p) => `${p.text.id}/${p.background.id}`)).not.toContain("yellow/white");
  });
});

describe("share links", () => {
  it("round-trips a pair and a palette", () => {
    const pair = { mode: "pair" as const, text: "#1a2b3c", background: "#ffffff" };
    expect(decodeShare(encodeShare(pair))).toEqual(pair);
    const pal = { mode: "palette" as const, colors: ["#000052", "#ffdf3f", "#ffffff80"] };
    expect(decodeShare(encodeShare(pal))).toEqual(pal);
  });

  it("ignores junk instead of breaking", () => {
    expect(decodeShare("#pair=zzz,ffffff")).toBeNull();
    expect(decodeShare("#nothing")).toBeNull();
    expect(decodeShare("#palette=000052,nothex,ffffff")).toEqual({
      mode: "palette",
      colors: ["#000052", "#ffffff"],
    });
  });
});

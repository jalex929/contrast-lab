import {
  composite,
  deltaE,
  findColors,
  formatColor,
  FORMATS,
  oklchToRgb,
  parseColor,
  quantize,
  rgbToOklch,
  toHex,
  type Rgb,
} from "./color";
import { contrastRatio, criterion, evaluate, formatRatio, luminance } from "./contrast";
import { paletteGrid, passingPairs, type Swatch } from "./palette";
import { MAX_RECENT, pushRecent, readRecent } from "./recent";
import { sampleAt, sampleTextPair } from "./sample";
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

describe("sampling a photo", () => {
  // A 3x3 image: a red row, a green row, a blue row; the middle-right pixel is half transparent.
  const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
  const img = {
    width: 3,
    height: 3,
    data: new Uint8ClampedArray([
      ...px(255, 0, 0),
      ...px(255, 0, 0),
      ...px(255, 0, 0),
      ...px(0, 255, 0),
      ...px(0, 255, 0),
      ...px(0, 0, 0, 128),
      ...px(0, 0, 255),
      ...px(0, 0, 255),
      ...px(0, 0, 255),
    ]),
  };

  it("reads the exact pixel", () => {
    expect(sampleAt(img, 0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(sampleAt(img, 1.7, 2.2)).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it("clamps points outside the image to the nearest edge", () => {
    expect(sampleAt(img, -5, -5)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(sampleAt(img, 99, 99)).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it("averages a square, weighting by opacity", () => {
    const c = sampleAt(img, 0, 1, 3); // left two columns of all rows (clipped at the edge)
    expect(c.r).toBeCloseTo(255 / 3, 10);
    expect(c.g).toBeCloseTo(255 / 3, 10);
    expect(c.b).toBeCloseTo(255 / 3, 10);
    expect(c.a).toBe(1);
    const all = sampleAt(img, 1, 1, 3);
    expect(all.a).toBeCloseTo((8 + 128 / 255) / 9, 10);
  });

  it("a fully transparent spot is transparent", () => {
    const clear = { width: 1, height: 1, data: new Uint8ClampedArray([10, 20, 30, 0]) };
    expect(sampleAt(clear, 0, 0).a).toBe(0);
  });
});

describe("sampling text from a photo", () => {
  /** A white 40x20 box with a navy bar of "text", anti-aliased by a grey fringe. */
  function textImage(text: number[], bg: number[], fringe = true) {
    const w = 40;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inText = y >= 8 && y < 12 && x >= 5 && x < 35;
        const edge = fringe && (y === 7 || y === 12) && x >= 5 && x < 35;
        const c = inText ? text : edge ? text.map((v, k) => (v + bg[k]!) / 2) : bg;
        data.set([c[0]!, c[1]!, c[2]!, 255], i);
      }
    }
    return { width: w, height: h, data };
  }

  it("finds navy text on white, ignoring the anti-aliased fringe", () => {
    const pair = sampleTextPair(textImage([0, 0, 82], [255, 255, 255]), {
      x: 0,
      y: 0,
      width: 40,
      height: 20,
    });
    expect(pair).not.toBeNull();
    expect(toHex(quantize(pair!.background))).toBe("#ffffff");
    expect(toHex(quantize(pair!.text))).toBe("#000052");
    expect(pair!.backgroundShare).toBeGreaterThan(0.7);
  });

  it("works for light text on a dark background, and a box drawn backwards", () => {
    const pair = sampleTextPair(textImage([255, 223, 63], [0, 0, 82]), {
      x: 40,
      y: 20,
      width: -40,
      height: -20,
    });
    expect(toHex(quantize(pair!.text))).toBe("#ffdf3f");
    expect(toHex(quantize(pair!.background))).toBe("#000052");
  });

  it("has nothing to say about a single flat color", () => {
    const flat = textImage([9, 9, 9], [9, 9, 9], false);
    expect(sampleTextPair(flat, { x: 0, y: 0, width: 40, height: 20 })).toBeNull();
  });
});

describe("recent colors", () => {
  it("puts the newest first, without repeats", () => {
    expect(pushRecent(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(pushRecent([], "#AAAAAA", "#bbbbbb")).toEqual(["#aaaaaa", "#bbbbbb"]);
  });

  it("keeps at most twelve and skips anything that isn't a hex color", () => {
    const many = Array.from({ length: 20 }, (_, i) => `#0000${i.toString(16).padStart(2, "0")}`);
    expect(pushRecent([], ...many)).toHaveLength(MAX_RECENT);
    expect(pushRecent(["#111111"], "rgb(0 0 0)", "#12")).toEqual(["#111111"]);
  });

  it("reads a stored list safely", () => {
    expect(readRecent('["#111111","nope",3]')).toEqual(["#111111"]);
    expect(readRecent("not json")).toEqual([]);
    expect(readRecent(null)).toEqual([]);
  });
});

describe("finding colors in pasted text", () => {
  it("finds hex and color functions in any order, with anything between them", () => {
    expect(
      findColors("#000052, #ffdf3f\nrgb(255 255 255) and hsl(210 40% 17%); --x: #abc;"),
    ).toEqual(["#000052", "#ffdf3f", "rgb(255 255 255)", "hsl(210 40% 17%)", "#abc"]);
  });

  it("ignores things that only look like colors", () => {
    expect(findColors("issue #12345 and #ggg, 000000, rgb(nope)")).toEqual([]);
  });
});

describe("bare hex lists", () => {
  it("reads comma-separated hex codes without # when asked", () => {
    expect(findColors("000052, FFDF3F,ffffff 1a2b3c80", { bare: true })).toEqual([
      "#000052",
      "#ffdf3f",
      "#ffffff",
      "#1a2b3c80",
    ]);
  });

  it("still ignores short numbers and words", () => {
    expect(findColors("100, 200, cafe, 12345", { bare: true })).toEqual([]);
    expect(findColors("000052, ffdf3f")).toEqual([]); // bare codes only when asked
  });
});

describe("switching value formats", () => {
  const samples = [
    "#000052",
    "#ffdf3f",
    "#777777",
    "#ffffff",
    "#000000",
    "#1a7f5a",
    "#b4235a",
    "#2563eb",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#c1121f",
    "#f4f4f5",
    "#6b6b8f",
    "#ff000080",
  ];

  it.each(FORMATS.map((f) => f.id))("%s reads back to the exact same color", (format) => {
    for (const h of samples) {
      const written = formatColor(hex(h), format);
      expect(toHex(quantize(hex(written)))).toBe(h);
    }
  });

  it("writes each format the way CSS does", () => {
    expect(formatColor(hex("#ff0000"), "rgb")).toBe("rgb(255 0 0)");
    expect(formatColor(hex("#ff0000"), "hsl")).toBe("hsl(0 100% 50%)");
    expect(formatColor(hex("#ff000080"), "rgb")).toBe("rgb(255 0 0 / 0.502)");
    expect(formatColor(hex("#ffffff"), "oklch")).toMatch(/^oklch\(1 0 0\)$/);
  });

  it("never changes a contrast result", () => {
    for (const fmt of FORMATS.map((f) => f.id)) {
      const a = hex(formatColor(hex("#777777"), fmt));
      expect(contrastRatio(quantize(a), hex("#ffffff"))).toBeCloseTo(4.478089453577214, 10);
    }
  });
});

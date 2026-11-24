import type { Rgb } from "./color";
import { boxColors, extractPalette, extractSwatches } from "./palette-extract";
import { quantize, toHex } from "./color";

/** Horizontal bands of known colors (rows each), with a little seeded noise on every pixel. */
function bands(spec: [number[], number][], noise = 6) {
  const w = 100;
  const h = spec.reduce((n, [, rows]) => n + rows, 0);
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 2;
  };
  let row = 0;
  for (const [c, rows] of spec) {
    for (let y = row; y < row + rows; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data.set([c[0]! + rnd() * noise, c[1]! + rnd() * noise, c[2]! + rnd() * noise, 255], i);
      }
    }
    row += rows;
  }
  return { width: w, height: h, data };
}

const near = (c: Rgb, t: number[]) =>
  Math.abs(c.r - t[0]!) < 12 && Math.abs(c.g - t[1]!) < 12 && Math.abs(c.b - t[2]!) < 12;

describe("palette from a photo", () => {
  it("finds the main colors of a noisy image, most common first", () => {
    const pal = extractPalette(
      bands([
        [[240, 240, 235], 50],
        [[200, 30, 40], 30],
        [[20, 60, 160], 20],
      ]),
    );
    expect(pal).toHaveLength(3);
    expect(near(pal[0]!.color, [240, 240, 235])).toBe(true);
    expect(near(pal[1]!.color, [200, 30, 40])).toBe(true);
    expect(near(pal[2]!.color, [20, 60, 160])).toBe(true);
    expect(pal[0]!.share).toBeCloseTo(0.5, 1);
    expect(pal[2]!.share).toBeCloseTo(0.2, 1);
  });

  it("gives the same answer every time", () => {
    const img = bands([
      [[10, 10, 10], 40],
      [[250, 200, 0], 60],
    ]);
    expect(extractPalette(img)).toEqual(extractPalette(img));
  });

  it("drops specks smaller than the minimum share", () => {
    const img = bands(
      [
        [[255, 255, 255], 99],
        [[0, 0, 0], 1],
      ],
      0,
    );
    expect(extractPalette(img, { minShare: 0.02 })).toHaveLength(1);
    expect(extractPalette(img, { minShare: 0.005 })).toHaveLength(2);
  });

  it("caps the number of colors", () => {
    const many = bands(
      Array.from({ length: 12 }, (_, i) => [[i * 20, 255 - i * 20, (i * 70) % 255], 10]),
      0,
    );
    expect(extractPalette(many, { count: 5 })).toHaveLength(5);
  });

  it("returns nothing for a fully transparent image", () => {
    const clear = { width: 2, height: 2, data: new Uint8ClampedArray(16) };
    expect(extractPalette(clear)).toEqual([]);
  });
});

describe("colors inside a box", () => {
  const img = bands([
    [[240, 240, 235], 50],
    [[200, 30, 40], 50],
  ]);

  it("lists one color for a flat area and both where the box spans two", () => {
    expect(boxColors(img, { x: 0, y: 0, width: 100, height: 40 })).toHaveLength(1);
    const both = boxColors(img, { x: 0, y: 30, width: 100, height: 40 });
    expect(both).toHaveLength(2);
    expect(near(both[0]!.color, [200, 30, 40]) || near(both[0]!.color, [240, 240, 235])).toBe(true);
  });
});

describe("swatches from a palette screenshot", () => {
  /** A Figma-like board: a white page, six swatches with a light outline, grey label "text". */
  function board() {
    const w = 700;
    const h = 260;
    const data = new Uint8ClampedArray(w * h * 4);
    const put = (x: number, y: number, c: number[]) =>
      data.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(x, y, [255, 255, 255]);
    const cols = [
      [0, 0, 82],
      [255, 223, 63],
      [240, 96, 93],
      [26, 127, 90],
      [37, 99, 235],
      [244, 244, 245],
    ];
    cols.forEach((c, i) => {
      const x0 = 20 + i * 112;
      for (let y = 30; y < 150; y++)
        for (let x = x0; x < x0 + 96; x++) {
          const border = y === 30 || y === 149 || x === x0 || x === x0 + 95;
          put(x, y, border ? [229, 229, 229] : c);
        }
      // A label: thin grey strokes with anti-aliased edges, like small text.
      for (let x = x0; x < x0 + 60; x += 3) {
        for (let y = 170; y < 182; y++) {
          put(x, y, [120, 120, 120]);
          put(x + 1, y, [190, 190, 190]);
        }
      }
    });
    return { width: w, height: h, data };
  }

  it("finds every swatch, keeps near-white apart from the page, ignores labels and outlines", () => {
    const scan = extractSwatches(board());
    const found = scan.swatches.map((s) => toHex(quantize(s.color))).sort();
    expect(found).toEqual(
      ["#000052", "#ffdf3f", "#f0605d", "#1a7f5a", "#2563eb", "#f4f4f5"].sort(),
    );
    expect(toHex(quantize(scan.background!.color))).toBe("#ffffff");
  });

  it("returns nothing for an image with no flat areas", () => {
    const w = 40;
    const data = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < data.length; i += 4)
      data.set([(i * 37) % 255, (i * 11) % 255, (i * 5) % 255, 255], i);
    expect(extractSwatches({ width: w, height: w, data }).swatches).toEqual([]);
  });
});

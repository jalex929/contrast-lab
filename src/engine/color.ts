/**
 * Colors as sRGB channels 0-255 (not rounded) plus alpha 0-1, and parsing of the CSS color
 * formats people paste most: hex, rgb(), hsl() and oklch().
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
  /** 0 (transparent) to 1 (opaque). */
  a: number;
}

export type ParseResult = { ok: true; color: Rgb } | { ok: false; error: string };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** "#rrggbb", or "#rrggbbaa" when the color isn't fully opaque. Channels are rounded. */
export function toHex(c: Rgb): string {
  const h = (v: number) =>
    Math.round(clamp(v, 0, 255))
      .toString(16)
      .padStart(2, "0");
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return c.a >= 1 ? base : base + h(c.a * 255);
}

/** The same color with its channels rounded to whole numbers, as a hex code stores it. */
export function quantize(c: Rgb): Rgb {
  const q = (v: number) => Math.round(clamp(v, 0, 255));
  return { r: q(c.r), g: q(c.g), b: q(c.b), a: Math.round(clamp(c.a, 0, 1) * 255) / 255 };
}

export function opaque(c: Rgb): boolean {
  return c.a >= 1;
}

/** A partly transparent color painted over an opaque one: the color the eye actually sees. */
export function composite(top: Rgb, bottom: Rgb): Rgb {
  const a = clamp(top.a, 0, 1);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

// ---------- Parsing ----------

const HEX = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function parseHex(s: string): Rgb | null {
  const m = HEX.exec(s);
  if (!m) return null;
  let d = m[1]!;
  if (d.length <= 4) d = [...d].map((ch) => ch + ch).join("");
  const n = (i: number) => parseInt(d.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: d.length === 8 ? n(6) / 255 : 1 };
}

/** Splits "a b c / d" or "a, b, c, d" into number tokens. */
function args(inner: string): string[] | null {
  const slash = inner.split("/");
  if (slash.length > 2) return null;
  const main = slash[0]!
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  if (slash.length === 2) main.push(slash[1]!.trim());
  return main;
}

/** A number, or a percentage of `pct100`. Returns NaN when it isn't one. */
function num(tok: string, pct100: number): number {
  const t = tok.trim().toLowerCase();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/.test(t)) return NaN;
  return t.endsWith("%") ? (parseFloat(t) / 100) * pct100 : parseFloat(t);
}

function alpha(tok: string | undefined): number {
  if (tok === undefined) return 1;
  return num(tok, 1);
}

/** Hue in degrees; accepts a bare number or deg/turn/rad. */
function hue(tok: string): number {
  const t = tok.trim().toLowerCase();
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad|grad)?$/.exec(t);
  if (!m) return NaN;
  const v = parseFloat(m[1]!);
  switch (m[2]) {
    case "turn":
      return v * 360;
    case "rad":
      return (v * 180) / Math.PI;
    case "grad":
      return v * 0.9;
    default:
      return v;
  }
}

export function hslToRgb(h: number, s: number, l: number, a = 1): Rgb {
  const hh = (((h % 360) + 360) % 360) / 360;
  const f = (n: number) => {
    const k = (n + hh * 12) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
}

// OKLab / OKLCH (Björn Ottosson, 2020): a color space where equal steps look roughly equal.

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return c * 255;
}

export interface Oklch {
  /** Lightness 0-1. */
  l: number;
  /** Chroma, 0 for greys; sRGB colors stay under about 0.37. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

export function rgbToOklab(c: Rgb): [number, number, number] {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to sRGB channels, which may fall outside 0-255 for colors a screen can't show. */
export function oklabToRgbUnclamped(L: number, A: number, B: number): Rgb {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a: 1,
  };
}

export function rgbToOklch(c: Rgb): Oklch {
  const [l, a, b] = rgbToOklab(c);
  const chroma = Math.hypot(a, b);
  const h = chroma < 1e-7 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c: chroma, h };
}

export function oklchToRgbUnclamped(o: Oklch): Rgb {
  const rad = (o.h * Math.PI) / 180;
  return oklabToRgbUnclamped(o.l, o.c * Math.cos(rad), o.c * Math.sin(rad));
}

const EPS = 0.5; // half a channel step: rounding still lands inside 0-255

export function inGamut(c: Rgb): boolean {
  return [c.r, c.g, c.b].every((v) => v >= -EPS && v <= 255 + EPS);
}

/**
 * The color at this lightness and hue that a screen can show: keeps chroma when it fits,
 * otherwise lowers it just enough (hue and lightness stay put).
 */
export function oklchToRgb(o: Oklch): Rgb {
  const direct = oklchToRgbUnclamped(o);
  if (inGamut(direct)) return clampRgb(direct);
  let lo = 0;
  let hi = o.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgbUnclamped({ ...o, c: mid }))) lo = mid;
    else hi = mid;
  }
  return clampRgb(oklchToRgbUnclamped({ ...o, c: lo }));
}

function clampRgb(c: Rgb): Rgb {
  return { r: clamp(c.r, 0, 255), g: clamp(c.g, 0, 255), b: clamp(c.b, 0, 255), a: c.a };
}

/** How different two colors look (Euclidean distance in OKLab; about 0.02 is just noticeable). */
export function deltaE(x: Rgb, y: Rgb): number {
  const [l1, a1, b1] = rgbToOklab(x);
  const [l2, a2, b2] = rgbToOklab(y);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

const FORMATS = "a hex code like #1a2b3c, rgb(26 43 60), hsl(210 40% 17%) or oklch(0.3 0.04 250)";

/** Reads a CSS color. Errors say what was expected, in plain words. */
export function parseColor(input: string): ParseResult {
  const s = input.trim();
  if (!s) return { ok: false, error: `Type a color: ${FORMATS}.` };

  const hex = parseHex(s);
  if (hex) return { ok: true, color: hex };
  if (/^#/.test(s) || /^[0-9a-f]{3,8}$/i.test(s)) {
    return {
      ok: false,
      error: "A hex code has 3, 4, 6 or 8 digits from 0-9 and a-f, like #1a2b3c.",
    };
  }

  const fn = /^([a-z]+)\((.*)\)$/i.exec(s);
  if (!fn) return { ok: false, error: `That isn't a color this tool reads. Try ${FORMATS}.` };
  const name = fn[1]!.toLowerCase();
  const parts = args(fn[2]!);
  const bad = (what: string): ParseResult => ({ ok: false, error: `${what}` });

  if (name === "rgb" || name === "rgba") {
    if (!parts || parts.length < 3 || parts.length > 4) {
      return bad("rgb() needs three numbers (red, green, blue), and an optional alpha.");
    }
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
    const a = alpha(parts[3]);
    if ([r, g, b, a].some((v) => Number.isNaN(v))) {
      return bad("rgb() takes numbers 0-255 or percentages, like rgb(26 43 60).");
    }
    return {
      ok: true,
      color: {
        r: clamp(r!, 0, 255),
        g: clamp(g!, 0, 255),
        b: clamp(b!, 0, 255),
        a: clamp(a, 0, 1),
      },
    };
  }

  if (name === "hsl" || name === "hsla") {
    if (!parts || parts.length < 3 || parts.length > 4) {
      return bad("hsl() needs a hue, a saturation % and a lightness %, like hsl(210 40% 17%).");
    }
    const h = hue(parts[0]!);
    const sat = num(parts[1]!, 1);
    const light = num(parts[2]!, 1);
    const a = alpha(parts[3]);
    if ([h, sat, light, a].some((v) => Number.isNaN(v))) {
      return bad("hsl() takes a hue in degrees, then saturation and lightness as percentages.");
    }
    // A bare number for saturation or lightness means a percentage (CSS Color 4).
    const pct = (tok: string, v: number) => (tok.trim().endsWith("%") ? v : v / 100);
    return {
      ok: true,
      color: hslToRgb(
        h,
        clamp(pct(parts[1]!, sat), 0, 1),
        clamp(pct(parts[2]!, light), 0, 1),
        clamp(a, 0, 1),
      ),
    };
  }

  if (name === "oklch") {
    if (!parts || parts.length < 3 || parts.length > 4) {
      return bad("oklch() needs lightness, chroma and hue, like oklch(0.3 0.04 250).");
    }
    const l = num(parts[0]!, 1);
    const c = num(parts[1]!, 0.4);
    const h = hue(parts[2]!);
    const a = alpha(parts[3]);
    if ([l, c, h, a].some((v) => Number.isNaN(v))) {
      return bad("oklch() takes lightness (0-1 or %), chroma (like 0.1) and a hue in degrees.");
    }
    const rgb = oklchToRgb({ l: clamp(l, 0, 1), c: Math.max(0, c), h });
    return { ok: true, color: { ...rgb, a: clamp(a, 0, 1) } };
  }

  return { ok: false, error: `${name}() isn't supported here. Try ${FORMATS}.` };
}

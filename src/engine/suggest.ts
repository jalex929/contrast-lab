import { composite, deltaE, oklchToRgb, quantize, rgbToOklch, type Rgb } from "./color";
import { contrastRatio } from "./contrast";

export type Role = "text" | "background";

export interface Suggestion {
  /** The new color (opaque channels rounded, so its hex code is exactly what was checked). */
  color: Rgb;
  /** Contrast of the suggested pair. */
  ratio: number;
  /** How far it moved from the original (OKLab distance; about 0.02 is just noticeable). */
  change: number;
  direction: "darker" | "lighter";
}

/** Lightness steps when walking outward (each 0.005); the edge is then found by halving. */
const STEPS = 200;

/**
 * The closest colors to `original` that reach `min` contrast against `other`, one darker and
 * one lighter where each exists, closest first. Only lightness moves; hue and chroma are
 * kept, with chroma lowered only when a screen can't show it at the new lightness. Each
 * candidate is rounded to a real hex color before it's checked, so rounding can't turn a pass
 * into a fail.
 *
 * Text may be partly transparent: its alpha is kept and it's composited over the background
 * before measuring. Backgrounds are treated as opaque.
 */
export function nearestPassing(original: Rgb, other: Rgb, min: number, role: Role): Suggestion[] {
  const alpha = role === "text" ? original.a : 1;
  const base = { ...original, a: 1 };
  const target = rgbToOklch(base);

  const measure = (cand: Rgb): number => {
    if (role === "text") {
      const bg = { ...other, a: 1 };
      return contrastRatio(composite({ ...cand, a: alpha }, bg), bg);
    }
    const seenText = other.a < 1 ? composite(other, cand) : other;
    return contrastRatio(seenText, cand);
  };

  const at = (l: number): Rgb => quantize(oklchToRgb({ l, c: target.c, h: target.h }));

  type Best = { color: Rgb; ratio: number; change: number };
  const best: Record<"darker" | "lighter", Best | null> = { darker: null, lighter: null };
  const passes = (l: number) => measure(at(l)) >= min;

  // Walk outward from the original lightness in each direction; the first passing shade is the
  // closest one that way. Then narrow down between the last fail and the first pass, so the
  // answer sits right at the edge instead of up to one step past it.
  for (const dir of ["darker", "lighter"] as const) {
    const sign = dir === "darker" ? -1 : 1;
    let prev = target.l;
    for (let i = 1; i <= STEPS; i++) {
      const l = Math.min(1, Math.max(0, target.l + sign * (i / STEPS)));
      if (passes(l)) {
        let fail = prev;
        let pass = l;
        for (let k = 0; k < 14; k++) {
          const mid = (fail + pass) / 2;
          if (passes(mid)) pass = mid;
          else fail = mid;
        }
        const color = at(pass);
        best[dir] = { color, ratio: measure(color), change: deltaE(color, base) };
        break;
      }
      if (l === 0 || l === 1) break;
      prev = l;
    }
  }

  return (["darker", "lighter"] as const)
    .flatMap((dir) => {
      const b = best[dir];
      return b
        ? [{ color: { ...b.color, a: alpha }, ratio: b.ratio, change: b.change, direction: dir }]
        : [];
    })
    .sort((x, y) => x.change - y.change);
}

/** The highest contrast any color could reach against `other` (pure black or pure white). */
export function bestPossible(other: Rgb): number {
  const solid = { ...other, a: 1 };
  return Math.max(
    contrastRatio(solid, { r: 0, g: 0, b: 0, a: 1 }),
    contrastRatio(solid, { r: 255, g: 255, b: 255, a: 1 }),
  );
}

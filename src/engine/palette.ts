import { composite, type Rgb } from "./color";
import { contrastRatio } from "./contrast";

export interface Swatch {
  id: string;
  /** What the person typed, kept so their format survives. */
  input: string;
  name: string;
  color: Rgb;
}

export interface PairResult {
  text: Swatch;
  background: Swatch;
  ratio: number;
}

/**
 * Every swatch as text on every other swatch as background. Text with alpha is composited
 * over the background; a background is always treated as opaque. Ratios are symmetric for
 * opaque colors, but a transparent text color changes with its background, so both
 * directions are measured.
 */
export function paletteGrid(swatches: Swatch[]): PairResult[][] {
  return swatches.map((text) =>
    swatches.map((background) => {
      const bg = { ...background.color, a: 1 };
      const seen = text.color.a < 1 ? composite(text.color, bg) : text.color;
      return { text, background, ratio: contrastRatio(seen, bg) };
    }),
  );
}

/** Pairs (each direction once, no swatch on itself) that reach `min`, highest first. */
export function passingPairs(grid: PairResult[][], min: number): PairResult[] {
  return grid
    .flat()
    .filter((p) => p.text.id !== p.background.id && p.ratio >= min)
    .sort((a, b) => b.ratio - a.ratio);
}

export interface PairRow {
  /** Text color (or the first color, when the pair works both ways). */
  text: Swatch;
  background: Swatch;
  ratio: number;
  /** Both directions pass: either color can be the text on the other. */
  bothWays: boolean;
}

/**
 * Passing pairs with each two-way pair listed once. Opaque colors have the same ratio in both
 * directions, so "navy on white" and "white on navy" become one row marked both ways; a pair
 * that only works one way (transparent text) keeps its direction. Highest ratio first.
 */
export function mergeBothWays(pairs: PairResult[]): PairRow[] {
  const seen = new Map<string, PairRow>();
  for (const p of pairs) {
    const key = [p.text.id, p.background.id].sort().join("|");
    const had = seen.get(key);
    if (had) {
      had.bothWays = true;
      had.ratio = Math.min(had.ratio, p.ratio);
    } else
      seen.set(key, { text: p.text, background: p.background, ratio: p.ratio, bothWays: false });
  }
  return [...seen.values()].sort((a, b) => b.ratio - a.ratio);
}

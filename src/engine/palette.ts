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

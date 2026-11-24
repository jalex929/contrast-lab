import { composite, type Rgb } from "./color";

/**
 * WCAG 2.2 contrast. Relative luminance and the contrast ratio follow the WCAG definition
 * (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance), using the sRGB threshold 0.04045;
 * WCAG's older 0.03928 gives the same result for every 8-bit color.
 */

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** 0 for black, 1 for white. Alpha is ignored: composite first. */
export function luminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** From 1 (no contrast) to 21 (black on white). Order doesn't matter. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The ratio as people read it: two decimals, rounded DOWN, so a pair that fails never shows a
 * passing number (4.497 shows as 4.49, not 4.50). WCAG has no rounding: 4.499 fails 4.5.
 */
export function formatRatio(ratio: number): string {
  // The small allowance keeps float noise from turning an exact 4.5 into 4.49.
  return (Math.floor(ratio * 100 + 1e-9) / 100).toFixed(2);
}

export type CriterionId = "aa-text" | "aa-large" | "aaa-text" | "aaa-large" | "non-text";

export interface Criterion {
  id: CriterionId;
  /** The WCAG success criterion number. */
  sc: string;
  level: "AA" | "AAA";
  label: string;
  /** What it covers, in plain words. */
  appliesTo: string;
  min: number;
}

/** In the order a designer usually checks them. */
export const CRITERIA: Criterion[] = [
  {
    id: "aa-text",
    sc: "1.4.3",
    level: "AA",
    label: "Body text",
    appliesTo: "Regular text under 24px (18pt), or under about 18.7px (14pt) if bold",
    min: 4.5,
  },
  {
    id: "aa-large",
    sc: "1.4.3",
    level: "AA",
    label: "Large text",
    appliesTo: "Text at least 24px (18pt), or at least about 18.7px (14pt) bold",
    min: 3,
  },
  {
    id: "non-text",
    sc: "1.4.11",
    level: "AA",
    label: "Icons and control edges",
    appliesTo: "Icons, input borders, focus rings and chart parts people need to see",
    min: 3,
  },
  {
    id: "aaa-text",
    sc: "1.4.6",
    level: "AAA",
    label: "Body text, enhanced",
    appliesTo: "Regular text, at the stricter AAA level",
    min: 7,
  },
  {
    id: "aaa-large",
    sc: "1.4.6",
    level: "AAA",
    label: "Large text, enhanced",
    appliesTo: "Large text, at the stricter AAA level",
    min: 4.5,
  },
];

export function criterion(id: CriterionId): Criterion {
  return CRITERIA.find((c) => c.id === id)!;
}

export interface Check {
  criterion: Criterion;
  pass: boolean;
}

export interface Evaluation {
  /** The text color as it actually appears: a transparent text color is painted over the background first. */
  seen: Rgb;
  ratio: number;
  checks: Check[];
}

/**
 * Text color on a background. The background must be opaque (it's what everything sits on);
 * a partly transparent text color is composited over it, the way a browser paints it.
 */
export function evaluate(text: Rgb, background: Rgb): Evaluation {
  const bg = { ...background, a: 1 };
  const seen = text.a < 1 ? composite(text, bg) : text;
  const ratio = contrastRatio(seen, bg);
  return { seen, ratio, checks: CRITERIA.map((c) => ({ criterion: c, pass: ratio >= c.min })) };
}

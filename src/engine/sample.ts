import type { Rgb } from "./color";
import { luminance } from "./contrast";

/** The same shape as the browser's ImageData, so tests don't need a canvas. */
export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8ClampedArray;
}

/**
 * The color at (x, y), or the average of a square around it. Photos are noisy (grain, JPEG
 * blocks), so averaging a few pixels gives the color a person actually sees there. `size` is
 * the square's width in pixels (1 = the exact pixel). The square is clipped at the edges.
 * Partly transparent pixels count by how opaque they are.
 */
export function sampleAt(img: Pixels, x: number, y: number, size = 1): Rgb {
  const cx = clampInt(Math.floor(x), 0, img.width - 1);
  const cy = clampInt(Math.floor(y), 0, img.height - 1);
  const half = Math.floor(Math.max(1, size) / 2);
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let py = cy - half; py <= cy + half; py++) {
    if (py < 0 || py >= img.height) continue;
    for (let px = cx - half; px <= cx + half; px++) {
      if (px < 0 || px >= img.width) continue;
      const i = (py * img.width + px) * 4;
      const alpha = img.data[i + 3]! / 255;
      r += img.data[i]! * alpha;
      g += img.data[i + 1]! * alpha;
      b += img.data[i + 2]! * alpha;
      a += alpha;
      n++;
    }
  }
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return { r: r / a, g: g / a, b: b / a, a: a / n };
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextPair {
  text: Rgb;
  background: Rgb;
  /** Share of the box that is background (0-1); a hint at how clean the sample was. */
  backgroundShare: number;
}

/**
 * The text color and background color inside a box drawn around some text. The background is
 * the most common color in the box. The text is the color group that stands out most from it,
 * among groups big enough to be real strokes: anti-aliased edges blend the two into in-between
 * shades, and those must not win just because they differ a little. Colors are grouped in
 * steps of 8 per channel, then each group's pixels are averaged. Returns null when the box
 * holds only one color.
 */
export function sampleTextPair(img: Pixels, box: Box): TextPair | null {
  const x0 = clampInt(Math.floor(Math.min(box.x, box.x + box.width)), 0, img.width - 1);
  const y0 = clampInt(Math.floor(Math.min(box.y, box.y + box.height)), 0, img.height - 1);
  const x1 = clampInt(Math.ceil(Math.max(box.x, box.x + box.width)), x0 + 1, img.width);
  const y1 = clampInt(Math.ceil(Math.max(box.y, box.y + box.height)), y0 + 1, img.height);

  type Group = { n: number; r: number; g: number; b: number };
  const groups = new Map<number, Group>();
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3]! < 128) continue; // mostly transparent: not part of what's seen
      const r = img.data[i]!;
      const g = img.data[i + 1]!;
      const b = img.data[i + 2]!;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const grp = groups.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      grp.n++;
      grp.r += r;
      grp.g += g;
      grp.b += b;
      groups.set(key, grp);
      total++;
    }
  }
  if (total === 0 || groups.size < 2) return null;

  const mean = (grp: Group): Rgb => ({
    r: grp.r / grp.n,
    g: grp.g / grp.n,
    b: grp.b / grp.n,
    a: 1,
  });
  const all = [...groups.values()].sort((p, q) => q.n - p.n);
  const bgGroup = all[0]!;
  const background = mean(bgGroup);
  const bgLum = luminance(background);

  // Big enough to be a stroke, not an edge shade: at least 1.5% of the box, or the biggest
  // other group if text is very thin.
  const others = all.slice(1);
  const minCount = Math.max(2, Math.ceil(total * 0.015));
  const candidates = others.filter((grp) => grp.n >= minCount);
  const pool = candidates.length > 0 ? candidates : others.slice(0, 1);

  let best = pool[0]!;
  let bestRatio = 0;
  for (const grp of pool) {
    const l = luminance(mean(grp));
    const ratio = (Math.max(l, bgLum) + 0.05) / (Math.min(l, bgLum) + 0.05);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = grp;
    }
  }
  return { text: mean(best), background, backgroundShare: bgGroup.n / total };
}

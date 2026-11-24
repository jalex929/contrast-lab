import { oklabToRgbUnclamped, rgbToOklab, type Rgb } from "./color";
import type { Box, Pixels } from "./sample";

export interface ColorShare {
  color: Rgb;
  /** Share of the sampled pixels (0-1). */
  share: number;
}

type Lab = [number, number, number];

/**
 * The main colors of a photo, most common first, like a "palette from image" tool. Pixels are
 * clustered by k-means in OKLab (so a group is what eyes see as one color), starting from
 * spread-out seeds chosen the same way every time, so the result never changes for the same
 * image. Look-alike clusters are merged and specks under `minShare` are dropped.
 */
export function extractPalette(
  img: Pixels,
  opts: { count?: number; minShare?: number; maxSamples?: number } = {},
): ColorShare[] {
  const count = opts.count ?? 8;
  const minShare = opts.minShare ?? 0.01;
  const maxSamples = opts.maxSamples ?? 20000;
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / maxSamples)));

  const pts: Lab[] = [];
  for (let y = 0; y < img.height; y += step) {
    for (let x = 0; x < img.width; x += step) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3]! < 128) continue;
      pts.push(rgbToOklab({ r: img.data[i]!, g: img.data[i + 1]!, b: img.data[i + 2]!, a: 1 }));
    }
  }
  if (pts.length === 0) return [];

  // Seeds: start anywhere, then keep taking the point farthest from every seed so far.
  const k = Math.min(count + 4, pts.length); // a few extra; look-alikes merge below
  const seeds: Lab[] = [pts[0]!];
  const near = new Float64Array(pts.length).fill(Infinity);
  while (seeds.length < k) {
    const last = seeds[seeds.length - 1]!;
    let far = 0;
    for (let p = 0; p < pts.length; p++) {
      near[p] = Math.min(near[p]!, dist2(pts[p]!, last));
      if (near[p]! > near[far]!) far = p;
    }
    if (near[far]! === 0) break; // fewer distinct colors than seeds
    seeds.push(pts[far]!);
  }

  const centers: Lab[] = seeds.map((s) => [s[0], s[1], s[2]]);
  const sizes = new Array<number>(centers.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    const sums = centers.map((): [number, number, number] => [0, 0, 0]);
    sizes.fill(0);
    for (const pt of pts) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = dist2(pt, centers[c]!);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const s = sums[best]!;
      s[0] += pt[0];
      s[1] += pt[1];
      s[2] += pt[2];
      sizes[best]! += 1;
    }
    for (let c = 0; c < centers.length; c++) {
      const n = sizes[c]!;
      if (n > 0) centers[c] = [sums[c]![0]! / n, sums[c]![1]! / n, sums[c]![2]! / n];
    }
  }

  // Merge look-alikes (closer than about 3x a just-noticeable difference), biggest first.
  const order = centers.map((lab, i) => ({ lab, n: sizes[i]! })).filter((g) => g.n > 0);
  order.sort((a, b) => b.n - a.n);
  const merged: { lab: Lab; n: number }[] = [];
  for (const g of order) {
    const twin = merged.find((m) => Math.sqrt(dist2(m.lab, g.lab)) < 0.06);
    if (twin) {
      const n = twin.n + g.n;
      twin.lab = [
        (twin.lab[0] * twin.n + g.lab[0] * g.n) / n,
        (twin.lab[1] * twin.n + g.lab[1] * g.n) / n,
        (twin.lab[2] * twin.n + g.lab[2] * g.n) / n,
      ];
      twin.n = n;
    } else merged.push({ lab: [g.lab[0], g.lab[1], g.lab[2]], n: g.n });
  }

  return merged
    .map((m) => ({ color: fromLab(m.lab), share: m.n / pts.length }))
    .filter((m) => m.share >= minShare)
    .sort((a, b) => b.share - a.share)
    .slice(0, count);
}

/** The main colors inside a box, most common first, to check or correct a guess. */
export function boxColors(img: Pixels, box: Box, count = 6): ColorShare[] {
  const x0 = clampInt(Math.floor(Math.min(box.x, box.x + box.width)), 0, img.width - 1);
  const y0 = clampInt(Math.floor(Math.min(box.y, box.y + box.height)), 0, img.height - 1);
  const x1 = clampInt(Math.ceil(Math.max(box.x, box.x + box.width)), x0 + 1, img.width);
  const y1 = clampInt(Math.ceil(Math.max(box.y, box.y + box.height)), y0 + 1, img.height);
  const w = x1 - x0;
  const h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * img.width + x0) * 4;
    data.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  return extractPalette({ width: w, height: h, data }, { count, minShare: 0.005 });
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function dist2(a: Lab, b: Lab): number {
  const d0 = a[0] - b[0];
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return d0 * d0 + d1 * d1 + d2 * d2;
}

function fromLab(lab: Lab): Rgb {
  const c = oklabToRgbUnclamped(lab[0], lab[1], lab[2]);
  const cl = (v: number) => Math.min(255, Math.max(0, v));
  return { r: cl(c.r), g: cl(c.g), b: cl(c.b), a: 1 };
}

export interface SwatchScan {
  /** The swatch colors, biggest first. */
  swatches: ColorShare[];
  /** The page behind the swatches (it fills the image's edges), left out of `swatches`. */
  background: ColorShare | null;
}

/**
 * The colors of a palette screenshot (Coolors, a Figma board, a style guide), which is a
 * different problem from a photo: swatches are flat blocks, labels are small text, and the page
 * fills the edges. Only pixels inside flat areas count, so lettering and soft edges never become
 * colors; near-identical colors stay separate (a design system's #f4f4f5 is not its #ffffff);
 * and the color that fills most of the image's border is set aside as the page.
 */
export function extractSwatches(img: Pixels, maxSwatches = 8): SwatchScan {
  const maxSamples = 60000;
  const step = Math.max(1, Math.floor(Math.sqrt((img.width * img.height) / maxSamples)));
  const R = Math.max(2, step * 2); // neighbors this far away must match for a pixel to be "flat"
  const px = (x: number, y: number) => (y * img.width + x) * 4;
  const same = (i: number, j: number) =>
    Math.abs(img.data[i]! - img.data[j]!) <= 3 &&
    Math.abs(img.data[i + 1]! - img.data[j + 1]!) <= 3 &&
    Math.abs(img.data[i + 2]! - img.data[j + 2]!) <= 3 &&
    img.data[j + 3]! >= 200;

  // Count exact colors (to the nearest 2 per channel) in flat areas.
  const counts = new Map<number, { n: number; r: number; g: number; b: number; edge: number }>();
  let flatTotal = 0;
  let edgeTotal = 0;
  for (let y = R; y < img.height - R; y += step) {
    for (let x = R; x < img.width - R; x += step) {
      const i = px(x, y);
      if (img.data[i + 3]! < 200) continue;
      if (
        !same(i, px(x - R, y)) ||
        !same(i, px(x + R, y)) ||
        !same(i, px(x, y - R)) ||
        !same(i, px(x, y + R))
      )
        continue;
      const r = img.data[i]!;
      const g = img.data[i + 1]!;
      const b = img.data[i + 2]!;
      const key = ((r >> 1) << 14) | ((g >> 1) << 7) | (b >> 1);
      const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0, edge: 0 };
      c.n++;
      c.r += r;
      c.g += g;
      c.b += b;
      const onEdge =
        x - R < step || y - R < step || x + R + step >= img.width || y + R + step >= img.height;
      if (onEdge) {
        c.edge++;
        edgeTotal++;
      }
      counts.set(key, c);
      flatTotal++;
    }
  }
  if (flatTotal === 0) return { swatches: [], background: null };

  // Merge colors that are practically identical (JPEG wobble), not merely close.
  type Group = { lab: [number, number, number]; color: Rgb; n: number; edge: number };
  const groups: Group[] = [];
  for (const c of [...counts.values()].sort((a, b) => b.n - a.n)) {
    const color = { r: c.r / c.n, g: c.g / c.n, b: c.b / c.n, a: 1 };
    const lab = rgbToOklab(color);
    const twin = groups.find((g) => Math.sqrt(dist2(g.lab, lab)) < 0.012);
    if (twin) {
      twin.n += c.n;
      twin.edge += c.edge;
    } else groups.push({ lab, color, n: c.n, edge: c.edge });
  }

  // The page: the color filling most of the image's border.
  const byEdge = [...groups].sort((a, b) => b.edge - a.edge)[0]!;
  const isPage = edgeTotal > 0 && byEdge.edge / edgeTotal > 0.6;
  const page = isPage ? byEdge : null;

  const minShare = 0.002;
  const swatches = groups
    .filter((g) => g !== page && g.n / flatTotal >= minShare)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxSwatches)
    .map((g) => ({ color: g.color, share: g.n / flatTotal }));
  return {
    swatches,
    background: page ? { color: page.color, share: page.n / flatTotal } : null,
  };
}

import type { Pixels } from "../engine/sample";

/** Reads an image file into pixels, scaled down so its longer side is at most `maxSide`. */
export async function imageToPixels(file: File, maxSide = 2400): Promise<Pixels> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

/** The first image file in a paste or drop, if any. */
export function firstImage(files: FileList | File[] | undefined | null): File | null {
  return [...(files ?? [])].find((f) => f.type.startsWith("image/")) ?? null;
}

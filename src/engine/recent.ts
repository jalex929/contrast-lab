/** Recently used colors, newest first, no repeats. Stored as lowercase #rrggbb(aa). */
export const MAX_RECENT = 12;

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

export function pushRecent(list: string[], ...colors: string[]): string[] {
  let out = [...list];
  // Push in reverse so the first color given ends up newest.
  for (const raw of [...colors].reverse()) {
    const hex = raw.trim().toLowerCase();
    if (!HEX.test(hex)) continue;
    out = [hex, ...out.filter((c) => c !== hex)];
  }
  return out.slice(0, MAX_RECENT);
}

/** Reads a stored list, dropping anything that isn't a color. */
export function readRecent(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const v: unknown = JSON.parse(stored);
    return Array.isArray(v)
      ? pushRecent([], ...v.filter((x): x is string => typeof x === "string"))
      : [];
  } catch {
    return [];
  }
}

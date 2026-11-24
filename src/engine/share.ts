/**
 * Shareable state in the address (after #), so a link reopens the same check with no server:
 *   #pair=1a2b3c,ffffff            text, background
 *   #palette=000052,ffdf3f,ffffff  up to MAX_SWATCHES colors
 * Colors are stored as hex without "#" (6 or 8 digits). Anything unreadable is dropped.
 */

export const MAX_SWATCHES = 8;

export type Shared =
  { mode: "pair"; text: string; background: string } | { mode: "palette"; colors: string[] };

const HEX = /^[0-9a-f]{6}([0-9a-f]{2})?$/i;

const clean = (hex: string) => hex.replace(/^#/, "").toLowerCase();

export function encodeShare(s: Shared): string {
  if (s.mode === "pair") return `#pair=${clean(s.text)},${clean(s.background)}`;
  return `#palette=${s.colors.slice(0, MAX_SWATCHES).map(clean).join(",")}`;
}

export function decodeShare(hash: string): Shared | null {
  const m = /^#?(pair|palette)=([0-9a-z,]*)$/i.exec(hash.trim());
  if (!m) return null;
  const colors = m[2]!
    .split(",")
    .filter((c) => HEX.test(c))
    .map((c) => `#${c.toLowerCase()}`);
  if (m[1]!.toLowerCase() === "pair") {
    if (colors.length !== 2) return null;
    return { mode: "pair", text: colors[0]!, background: colors[1]! };
  }
  if (colors.length < 2) return null;
  return { mode: "palette", colors: colors.slice(0, MAX_SWATCHES) };
}

import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

export type Target = "text" | "background";

/** Drag-and-drop type for a color, plus plain text so it can be dropped into other apps. */
export const COLOR_MIME = "application/x-contrast-lab-color";

export function readDroppedColor(e: DragEvent): string | null {
  const v = e.dataTransfer.getData(COLOR_MIME) || e.dataTransfer.getData("text/plain");
  return v ? v.trim() : null;
}

export function isColorDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes(COLOR_MIME);
}

/**
 * A color swatch you can click (text color), Shift+click (background), drag onto a color well,
 * or hover to preview. Keyboard: Enter sets the text color, Shift+Enter the background; focus
 * previews like hover.
 */
export function Chip({
  hex,
  label,
  onPick,
  onPreview,
  fixedTarget,
  size = "md",
  defaultTarget = "text",
}: {
  hex: string;
  /** Spoken name, e.g. "#767676, recent color". */
  label: string;
  onPick: (target: Target, hex: string) => void;
  onPreview: (p: { target: Target; hex: string } | null) => void;
  /** When set, clicking always applies to this side (fixes know where they go). */
  fixedTarget?: Target;
  /** Where a plain click goes when there's no fixed side; Shift+click goes to the other. */
  defaultTarget?: Target;
  size?: "sm" | "md";
}) {
  const other: Target = defaultTarget === "text" ? "background" : "text";
  const targetFor = (shift: boolean): Target => fixedTarget ?? (shift ? other : defaultTarget);

  const hint = fixedTarget
    ? `Click to use as the ${fixedTarget === "text" ? "foreground" : "background"}`
    : `Click: ${defaultTarget === "text" ? "foreground" : "background"} · Shift+click: ${other === "text" ? "foreground" : "background"} · or drag onto a color`;

  return (
    <button
      type="button"
      className={`chip chip--${size}`}
      style={{ background: hex }}
      title={`${hex} · ${hint}`}
      aria-label={`${label}. ${fixedTarget ? "" : `Enter sets the ${defaultTarget === "text" ? "foreground" : "background"}, Shift+Enter the ${other === "text" ? "foreground" : "background"}.`}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(COLOR_MIME, hex);
        e.dataTransfer.setData("text/plain", hex);
        e.dataTransfer.effectAllowed = "copy";
        onPreview(null);
      }}
      onClick={(e: MouseEvent) => onPick(targetFor(e.shiftKey), hex)}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Enter" && e.shiftKey && !fixedTarget) {
          e.preventDefault();
          onPick(other, hex);
        }
      }}
      onMouseEnter={(e) => onPreview({ target: targetFor(e.shiftKey), hex })}
      onMouseMove={(e) => onPreview({ target: targetFor(e.shiftKey), hex })}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview({ target: targetFor(false), hex })}
      onBlur={() => onPreview(null)}
    />
  );
}

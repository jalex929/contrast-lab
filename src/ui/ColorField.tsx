import { useId, useState, type ReactNode } from "react";
import { isColorDrag, readDroppedColor } from "./Chip";
import { parseColor, quantize, toHex, type Rgb } from "../engine/color";

/** Chrome and Edge can pick a color from anywhere on screen; other browsers can't yet. */
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const EyeDropperApi: EyeDropperCtor | undefined =
  typeof window !== "undefined"
    ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    : undefined;

/**
 * A color you can type in any supported format, pick by clicking the swatch, or (where the
 * browser allows) pick from anywhere on screen. The typed text is kept as typed; while it can't
 * be read, the last good color stays in use and a plain message says what's wrong.
 */
export function ColorField({
  label,
  value,
  onChange,
  hint,
  action,
  compact = false,
}: {
  label: string;
  /** Exactly what's in the box. */
  value: string;
  onChange: (text: string) => void;
  hint?: string;
  /** A button at the end of the row (e.g. Remove in a palette). */
  action?: ReactNode;
  /** Smaller swatch and field, for lists. */
  compact?: boolean;
}) {
  const id = useId();
  const [dropping, setDropping] = useState(false);
  const parsed = parseColor(value);
  const color: Rgb | null = parsed.ok ? parsed.color : null;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // The system picker only knows opaque #rrggbb; keep the typed alpha when it's used.
  const pickerValue = color ? toHex(quantize({ ...color, a: 1 })) : "#000000";

  const keepAlpha = (hex: string) => {
    if (color && color.a < 1) {
      const a = Math.round(color.a * 255)
        .toString(16)
        .padStart(2, "0");
      onChange(hex + a);
    } else onChange(hex);
  };

  const pickFromScreen = async () => {
    if (!EyeDropperApi) return;
    try {
      const { sRGBHex } = await new EyeDropperApi().open();
      // Chrome returns #rrggbb; some versions return rgb(); both parse.
      const p = parseColor(sRGBHex);
      if (p.ok) keepAlpha(toHex(quantize({ ...p.color, a: 1 })));
    } catch {
      /* Escape or a click outside the page: nothing picked */
    }
  };

  return (
    <div
      className={`field ${compact ? "field--compact" : ""} ${dropping ? "field--drop" : ""}`}
      onDragOver={(e) => {
        if (!isColorDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!isColorDrag(e)) return;
        e.preventDefault();
        setDropping(false);
        const hex = readDroppedColor(e);
        if (hex) onChange(hex);
      }}
    >
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div
        className={`field__row ${EyeDropperApi ? "field__row--dropper" : ""} ${action ? "field__row--action" : ""}`}
      >
        <label className="field__swatch" title="Choose a color">
          <span className="visually-hidden">
            Choose {label.toLowerCase()} with the color picker
          </span>
          <span
            className="field__swatch-fill"
            style={{ background: color ? toHex(quantize(color)) : "transparent" }}
          />
          <input type="color" value={pickerValue} onChange={(e) => keepAlpha(e.target.value)} />
        </label>
        <input
          id={id}
          className="field__input"
          type="text"
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-invalid={!parsed.ok}
          aria-describedby={
            [hint ? hintId : "", parsed.ok ? "" : errorId].join(" ").trim() || undefined
          }
          onChange={(e) => onChange(e.target.value)}
        />
        {EyeDropperApi && (
          <button
            type="button"
            className="field__dropper"
            onClick={pickFromScreen}
            title="Pick a color from anywhere on screen"
          >
            <span className="visually-hidden">Pick {label.toLowerCase()} from the screen</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {/* Eyedropper: bulb at the top right, glass tube down to a tip at the bottom left. */}
              <path d="M17.6 3.6a2.1 2.1 0 013 3l-2.3 2.3.9.9-1.6 1.6-4.1-4.1 1.6-1.6.9.9z" />
              <path d="M12.6 8.8l-7 7a2 2 0 00-.5.9l-.6 2.4 2.4-.6a2 2 0 00.9-.5l7-7" />
            </svg>
          </button>
        )}
        {action}
      </div>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {!parsed.ok && (
        <p className="field__error" id={errorId}>
          <span aria-hidden="true">! </span>
          {parsed.error}
        </p>
      )}
    </div>
  );
}

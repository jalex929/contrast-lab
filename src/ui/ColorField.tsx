import { useId } from "react";
import { parseColor, toHex, quantize, type Rgb } from "../engine/color";

/**
 * A color you can type in any supported format or pick with the system picker. The typed text
 * is kept as typed; while it can't be read, the last good color stays in use and a plain
 * message says what's wrong.
 */
export function ColorField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  /** Exactly what's in the box. */
  value: string;
  onChange: (text: string) => void;
  hint?: string;
}) {
  const id = useId();
  const parsed = parseColor(value);
  const color: Rgb | null = parsed.ok ? parsed.color : null;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // The system picker only knows opaque #rrggbb; keep the typed alpha when it's used.
  const pickerValue = color ? toHex(quantize({ ...color, a: 1 })) : "#000000";

  const fromPicker = (hex: string) => {
    if (color && color.a < 1) {
      const a = Math.round(color.a * 255)
        .toString(16)
        .padStart(2, "0");
      onChange(hex + a);
    } else onChange(hex);
  };

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__row">
        <span className="field__swatch" aria-hidden="true">
          <span
            className="field__swatch-fill"
            style={{ background: color ? toHex(quantize(color)) : "transparent" }}
          />
        </span>
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
        <label className="field__picker">
          <span className="visually-hidden">Pick {label.toLowerCase()} with the color picker</span>
          <input type="color" value={pickerValue} onChange={(e) => fromPicker(e.target.value)} />
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 4.5l5 5M4 20l1-4 10.5-10.5 3 3L8 19z" />
          </svg>
        </label>
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

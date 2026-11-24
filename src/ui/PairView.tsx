import { useMemo, useRef, useState } from "react";
import { parseColor, quantize, toHex, type Rgb } from "../engine/color";
import { criterion, evaluate, formatRatio, luminance, type CriterionId } from "../engine/contrast";
import { bestPossible, nearestPassing, type Role, type Suggestion } from "../engine/suggest";
import { ColorField } from "./ColorField";

/** Keeps the last color that could be read, so a half-typed value doesn't blank the page. */
function useLastGood(text: string, fallback: Rgb): Rgb {
  const last = useRef(fallback);
  const p = parseColor(text);
  if (p.ok) last.current = p.color;
  return last.current;
}

const TARGETS: CriterionId[] = ["aa-text", "aa-large", "aaa-text"];

function changeWord(change: number): string {
  if (change < 0.02) return "barely visible change";
  if (change < 0.06) return "small change";
  if (change < 0.12) return "noticeable change";
  return "big change";
}

export function PairView({
  text,
  background,
  onText,
  onBackground,
}: {
  text: string;
  background: string;
  onText: (v: string) => void;
  onBackground: (v: string) => void;
}) {
  const fg = useLastGood(text, { r: 0, g: 0, b: 82, a: 1 });
  const bg = useLastGood(background, { r: 255, g: 255, b: 255, a: 1 });
  const bgOpaque = { ...bg, a: 1 };
  const result = evaluate(fg, bgOpaque);
  const ratioText = formatRatio(result.ratio);
  const [target, setTarget] = useState<CriterionId>("aa-text");
  const goal = criterion(target);

  const summary = summarize(result.checks.map((c) => [c.criterion.id, c.pass]));

  const fgHex = toHex(quantize(fg));
  const bgHex = toHex(quantize(bgOpaque));
  const seenHex = toHex(quantize(result.seen));

  const suggestions = useMemo(() => {
    if (result.ratio >= goal.min) return null;
    return {
      text: nearestPassing(fg, bgOpaque, goal.min, "text"),
      background: nearestPassing(bgOpaque, fg, goal.min, "background"),
    };
    // fg/bg are read through their hex codes, which change exactly when the colors do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fgHex, bgHex, goal.min, result.ratio]);

  const use = (role: Role, s: Suggestion) => {
    const hex = toHex(s.color);
    if (role === "text") onText(hex);
    else onBackground(hex);
  };

  const swap = () => {
    onText(background);
    onBackground(text);
  };

  return (
    <div className="pair">
      <section className="pair__inputs" aria-label="Colors">
        <ColorField
          label="Text color"
          value={text}
          onChange={onText}
          hint="Hex, rgb(), hsl() or oklch(). Transparent text is painted over the background."
        />
        <ColorField
          label="Background"
          value={background}
          onChange={onBackground}
          hint={
            bg.a < 1 ? "Backgrounds are measured as opaque; transparency is ignored." : undefined
          }
        />
        <button type="button" className="btn btn--quiet" onClick={swap}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
          </svg>
          Swap text and background
        </button>
      </section>

      <section className="pair__result" aria-labelledby="ratio-heading">
        <h2 id="ratio-heading" className="visually-hidden">
          Result
        </h2>
        <p className="ratio" aria-live="polite" aria-atomic="true">
          <span className="ratio__number">{ratioText}</span>
          <span className="ratio__unit">: 1</span>
          <span className="visually-hidden"> contrast. </span>
          <span className="ratio__summary">{summary}</span>
        </p>

        <ul className="checks" role="list">
          {result.checks.map(({ criterion: c, pass }) => (
            <li key={c.id} className={`check ${pass ? "check--pass" : "check--fail"}`}>
              <span className="check__badge">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {pass ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
                </svg>
                {pass ? "Pass" : "Fail"}
              </span>
              <span className="check__what">
                <span className="check__label">{c.label}</span>
                <span className="check__applies">{c.appliesTo}</span>
              </span>
              <span className="check__rule">
                {c.level} · SC {c.sc} · needs {c.min}:1
              </span>
            </li>
          ))}
        </ul>

        <details className="math">
          <summary>Show the math</summary>
          <ol>
            <li>
              Relative luminance (0 is black, 1 is white): text{" "}
              <code>{luminance(result.seen).toFixed(4)}</code>, background{" "}
              <code>{luminance(bgOpaque).toFixed(4)}</code>.
              {fg.a < 1 && (
                <>
                  {" "}
                  The text is {Math.round(fg.a * 100)}% opaque, so it's measured as the color you
                  actually see, <code>{seenHex}</code>.
                </>
              )}
            </li>
            <li>
              Contrast = (lighter + 0.05) ÷ (darker + 0.05) ={" "}
              <code>
                ({Math.max(luminance(result.seen), luminance(bgOpaque)).toFixed(4)} + 0.05) ÷ (
                {Math.min(luminance(result.seen), luminance(bgOpaque)).toFixed(4)} + 0.05) ={" "}
                {result.ratio.toFixed(3)}
              </code>
              .
            </li>
            <li>
              WCAG has no rounding: 4.499 fails a 4.5 rule. That's why the ratio above is rounded
              down, never up.
            </li>
          </ol>
        </details>
      </section>

      <section className="preview" aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="section-title">
          Preview
        </h2>
        <div className="preview__card" style={{ background: bgHex, color: toHex(quantize(fg)) }}>
          <p className="preview__large">Large heading text</p>
          <p className="preview__body">
            Body text at 16px. This is what a paragraph looks like in these colors, the case that
            needs 4.5:1.
          </p>
          <div className="preview__controls">
            <span className="preview__button" style={{ borderColor: toHex(quantize(fg)) }}>
              Button
            </span>
            <span className="preview__input" style={{ borderColor: toHex(quantize(fg)) }}>
              Input border
            </span>
            <svg viewBox="0 0 24 24" className="preview__icon" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16.5v.5" />
            </svg>
          </div>
        </div>
        <p className="note">
          The preview uses your colors for text, outlines and the icon. It's a guide; the checks
          above are the measurement.
        </p>
      </section>

      <section className="fix" aria-labelledby="fix-heading">
        <div className="fix__head">
          <h2 id="fix-heading" className="section-title">
            Nearest colors that pass
          </h2>
          <fieldset className="segmented">
            <legend>Aim for</legend>
            {TARGETS.map((id) => {
              const c = criterion(id);
              return (
                <label key={id} className="segmented__option">
                  <input
                    type="radio"
                    name="target"
                    value={id}
                    checked={target === id}
                    onChange={() => setTarget(id)}
                  />
                  <span>
                    {c.label} {c.level} ({c.min}:1)
                  </span>
                </label>
              );
            })}
          </fieldset>
        </div>

        {!suggestions ? (
          <p className="fix__ok">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            This pair already passes {goal.label.toLowerCase()} {goal.level}. Nothing to fix.
          </p>
        ) : (
          <div className="fix__groups">
            <SuggestionGroup
              title="Change the text color"
              items={suggestions.text}
              emptyNote={
                fg.a < 1
                  ? `No text color at ${Math.round(fg.a * 100)}% opacity reaches ${goal.min}:1 here. Make the text more opaque or change the background.`
                  : `No text color reaches ${goal.min}:1 on this background (the most possible is ${formatRatio(bestPossible(bgOpaque))}:1). Change the background instead.`
              }
              onUse={(s) => use("text", s)}
            />
            <SuggestionGroup
              title="Change the background"
              items={suggestions.background}
              emptyNote={`No background reaches ${goal.min}:1 with this text color. Change the text color instead.`}
              onUse={(s) => use("background", s)}
            />
          </div>
        )}
        <p className="note">
          Suggestions keep the hue and move only lightness, as little as possible. Each one is
          checked again from its exact hex code.
        </p>
      </section>
    </div>
  );
}

function SuggestionGroup({
  title,
  items,
  emptyNote,
  onUse,
}: {
  title: string;
  items: Suggestion[];
  emptyNote: string;
  onUse: (s: Suggestion) => void;
}) {
  return (
    <div className="fix__group">
      <h3 className="fix__title">{title}</h3>
      {items.length === 0 ? (
        <p className="note">{emptyNote}</p>
      ) : (
        <ul className="suggestions" role="list">
          {items.map((s) => {
            const hex = toHex(s.color);
            return (
              <li key={s.direction} className="suggestion">
                <span
                  className="suggestion__swatch"
                  style={{ background: toHex(quantize({ ...s.color, a: 1 })) }}
                  aria-hidden="true"
                />
                <span className="suggestion__text">
                  <code className="suggestion__hex">{hex}</code>
                  <span className="suggestion__meta">
                    {s.direction === "darker" ? "Darker" : "Lighter"} · {formatRatio(s.ratio)}:1 ·{" "}
                    {changeWord(s.change)}
                  </span>
                </span>
                <button type="button" className="btn btn--small" onClick={() => onUse(s)}>
                  Use <span className="visually-hidden">{hex}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One plain sentence: what passes and fails at AA, then how AAA goes. */
function summarize(checks: [CriterionId, boolean][]): string {
  const ok = Object.fromEntries(checks) as Record<CriterionId, boolean>;
  const aa: [string, boolean][] = [
    ["body text", ok["aa-text"]],
    ["large text", ok["aa-large"]],
    ["icons and control edges", ok["non-text"]],
  ];
  const aaPass = aa.filter(([, p]) => p).map(([n]) => n);
  const aaFail = aa.filter(([, p]) => !p).map(([n]) => n);
  const aaLine =
    aaFail.length === 0
      ? "Passes AA for everything."
      : aaPass.length === 0
        ? "Fails AA for everything."
        : `AA: passes ${list(aaPass)}; fails ${list(aaFail)}.`;
  const aaaLine =
    ok["aaa-text"] && ok["aaa-large"]
      ? "Passes AAA too."
      : ok["aaa-large"]
        ? "AAA: passes large text only."
        : "Doesn't reach AAA.";
  return `${aaLine} ${aaaLine}`;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

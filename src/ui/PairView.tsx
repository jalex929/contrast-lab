import { useEffect, useMemo, useRef, useState } from "react";
import { parseColor, quantize, toHex, type Rgb } from "../engine/color";
import {
  CRITERIA,
  criterion,
  evaluate,
  formatRatio,
  luminance,
  type CriterionId,
} from "../engine/contrast";
import { bestPossible, nearestPassing, type Suggestion } from "../engine/suggest";
import { Chip, type Target } from "./Chip";
import { ColorField } from "./ColorField";
import { PhotoPicker } from "./PhotoPicker";
import { action } from "../telemetry";

/** True while the layout is a single column (the CSS breakpoint for the stacked layout). */
function useNarrow(): boolean {
  const query = "(max-width: 979px)";
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

/** Keeps the last color that could be read, so a half-typed value doesn't blank the page. */
function useLastGood(text: string, fallback: Rgb): Rgb {
  const last = useRef(fallback);
  const p = parseColor(text);
  if (p.ok) last.current = p.color;
  return last.current;
}

const TARGETS: CriterionId[] = ["aa-text", "aa-large", "non-text", "aaa-text", "aaa-large"];

const SHORT: Record<CriterionId, string> = {
  "aa-text": "Body text",
  "aa-large": "Large text",
  "non-text": "Icons & edges",
  "aaa-text": "Body text",
  "aaa-large": "Large text",
};

function changeWord(change: number): string {
  if (change < 0.02) return "barely visible";
  if (change < 0.06) return "small change";
  if (change < 0.12) return "noticeable";
  return "big change";
}

const hexOf = (c: Rgb) => toHex(quantize(c));

export function PairView({
  text,
  background,
  onText,
  onBackground,
  onSwap,
  recent,
  onPalette,
  inFormat,
}: {
  text: string;
  background: string;
  onText: (v: string) => void;
  onBackground: (v: string) => void;
  onSwap: (how?: "button" | "bar") => void;
  recent: string[];
  /** Open these colors in palette mode. */
  onPalette: (hexes: string[]) => void;
  /** Writes a picked color in the format the person chose. */
  inFormat: (value: string) => string;
}) {
  const fg = useLastGood(text, { r: 119, g: 119, b: 119, a: 1 });
  const bg = useLastGood(background, { r: 255, g: 255, b: 255, a: 1 });
  const [target, setTarget] = useState<CriterionId>("aa-text");
  const [preview, setPreview] = useState<{ target: Target; hex: string } | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const narrow = useNarrow();
  const [recentTarget, setRecentTarget] = useState<Target>("text");
  const goal = criterion(target);

  // What's shown: the committed colors, or a preview while hovering or focusing a swatch.
  const parsedPreview = preview ? parseColor(preview.hex) : null;
  const showFg = parsedPreview?.ok && preview!.target === "text" ? parsedPreview.color : fg;
  const showBg = parsedPreview?.ok && preview!.target === "background" ? parsedPreview.color : bg;
  const shown = evaluate(showFg, { ...showBg, a: 1 });
  const committed = evaluate(fg, { ...bg, a: 1 });

  const fgHex = hexOf(fg);
  const bgHex = hexOf({ ...bg, a: 1 });

  const suggestions = useMemo(() => {
    const bgSolid = { ...bg, a: 1 };
    if (committed.ratio >= goal.min) return null;
    return {
      text: nearestPassing(fg, bgSolid, goal.min, "text"),
      background: nearestPassing(bgSolid, fg, goal.min, "background"),
    };
    // fg/bg are read through their hex codes, which change exactly when the colors do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fgHex, bgHex, goal.min, committed.ratio]);

  const pick = (t: Target, hex: string) => {
    setPreview(null);
    if (t === "text") onText(inFormat(hex));
    else onBackground(inFormat(hex));
  };

  const canvasFg = hexOf(showFg);
  const canvasBg = hexOf({ ...showBg, a: 1 });
  const passes = (id: CriterionId) => shown.checks.find((c) => c.criterion.id === id)!.pass;

  const fixPanel = (
    <section className="panel-block" aria-labelledby="fix-heading">
      <div className="panel-block__head">
        <h2 id="fix-heading">Nearest passing colors</h2>
        <label className="aim">
          <span className="visually-hidden">Aim for</span>
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as CriterionId);
              action("aim_change", { aim: e.target.value });
            }}
          >
            {TARGETS.map((id) => {
              const c = criterion(id);
              return (
                <option key={id} value={id}>
                  {SHORT[id]} {c.level} · {c.min}:1
                </option>
              );
            })}
          </select>
        </label>
      </div>
      {!suggestions ? (
        <p className="fix-ok">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Passes {SHORT[target].toLowerCase()} {goal.level}. Nothing to fix.
        </p>
      ) : (
        <>
          <FixGroup
            title="Foreground"
            items={suggestions.text}
            target="text"
            empty={
              fg.a < 1
                ? `At ${Math.round(fg.a * 100)}% opacity no text color reaches ${goal.min}:1. Raise the opacity or change the background.`
                : `No text color reaches ${goal.min}:1 here (most possible: ${formatRatio(bestPossible({ ...bg, a: 1 }))}:1). Change the background.`
            }
            onPick={(t, h) => {
              action("use_fix", { side: t, aim: target });
              pick(t, h);
            }}
            onPreview={setPreview}
          />
          <FixGroup
            title="Background"
            items={suggestions.background}
            target="background"
            empty={`No background reaches ${goal.min}:1 with this text color.`}
            onPick={(t, h) => {
              action("use_fix", { side: t, aim: target });
              pick(t, h);
            }}
            onPreview={setPreview}
          />
        </>
      )}
      <p className="hint">
        Same hue, lightness moved as little as possible.
        <span className="hover-only"> Hover to preview.</span>
      </p>
    </section>
  );

  return (
    <div className="pair">
      {/* Phones: the two colors, the ratio and swap stay in view while scrolling. */}
      <div className="sticky-bar">
        <span
          className="sticky-bar__pair"
          style={{ background: canvasBg, color: canvasFg }}
          aria-hidden="true"
        >
          Aa
        </span>
        <span className="sticky-bar__ratio" aria-hidden="true">
          {formatRatio(shown.ratio)}:1
        </span>
        <span
          className={`sticky-bar__verdict ${passes("aa-text") ? "is-pass" : "is-fail"}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {passes("aa-text") ? (
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            ) : (
              <path d="M6 6l12 12M18 6L6 18" />
            )}
          </svg>
          AA body
        </span>
        <button type="button" className="btn btn--quiet btn--small" onClick={() => onSwap("bar")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
          </svg>
          Swap
        </button>
      </div>

      <section className="stage" aria-labelledby="result-heading">
        <h2 id="result-heading" className="visually-hidden">
          Result
        </h2>
        {/* Screen readers hear committed changes only, not every hover preview. */}
        <p className="visually-hidden" aria-live="polite" aria-atomic="true">
          {formatRatio(committed.ratio)} to 1 contrast. {summarize(committed.checks)}
        </p>

        <div className="canvas" style={{ background: canvasBg, color: canvasFg }}>
          {preview && (
            <span className="canvas__badge">
              Previewing {preview.hex} as the{" "}
              {preview.target === "text" ? "foreground" : "background"} · click to keep
            </span>
          )}
          <p className="canvas__ratio" aria-hidden="true">
            {formatRatio(shown.ratio)}
            <span>:1</span>
          </p>
          <p className="canvas__large">Large heading text</p>
          <p className="canvas__body">
            Body text at 16px, the size most reading happens at. This is what a paragraph looks like
            in these colors.
          </p>
          <div className="canvas__controls">
            <span className="canvas__button" style={{ background: canvasFg, color: canvasBg }}>
              Button
            </span>
            <span className="canvas__outline" style={{ borderColor: canvasFg }}>
              Outlined button
            </span>
            <svg viewBox="0 0 24 24" className="canvas__icon" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v5M12 16.5v.5" />
            </svg>
          </div>
        </div>

        <p className="verdict">{summarize(shown.checks)}</p>

        <ul className="checks" role="list">
          {shown.checks.map(({ criterion: c, pass }) => (
            <li
              key={c.id}
              className={`check ${pass ? "check--pass" : "check--fail"}`}
              title={`${c.appliesTo}. WCAG ${c.level}, SC ${c.sc}.`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {pass ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
              </svg>
              <span className="check__name">
                <span className="visually-hidden">{pass ? "Pass: " : "Fail: "}</span>
                {SHORT[c.id]} <span className="check__level">{c.level}</span>
              </span>
              <span className="check__min">{c.min}:1</span>
            </li>
          ))}
        </ul>

        {narrow && fixPanel}

        <details
          className="math"
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) action("math_open");
          }}
        >
          <summary>Show the math and what each check covers</summary>
          <ol>
            <li>
              Relative luminance (0 is black, 1 is white): text{" "}
              <code>{luminance(committed.seen).toFixed(4)}</code>, background{" "}
              <code>{luminance({ ...bg, a: 1 }).toFixed(4)}</code>.
              {fg.a < 1 && (
                <>
                  {" "}
                  The text is {Math.round(fg.a * 100)}% opaque, so it's measured as the color you
                  actually see, <code>{hexOf(committed.seen)}</code>.
                </>
              )}
            </li>
            <li>
              Contrast = (lighter + 0.05) ÷ (darker + 0.05) ={" "}
              <code>{committed.ratio.toFixed(3)}</code>. WCAG has no rounding: 4.499 fails a 4.5
              rule, so the ratio shown is rounded down, never up.
            </li>
          </ol>
          <dl className="rules">
            {CRITERIA.map((c) => (
              <div key={c.id}>
                <dt>
                  {c.label} · {c.level} · SC {c.sc} · {c.min}:1
                </dt>
                <dd>{c.appliesTo}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      <aside className="side" aria-label="Colors and fixes">
        <div className="wells">
          <ColorField
            label="Foreground"
            value={text}
            onChange={onText}
            hint="Text, an icon or a border."
          />
          <button
            type="button"
            className="swap"
            onClick={() => onSwap("button")}
            title="Swap foreground and background (X)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4v16M7 4L3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />
            </svg>
            Swap colors <kbd aria-hidden="true">X</kbd>
          </button>
          <ColorField
            label="Background"
            value={background}
            onChange={onBackground}
            hint={bg.a < 1 ? "Backgrounds are measured as opaque." : undefined}
          />
        </div>

        <details
          className="panel-block photo-drawer"
          open={photoOpen}
          onToggle={(e) => setPhotoOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            Pick from a photo <span className="hint">paste, drop or choose</span>
          </summary>
          <PhotoPicker
            text={text}
            background={background}
            onImage={() => setPhotoOpen(true)}
            onKind={(k) => setTarget(k === "text" ? "aa-text" : "non-text")}
            onPalette={onPalette}
            onPair={(t, b) => {
              onText(inFormat(t));
              onBackground(inFormat(b));
            }}
            onColor={pick}
          />
        </details>

        {!narrow && fixPanel}

        <section className="panel-block" aria-labelledby="recent-heading">
          <div className="panel-block__head">
            <h2 id="recent-heading">Recent colors</h2>
            <fieldset className="segmented segmented--tiny">
              <legend className="visually-hidden">Recent colors apply to</legend>
              {(
                [
                  ["text", "Foreground"],
                  ["background", "Background"],
                ] as const
              ).map(([id, lbl]) => (
                <label key={id} className="segmented__option">
                  <input
                    type="radio"
                    name="recent-target"
                    checked={recentTarget === id}
                    onChange={() => setRecentTarget(id)}
                  />
                  <span>{lbl}</span>
                </label>
              ))}
            </fieldset>
          </div>
          {recent.length === 0 ? (
            <p className="hint">Colors you use show up here.</p>
          ) : (
            <>
              <ul className="recent" role="list">
                {recent.map((hex) => (
                  <li key={hex}>
                    <Chip
                      hex={hex}
                      label={`${hex}, recent color`}
                      defaultTarget={recentTarget}
                      onPick={(t, h) => {
                        action("recent_pick", { side: t });
                        pick(t, h);
                      }}
                      onPreview={setPreview}
                    />
                  </li>
                ))}
              </ul>
              <p className="hint">
                Sets the {recentTarget === "text" ? "foreground" : "background"}.
                <span className="hover-only">
                  {" "}
                  Shift+click for the {recentTarget === "text" ? "background" : "foreground"}, or
                  drag onto a color.
                </span>
              </p>
            </>
          )}
        </section>
      </aside>
    </div>
  );
}

function FixGroup({
  title,
  items,
  target,
  empty,
  onPick,
  onPreview,
}: {
  title: string;
  items: Suggestion[];
  target: Target;
  empty: string;
  onPick: (t: Target, hex: string) => void;
  onPreview: (p: { target: Target; hex: string } | null) => void;
}) {
  return (
    <div className="fix">
      <h3 className="fix__title">{title}</h3>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <ul className="fix__list" role="list">
          {items.map((s) => {
            const hex = toHex(s.color);
            return (
              <li
                key={s.direction}
                className="fix__row"
                onMouseEnter={() => onPreview({ target, hex })}
                onMouseLeave={() => onPreview(null)}
              >
                <Chip
                  hex={hex}
                  size="sm"
                  label={`${hex}, ${s.direction}, ${formatRatio(s.ratio)} to 1`}
                  fixedTarget={target}
                  onPick={onPick}
                  onPreview={onPreview}
                />
                <span className="fix__text">
                  <code>{hex}</code>
                  <span>
                    {s.direction} · {formatRatio(s.ratio)}:1 · {changeWord(s.change)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => onPick(target, hex)}
                  onFocus={() => onPreview({ target, hex })}
                  onBlur={() => onPreview(null)}
                >
                  Use<span className="visually-hidden"> {hex}</span>
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
function summarize(checks: { criterion: { id: CriterionId }; pass: boolean }[]): string {
  const ok = Object.fromEntries(checks.map((c) => [c.criterion.id, c.pass])) as Record<
    CriterionId,
    boolean
  >;
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

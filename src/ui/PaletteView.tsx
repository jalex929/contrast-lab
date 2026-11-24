import { useEffect, useRef, useState } from "react";
import { findColors, parseColor, quantize, toHex } from "../engine/color";
import { criterion, formatRatio, type CriterionId } from "../engine/contrast";
import { mergeBothWays, paletteGrid, passingPairs, type Swatch } from "../engine/palette";
import { MAX_SWATCHES } from "../engine/share";
import { extractSwatches } from "../engine/palette-extract";
import { ColorField } from "./ColorField";
import { firstImage, imageToPixels } from "./imagePixels";
import { action } from "../telemetry";

export interface PaletteEntry {
  id: string;
  input: string;
}

const TARGETS: CriterionId[] = ["aa-text", "aa-large", "aaa-text"];

let nextId = 0;
export const newEntry = (input: string): PaletteEntry => ({ id: `c${nextId++}`, input });

export function PaletteView({
  entries,
  onChange,
  onCheckPair,
  recent,
  inFormat,
}: {
  entries: PaletteEntry[];
  onChange: (entries: PaletteEntry[]) => void;
  onCheckPair: (text: string, background: string) => void;
  /** Recently used colors, offered as one-click additions. */
  recent: string[];
  /** Writes a color in the format the person chose. */
  inFormat: (value: string) => string;
}) {
  const [target, setTarget] = useState<CriterionId>("aa-text");
  const [pasted, setPasted] = useState("");
  const [pasteNote, setPasteNote] = useState("");
  /** The page color a screenshot was set on, left out of the palette but offered back. */
  const [pageColor, setPageColor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hexesInUse = new Set(
    entries.map((e) => {
      const p = parseColor(e.input);
      return p.ok ? toHex(quantize(p.color)) : e.input;
    }),
  );
  const suggestions = recent.filter((h) => !hexesInUse.has(h)).slice(0, 12);

  const addColor = (hex: string) => {
    if (entries.length >= MAX_SWATCHES) {
      setPasteNote(`A palette holds up to ${MAX_SWATCHES} colors. Remove one first.`);
      return;
    }
    action("palette_add_recent");
    onChange([...entries, newEntry(inFormat(hex))]);
  };

  // A screenshot of a palette (Coolors, a Figma board, a style guide): find its swatches.
  const fromImage = async (file: File, via: "paste" | "drop" | "file") => {
    try {
      const px = await imageToPixels(file, 1600);
      const scan = extractSwatches(px, MAX_SWATCHES);
      const found = scan.swatches;
      const page = scan.background ? toHex(quantize({ ...scan.background.color, a: 1 })) : null;
      if (found.length < 2) {
        setPageColor(null);
        setPasteNote(
          "Couldn't find at least two solid swatches in that image. Try a tighter screenshot of the palette.",
        );
        return;
      }
      onChange(found.map((c) => newEntry(inFormat(toHex(quantize({ ...c.color, a: 1 }))))));
      action("palette_from_image", { via, count: found.length, page: page !== null });
      setPageColor(page);
      setPasteNote(
        `Found ${found.length} swatches in the image.` +
          (page ? ` Left out ${page}, the page behind them.` : ""),
      );
    } catch {
      setPasteNote("That image couldn't be opened. Try a PNG, JPG or WebP.");
    }
  };
  const fromImageRef = useRef(fromImage);
  fromImageRef.current = fromImage;

  // Paste a screenshot anywhere on this tab (pasting text into a field still works).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = firstImage(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      void fromImageRef.current(file, "paste");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const usePasted = () => {
    const found = findColors(pasted, { bare: true });
    if (found.length < 2) {
      setPasteNote(
        found.length === 1
          ? "Found one color. Paste at least two to compare."
          : "No colors found. Paste hex codes like #000052, or rgb(), hsl() or oklch() values.",
      );
      return;
    }
    const unique = [...new Set(found)];
    action("palette_paste_list", { count: unique.length });
    onChange(unique.slice(0, MAX_SWATCHES).map((c) => newEntry(inFormat(c))));
    setPasteNote(
      unique.length > MAX_SWATCHES
        ? `Found ${unique.length} colors; using the first ${MAX_SWATCHES}.`
        : `Using ${unique.length} colors.`,
    );
    setPasted("");
  };
  const goal = criterion(target);

  const swatches: Swatch[] = entries.flatMap((e, i) => {
    const p = parseColor(e.input);
    return p.ok ? [{ id: e.id, input: e.input, name: `Color ${i + 1}`, color: p.color }] : [];
  });
  const grid = paletteGrid(swatches);
  const pairs = mergeBothWays(passingPairs(grid, goal.min));
  const hexOf = (s: Swatch) => toHex(quantize(s.color));

  // Pasting several colors into one field splits them into separate colors.
  const update = (id: string, input: string) => {
    const many = findColors(input, { bare: true });
    if (many.length >= 2) {
      const at = entries.findIndex((e) => e.id === id);
      const added = many.map((c) => newEntry(inFormat(c)));
      action("palette_split", { count: many.length });
      const next = [...entries.slice(0, at), ...added, ...entries.slice(at + 1)];
      onChange(next.slice(0, MAX_SWATCHES));
      setPasteNote(
        next.length > MAX_SWATCHES
          ? `Split into ${many.length} colors; the palette keeps the first ${MAX_SWATCHES}.`
          : `Split into ${many.length} colors.`,
      );
      return;
    }
    onChange(entries.map((e) => (e.id === id ? { ...e, input } : e)));
  };
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const add = () => onChange([...entries, newEntry("#808080")]);

  return (
    <div className="palette">
      <section
        className="palette__inputs"
        aria-labelledby="palette-colors"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const file = firstImage(e.dataTransfer.files);
          if (!file) return;
          e.preventDefault();
          void fromImage(file, "drop");
        }}
      >
        <h2 id="palette-colors" className="section-title">
          Your palette
        </h2>
        {entries.length === 0 && (
          <p className="hint">
            Add the colors you want to compare. Every color is checked against every other one.
          </p>
        )}
        <ol className="palette__list">
          {entries.map((e, i) => (
            <li key={e.id} className="palette__item">
              <ColorField
                compact
                dropper={false}
                label={`Color ${i + 1}`}
                value={e.input}
                onChange={(v) => update(e.id, v)}
                action={
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => remove(e.id)}
                    title="Remove"
                  >
                    <span className="visually-hidden">Remove color {i + 1}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                }
              />
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn btn--quiet btn--small"
          onClick={add}
          disabled={entries.length >= MAX_SWATCHES}
        >
          + Add a color
        </button>
        {suggestions.length > 0 && (
          <div className="palette__suggest">
            <h3 className="fix__title">Recent colors</h3>
            <ul className="recent" role="list">
              {suggestions.map((h) => (
                <li key={h}>
                  <button
                    type="button"
                    className="chip"
                    style={{ background: h }}
                    title={`Add ${h}`}
                    onClick={() => addColor(h)}
                  >
                    <span className="visually-hidden">Add {h} to the palette</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="palette__shot">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void fromImage(f, "file");
              e.target.value = "";
            }}
          />
          <p>
            Have the palette somewhere already (Coolors, a Figma board, a style guide)? Paste a
            screenshot (<kbd>Ctrl</kbd>+<kbd>V</kbd>), drop one here, or{" "}
            <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
              choose one
            </button>
            .
          </p>
        </div>
        <details className="paste">
          <summary>Paste a list of colors</summary>
          <label className="field__label" htmlFor="paste-colors">
            Colors, from anywhere
          </label>
          <textarea
            id="paste-colors"
            className="paste__box"
            rows={3}
            value={pasted}
            placeholder="#000052, #ffdf3f, rgb(255 255 255)…"
            onChange={(e) => setPasted(e.target.value)}
          />
          <p className="hint">
            Hex codes (with or without #), rgb(), hsl() or oklch(), separated by commas, spaces or
            new lines. CSS or a design-token file works too.
          </p>
          <button type="button" className="btn btn--small" onClick={usePasted}>
            Use these colors
          </button>
        </details>
        {pasteNote && (
          <p className="hint" role="status">
            {pasteNote}
          </p>
        )}
        {pageColor && (
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => {
              addColor(pageColor);
              setPageColor(null);
              setPasteNote("");
            }}
          >
            <span
              className="chip chip--inline"
              style={{ background: pageColor }}
              aria-hidden="true"
            />
            Add {pageColor} back
          </button>
        )}
        {entries.length >= MAX_SWATCHES && (
          <p className="note">Up to {MAX_SWATCHES} colors, so the grid stays readable.</p>
        )}
      </section>

      <section className="palette__grid-wrap" aria-labelledby="grid-heading">
        <div className="fix__head">
          <h2 id="grid-heading" className="section-title">
            Every pair
          </h2>
          <fieldset className="segmented">
            <legend>Check for</legend>
            {TARGETS.map((id) => {
              const c = criterion(id);
              return (
                <label key={id} className="segmented__option">
                  <input
                    type="radio"
                    name="palette-target"
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

        {swatches.length < 2 ? (
          <p className="note">Add at least two readable colors to see the grid.</p>
        ) : (
          <div className="grid-scroll" tabIndex={0} aria-label="Contrast grid, scrolls sideways">
            <table className="grid">
              <caption className="visually-hidden">
                Contrast of each color as text (rows) on each color as background (columns), checked
                for {goal.label.toLowerCase()} {goal.level}, which needs {goal.min}:1.
              </caption>
              <thead>
                <tr>
                  <td className="grid__corner">
                    <span>Text ↓</span>
                    <span>Background →</span>
                  </td>
                  {swatches.map((s) => (
                    <th key={s.id} scope="col">
                      <span
                        className="grid__chip"
                        style={{ background: hexOf(s) }}
                        aria-hidden="true"
                      />
                      <code>{hexOf(s)}</code>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, r) => (
                  <tr key={swatches[r]!.id}>
                    <th scope="row">
                      <span
                        className="grid__chip"
                        style={{ background: hexOf(swatches[r]!) }}
                        aria-hidden="true"
                      />
                      <code>{toHex(quantize(swatches[r]!.color))}</code>
                    </th>
                    {row.map((cell) => {
                      const self = cell.text.id === cell.background.id;
                      const pass = cell.ratio >= goal.min;
                      if (self) {
                        return (
                          <td key={cell.background.id} className="grid__cell grid__cell--self">
                            <span className="visually-hidden">Same color</span>
                            <span aria-hidden="true">–</span>
                          </td>
                        );
                      }
                      return (
                        <td
                          key={cell.background.id}
                          className={`grid__cell ${pass ? "is-pass" : "is-fail"}`}
                        >
                          <button
                            type="button"
                            className="grid__sample"
                            style={{
                              background: hexOf(cell.background),
                              color: toHex(quantize(cell.text.color)),
                            }}
                            onClick={() => onCheckPair(cell.text.input, cell.background.input)}
                          >
                            <span aria-hidden="true">Aa</span>
                            <span className="visually-hidden">
                              Open {hexOf(cell.text)} on {hexOf(cell.background)} in the pair
                              checker
                            </span>
                          </button>
                          <span className="grid__ratio">{formatRatio(cell.ratio)}</span>
                          <span className="grid__mark">
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              {pass ? (
                                <path d="M5 12.5l4.5 4.5L19 7.5" />
                              ) : (
                                <path d="M6 6l12 12M18 6L6 18" />
                              )}
                            </svg>
                            {pass ? "Pass" : "Fail"}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          Open any cell in the pair checker to see the math and the nearest colors that pass.
        </p>
      </section>

      <section className="palette__pairs" aria-labelledby="pairs-heading">
        <h2 id="pairs-heading" className="section-title">
          Pairs that pass {goal.label.toLowerCase()} {goal.level}
        </h2>
        {pairs.length === 0 ? (
          <p className="note">None yet. Try adding a much darker or much lighter color.</p>
        ) : (
          <ul className="pairs" role="list">
            {pairs.map((p) => (
              <li key={`${p.text.id}-${p.background.id}`} className="pairs__item">
                <span
                  className="pairs__sample"
                  style={{ background: hexOf(p.background), color: toHex(quantize(p.text.color)) }}
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span className="pairs__names">
                  <span>
                    <code>{hexOf(p.text)}</code> {p.bothWays ? "and" : "on"}{" "}
                    <code>{hexOf(p.background)}</code>
                  </span>
                  <span className="pairs__way">
                    {p.bothWays ? "Either one as the text" : "Only this way round"}
                  </span>
                </span>
                <span className="pairs__ratio">{formatRatio(p.ratio)}:1</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

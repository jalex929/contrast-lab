import { useState } from "react";
import { parseColor, quantize, toHex } from "../engine/color";
import { criterion, formatRatio, type CriterionId } from "../engine/contrast";
import { paletteGrid, passingPairs, type Swatch } from "../engine/palette";
import { MAX_SWATCHES } from "../engine/share";
import { ColorField } from "./ColorField";

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
}: {
  entries: PaletteEntry[];
  onChange: (entries: PaletteEntry[]) => void;
  onCheckPair: (text: string, background: string) => void;
}) {
  const [target, setTarget] = useState<CriterionId>("aa-text");
  const goal = criterion(target);

  const swatches: Swatch[] = entries.flatMap((e, i) => {
    const p = parseColor(e.input);
    return p.ok ? [{ id: e.id, input: e.input, name: `Color ${i + 1}`, color: p.color }] : [];
  });
  const grid = paletteGrid(swatches);
  const pairs = passingPairs(grid, goal.min);
  const hexOf = (s: Swatch) => toHex(quantize(s.color));

  const update = (id: string, input: string) =>
    onChange(entries.map((e) => (e.id === id ? { ...e, input } : e)));
  const remove = (id: string) => onChange(entries.filter((e) => e.id !== id));
  const add = () => onChange([...entries, newEntry("#808080")]);

  return (
    <div className="palette">
      <section className="palette__inputs" aria-labelledby="palette-colors">
        <h2 id="palette-colors" className="section-title">
          Your palette
        </h2>
        <ol className="palette__list">
          {entries.map((e, i) => (
            <li key={e.id} className="palette__item">
              <ColorField
                label={`Color ${i + 1}`}
                value={e.input}
                onChange={(v) => update(e.id, v)}
              />
              <button
                type="button"
                className="btn btn--quiet btn--small"
                onClick={() => remove(e.id)}
                disabled={entries.length <= 2}
              >
                Remove <span className="visually-hidden">color {i + 1}</span>
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="btn"
          onClick={add}
          disabled={entries.length >= MAX_SWATCHES}
        >
          Add a color
        </button>
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
                <span>
                  <code>{hexOf(p.text)}</code> on <code>{hexOf(p.background)}</code>
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

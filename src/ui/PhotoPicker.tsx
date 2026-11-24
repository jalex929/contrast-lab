import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { parseColor, quantize, toHex, type Rgb } from "../engine/color";
import { criterion, evaluate, formatRatio, type CriterionId } from "../engine/contrast";
import { boxColors, extractPalette, type ColorShare } from "../engine/palette-extract";
import { sampleAt, sampleTextPair, type Box, type Pixels } from "../engine/sample";
import { Chip, type Target } from "./Chip";
import { action } from "../telemetry";

type Tool = "box" | "point" | "move";
export type Kind = "text" | "non-text";

/** Photos bigger than this are scaled down when loaded; plenty for picking colors. */
const MAX_SIDE = 2400;
/** Clicks average a 3x3 square: photos are grainy, and one pixel can be an outlier. */
const POINT_SIZE = 3;
/** Pixels shown across the magnifier. */
const LOUPE_PX = 11;
const ZOOMS = [1, 1.5, 2, 3, 4, 6];

const hex = (c: Rgb) => toHex(quantize({ ...c, a: 1 }));
const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/**
 * Pick colors from a photo or screenshot. The sidebar holds the drop zone, a thumbnail and the
 * photo's palette; the photo opens large in a dialog with zoom, three tools (box an area, click
 * a color, move) and the live result beside it. The image never leaves the device.
 */
export function PhotoPicker({
  text,
  background,
  onPair,
  onColor,
  onImage,
  onKind,
  onPalette,
}: {
  /** The current colors, for the live result next to the photo. */
  text: string;
  background: string;
  onPair: (text: string, background: string) => void;
  onColor: (target: Target, hex: string) => void;
  /** Called when an image is loaded (so a closed drawer can open). */
  onImage?: () => void;
  /** Called when "what's in the box" changes, so the fixes aim for the right rule. */
  onKind?: (kind: Kind) => void;
  /** Send colors to palette mode. */
  onPalette?: (hexes: string[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pixels = useRef<Pixels | null>(null);
  const [loaded, setLoaded] = useState<{ width: number; height: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("box");
  const [kind, setKind] = useState<Kind>("text");
  const [target, setTarget] = useState<Target>("text");
  const [swatchTarget, setSwatchTarget] = useState<Target>("text");
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [found, setFound] = useState<ColorShare[]>([]);
  const [palette, setPalette] = useState<ColorShare[]>([]);
  const start = useRef<{ x: number; y: number } | null>(null);
  const onImageRef = useRef(onImage);
  onImageRef.current = onImage;

  // ---------- Loading ----------

  const load = useCallback(async (file: File, via: "paste" | "drop" | "file") => {
    if (!file.type.startsWith("image/")) {
      setStatus("That file isn't an image. Try a PNG, JPG or WebP.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const work = document.createElement("canvas");
      work.width = w;
      work.height = h;
      const ctx = work.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      pixels.current = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
      setLoaded({ width: w, height: h });
      setBox(null);
      setFound([]);
      setCursor(null);
      setZoom(1);
      setPalette([]);
      setStatus("Image ready. Box a word, an icon or a border, or click a color.");
      action("photo_load", { via, where: "pair" });
      onImageRef.current?.();
      // The palette takes a moment on big photos: let the page paint first.
      setTimeout(() => {
        if (pixels.current) setPalette(extractPalette(pixels.current));
      }, 30);
      setOpen(true);
    } catch {
      setStatus("That image couldn't be opened. Try a PNG, JPG or WebP.");
    }
  }, []);

  // Draw the photo into the big canvas and the thumbnail whenever they (re)appear.
  useEffect(() => {
    const px = pixels.current;
    if (!px || !loaded) return;
    const image = new ImageData(new Uint8ClampedArray(px.data), px.width, px.height);
    for (const canvas of [canvasRef.current, thumbRef.current]) {
      if (!canvas) continue;
      canvas.width = px.width;
      canvas.height = px.height;
      canvas.getContext("2d")?.putImageData(image, 0, 0);
    }
  }, [loaded, open]);

  // The workspace is a real modal dialog: focus moves in, Escape closes, the page behind is inert.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Paste anywhere on the page (an image only; pasting text into a field still works).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void load(file, "paste");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [load]);

  // ---------- Picking ----------

  const toImage = (e: PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    return {
      x: Math.min(canvas.width - 1, Math.max(0, fx * canvas.width)),
      y: Math.min(canvas.height - 1, Math.max(0, fy * canvas.height)),
    };
  };

  const pickPoint = (p: { x: number; y: number }) => {
    const px = pixels.current;
    if (!px) return;
    const c = sampleAt(px, p.x, p.y, POINT_SIZE);
    if (c.a === 0) {
      setStatus("That spot is transparent. Pick somewhere with color.");
      return;
    }
    onColor(target, hex(c));
    action("photo_point", { side: target });
    const next: Target = target === "text" ? "background" : "text";
    const name = (t: Target) => (t === "text" ? "foreground" : "background");
    setStatus(`${hex(c)} set as the ${name(target)}. Next click sets the ${name(next)}.`);
    setTarget(next);
  };

  const pickBox = (b: Box) => {
    const px = pixels.current;
    if (!px) return;
    if (Math.abs(b.width) < 4 || Math.abs(b.height) < 4) {
      setStatus("Drag a box over the thing to check and a little of what's behind it.");
      return;
    }
    const colors = boxColors(px, b);
    setFound(colors);
    const pair = sampleTextPair(px, b);
    if (!pair) {
      setStatus("That box is all one color. Include the thing to check and what's behind it.");
      return;
    }
    onPair(hex(pair.text), hex(pair.background));
    action("photo_box", {
      kind,
      busy: pair.backgroundShare < 0.4 || colors.length > 5,
      colors: colors.length,
    });
    const ratio = evaluate(pair.text, pair.background).ratio;
    const rule = criterion(kind === "text" ? "aa-text" : "non-text");
    const verdict = ratio >= rule.min ? "passes" : "fails";
    const what = kind === "text" ? "body text" : "icons and borders";
    setStatus(
      `Found ${hex(pair.text)} on ${hex(pair.background)}: ${formatRatio(ratio)}:1, ${verdict} ${what} (${rule.min}:1).` +
        (pair.backgroundShare < 0.4 || colors.length > 5
          ? " Busy area: if the guess is wrong, pick the right colors below."
          : ""),
    );
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!pixels.current || tool === "move") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    start.current = p;
    setCursor(p);
    setDragging(true);
    if (tool === "box") setBox({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pixels.current || tool === "move") return;
    const p = toImage(e);
    setCursor(p);
    if (tool === "box" && dragging && start.current) {
      setBox({
        x: start.current.x,
        y: start.current.y,
        width: p.x - start.current.x,
        height: p.y - start.current.y,
      });
    }
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !start.current) return;
    setDragging(false);
    const p = toImage(e);
    if (tool === "point") pickPoint(p);
    else if (tool === "box")
      pickBox({
        x: start.current.x,
        y: start.current.y,
        width: p.x - start.current.x,
        height: p.y - start.current.y,
      });
    start.current = null;
  };

  // Keyboard: arrows move the picker (Shift for 10px); Enter picks, or starts and ends a box.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const px = pixels.current;
    if (!px || tool === "move") return;
    const step = e.shiftKey ? 10 : 1;
    const cur = cursor ?? { x: Math.floor(px.width / 2), y: Math.floor(px.height / 2) };
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const mv = moves[e.key];
    if (mv) {
      e.preventDefault();
      const next = {
        x: Math.min(px.width - 1, Math.max(0, cur.x + mv[0])),
        y: Math.min(px.height - 1, Math.max(0, cur.y + mv[1])),
      };
      setCursor(next);
      if (tool === "box" && start.current) {
        setBox({
          x: start.current.x,
          y: start.current.y,
          width: next.x - start.current.x,
          height: next.y - start.current.y,
        });
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (tool === "point") pickPoint(cur);
      else if (!start.current) {
        start.current = cur;
        setCursor(cur);
        setBox({ x: cur.x, y: cur.y, width: 0, height: 0 });
        setStatus("Box started. Move with the arrow keys, then press Enter to finish it.");
      } else {
        pickBox({
          x: start.current.x,
          y: start.current.y,
          width: cur.x - start.current.x,
          height: cur.y - start.current.y,
        });
        start.current = null;
      }
    }
  };

  // Magnifier: the pixels around the cursor, blown up, with the sampled square outlined.
  useEffect(() => {
    const loupe = loupeRef.current;
    const canvas = canvasRef.current;
    if (!loupe || !canvas || !cursor || tool !== "point") return;
    const ctx = loupe.getContext("2d");
    if (!ctx) return;
    const cell = loupe.width / LOUPE_PX;
    const half = Math.floor(LOUPE_PX / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#f4f4f5";
    ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(
      canvas,
      Math.floor(cursor.x) - half,
      Math.floor(cursor.y) - half,
      LOUPE_PX,
      LOUPE_PX,
      0,
      0,
      loupe.width,
      loupe.height,
    );
    const s = Math.floor(POINT_SIZE / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    ctx.strokeRect((half - s) * cell, (half - s) * cell, POINT_SIZE * cell, POINT_SIZE * cell);
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(
      (half - s) * cell - 2,
      (half - s) * cell - 2,
      POINT_SIZE * cell + 4,
      POINT_SIZE * cell + 4,
    );
  }, [cursor, tool]);

  // Zoom keeps the middle of the view in place.
  const setZoomKeep = (z: number) => {
    const el = scrollRef.current;
    if (!el) return setZoom(z);
    const cx = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth;
    const cy = (el.scrollTop + el.clientHeight / 2) / el.scrollHeight;
    setZoom(z);
    action("photo_zoom", { level: z });
    requestAnimationFrame(() => {
      el.scrollLeft = cx * el.scrollWidth - el.clientWidth / 2;
      el.scrollTop = cy * el.scrollHeight - el.clientHeight / 2;
    });
  };
  const zi = ZOOMS.indexOf(zoom);

  const chooseKind = (k: Kind) => {
    setKind(k);
    onKind?.(k);
  };

  const hovered =
    cursor && pixels.current && tool === "point"
      ? hex(sampleAt(pixels.current, cursor.x, cursor.y, POINT_SIZE))
      : null;
  const rule = criterion(kind === "text" ? "aa-text" : "non-text");

  const swatchList = (items: ColorShare[], where: string) => (
    <ul className="recent" role="list">
      {items.map((c) => {
        const h = hex(c.color);
        return (
          <li key={h}>
            <Chip
              hex={h}
              label={`${h}, ${Math.round(c.share * 100)}% of the ${where}`}
              defaultTarget={swatchTarget}
              onPick={(t, v) => {
                action("photo_swatch", { side: t, where });
                onColor(t, v);
              }}
              onPreview={() => {}}
            />
          </li>
        );
      })}
    </ul>
  );

  const swatchToggle = (name: string, legend: string) => (
    <fieldset className="segmented segmented--tiny">
      <legend className="visually-hidden">{legend}</legend>
      {(
        [
          ["text", "Foreground"],
          ["background", "Background"],
        ] as const
      ).map(([id, lbl]) => (
        <label key={id} className="segmented__option">
          <input
            type="radio"
            name={name}
            checked={swatchTarget === id}
            onChange={() => setSwatchTarget(id)}
          />
          <span>{lbl}</span>
        </label>
      ))}
    </fieldset>
  );

  const sendPalette = () => {
    setOpen(false);
    action("photo_to_palette", { count: palette.length });
    onPalette?.(palette.map((c) => hex(c.color)));
  };

  return (
    <section
      className="photo"
      aria-label="Pick from a photo"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (!file) return;
        e.preventDefault();
        void load(file, "drop");
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f, "file");
          e.target.value = "";
        }}
      />

      {!loaded ? (
        <div className="photo__drop">
          <p>
            Paste a screenshot or photo (<kbd>Ctrl</kbd>+<kbd>V</kbd>), drop one here, or choose
            one. Box a word, an icon or a border to check it, or use the photo's colors.
          </p>
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => fileRef.current?.click()}
          >
            Choose an image
          </button>
          <p className="hint">It stays on this device. Nothing is uploaded.</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="photo__thumb"
            onClick={() => setOpen(true)}
            aria-label="Open the photo large to pick colors"
          >
            <canvas ref={thumbRef} aria-hidden="true" />
            <span>Open large</span>
          </button>
          {palette.length > 0 && (
            <div className="photo__palette">
              <div className="panel-block__head">
                <h3 className="fix__title">Colors in this photo</h3>
                {swatchToggle("swatch-target-side", "Photo colors apply to")}
              </div>
              {swatchList(palette, "photo")}
              <button type="button" className="btn btn--quiet btn--small" onClick={sendPalette}>
                Check these as a palette
              </button>
            </div>
          )}
          <div className="photo__actions">
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => fileRef.current?.click()}
            >
              Different image
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => {
                pixels.current = null;
                setLoaded(null);
                setBox(null);
                setFound([]);
                setPalette([]);
                setCursor(null);
                setStatus("Image removed.");
              }}
            >
              Remove
            </button>
          </div>
        </>
      )}
      {!open && (
        <p className="photo__status" role="status">
          {status}
        </p>
      )}

      <dialog
        ref={dialogRef}
        className="workspace"
        aria-label="Photo"
        onClose={() => setOpen(false)}
        onCancel={(e) => {
          // Escape cancels a box in progress first; a second Escape closes.
          if (start.current) {
            e.preventDefault();
            start.current = null;
            setBox(null);
            setStatus("Box cancelled.");
          }
        }}
      >
        {open && loaded && (
          <div className="workspace__inner">
            <div className="workspace__bar">
              <fieldset className="segmented">
                <legend className="visually-hidden">Tool</legend>
                {(
                  [
                    ["box", "Box an area"],
                    ["point", "Click a color"],
                    ["move", "Move"],
                  ] as const
                ).map(([id, label]) => (
                  <label key={id} className="segmented__option">
                    <input
                      type="radio"
                      name="photo-tool"
                      checked={tool === id}
                      onChange={() => {
                        setTool(id);
                        setBox(null);
                        start.current = null;
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>

              {tool === "box" && (
                <fieldset className="segmented">
                  <legend>What's in the box?</legend>
                  {(
                    [
                      ["text", "Text"],
                      ["non-text", "Icon or border"],
                    ] as const
                  ).map(([id, label]) => (
                    <label key={id} className="segmented__option">
                      <input
                        type="radio"
                        name="photo-kind"
                        checked={kind === id}
                        onChange={() => chooseKind(id)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {tool === "point" && (
                <fieldset className="segmented">
                  <legend>Next click sets</legend>
                  {(
                    [
                      ["text", "Foreground"],
                      ["background", "Background"],
                    ] as const
                  ).map(([id, label]) => (
                    <label key={id} className="segmented__option">
                      <input
                        type="radio"
                        name="photo-target"
                        checked={target === id}
                        onChange={() => setTarget(id)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              )}

              <div className="zoom" role="group" aria-label="Zoom">
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  onClick={() => setZoomKeep(ZOOMS[Math.max(0, zi - 1)]!)}
                  disabled={zi <= 0}
                  aria-label="Zoom out"
                >
                  −
                </button>
                <span className="zoom__level" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  onClick={() => setZoomKeep(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)]!)}
                  disabled={zi >= ZOOMS.length - 1}
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>

              <button
                type="button"
                className="btn btn--small workspace__close"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>

            <div className="workspace__body">
              <div
                ref={scrollRef}
                className={`workspace__scroll ${tool === "move" ? "is-move" : ""}`}
              >
                <div
                  className={`photo__stage photo__stage--${tool}`}
                  style={{ width: `${zoom * 100}%` }}
                  tabIndex={0}
                  role="group"
                  aria-label={
                    tool === "box"
                      ? "Photo. Drag a box over a word, an icon or a border and a little of what's behind it. Keyboard: arrow keys move, Enter starts and finishes the box, Shift moves faster."
                      : tool === "point"
                        ? "Photo. Click to pick a color. Keyboard: arrow keys move, Enter picks, Shift moves faster."
                        : "Photo. Drag or scroll to move around."
                  }
                  aria-describedby="photo-status"
                  onPointerDown={onDown}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerLeave={() => !dragging && setCursor(null)}
                  onKeyDown={onKey}
                >
                  <canvas ref={canvasRef} className="photo__canvas" aria-hidden="true" />
                  {box && (
                    <span
                      className="photo__box"
                      aria-hidden="true"
                      style={{
                        left: pct(Math.min(box.x, box.x + box.width), loaded.width),
                        top: pct(Math.min(box.y, box.y + box.height), loaded.height),
                        width: pct(Math.abs(box.width), loaded.width),
                        height: pct(Math.abs(box.height), loaded.height),
                      }}
                    />
                  )}
                  {cursor && tool !== "move" && (
                    <span
                      className="photo__cross"
                      aria-hidden="true"
                      style={{
                        left: pct(cursor.x, loaded.width),
                        top: pct(cursor.y, loaded.height),
                      }}
                    />
                  )}
                  {tool === "point" && cursor && (
                    <span
                      className={`photo__loupe ${cursor.x / loaded.width > 0.6 ? "photo__loupe--left" : ""}`}
                      aria-hidden="true"
                      style={{
                        left: pct(cursor.x, loaded.width),
                        top: pct(cursor.y, loaded.height),
                      }}
                    >
                      <canvas ref={loupeRef} width={110} height={110} />
                      <code>{hovered}</code>
                    </span>
                  )}
                </div>
              </div>

              <aside className="workspace__side" aria-label="Result">
                <MiniResult text={text} background={background} kind={kind} />
                <p className="photo__status" id="photo-status" role="status">
                  {status}
                </p>
                <p className="hint">
                  {kind === "text"
                    ? `Text is checked at ${rule.min}:1 (body) and 3:1 (large).`
                    : `Icons and borders need ${rule.min}:1 against what's next to them.`}
                </p>

                {found.length > 0 && (
                  <div className="photo__palette">
                    <div className="panel-block__head">
                      <h3 className="fix__title">Colors in the box</h3>
                      {swatchToggle("swatch-target-box", "Box colors apply to")}
                    </div>
                    {swatchList(found, "box")}
                    <p className="hint">
                      Wrong guess? Click the right color for the{" "}
                      {swatchTarget === "text" ? "foreground" : "background"}.
                    </p>
                  </div>
                )}

                {palette.length > 0 && (
                  <div className="photo__palette">
                    <h3 className="fix__title">Colors in this photo</h3>
                    {swatchList(palette, "photo")}
                    <button
                      type="button"
                      className="btn btn--quiet btn--small"
                      onClick={sendPalette}
                    >
                      Check these as a palette
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

/** Both colors, the ratio and pass/fail for the rule that fits what's being checked. */
function MiniResult({ text, background, kind }: { text: string; background: string; kind: Kind }) {
  const fg = parseColor(text);
  const bg = parseColor(background);
  if (!fg.ok || !bg.ok) return null;
  const e = evaluate(fg.color, { ...bg.color, a: 1 });
  const ids: CriterionId[] = kind === "text" ? ["aa-text", "aa-large"] : ["non-text"];
  const fgHex = toHex(quantize(e.seen));
  const bgHex = hex(bg.color);
  return (
    <div className="mini">
      <div className="mini__sample" style={{ background: bgHex, color: fgHex }}>
        {kind === "text" ? (
          <span aria-hidden="true">Aa</span>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16.5v.5" />
          </svg>
        )}
      </div>
      <div className="mini__numbers">
        <p className="mini__ratio">{formatRatio(e.ratio)}:1</p>
        <p className="mini__pair">
          <code>{fgHex}</code> on <code>{bgHex}</code>
        </p>
        <ul className="checks" role="list">
          {e.checks
            .filter((c) => ids.includes(c.criterion.id))
            .map(({ criterion: c, pass }) => (
              <li key={c.id} className={`check ${pass ? "check--pass" : "check--fail"}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {pass ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
                </svg>
                <span>
                  <span className="visually-hidden">{pass ? "Pass: " : "Fail: "}</span>
                  {c.id === "non-text" ? "Icons & borders" : c.label} {c.min}:1
                </span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

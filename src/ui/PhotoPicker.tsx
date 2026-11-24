import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { quantize, toHex, type Rgb } from "../engine/color";
import { formatRatio, evaluate } from "../engine/contrast";
import { sampleAt, sampleTextPair, type Box, type Pixels } from "../engine/sample";

type Tool = "text" | "point";
type Target = "text" | "background";

/** Photos bigger than this are scaled down when loaded; plenty for picking colors. */
const MAX_SIDE = 2400;
/** Clicks average a 3x3 square: photos are grainy, and one pixel can be an outlier. */
const POINT_SIZE = 3;
/** Pixels shown across the magnifier. */
const LOUPE_PX = 11;

const hex = (c: Rgb) => toHex(quantize({ ...c, a: 1 }));

/**
 * Pick colors from a photo or screenshot: paste, drop or choose one. "Box some text" finds a
 * text color and its background inside a box you draw; "Click a color" sets one color at a time
 * with a magnifier for precision. The image never leaves the device.
 */
export function PhotoPicker({
  onPair,
  onColor,
  onImage,
}: {
  onPair: (text: string, background: string) => void;
  /** Called when an image is loaded (so a closed drawer can open). */
  onImage?: () => void;
  onColor: (target: Target, hex: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pixels = useRef<Pixels | null>(null);
  const [loaded, setLoaded] = useState<{ width: number; height: number; name: string } | null>(
    null,
  );
  const [tool, setTool] = useState<Tool>("text");
  const [target, setTarget] = useState<Target>("text");
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState(false);
  /** The point being looked at, in image pixels (pointer or keyboard). */
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  /** A box being drawn, in image pixels. */
  const [box, setBox] = useState<Box | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  // ---------- Loading ----------

  const load = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setStatus("That file isn't an image. Try a PNG, JPG or WebP.");
        return;
      }
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = canvasRef.current ?? document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0, w, h);
        bitmap.close();
        const data = ctx.getImageData(0, 0, w, h);
        pixels.current = { width: w, height: h, data: data.data };
        setLoaded({ width: w, height: h, name: file.name || "Pasted image" });
        onImage?.();
        setBox(null);
        setCursor(null);
        setStatus(
          "Image ready. Drag a box around some text, or switch to Click a color to pick one color.",
        );
      } catch {
        setStatus("That image couldn't be opened. Try a PNG, JPG or WebP.");
      }
    },
    [onImage],
  );

  // The canvas only exists once something is loaded: draw again when it appears.
  useEffect(() => {
    const canvas = canvasRef.current;
    const px = pixels.current;
    if (!canvas || !px || !loaded) return;
    if (canvas.width !== px.width || canvas.height !== px.height) {
      canvas.width = px.width;
      canvas.height = px.height;
    }
    canvas
      .getContext("2d")
      ?.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  }, [loaded]);

  // Paste anywhere on the page (an image only; pasting text into a field still works).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void load(file);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [load]);

  // ---------- Picking ----------

  const toImage = (e: PointerEvent<HTMLElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.min(
        canvas.width - 1,
        Math.max(0, ((e.clientX - rect.left) / rect.width) * canvas.width),
      ),
      y: Math.min(
        canvas.height - 1,
        Math.max(0, ((e.clientY - rect.top) / rect.height) * canvas.height),
      ),
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
    const next: Target = target === "text" ? "background" : "text";
    setStatus(
      `${hex(c)} set as the ${target === "text" ? "text color" : "background"}. Next click sets the ${next === "text" ? "text color" : "background"}.`,
    );
    setTarget(next);
  };

  const pickBox = (b: Box) => {
    const px = pixels.current;
    if (!px) return;
    if (Math.abs(b.width) < 4 || Math.abs(b.height) < 4) {
      setStatus("Drag a box around some text, a word or a line is plenty.");
      return;
    }
    const pair = sampleTextPair(px, b);
    if (!pair) {
      setStatus("That box is all one color. Include some text and the space around it.");
      return;
    }
    onPair(hex(pair.text), hex(pair.background));
    const ratio = formatRatio(evaluate(pair.text, pair.background).ratio);
    setStatus(
      `Found text ${hex(pair.text)} on background ${hex(pair.background)}: ${ratio}:1.` +
        (pair.backgroundShare < 0.4
          ? " The box is busy, so check the colors look right, or draw a tighter box."
          : ""),
    );
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!pixels.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    start.current = p;
    setCursor(p);
    setDragging(true);
    if (tool === "text") setBox({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pixels.current) return;
    const p = toImage(e);
    setCursor(p);
    if (tool === "text" && dragging && start.current) {
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
    else
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
    if (!px) return;
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
      if (tool === "text" && start.current) {
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
    if (e.key === "Escape" && start.current) {
      start.current = null;
      setBox(null);
      setStatus("Box cancelled.");
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
    ctx.fillStyle = "#fbfaf6";
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
    ctx.strokeStyle = "#000052";
    ctx.strokeRect((half - s) * cell, (half - s) * cell, POINT_SIZE * cell, POINT_SIZE * cell);
    ctx.strokeStyle = "#ffdf3f";
    ctx.strokeRect(
      (half - s) * cell - 2,
      (half - s) * cell - 2,
      POINT_SIZE * cell + 4,
      POINT_SIZE * cell + 4,
    );
  }, [cursor, tool]);

  const hovered =
    cursor && pixels.current && tool === "point"
      ? hex(sampleAt(pixels.current, cursor.x, cursor.y, POINT_SIZE))
      : null;

  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <section
      className="photo"
      aria-label="Pick from a photo"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (file) void load(file);
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
          if (f) void load(f);
          e.target.value = "";
        }}
      />

      {!loaded ? (
        <div className="photo__drop">
          <p>
            Paste a screenshot or photo (<kbd>Ctrl</kbd>+<kbd>V</kbd>), drop one here, or choose
            one. Then drag a box around some text to check it.
          </p>
          <button
            type="button"
            className="btn btn--quiet btn--small"
            onClick={() => fileRef.current?.click()}
          >
            Choose an image
          </button>
          <p className="note">It stays on this device. Nothing is uploaded.</p>
        </div>
      ) : (
        <>
          <fieldset className="segmented segmented--small">
            <legend>On the photo</legend>
            {(
              [
                ["text", "Box some text"],
                ["point", "Click a color"],
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

          {tool === "point" && (
            <fieldset className="segmented segmented--small">
              <legend>Next click sets</legend>
              {(
                [
                  ["text", "Text color"],
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

          <div
            className={`photo__stage photo__stage--${tool}`}
            tabIndex={0}
            role="group"
            aria-label={
              tool === "text"
                ? "Photo. Drag a box around some text. With the keyboard: arrow keys move, Enter starts and finishes the box, Shift moves faster."
                : "Photo. Click to pick a color. With the keyboard: arrow keys move, Enter picks, Shift moves faster."
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
            {cursor && (
              <span
                className="photo__cross"
                aria-hidden="true"
                style={{ left: pct(cursor.x, loaded.width), top: pct(cursor.y, loaded.height) }}
              />
            )}
            {tool === "point" && cursor && (
              <span
                className={`photo__loupe ${cursor.x / loaded.width > 0.6 ? "photo__loupe--left" : ""}`}
                aria-hidden="true"
                style={{ left: pct(cursor.x, loaded.width), top: pct(cursor.y, loaded.height) }}
              >
                <canvas ref={loupeRef} width={110} height={110} />
                <code>{hovered}</code>
              </span>
            )}
          </div>

          <div className="photo__actions">
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => fileRef.current?.click()}
            >
              Use a different image
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--small"
              onClick={() => {
                pixels.current = null;
                setLoaded(null);
                setBox(null);
                setCursor(null);
                setStatus("Image removed.");
              }}
            >
              Remove image
            </button>
          </div>
        </>
      )}
      <p className="photo__status" id="photo-status" role="status">
        {status}
      </p>
    </section>
  );
}

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { parseColor, quantize, toHex } from "./engine/color";
import { pushRecent, readRecent } from "./engine/recent";
import { decodeShare, encodeShare, type Shared } from "./engine/share";
import { PairView } from "./ui/PairView";
import { newEntry, PaletteView, type PaletteEntry } from "./ui/PaletteView";

/** Where "back" goes: the Lab on jayfox.design (relative when hosted inside it). */
const LAB_URL =
  typeof location !== "undefined" && location.pathname.includes("/lab/")
    ? "../"
    : "https://jayfox.design/lab";

type Mode = "pair" | "palette";

const RECENT_KEY = "contrast-lab:recent";

const DEFAULT_PAIR = { text: "#777777", background: "#ffffff" };
const DEFAULT_PALETTE = ["#000052", "#ffdf3f", "#ffffff", "#6b6b8f"];

function initial(): { mode: Mode; text: string; background: string; palette: PaletteEntry[] } {
  const shared = typeof location !== "undefined" ? decodeShare(location.hash) : null;
  const palette = (shared?.mode === "palette" ? shared.colors : DEFAULT_PALETTE).map(newEntry);
  if (shared?.mode === "pair") {
    return { mode: "pair", text: shared.text, background: shared.background, palette };
  }
  return { mode: shared?.mode ?? "pair", ...DEFAULT_PAIR, palette };
}

/** Hex for the share link; anything unreadable is left out. */
const hexFor = (input: string): string | null => {
  const p = parseColor(input);
  return p.ok ? toHex(quantize(p.color)) : null;
};

export function App() {
  const [state] = useState(initial);
  const [mode, setMode] = useState<Mode>(state.mode);
  const [text, setText] = useState(state.text);
  const [background, setBackground] = useState(state.background);
  const [palette, setPalette] = useState<PaletteEntry[]>(state.palette);
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<string[]>(() =>
    typeof localStorage === "undefined" ? [] : readRecent(localStorage.getItem(RECENT_KEY)),
  );

  const swap = () => {
    setText(background);
    setBackground(text);
  };

  // Colors that stay put for a moment join the recent strip (typing doesn't flood it).
  useEffect(() => {
    if (mode !== "pair") return;
    const t = hexFor(text);
    const b = hexFor(background);
    if (!t || !b) return;
    const timer = setTimeout(() => {
      setRecent((list) => {
        const next = pushRecent(list, t, b);
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          /* storage off: the strip still works for this visit */
        }
        return next;
      });
    }, 700);
    return () => clearTimeout(timer);
  }, [mode, text, background]);

  // X swaps text and background (as in Figma and Photoshop), unless you're typing.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "x" && e.key !== "X") return;
      if (e.ctrlKey || e.metaKey || e.altKey || mode !== "pair") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      setText(background);
      setBackground(text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, text, background]);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Keep the address in step with what's on screen, so the link is always the current check.
  useEffect(() => {
    let shared: Shared | null = null;
    if (mode === "pair") {
      const t = hexFor(text);
      const b = hexFor(background);
      if (t && b) shared = { mode: "pair", text: t, background: b };
    } else {
      const colors = palette.map((e) => hexFor(e.input)).filter((h): h is string => !!h);
      if (colors.length >= 2) shared = { mode: "palette", colors };
    }
    if (!shared) return;
    const timer = setTimeout(() => {
      history.replaceState(null, "", encodeShare(shared));
    }, 250);
    return () => clearTimeout(timer);
  }, [mode, text, background, palette]);

  // A link pasted into this same tab only changes the part after #: apply it.
  useEffect(() => {
    const apply = () => {
      const shared = decodeShare(location.hash);
      if (!shared) return;
      setMode(shared.mode);
      if (shared.mode === "pair") {
        setText(shared.text);
        setBackground(shared.background);
      } else setPalette(shared.colors.map(newEntry));
    };
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
    } catch {
      /* clipboard blocked: the address bar still has the link */
    }
  };

  const openPair = (t: string, b: string) => {
    setText(t);
    setBackground(b);
    setMode("pair");
    tabs.current[0]?.focus();
  };

  const MODES: { id: Mode; label: string }[] = [
    { id: "pair", label: "Check a pair" },
    { id: "palette", label: "Check a palette" },
  ];

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : -1) + MODES.length) % MODES.length;
    setMode(MODES[next]!.id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="app">
      <header className="top">
        <a className="back" href={LAB_URL} aria-label="Back to the Lab at jayfox.design">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          <span className="back__text">jayfox.design/lab</span>
        </a>
        <div className="top__title">
          <h1>Contrast Lab</h1>
          <p className="top__tagline">
            WCAG contrast with the math, and the nearest colors that pass instead of just a fail.
          </p>
        </div>
      </header>

      <div className="bar">
        <div className="tabs" role="tablist" aria-label="What to check">
          {MODES.map((m, i) => (
            <button
              key={m.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${m.id}`}
              aria-selected={mode === m.id}
              aria-controls="panel"
              tabIndex={mode === m.id ? 0 : -1}
              className="tab"
              onClick={() => setMode(m.id)}
              onKeyDown={(e) => onTabKey(e, i)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--quiet" onClick={copyLink}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />
          </svg>
          {copied ? "Link copied" : "Copy link"}
        </button>
        <span className="visually-hidden" role="status">
          {copied ? "Link copied to the clipboard." : ""}
        </span>
      </div>

      <main id="panel" role="tabpanel" aria-labelledby={`tab-${mode}`} className="panel">
        {mode === "pair" ? (
          <PairView
            text={text}
            background={background}
            onText={setText}
            onBackground={setBackground}
            onSwap={swap}
            recent={recent}
            onPalette={(hexes) => {
              setPalette(hexes.map(newEntry));
              setMode("palette");
            }}
          />
        ) : (
          <PaletteView entries={palette} onChange={setPalette} onCheckPair={openPair} />
        )}
      </main>

      <footer className="foot">
        <p>
          Measures WCAG 2.2 contrast (success criteria 1.4.3, 1.4.6 and 1.4.11). Contrast is one
          part of accessible color: never show meaning by color alone, and test with real people.
        </p>
        <p>
          Made by <a href="https://jayfox.design">Jay Fox</a>. Free, no sign-up, nothing leaves your
          browser. <a href="https://github.com/jalex929/contrast-lab">Code on GitHub</a>.
        </p>
      </footer>
    </div>
  );
}

/**
 * Undo and redo for the colors on screen. A plain value history: `past` holds earlier states,
 * `present` is what's shown, `future` holds undone states until something new is recorded.
 * Recording a state equal to the present does nothing, so repeated renders never add steps.
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const MAX_STEPS = 100;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function record<T>(h: History<T>, next: T, same: (a: T, b: T) => boolean): History<T> {
  if (same(h.present, next)) return h;
  return { past: [...h.past, h.present].slice(-MAX_STEPS), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1]!,
    future: [h.present, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1) };
}

/**
 * Is `next` just more typing in the same field as the last change? True when exactly one
 * value changed, in the same place as last time, and the new text grows or shrinks the old one
 * (adding or deleting characters). A fix, a swap or a paste replaces the whole value, so it
 * always makes its own step.
 */
export function typingIn(prev: string[], next: string[]): number | null {
  if (prev.length !== next.length) return null;
  let at = -1;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] === next[i]) continue;
    if (at !== -1) return null;
    at = i;
  }
  if (at === -1) return null;
  const a = prev[at]!;
  const b = next[at]!;
  return a.startsWith(b) || b.startsWith(a) ? at : null;
}

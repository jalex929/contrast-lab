# Working in contrast-lab

Read `README.md` and `DECISIONS.md` first.

- Record every product, design or engineering decision in `DECISIONS.md`: what, why, the
  trade-off, and who made the call (Jay's call / proposed, approved / build default).
- All logic stays in `src/engine` (plain TypeScript, no React) and is unit tested there. UI
  stays thin.
- Accuracy first: contrast numbers must match the WCAG 2.2 definition exactly. New reference
  values are computed independently (Python) before they go into a test. Never round a ratio
  up; never let a suggestion through without re-checking its hex code.
- The interface's own colors must pass AA; check any new color pair with the engine.
- Left-aligned, neutral grey interface so the tested colors are the only color on the page
  (DECISIONS.md, second pass); never show pass/fail by color alone (icon + word); every control
  reachable by keyboard; respect reduced motion.
- READMEs say what was tested and what wasn't. No secrets, no private data.
- Before pushing: `npm run check`, and `npm run build && npm run test:e2e` when the UI changed.
- Commits use the GitHub no-reply email, never a personal address.

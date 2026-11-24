# Decisions

How Contrast Lab was set up on purpose: what was decided, why, and what was left out. Each
decision says who made it:

- **Jay's call:** a product or design decision Jay Fox made.
- **Proposed, approved:** suggested during the build and accepted by Jay.
- **Build default:** an engineering choice made while building it, kept because it worked.
  Open to change.

Contrast Lab was designed by Jay Fox and built with an AI coding assistant (Claude) as a pair
programmer. Jay set the direction and made the calls marked below.

## What it is for

**A contrast checker that helps you fix the problem, not just report it** (Jay's call,
2026-11-23). It was idea 07 in the Lab's original plan, listed on the Lab page as "Contrast
Checker" with the promise "see the nearest pair that passes instead of just a fail." Jay chose
it as the first project in the Lab's Engineering section, so the Lab page can show Creative,
Engineering and Games once it's live. Most checkers stop at pass or fail; the fix is the part
designers actually need.

**Its own public repo** (Jay's call): like every Lab project, built in its own repo and
published under jayfox.design/lab.

## Product decisions

**Two modes: a pair and a palette** (build default). The original plan asked for ratios,
previews and suggestions; the palette grid answers the design-system question ("which of our
colors can sit on which?") that a single pair can't.

**Nearest pass, darker and lighter, for text or background** (build default, from the bench
promise). For the rule you aim for, it shows up to four fixes: the closest darker and lighter
text color, and the same for the background, closest first, with how visible the change is in
plain words ("barely visible change" to "big change").

**Aim for one rule at a time** (build default): body text AA (4.5:1), large text AA (3:1) or
body text AAA (7:1). Showing fixes for every rule at once was a wall of swatches.

**Say why when nothing can pass** (build default). On mid grey, no color reaches 7:1 (the most
possible is 4.68:1), and half-transparent text can be capped by its opacity. In those cases it
says so and what to change instead, rather than showing an empty list.

**Show the math** (from the original plan's quality gates: "contrast tools should show the
math and which WCAG criterion is being assessed"). Each check names its success criterion and
minimum, and a disclosure walks through the luminance formula with your numbers.

**Links carry the check** (build default). The address always holds the current pair or
palette, so sharing is copying the link. No accounts, no server, nothing leaves the browser.

## Accuracy decisions

**WCAG 2.2 contrast, exactly** (build default). Relative luminance and the ratio follow the
WCAG definition, with the sRGB threshold 0.04045 (WCAG's older 0.03928 gives identical results
for every 8-bit color). Test reference values were computed separately in Python.

**Round down, never up** (build default). WCAG has no rounding: 4.499 fails 4.5. Showing
"4.50" for a failing pair is a common checker bug, so the display rounds down.

**Transparent text is composited first** (build default). A partly transparent text color is
painted over the background, the way a browser does, and measured as the color you see.
Backgrounds are measured as opaque, and the field says so when one has alpha.

**Suggestions move lightness in OKLCH** (build default). OKLCH lightness tracks how light a
color looks, so changing only lightness keeps the color recognizably "the same red." Chroma is
lowered only when a screen can't show the color at the new lightness. Change is measured as
distance in OKLab.

**Every suggestion is re-checked from its hex code** (build default). Candidates are rounded
to real 8-bit colors before they're measured, so rounding can't turn a pass into a fail. A test
re-parses every suggestion's hex and checks it again.

**Fast enough to run live** (build default). The first version scanned 1,000 lightness steps
(about 13 ms per search, up to six searches per change). It now walks outward from the original
until the first pass and halves the gap to the edge: about 1.7 ms, so it updates while you type
or drag the picker.

**Not APCA** (build default). APCA, the proposed contrast method for a future WCAG, isn't a
requirement yet and its thresholds are still changing. Mixing it in would blur what "pass"
means. It's the first stretch idea if this grows.

## Design decisions

**Navy and yellow, left-aligned** (Jay's standing preferences for the Lab): a strict left edge,
navy (#000052) and yellow (#FFDF3F), Work Sans and Source Code Pro.

**Never color alone for pass or fail** (build default, a Lab rule). Every result has an icon
and the word Pass or Fail; failing rows also get a tinted background.

**The tool passes its own test** (build default). Every text and control color in the
interface was run through the engine and passes AA (the lowest is 6.79:1).

**The palette grid scrolls inside its box on phones** (build default). A wide grid scrolls
sideways on its own instead of making the whole page wider. A browser test checks nothing on
the page is wider than the screen.

## Left out on purpose

- APCA and other contrast models (see above).
- Saved palettes and accounts: links already carry a palette, with no data stored anywhere.
- Color-blindness simulation: useful, but a separate tool; contrast doesn't cover it.
- Named CSS colors ("rebeccapurple"): hex, rgb(), hsl() and oklch() cover what people paste
  from design tools.

## Honest limits

- Contrast is one part of accessible color. The page says so: never show meaning by color
  alone, and test with real people.
- Tested in Chrome (desktop and Pixel 7 emulation). Not yet on real phones, in Safari or
  Firefox, or with a screen reader by hand.

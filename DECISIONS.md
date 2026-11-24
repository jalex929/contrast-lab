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

**Left-aligned** (Jay's standing preference): a strict left edge. The first version used the
Lab's navy (#000052) and yellow (#FFDF3F); the second pass moved to a neutral interface (see
below).

**Never color alone for pass or fail** (build default, a Lab rule). Every result has an icon
and the word Pass or Fail; failing rows also get a tinted background.

**The tool passes its own test** (build default). Every text and control color in the
interface was run through the engine and passes AA (the lowest is 6.79:1).

**The palette grid scrolls inside its box on phones** (build default). A wide grid scrolls
sideways on its own instead of making the whole page wider. A browser test checks nothing on
the page is wider than the screen.

## Second pass: a live canvas and faster swapping (2026-11-23)

**Pick colors from a photo** (Jay's call). Paste (Ctrl+V), drop or choose a screenshot or photo;
it never leaves the device. Two tools:

- **Box some text** (Jay's idea: "sample certain text"). Draw a box around words and it finds
  both colors: the background is the most common color in the box; the text is the color
  group that stands out most from it, among groups big enough to be real strokes, so the
  in-between shades of anti-aliased edges don't win. Tested on a synthetic image with an
  anti-aliased fringe and on a real rendered PNG.
- **Click a color** with a magnifier. A click averages a 3x3 square (photos are grainy) and
  alternates text, then background.

Both work from the keyboard: arrows move the picker (Shift for 10px), Enter picks or starts and
finishes a box, Escape cancels.

**The swatch is the color picker; the eyedropper picks from the screen** (Jay's call: "if you
click the swatch you should be able to use it"). The old pencil button was clipped and
duplicated the swatch. Where the browser supports it (Chrome, Edge), the eyedropper button picks
a color from anywhere on screen; elsewhere it's hidden rather than broken.

**Live canvas layout** (Jay chose it over a denser three-column workbench). Jay flagged too much
scrolling and wanted swapping colors to be easy. The result now is the preview: one panel painted
in the two colors carries the ratio, heading, body text, a filled and an outlined button and an
icon. Compact pass/fail chips sit under it, and the math and what each check covers fold into
one disclosure. A sticky sidebar holds the colors, the photo picker, the fixes and recent
colors, so the fix is next to the problem instead of three screens down. On phones a sticky bar
keeps both colors, the ratio, AA body text and Swap in view.

**Neutral interface, not the Lab's navy and yellow** (Jay: "it does not have to match my
branding if there is a stronger way"). A grey interface leaves the tested colors as the only
color on the page; navy buttons around a navy test color were noise. Every interface pair still
passes AA (the lowest is 4.40:1, a control border that needs 3:1).

**Four ways to try colors fast** (Jay picked all four):

- **Recent colors:** each color that stays put for a moment joins a strip (newest first, up to
  12, saved in the browser). An "applies to" toggle picks text or background, so it works with a
  tap on phones; Shift+click uses the other side.
- **X swaps** text and background, as in Figma and Photoshop, except while typing.
- **Drag** a recent color or a fix onto either color field.
- **Hover (or focus) to preview:** the canvas shows the color before you commit, with a
  "Previewing" badge. Screen readers hear committed changes only, not every preview.

## Third pass: busy photos, a photo palette and non-text contrast (2026-11-24)

Jay tried a "Where's Waldo" screenshot and raised three things: choosing colors from a busy
image, wanting a palette from the photo (like the "palette from image" tools), and checking
non-text contrast, not just text.

**A large photo workspace** (proposed, approved). Opening an image now shows it in a near
full-screen dialog instead of the narrow sidebar, with zoom (100% to 600%), and the live result
(both colors, the ratio, pass or fail) beside it so you see the outcome while picking. It's a
real modal dialog: focus moves in, Escape closes (or cancels a box in progress first). A Move
tool pans when zoomed, which phones need because dragging otherwise draws a box.

**Box an area, not just text** (Jay: "drag a box around some text seems narrow"). The box tool
asks what's in it: **Text** or **Icon or border**. Detection is the same either way; the result
is judged at 4.5:1 for text and 3:1 for icons and borders (SC 1.4.11), and choosing Icon or
border also points the fixes at 3:1. The main color field is now called **Foreground**, with
"Text, an icon or a border" under it.

**Show what's in the box** (build default). On a busy image the automatic guess can be wrong,
so after every box the main colors inside it are listed as swatches you can click to correct
the foreground or background. The status line warns when a box looks busy (the background is
under 40% of it, or it holds more than five colors).

**A palette from the photo** (Jay's call). The photo's main colors (up to 8) are found with
k-means clustering in OKLab, so a group is what eyes see as one color, starting from spread-out
seeds chosen the same way every time (the same image always gives the same palette); look-alike
groups merge and specks under 1% are dropped. Each swatch can be clicked or dragged onto a color,
and "Check these as a palette" opens them all in palette mode to see every pair. About 0.4
seconds on a busy 1600x1000 image, run once after the image loads.

## Fourth pass: formats, lists, an empty palette and usage counts (2026-11-24)

**Values in any format** (Jay's ask: "change the type of color values, if the calculations still
work"). A "Values as" control converts the fields to HEX, RGB, HSL or OKLCH, and fixes, recent
and photo colors arrive in that format. The math is unaffected: every format is read into the
same color first. Each format is written with just enough decimals to read back to the exact
same 8-bit color (tested for every format on a set of colors), so switching never changes a
result. The share link always stores hex.

**Comma-separated hex without "#"** (Jay's call). "000052, ffdf3f" works in the paste box and in
any field. Six- or eight-digit codes count without "#"; three-digit numbers don't, so "100" isn't
read as a color. Pasting several colors into one palette field splits them into separate
colors, and two colors pasted into Foreground fill both fields.

**The palette starts empty** (Jay's call: "should not come preloaded"). The empty state offers
recent colors as one-click additions, a screenshot of an existing palette (Coolors, a Figma
board, a style guide; its swatches are found the same way as a photo's palette) and a pasted
list. Rows are compact, with an inline remove that works down to zero.

**Usage counts** (Jay's call: "add instrumentation so I can see how folks use it"). Same setup
as the other Lab projects: anonymous events to the shared `lab_events` table in the UX
Portfolio Supabase project, live site only, skipped with Do Not Track or Global Privacy Control,
a random id per visit and nothing kept between visits. **No colors, images or typed text are
ever sent**: a pair is summarized as pass or fail per rule and a ratio band (under 3, 3 to 4.5,
4.5 to 7, 7+). Counted: opens (and where from), mode changes, how each pair turned out, and
which features get used (fixes, swaps by button, key or bar, recent colors, drags, the
eyedropper, formats, the photo tools, palette lists and screenshots, copy link). The shared
receiver only accepts apps on its list, so Contrast Lab's counts start once "contrast-lab" is
added there and the receiver is redeployed.

**Lab labels for tools** (proposed, approved pending Jay's word). On the Lab page, tools say
"Ready to use" and "Open", games and toys keep "Playable" and "Play".

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

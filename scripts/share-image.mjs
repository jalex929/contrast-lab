/* global localStorage */
// Builds public/og-image.png (1200x630): the title and three features on the left, and a real
// screenshot of the app on the right (a failing pair with the nearest fix being previewed), so
// the share image always shows the actual interface.
// Usage: npm run build, then `npx vite preview --port 4195` in another terminal, then
//   node scripts/share-image.mjs [http://localhost:4195/]
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const APP = process.argv[2] ?? "http://localhost:4195/";
const browser = await chromium.launch();

// 1. The app: a coral on white fails body text, with the best fix offered beside it.
const app = await browser.newPage({ viewport: { width: 1060, height: 760 }, deviceScaleFactor: 2 });
await app.addInitScript(() => {
  localStorage.setItem(
    "contrast-lab:recent",
    JSON.stringify([
      "#f0605d",
      "#ffffff",
      "#000052",
      "#ffdf3f",
      "#1a7f5a",
      "#b4235a",
      "#2563eb",
      "#18181b",
    ]),
  );
  localStorage.setItem("contrast-lab:format", "hex");
});
await app.goto(`${APP}#pair=f0605d,ffffff`, { waitUntil: "networkidle" });
await app.waitForTimeout(300);
const pair = await app.locator(".pair").boundingBox();
await app.screenshot({
  path: "docs/share/app.png",
  clip: { x: pair.x - 8, y: pair.y - 8, width: pair.width + 16, height: 640 },
});

// 2. The card, with that screenshot on the right.
const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await card.goto(pathToFileURL(resolve("docs/share/card.html")).href, { waitUntil: "networkidle" });
await card.screenshot({ path: "public/og-image.png" });
await browser.close();
console.log("Wrote docs/share/app.png and public/og-image.png");

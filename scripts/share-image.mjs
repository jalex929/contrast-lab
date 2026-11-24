// Builds public/og-image.png (1200x630) from docs/share/card.html.
// Usage: node scripts/share-image.mjs
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(resolve("docs/share/card.html")).href, { waitUntil: "networkidle" });
await page.screenshot({ path: "public/og-image.png" });
await browser.close();
console.log("Wrote public/og-image.png");

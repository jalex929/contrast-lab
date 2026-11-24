import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// An automated accessibility audit (axe-core, WCAG 2.2 A and AA rules) of each main state.
// It catches what machines can catch (names, roles, contrast of the interface, structure); it
// doesn't replace testing with a screen reader by hand.
async function audit(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    // The preview and the palette grid show the person's own colors on purpose, including pairs
    // that fail; their contrast is the subject of the tool, not a defect in it.
    .exclude(".canvas")
    .exclude(".grid__sample")
    .exclude(".pairs__sample")
    .exclude(".sticky-bar__pair")
    .exclude(".mini__sample")
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary).toEqual([]);
}

test("pair checker has no automated accessibility violations", async ({ page }) => {
  await page.goto("./#pair=f0605d,ffffff");
  await audit(page);
});

test("a passing pair, with the AAA step up, has none either", async ({ page }) => {
  await page.goto("./#pair=767676,ffffff");
  await audit(page);
});

test("palette view has no automated accessibility violations", async ({ page }) => {
  await page.goto("./#palette=000052,ffdf3f,ffffff,f0605d");
  await audit(page);
});

test("empty palette has none either", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("tab", { name: "Check a palette" }).click();
  await audit(page);
});

test("photo workspace has no automated accessibility violations", async ({ page }) => {
  await page.goto("./#pair=f0605d,ffffff");
  await page.locator('input[type="file"]').first().setInputFiles("e2e/fixtures/text-sample.png");
  await expect(page.getByRole("dialog", { name: "Photo" })).toBeVisible();
  await audit(page);
});

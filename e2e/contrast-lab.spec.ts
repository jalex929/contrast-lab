import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
});

test("opens on a failing pair with no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.reload();
  await expect(page.locator(".ratio__number")).toHaveText("4.47");
  await expect(
    page.getByText("AA: passes large text and icons and control edges; fails body text."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("using the nearest passing text color fixes body text", async ({ page }) => {
  const group = page.locator(".fix__group").filter({ hasText: "Change the text color" });
  await expect(group.locator(".suggestion__hex").first()).toHaveText("#767676");
  await group.getByRole("button", { name: /Use/ }).first().click();
  await expect(page.getByLabel("Text color", { exact: true })).toHaveValue("#767676");
  await expect(page.locator(".ratio__number")).toHaveText("4.54");
  await expect(page.getByText(/already passes body text AA/)).toBeVisible();
});

test("a typo explains itself and keeps the last good result", async ({ page }) => {
  const text = page.getByLabel("Text color", { exact: true });
  await text.fill("#77");
  await expect(page.getByText("A hex code has 3, 4, 6 or 8 digits")).toBeVisible();
  await expect(text).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".ratio__number")).toHaveText("4.47");
  await text.fill("rgb(0 0 82)");
  await expect(page.locator(".ratio__number")).toHaveText("18.71");
});

test("swap trades text and background", async ({ page }) => {
  await page.getByLabel("Text color", { exact: true }).fill("#000052");
  await page.getByRole("button", { name: "Swap text and background" }).click();
  await expect(page.getByLabel("Text color", { exact: true })).toHaveValue("#ffffff");
  await expect(page.getByLabel("Background", { exact: true })).toHaveValue("#000052");
});

test("the address keeps the current check, so a link reopens it", async ({ page }) => {
  await page.getByLabel("Text color", { exact: true }).fill("#1a2b3c");
  await expect(page).toHaveURL(/#pair=1a2b3c,ffffff$/);
  await page.goto("./#pair=000052,ffdf3f");
  await expect(page.locator(".ratio__number")).toHaveText("14.15");
});

test("palette grid: every pair, and a cell opens the pair checker", async ({ page }) => {
  await page.getByRole("tab", { name: "Check a palette" }).click();
  await expect(page).toHaveURL(/#palette=000052,ffdf3f,ffffff,6b6b8f$/);
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(4);
  await page.getByRole("button", { name: "Open #ffdf3f on #ffffff in the pair checker" }).click();
  await expect(page.getByRole("tab", { name: "Check a pair" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".ratio__number")).toHaveText("1.32");
});

test("tabs work with the arrow keys", async ({ page }) => {
  await page.getByRole("tab", { name: "Check a pair" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Check a palette" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Every pair" })).toBeVisible();
});

test("nothing is wider than the screen", async ({ page }) => {
  for (const tab of ["Check a pair", "Check a palette"]) {
    await page.getByRole("tab", { name: tab }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("buttons and fields are at least 36px tall", async ({ page }) => {
  for (const el of await page.locator("button:visible, input[type=text]:visible").all()) {
    const box = await el.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  }
});

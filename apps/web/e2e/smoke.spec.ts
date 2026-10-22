import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

async function open(page: import("@playwright/test").Page) {
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Find common ground." }),
  ).toBeVisible();
  await page.getByLabel("Starting date", { exact: true }).fill("2026-11-02");
}
async function mockClipboard(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.clipboard = text;
        },
      },
    });
  });
}

test("add/search/reorder zones, pick date, see results, and round-trip exact URL state", async ({
  page,
  context,
}) => {
  await mockClipboard(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page);
  await page
    .getByRole("button", { name: "Add a time zone", exact: false })
    .click();
  await page.getByLabel("Search time zones").fill("Paris");
  await page
    .getByRole("button", { name: "Add Paris (Europe/Paris)", exact: true })
    .click();
  await expect(page.locator(".zone-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Move Paris earlier", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Settings for Paris", exact: true })
    .click();
  await page.getByLabel("Europe/Paris city label").fill("Paris studio");
  await page.getByRole("button", { name: "45m", exact: true }).click();
  await page.getByLabel("Days to search").fill("3");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator(".slot-card").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Select slot 2", exact: true })
    .click();
  await expect(page.locator(".slot-details")).toBeVisible();
  await page.getByRole("button", { name: "Share workspace" }).click();
  const share = await page.evaluate(
    () => document.documentElement.dataset.clipboard!,
  );
  const original = JSON.parse(new URL(share).searchParams.get("state")!);
  expect(original.input.zones.map((zone: { id: string }) => zone.id)).toEqual([
    "Asia/Dhaka",
    "Europe/London",
    "Europe/Paris",
    "America/New_York",
  ]);
  expect(original.input.durationMinutes).toBe(45);
  expect(original.theme).toBe("dark");
  await page.evaluate(() =>
    localStorage.setItem("tzmeet:state:v1", "invalid stored value"),
  );
  const restored = await context.newPage();
  await restored.goto(share);
  await expect(
    restored.getByLabel("Starting date", { exact: true }),
  ).toHaveValue("2026-11-02");
  await expect(
    restored.getByRole("button", { name: "45m", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(restored.locator(".zone-card")).toHaveCount(4);
  await expect(restored.getByLabel("Europe/Paris city label")).toHaveValue(
    "Paris studio",
  );
  await expect(restored.locator(".slot-details")).toBeVisible();
  await expect(restored.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(async () =>
      JSON.parse(new URL(restored.url()).searchParams.get("state")!),
    )
    .toEqual(original);
  expect(errors).toEqual([]);
});

test("copies a link that opens one exact slot", async ({ page, context }) => {
  await mockClipboard(page);
  await open(page);
  const third = page.locator(".slot-card").nth(2);
  const start = (await third.getAttribute("id"))!;
  await page
    .getByRole("button", { name: "Copy link to slot 3", exact: true })
    .click();
  const link = await page.evaluate(
    () => document.documentElement.dataset.clipboard!,
  );
  const opened = await context.newPage();
  await opened.goto(link);
  const card = opened.locator(`[id="${start}"]`);
  await expect(card).toHaveClass(/selected/);
  await expect(card.locator(".slot-details")).toBeVisible();
  await expect(card).toBeInViewport();
});

test("copies every local time and downloads a real UTC ICS file", async ({
  page,
}) => {
  await mockClipboard(page);
  await open(page);
  await page
    .getByRole("button", { name: "Copy invite text for slot 1", exact: true })
    .click();
  const copied = await page.evaluate(
    () => document.documentElement.dataset.clipboard!,
  );
  expect(copied).toContain("Dhaka");
  expect(copied).toContain("London");
  expect(copied).toContain("New York");
  expect(copied).toContain("Mon 2 Nov 2026");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download ICS for slot 1", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tzmeet-.*\.ics$/);
  const content = await readFile((await download.path())!, "utf8");
  expect(content).toContain("BEGIN:VCALENDAR\r\n");
  expect(content).toContain("DTSTART:20261102T140000Z");
  expect(content).toContain("DTEND:20261102T143000Z");
});

test("offers a focused manual-copy fallback when clipboard permission is denied", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async () => {
          throw new Error("Clipboard denied");
        },
      },
    });
  });
  await open(page);
  await page
    .getByRole("button", { name: "Copy invite text for slot 1", exact: true })
    .click();
  const text = page.getByLabel("Select this text to copy");
  await expect(text).toBeFocused();
  await expect(text).toHaveValue(/Dhaka/);
  await page.getByRole("button", { name: "Close copy text" }).click();
  await expect(text).toHaveCount(0);
});

test("has no runtime API/external requests and keeps working offline after load", async ({
  page,
  context,
}) => {
  const unexpected: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).origin !==
        new URL(page.url() === "about:blank" ? request.url() : page.url())
          .origin ||
      ["fetch", "xhr", "websocket"].includes(request.resourceType())
    )
      unexpected.push(request.url());
  });
  await open(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "60m", exact: true }).click();
  await expect(page.locator(".slot-card").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Select slot 1", exact: true })
    .click();
  await expect(page.locator(".slot-details")).toContainText("elapsed time");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  expect(unexpected).toEqual([]);
});

test("shows core empty-result diagnostics and validates incomplete edits", async ({
  page,
}) => {
  await open(page);
  for (const label of ["Dhaka", "New York"]) {
    await page
      .getByRole("button", { name: `Settings for ${label}`, exact: true })
      .click();
    await page
      .getByLabel(`${label} earliest allowed`, { exact: true })
      .fill("09:00");
    await page
      .getByLabel(`${label} latest allowed`, { exact: true })
      .fill("18:00");
  }
  await expect(
    page.getByRole("heading", { name: "No common window, yet." }),
  ).toBeVisible();
  await expect(page.locator(".empty-results")).toContainText("No shared slots");
  await expect(page.locator(".empty-results")).toContainText("Relax");
  await page.getByLabel("Dhaka work starts", { exact: true }).fill("19:00");
  await expect(
    page.getByRole("alert").filter({ hasText: "Check your settings" }),
  ).toContainText("Check your settings");
});

test("prayer controls affect the shared timeline; last-used settings persist", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Remove New York", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove London", exact: true })
    .click();
  await page.getByRole("switch", { name: "Respect prayer times" }).check();
  await page
    .getByLabel("Prayer method", { exact: true })
    .selectOption("Karachi");
  await page.getByLabel("Prayer buffer minutes", { exact: true }).fill("15");
  await expect(
    page.locator(".timeline-segment.kind-prayer").first(),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("tzmeet:state:v1")!).input.prayer
            .bufferMinutes,
      ),
    )
    .toBe(15);
  await page.goto("./");
  await expect(
    page.getByRole("switch", { name: "Respect prayer times" }),
  ).toBeChecked();
  await expect(
    page.getByLabel("Prayer buffer minutes", { exact: true }),
  ).toHaveValue("15");
  await expect(page.locator(".zone-card")).toHaveCount(1);
});

test("is keyboard operable, passes automated accessibility checks, and does not overflow mobile", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Add a time zone", exact: false })
    .focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Search time zones").fill("Paris");
  await page.keyboard.press("Enter");
  await expect(page.locator(".zone-card")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Select slot 1", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".slot-details")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const timeline = page.getByRole("region", {
    name: "24-hour timeline, horizontally scrollable on small screens",
  });
  await expect(timeline).toBeVisible();
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations, `${theme} accessibility violations`).toEqual([]);
  }
});

test("recovers gracefully from malformed URL and unavailable localStorage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage denied");
      },
    });
  });
  await page.goto("./?state=not-json");
  await expect(
    page.getByRole("heading", { name: "Find common ground." }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("invalid settings");
  await page.getByLabel("Starting date", { exact: true }).fill("2026-11-02");
  await expect(page.locator(".slot-card").first()).toBeVisible();
});

test("cron explainer: DST warnings, field errors, zones, link round-trip and accessibility", async ({
  page,
  context,
}) => {
  await mockClipboard(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./#/cron");
  await expect(
    page.getByRole("heading", { name: "Explain a cron schedule." }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "At 02:30" })).toBeVisible();
  const warnings = page.getByRole("list", { name: "Warnings" });
  await expect(warnings).toContainText(
    "Unix cron runs the 02:30 job right after the change, at 03:00.",
  );
  await expect(page.locator(".cron-table tbody tr")).toHaveCount(10);
  await page.getByLabel("Cron expression").fill("0 99 * * *");
  await expect(page.getByRole("alert")).toContainText(
    "hour must be 0–23, got 99",
  );
  await expect(page.locator(".cron-chips li.invalid")).toContainText("99");
  await page
    .getByRole("button", { name: "Kubernetes 01:30 in London" })
    .click();
  await expect(warnings).toContainText("so the 01:30 run happens twice");
  await page.getByRole("button", { name: "Stop showing Asia/Dhaka" }).click();
  await page.getByLabel("Add a zone").fill("Asia/Tokyo");
  await expect(page.getByRole("columnheader", { name: /Tokyo/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Switch to dark theme" }).click();
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations, `${theme} accessibility violations`).toEqual([]);
  }
  await page.getByRole("button", { name: "Copy link" }).click();
  const link = await page.evaluate(
    () => document.documentElement.dataset.clipboard!,
  );
  expect(new URL(link).hash).toContain("d=kubernetes");
  const restored = await context.newPage();
  await restored.goto(link);
  await expect(restored.getByLabel("Cron expression")).toHaveValue(
    "30 1 * * *",
  );
  await expect(restored.getByLabel("Cron syntax")).toHaveValue("kubernetes");
  await expect(
    restored.getByRole("columnheader", { name: /Tokyo/ }),
  ).toBeVisible();
  await expect(
    restored.getByRole("columnheader", { name: /Dhaka/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Meetings" }).click();
  await expect(
    page.getByRole("heading", { name: "Find common ground." }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('checks a slot over the coming weeks of DST changes', async ({ page }) => {
  await open(page);
  const toggle = page.getByRole('button', { name: 'Check slot 1 over the coming weeks', exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const panel = page.locator('#over-time-0');
  await expect(panel).toContainText('next 26 weeks');
  await expect(panel).toContainText('Local times change');
  await expect(panel.getByRole('cell', { name: 'America/New_York clocks went forward 1 hour on 2027-03-14' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const audit = await new AxeBuilder({ page }).include('#over-time-0').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(audit.violations).toEqual([]);
  await toggle.click();
  await expect(panel).toHaveCount(0);
});

test('applies a public holiday preset and lists upcoming holidays', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Settings for Dhaka', exact: true }).click();
  await expect(page.getByLabel('Dhaka public holidays')).toContainText('Bangladesh (suggested)');
  await page.getByLabel('Dhaka public holidays').selectOption('BD');
  await expect(page.locator('.zone-details')).toContainText('Next: 16 Dec Victory Day · 25 Dec Christmas Day');
  await page.getByLabel('Starting date', { exact: true }).fill('2026-12-16');
  await page.getByLabel('Days to search').fill('1');
  await expect(page.locator('.empty-results')).toContainText('holiday in Dhaka');
  await page.getByLabel('Dhaka public holidays').selectOption('');
  await expect(page.locator('.slot-card').first()).toBeVisible();
});

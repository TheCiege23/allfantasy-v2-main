import { expect, test } from "@playwright/test"

test.describe("@toolhub tool hub click audit", () => {
  test.describe.configure({ timeout: 240_000 })

  test("tool hub filters, cards, related links, and mobile quick-launch are wired", async ({ page, browserName }) => {
    await page.goto("/tools-hub", { waitUntil: "domcontentloaded" })

    await expect(page.getByTestId("tools-hub-page")).toBeVisible()
    await expect(page.getByTestId("tools-hub-title")).toBeVisible()
    await expect(page.getByTestId("tools-hub-featured-section")).toBeVisible()
    await expect(page.getByTestId("tools-hub-trending-section")).toBeVisible()
    await expect(page.getByTestId("tools-hub-quick-launch-section")).toBeVisible()

    // Tool detail link path
    await page.getByTestId("tools-hub-featured-detail-trade-analyzer").click()
    await expect(page).toHaveURL(/\/tools\/trade-analyzer$/, { timeout: 20_000 })
    await expect(page.getByTestId("tool-landing-back-to-hub")).toBeVisible()
    await expect(page.getByTestId("tool-landing-related-tools")).toBeVisible()
    await page.getByTestId("tool-landing-related-link-mock-draft-simulator").click()
    await expect(page).toHaveURL(/\/tools\/mock-draft-simulator$/, { timeout: 20_000 })
    await page.getByTestId("tool-landing-back-to-hub").click()
    await expect(page).toHaveURL(/\/tools-hub/, { timeout: 20_000 })

    // Sport + category filter path and filter persistence
    await page.getByTestId("tools-hub-sport-filter").selectOption("ncaa-basketball-fantasy")
    await page.getByTestId("tools-hub-category-bracket").click()
    await expect(page.getByTestId("tools-hub-tool-card-bracket-challenge")).toBeVisible()

    // Filtered views reload correctly via URL state
    await page.goto("/tools-hub?sport=ncaa-basketball-fantasy&category=bracket", { waitUntil: "domcontentloaded" })
    await expect(page.getByTestId("tools-hub-sport-filter")).toHaveValue("ncaa-basketball-fantasy")
    await expect(page.getByTestId("tools-hub-tool-card-bracket-challenge")).toBeVisible()

    // Tool open + related links from filtered card
    await page.getByTestId("tools-hub-tool-open-bracket-challenge").click()
    await expect(page).toHaveURL(/\/bracket/, { timeout: 20_000 })
    await page.goto("/tools-hub?sport=ncaa-basketball-fantasy&category=bracket", { waitUntil: "domcontentloaded" })
    await page.getByTestId("tools-hub-related-bracket-challenge-power-rankings").click()
    await expect(page).toHaveURL(/\/tools\/power-rankings$/, { timeout: 20_000 })
    await page.getByTestId("tool-landing-back-to-hub").click()
    await expect(page).toHaveURL(/\/tools-hub/, { timeout: 20_000 })

    // Mobile card-list behavior + quick launch click path
    if (browserName !== "firefox") {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto("/tools-hub?category=bracket", { waitUntil: "domcontentloaded" })
      await expect(page.getByTestId("tools-hub-quick-launch-bracket-challenge")).toBeVisible()
      await page.getByTestId("tools-hub-quick-launch-bracket-challenge").click()
      await expect(page).toHaveURL(/\/bracket/, { timeout: 20_000 })
    }

    // AI "best tool for me" entry point
    await page.goto("/tools-hub", { waitUntil: "domcontentloaded" })
    const chimmyLink = page.getByTestId("tools-hub-chimmy-link")
    await expect(chimmyLink).toHaveAttribute("href", /\/messages\?tab=ai/)
    await chimmyLink.click()
    await expect(page).toHaveURL(/\/messages\?tab=ai/, { timeout: 20_000 })

    await page.goto("/tools-hub", { waitUntil: "domcontentloaded" })
    await page.getByTestId("tools-hub-best-tool-link").click()
    await expect(page).toHaveURL(/\/messages\?tab=ai/, { timeout: 20_000 })

    // Back button path
    await page.goto("/tools-hub", { waitUntil: "domcontentloaded" })
    await page.getByTestId("tools-hub-back-home").click()
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
  })
})

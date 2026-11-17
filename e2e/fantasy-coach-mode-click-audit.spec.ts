import { expect, test } from "@playwright/test"

test.describe.configure({ mode: "serial", timeout: 120_000 })

async function openHarness(page: Parameters<typeof test>[0]["page"]) {
  await page.goto("/e2e/fantasy-coach-mode", { waitUntil: "domcontentloaded" })
  await expect(page.getByRole("heading", { name: "Fantasy Coach Mode Harness" })).toBeVisible()
  await expect(page.getByTestId("coach-action-link-waiver")).toBeVisible()
}

test.describe("@coach fantasy coach mode click audit", () => {
  test("coach dashboard renders provider overlays and advice panel", async ({ page }) => {
    await openHarness(page)

    await expect(page.getByText("Team pulse").first()).toBeVisible()
    await expect(page.getByText("DeepSeek roster math")).toBeVisible()
    await expect(page.getByText("Grok strategy framing")).toBeVisible()
    await expect(page.getByText("OpenAI coach recommendation")).toBeVisible()

    await expect(page.getByTestId("strategy-explanation-panel")).toHaveCount(0)
    await page.getByTestId("coach-advice-type-waiver").click()
    await page.getByTestId("coach-mode-button").click()

    const strategyPanel = page.getByTestId("strategy-explanation-panel")
    await expect(strategyPanel).toBeVisible()
    await expect(strategyPanel).toContainText("Waiver advice")
    await expect(strategyPanel).toContainText("Waiver edge")
    await expect(strategyPanel).toContainText("Your challenge")

    await expect(page.getByTestId("coach-action-link-waiver")).toBeVisible()
    await expect(page.getByTestId("coach-waiver-link-0")).toBeVisible()
    await expect(page.getByTestId("coach-trade-link-0")).toBeVisible()

    await page.getByTestId("coach-advice-type-lineup_optimization").click()
    await page
      .getByTestId("coach-roster-json-input")
      .fill(
        '[{"playerName":"Harness Floor Guard","position":"PG","projectedPoints":34.2},{"playerName":"Harness Wing Creator","position":"SG","projectedPoints":31.8}]'
      )
    await page.getByTestId("coach-lineup-optimize-button").click()
    const optimizerPanel = page.getByTestId("coach-lineup-optimizer-panel")
    await expect(optimizerPanel).toBeVisible()
    await expect(optimizerPanel).toContainText("Deterministic lineup optimizer")
    await expect(page.getByTestId("coach-lineup-optimizer-starters")).toContainText("Harness Floor Guard")

    await page.getByTestId("coach-lineup-optimize-ai-toggle").click()
    await page.getByTestId("coach-lineup-optimize-button").click()
    await expect(optimizerPanel).toContainText("Explanation source: AI")
  })

  test("recommendation, waiver target, and trade suggestion links navigate correctly", async ({ page }) => {
    await openHarness(page)

    const recommendationLink = page.getByTestId("coach-action-link-waiver")
    await expect(recommendationLink).toHaveAttribute("href", /\/waiver-ai\?/)
    await Promise.all([
      page.waitForURL(/\/waiver-ai\?/, { timeout: 15_000 }),
      recommendationLink.click(),
    ])

    await openHarness(page)

    const waiverTargetLink = page.getByTestId("coach-waiver-link-0")
    // The waiver targets are archetypes, not people: they open the waiver tool on that slot.
    await expect(waiverTargetLink).toHaveAttribute("href", /\/waiver-ai\?.*focus=/)
    await Promise.all([
      page.waitForURL(/\/waiver-ai\?.*focus=/, { timeout: 15_000 }),
      waiverTargetLink.click(),
    ])

    await openHarness(page)

    const tradeSuggestionLink = page.getByTestId("coach-trade-link-0")
    await expect(tradeSuggestionLink).toHaveAttribute("href", /\/trade-evaluator\?/)
    await Promise.all([
      page.waitForURL(/\/trade-evaluator\?/, { timeout: 15_000 }),
      tradeSuggestionLink.click(),
    ])
  })
})

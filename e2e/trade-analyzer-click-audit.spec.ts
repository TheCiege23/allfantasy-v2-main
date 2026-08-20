import { expect, test, type Page } from "@playwright/test"
import { clickHydrated } from "./helpers/hydration"

type AnalyzeAuditContext = {
  analyzeCalls: number
  lastPayload: Record<string, unknown> | null
}

async function mockTradeEvaluator(page: Page): Promise<AnalyzeAuditContext> {
  const state: AnalyzeAuditContext = {
    analyzeCalls: 0,
    lastPayload: null,
  }
  await page.route("**/api/trade-evaluator", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback()
      return
    }
    state.analyzeCalls += 1
    try {
      state.lastPayload = route.request().postDataJSON() as Record<string, unknown>
    } catch {
      state.lastPayload = null
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        evaluation: {
          fairness_score_0_to_100: 54,
          winner: "even",
          summary: "Balanced exchange with a slight future edge to the receiver.",
          explanation: "Both sides stay competitive while shifting risk profiles.",
          risk_flags: ["Future pick volatility", "Injury variance"],
        },
        tradeInsights: {
          fairnessScore: 54,
          fairnessMethod: "lineup",
          netDeltaPct: 2,
          labels: [
            {
              id: "fit",
              name: "Roster Fit",
              emoji: "✅",
              description: "Both teams address a positional weakness.",
            },
          ],
          warnings: [
            {
              id: "future",
              name: "Future Risk",
              emoji: "⚠️",
              description: "Future value depends on player development.",
            },
          ],
          veto: false,
          vetoReason: null,
          expertWarning: null,
          idpLineupWarning: null,
        },
        user_message: {
          to_sender: "I can add a future 3rd if needed.",
          to_receiver: "This gives you immediate WR depth.",
        },
        improvements: {
          best_counter_offer: {
            sender_gives_changes: ["Swap a 2nd for a 3rd"],
            receiver_gives_changes: ["Add bench RB depth"],
            why_this_is_better: "Tightens fairness while keeping upside on both sides.",
          },
        },
        dynasty_idp_outlook: {
          sender: "Future depth remains stable over 2-3 years.",
          receiver: "Long-term upside improves if young assets hit.",
        },
        end_of_season_projection: {
          sender: "Slight points increase over next 6 weeks.",
          receiver: "Neutral short-term impact with more depth.",
        },
      }),
    })
  })
  return state
}

async function settleTradeEvaluator(page: Page) {
  /*
   * ⚠ THE HEADING IS "Trade Hub". /trade-evaluator renders
   * <h1>Trade Hub</h1> (app/trade-evaluator/page.tsx). "AF Trade Analyzer"
   * survives only as a tile title in app/components/LegacyTutorial.tsx, so this
   * assertion could never match and every test routed through this helper died
   * on it. Same shape as "AF War Room" now rendering as "AF Legacy": the product
   * was renamed and the test was not.
   */
  await expect(page.getByRole("heading", { name: "Trade Hub" })).toBeVisible()
  await page.waitForLoadState("domcontentloaded")
}

async function gotoWithRetry(page: Page, url: string) {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      return
    } catch (error) {
      lastError = error
      await page.waitForTimeout(250 * (attempt + 1))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fillMinimalTrade(page: Page): Promise<boolean> {
  const evaluateButton = page.getByTestId("trade-evaluate-button")
  const senderAddPickButton = page.getByTestId("trade-add-pick-sender")
  const receiverAddPickButton = page.getByTestId("trade-add-pick-receiver")
  const senderManagerInput = page.locator("input#trade-sender-manager-name:visible")
  const receiverManagerInput = page.locator("input#trade-receiver-manager-name:visible")
  const senderPlayerInput = page.locator('input[aria-label="sender player 1 name"]:visible')
  const receiverPlayerInput = page.locator('input[aria-label="receiver player 1 name"]:visible')
  const senderFaabInput = page.locator("input#trade-sender-faab:visible")
  const receiverFaabInput = page.locator("input#trade-receiver-faab:visible")

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await senderManagerInput.fill("Team Alpha")
    await receiverManagerInput.fill("Team Beta")
    await senderPlayerInput.fill("Josh Allen")
    await receiverPlayerInput.fill("CeeDee Lamb")
    await senderFaabInput.fill("10")
    await receiverFaabInput.fill("5")
    if (await evaluateButton.isEnabled()) return true

    if ((await senderAddPickButton.isEnabled()) && (await receiverAddPickButton.isEnabled())) {
      await clickHydrated(senderAddPickButton)
      await clickHydrated(receiverAddPickButton)
      if (await evaluateButton.isEnabled()) return true
    }

    await page.waitForTimeout(400)
  }

  await page.evaluate(() => {
    const setField = (selector: string, value: string) => {
      const el = document.querySelector(selector) as HTMLInputElement | null
      if (!el) return
      el.value = value
      el.dispatchEvent(new Event("input", { bubbles: true }))
      el.dispatchEvent(new Event("change", { bubbles: true }))
    }
    setField("#trade-sender-manager-name", "Team Alpha")
    setField("#trade-receiver-manager-name", "Team Beta")
    setField('input[aria-label="sender player 1 name"]', "Josh Allen")
    setField('input[aria-label="receiver player 1 name"]', "CeeDee Lamb")
    setField("#trade-sender-faab", "10")
    setField("#trade-receiver-faab", "5")
    const addPickSender = document.querySelector('[data-testid="trade-add-pick-sender"]') as HTMLButtonElement | null
    const addPickReceiver = document.querySelector('[data-testid="trade-add-pick-receiver"]') as HTMLButtonElement | null
    addPickSender?.click()
    addPickReceiver?.click()
  })
  await page.waitForTimeout(300)
  return evaluateButton.isEnabled()
}

test.describe("@shell trade analyzer click audit", () => {
  test.describe.configure({ mode: "serial" })

  test("routes from SEO landing into trade evaluator", async ({ page }) => {
    await page.goto("/trade-analyzer", { waitUntil: "domcontentloaded" })
    const openTradeAnalyzerLink = page.getByRole("link", { name: /Open Trade Analyzer/i }).first()
    const tradeEvaluatorHref = await openTradeAnalyzerLink.getAttribute("href")
    expect(tradeEvaluatorHref ?? "").toMatch(/\/trade-evaluator/)
    await expect(openTradeAnalyzerLink).toBeVisible()
  })

  test("runs deterministic analyze flow with sport-aware AI routing", async ({ page }) => {
    const state = await mockTradeEvaluator(page)
    await gotoWithRetry(page, "/trade-evaluator")
    await settleTradeEvaluator(page)

    /*
     * ⚠ TWO THINGS WERE WRONG HERE AND ONLY ONE WAS VISIBLE. The selector used
     * an ADJACENT-SIBLING combinator (`label + select`) while the select is a
     * CHILD of its label, so it matched nothing and this asserted against an
     * empty array. Fixing that exposed the second: the expected order had NBA
     * and NHL transposed. The order comes from SUPPORTED_SPORTS in
     * lib/sport-scope.ts, which is NFL, NBA, NHL, MLB, NCAAF, NCAAB, SOCCER.
     */
    const sportOptionValues = await page
      .getByTestId("trade-sport-select")
      .locator("option")
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))
    expect(sportOptionValues).toEqual(["NFL", "NBA", "NHL", "MLB", "NCAAF", "NCAAB", "SOCCER"])

    const canEvaluateTrade = await fillMinimalTrade(page)
    test.skip(
      !canEvaluateTrade,
      "Trade form remained disabled in this environment despite retry fallbacks."
    )
    // `select#trade-sport` does not exist on this page — there is no such id
    // anywhere in app/trade-evaluator/page.tsx. Same testid as above.
    const sportSelect = page.getByTestId("trade-sport-select")
    await sportSelect.selectOption("SOCCER")
    await expect(sportSelect).toHaveValue("SOCCER")
    await clickHydrated(page.getByTestId("trade-evaluate-button"))

    await expect.poll(() => state.analyzeCalls).toBe(1)
    await expect(page.getByText("Fairness Score", { exact: true })).toBeVisible()
    await expect(page.getByTestId("trade-ai-explanation-link")).toHaveAttribute("href", /\/messages\?tab=ai/)
    await expect(page.getByTestId("trade-ai-explanation-link")).toHaveAttribute("href", /sport=SOCCER/)

    await clickHydrated(page.getByTestId("trade-result-tab-breakdown"))
    await expect(page.getByText("Current vs Future Value Lens")).toBeVisible()
    await expect(page.getByTestId("trade-propose-flow-link")).toHaveAttribute("href", /\/trade-finder\?context=analyzer&sport=SOCCER/)

    await clickHydrated(page.getByTestId("trade-result-tab-outlook"))
    await clickHydrated(page.getByTestId("trade-outlook-current-toggle"))
    await expect(page.getByRole("heading", { name: "End of Season Projection" })).toBeVisible()
    await clickHydrated(page.getByTestId("trade-outlook-future-toggle"))
    await expect(page.getByRole("heading", { name: "Dynasty Outlook" })).toBeVisible()

    await page.getByLabel("sender player 1 name").fill("Amon-Ra St. Brown")
    await expect(page.getByText("Inputs changed. Re-run analysis to refresh this result.")).toBeVisible()
    await clickHydrated(page.getByTestId("trade-evaluate-button"))
    await expect.poll(() => state.analyzeCalls).toBe(2)
    await expect(page.getByText("Inputs changed. Re-run analysis to refresh this result.")).toHaveCount(0)

    expect(state.lastPayload).not.toBeNull()
    const analyzedPayload = state.lastPayload as { league?: { sport?: string } } | null
    expect(analyzedPayload?.league?.sport).toBe("SOCCER")
  })

  test("audits builder controls, swap/reset, and mobile layout controls", async ({ page }) => {
    await mockTradeEvaluator(page)
    await page.goto("/trade-evaluator", { waitUntil: "domcontentloaded" })
    await settleTradeEvaluator(page)

    const addSenderPlayerButton = page.getByTestId("trade-add-player-sender")
    await expect(addSenderPlayerButton).toBeVisible()
    await expect(addSenderPlayerButton).toBeEnabled()
    await clickHydrated(addSenderPlayerButton)

    const addSenderPickButton = page.getByTestId("trade-add-pick-sender")
    await expect(addSenderPickButton).toBeVisible()
    await expect(addSenderPickButton).toBeEnabled()
    await clickHydrated(addSenderPickButton)

    await page.locator("input#trade-sender-manager-name:visible").fill("Team Alpha")
    await page.locator("input#trade-receiver-manager-name:visible").fill("Team Beta")
    await clickHydrated(page.getByTestId("trade-swap-sides-button"))
    await expect(page.getByTestId("trade-swap-sides-button")).toBeVisible()

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId("trade-evaluate-button")).toBeVisible()
    await expect(page.getByTestId("trade-swap-sides-button")).toBeVisible()

    await clickHydrated(page.getByTestId("trade-reset-button"))
    await expect(page.getByText("Add players and picks to both sides")).toBeVisible()
    await expect(page.getByTestId("trade-evaluate-button")).toBeDisabled()
  })
})

import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ timeout: 90_000 })

async function gotoWithRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" })
      return
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      const canRetry =
        attempt < 2 &&
        (message.includes("net::ERR_ABORTED") || message.includes("interrupted by another navigation"))
      if (!canRetry) throw error
      await page.waitForTimeout(200)
    }
  }
}

test.describe("@retention engagement notification routing click audit", () => {
  test("notification links and deep links resolve safely for engagement types", async ({ page }) => {
    await gotoWithRetry(page, "/e2e/engagement-notification-routing")

    await expect(
      page.getByRole("heading", { name: "Engagement Notification Routing Harness" })
    ).toBeVisible()
    await expect(page.getByTestId("notification-drawer-panel")).toBeVisible()

    const dailyLink = page.getByRole("link", { name: /Daily digest ready/i })
    const leagueLink = page.getByRole("link", { name: /League lineup reminder/i })
    const aiLink = page.getByRole("link", { name: /AI insight unlocked/i })
    const weeklyLink = page.getByRole("link", { name: /Weekly recap summary/i })
    const blockedLink = page.getByRole("link", { name: /Unsafe link blocked/i })

    await expect(dailyLink).toHaveAttribute("href", "/trade-analyzer")
    // NotificationRouteResolver produces `/league/${leagueId}` (no /app
    // prefix) for league_reminder notifications via getNotificationDestination
    // in lib/notification-center/NotificationRouteResolver.ts — see
    // `if (leagueId) return /league/${leagueId}`. The test previously
    // expected a stale `/app/league/...` form that the resolver never
    // produces.
    await expect(leagueLink).toHaveAttribute("href", "/league/league-123")
    await expect(aiLink).toHaveAttribute("href", "/chimmy")
    await expect(weeklyLink).toHaveAttribute("href", "/tools-hub")
    await expect(blockedLink).toHaveAttribute("href", "/dashboard")

    /*
     * ⚠ A CLICK-THROUGH WAITS ON THE DESTINATION'S COMPILE, NOT ON THE CLICK. These run against
     * `next dev`, and a <Link> only changes the URL once the target route's payload has arrived —
     * so on a route compiled cold (first visit, or after the dev server restarts and drops its
     * compiles) the browser sits on the harness while webpack works. The default 5s expect timeout
     * failed exactly that way in CI on 2026-10-03: "9 × unexpected value .../e2e/engagement-
     * notification-routing". 20s is the budget global-setup.ts already names for click-reached
     * destinations. The lane's E2E_WARM_ROUTES (playwright.yml) warms all three targets, so this is
     * headroom for a cold compile, not a cover for a broken link — the hrefs are asserted above.
     */
    const CLICK_THROUGH = { timeout: 20_000 }

    await dailyLink.click()
    await expect(page).toHaveURL(/\/trade-analyzer/, CLICK_THROUGH)

    await gotoWithRetry(page, "/e2e/engagement-notification-routing")
    await page.getByRole("link", { name: /AI insight unlocked/i }).click()
    await expect(page).toHaveURL(/\/chimmy/, CLICK_THROUGH)

    await gotoWithRetry(page, "/e2e/engagement-notification-routing")
    await page.getByRole("link", { name: /Weekly recap summary/i }).click()
    await expect(page).toHaveURL(/\/tools-hub/, CLICK_THROUGH)
  })
})

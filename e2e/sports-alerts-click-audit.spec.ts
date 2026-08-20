import { expect, test } from "@playwright/test"

test.describe("@alerts sports alerts click audit", () => {
  test("audits alert click routing, settings save, and dismissal", async ({ page }) => {
    let prefsState = {
      injuryAlerts: true,
      performanceAlerts: true,
      lineupAlerts: true,
    }
    let lastPatchedPrefs: typeof prefsState | null = null

    await page.route("**/api/shared/notifications/read-all", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      })
    })

    await page.route("**/api/shared/notifications/*/read", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok" }),
      })
    })

    await page.route("**/api/alerts/preferences", async (route) => {
      const method = route.request().method()
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(prefsState),
        })
        return
      }

      if (method === "PATCH") {
        const body = route.request().postDataJSON() as typeof prefsState
        prefsState = {
          injuryAlerts: Boolean(body.injuryAlerts),
          performanceAlerts: Boolean(body.performanceAlerts),
          lineupAlerts: Boolean(body.lineupAlerts),
        }
        lastPatchedPrefs = prefsState
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      await route.fallback()
    })

    await page.goto("/e2e/sports-alerts", { waitUntil: "domcontentloaded" })
    await expect(page.getByRole("heading", { name: "Sports Alerts Click Audit Harness" })).toBeVisible()
    const harness = page.getByTestId("sports-alerts-harness-panel")
    const drawer = harness.getByTestId("notification-drawer-panel")
    await expect(drawer).toBeVisible()

    const leagueAlertLink = harness.getByTestId("notification-link-sports-league-alert")
    const playerAlertLink = harness.getByTestId("notification-link-sports-player-alert")

    await expect(leagueAlertLink).toHaveAttribute("href", "/leagues/league-alert-1")
    await expect(playerAlertLink).toHaveAttribute("href", "/af-rankings&playerId=player-12")

    await expect(drawer.getByTestId("notification-dismiss-sports-player-alert")).toBeVisible()
    await expect(drawer.getByTestId("notification-mark-all-read")).toBeVisible()

    const injuryToggle = page.getByTestId("sports-alert-toggle-injury").locator('input[type="checkbox"]')
    const lineupToggle = page.getByTestId("sports-alert-toggle-lineup").locator('input[type="checkbox"]')
    await injuryToggle.uncheck()
    await lineupToggle.check()
    await page.getByTestId("sports-alert-save-button").click()

    await expect(page.getByTestId("sports-alert-save-success")).toBeVisible()
    await expect.poll(() => lastPatchedPrefs).toEqual({
      injuryAlerts: false,
      performanceAlerts: true,
      lineupAlerts: true,
    })

    await expect(leagueAlertLink).toBeVisible()
  })
})

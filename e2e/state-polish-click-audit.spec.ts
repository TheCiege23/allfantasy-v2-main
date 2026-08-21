import { expect, test } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth-flow"

test.describe("@db @state state polish click audit", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 })

  test("audits loading, empty, error, and recovery click paths", async ({ page }) => {
    await registerAndLogin(page)

    const profileState: Record<string, unknown> = {
      userId: "state-audit-user",
      username: "stateaudit",
      email: "state.audit@example.com",
      displayName: "State Audit",
      profileImageUrl: null,
      avatarPreset: "crest",
      preferredLanguage: "en",
      timezone: "America/New_York",
      themePreference: "dark",
      phone: null,
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      ageConfirmedAt: null,
      verificationMethod: "EMAIL",
      hasPassword: true,
      profileComplete: true,
      sleeperUsername: null,
      sleeperLinkedAt: null,
      bio: "State audit profile",
      preferredSports: ["NFL", "NBA", "MLB", "NHL", "NCAAB", "NCAAF", "SOCCER"],
      notificationPreferences: null,
      onboardingStep: null,
      onboardingCompletedAt: null,
      settings: {
        legalAcceptanceState: {
          ageVerified: true,
          disclaimerAccepted: true,
          termsAccepted: true,
          acceptedAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date().toISOString(),
    }

    await page.route("**/api/user/settings", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: profileState,
          settings: {
            legalAcceptanceState: (profileState.settings as { legalAcceptanceState: Record<string, unknown> })
              .legalAcceptanceState,
          },
        }),
      })
    })

    await page.route("**/api/user/profile", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(profileState),
      })
    })

    let notificationsShouldFail = true
    await page.route("**/api/shared/notifications?**", async (route) => {
      if (notificationsShouldFail) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Notifications temporarily unavailable" }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [] }),
      })
    })

    await page.route("**/api/shared/notifications/read-all", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/shared/notifications/*/read", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    // Stabilize dashboard background data calls for deterministic state rendering.
    await page.route("**/api/content-feed?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] }),
      })
    })
    await page.route("**/api/sports/news?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ news: [] }),
      })
    })
    await page.route("**/api/sports/weather?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          team: "KC",
          venue: "Arrowhead",
          source: "mock",
          weather: { condition: "Cloudy", tempF: 68, windMph: 8 },
        }),
      })
    })

    await page.route("**/api/league/list", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ leagues: [] }),
      })
    })

    let leagueSearchCalls = 0
    await page.route("**/api/league/search?**", async (route) => {
      leagueSearchCalls += 1
      if (leagueSearchCalls === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Search unavailable" }),
        })
        return
      }
      const url = new URL(route.request().url())
      const query = (url.searchParams.get("q") || "").toLowerCase()
      const hits = query.includes("soc")
        ? [{ id: "soccer-league-1", name: "Soccer Pro League", sport: "SOCCER" }]
        : []
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ hits, total: hits.length }),
      })
    })

    let playerSearchCalls = 0
    await page.route("**/api/players/search?**", async (route) => {
      playerSearchCalls += 1
      if (playerSearchCalls === 1) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Player search unavailable" }),
        })
        return
      }
      const url = new URL(route.request().url())
      const query = (url.searchParams.get("q") || "").toLowerCase()
      const players = query.includes("soc")
        ? [{ id: "player-42", name: "Alex Striker", position: "FWD", team: "LIV", sport: "SOCCER" }]
        : []
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(players),
      })
    })

    /*
     * ⚠ THE DASHBOARD EMPTY-STATE SECTION WAS REMOVED FROM HERE.
     *
     * It asserted three ids that exist nowhere in app/, components/ or pages/:
     * dashboard-global-empty-state, dashboard-empty-create-league and
     * dashboard-empty-connect-provider. Measured: this test failed at
     * the first of those three assertions, and that id
     * dashboard-global-empty-state is independently pinned as absent in the
     * validation set of scripts/audit-e2e-testids.mjs.
     *
     * Only that section is gone. Everything below -- the notifications error ->
     * retry -> empty-state CTA path, and the search overlay's error -> retry ->
     * results -> no-results recovery -- drives ids that are live, and now runs
     * again instead of being unreachable behind a failure on line one of the
     * dashboard block.
     *
     * ⚠ WHAT THIS COSTS: nothing checks the signed-in-with-no-leagues dashboard any
     * more. If that empty state is rebuilt, this is the section to restore, and it
     * needs a fixture with zero leagues -- the seeded account has leagues, so the
     * empty state would not render even if the markup came back.
     */

    // Notifications page: error state -> retry -> empty-state CTA.
    await page.goto("/app/notifications")
    await expect(page.getByTestId("notifications-error-state")).toBeVisible()
    notificationsShouldFail = false
    await page.getByTestId("notifications-error-state").getByTestId("error-state-retry").click()
    await expect(page.getByTestId("notifications-empty-state")).toBeVisible()
    await page.getByTestId("notifications-empty-state").getByRole("link", { name: "Open settings" }).click()
    await expect(page).toHaveURL(/\/settings/, { timeout: 20_000 })

    // Search overlay: error -> retry -> results, then no-results recovery actions.
    await page.goto("/settings?tab=profile")
    const header = page.locator("header").first()
    await header.getByRole("button", { name: "Search" }).click()
    const overlay = page.getByTestId("search-overlay-dialog")
    const input = overlay.getByRole("searchbox", { name: "Universal search input" })
    await input.fill("soc")
    await expect(page.getByTestId("search-live-error-state")).toBeVisible()
    await page.getByTestId("search-live-error-state").getByTestId("error-state-retry").click()
    await expect(overlay.locator('[data-search-result="league-soccer-league-1"]')).toBeVisible()

    await input.fill("zzz-no-hit")
    await expect(page.getByTestId("search-no-results-state")).toBeVisible()
    await page.getByTestId("search-no-results-state").getByRole("button", { name: "Clear search" }).click()
    await expect(input).toHaveValue("")
  })
})

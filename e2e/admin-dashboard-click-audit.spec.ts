import { expect, test } from "@playwright/test"

test.describe.configure({ timeout: 240_000 })

test.describe("@admin admin dashboard click audit", () => {
  test("admin route redirects to login without admin session", async ({ page }) => {
    await page.goto("/admin?tab=overview", { waitUntil: "domcontentloaded" })
    /*
     * /admin sends signed-out visitors to its OWN login page, not the app one:
     * app/admin/page.tsx redirects to `/admin-login?next=/admin` when the gate
     * reports "unauthenticated". This asserted the app login's
     * `/login?callbackUrl=...` shape, which the admin surface stopped using when
     * it gained a dedicated sign-in screen — so the test was describing a
     * redirect the product no longer performs.
     *
     * `next` is matched raw-or-encoded because whether the slash survives
     * depends on the navigation path, and pinning one form makes this flake.
     */
    await expect(page).toHaveURL(/\/admin-login\?next=(%2F|\/)admin/, { timeout: 20_000 })
  })

  test("admin dashboard core click paths are wired end-to-end", async ({ page }) => {
    const moderationActions: Array<{ userId: string; actionType: string }> = []
    const deletedLeagues: string[] = []
    const deletedUsers: string[] = []
    const unbannedUsers: string[] = []
    const unmutedUsers: string[] = []
    const unsuspendedUsers: string[] = []

    page.on("dialog", async (dialog) => {
      await dialog.accept()
    })

    await page.route("**/api/admin/summary", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalUsers: 1200,
          thisWeek: 84,
          today: 12,
          legacyUsers: 330,
        }),
      })
    })
    await page.route("**/api/admin/usage/summary**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totals: { count: 4200, errRate: 1.8, avgMs: 190 },
          topEndpoints: [{ name: "/api/admin/users", count: 77 }],
          topTools: [{ name: "Admin", count: 54 }],
        }),
      })
    })
    await page.route("**/api/admin/visitor-locations", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          locations: [
            { id: "loc-1", city: "Austin", country: "US", visits: 120, lastSeen: new Date().toISOString() },
            { id: "loc-2", city: "Madrid", country: "ES", visits: 90, lastSeen: new Date().toISOString() },
          ],
        }),
      })
    })
    await page.route("**/api/admin/dashboard/overview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalUsers: 5000,
          activeUsersToday: 901,
          activeLeagues: 812,
          bracketsCreated: 243,
          draftsActive: 45,
          tradesToday: 132,
        }),
      })
    })
    await page.route("**/api/admin/calibration", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })
    await page.route("**/api/leagues/demo/hall-of-fame", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })
    await page.route("**/api/sports/sync", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })

    await page.route("**/api/admin/users", async (route) => {
      const users = Array.from({ length: 26 }, (_, i) => ({
        id: `user-${i + 1}`,
        email: `user${i + 1}@example.com`,
        username: `user${i + 1}`,
        emailVerified: i % 2 === 0,
        phoneVerified: false,
        verificationMethod: "EMAIL",
        profileComplete: i % 3 === 0,
        sleeperUsername: i % 5 === 0 ? `sleeper${i + 1}` : null,
        createdAt: new Date(Date.now() - i * 60_000).toISOString(),
      }))
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, users }) })
    })
    await page.route("**/api/admin/users/*/reset-password", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "sent" }) })
    })
    await page.route("**/api/admin/users/*", async (route) => {
      if (route.request().method() === "DELETE") {
        const id = route.request().url().split("/").pop() || ""
        deletedUsers.push(id)
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, message: "deleted" }) })
        return
      }
      await route.fallback()
    })
    await page.route("**/api/admin/moderation/users/*/action", async (route) => {
      const body = route.request().postDataJSON() as { actionType?: string }
      const parts = route.request().url().split("/")
      const userId = decodeURIComponent(parts[parts.length - 2] || "")
      moderationActions.push({ userId, actionType: String(body?.actionType || "") })
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })

    await page.route("**/api/admin/dashboard/leagues**", async (route) => {
      const url = new URL(route.request().url())
      const kind = url.searchParams.get("kind") || "recent"
      if (kind === "by_sport") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            kind: "by_sport",
            data: [
              { sport: "NFL", count: 40 },
              { sport: "NHL", count: 9 },
              { sport: "NBA", count: 22 },
              { sport: "MLB", count: 18 },
              { sport: "NCAAB", count: 10 },
              { sport: "NCAAF", count: 8 },
              { sport: "SOCCER", count: 14 },
            ],
          }),
        })
        return
      }
      const rows = Array.from({ length: 22 }, (_, i) => ({
        id: `league-${i + 1}`,
        name: `League ${i + 1}`,
        sport: i % 2 === 0 ? "NFL" : "SOCCER",
        leagueSize: 8 + (i % 8),
        userId: `user-${i + 1}`,
        createdAt: new Date(Date.now() - i * 300_000).toISOString(),
        status: "active",
        syncError: i === 2 ? "Sync failed" : null,
      }))
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind, data: rows }) })
    })
    await page.route("**/api/admin/leagues/*", async (route) => {
      if (route.request().method() === "DELETE") {
        const id = route.request().url().split("/").pop() || ""
        deletedLeagues.push(id)
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
        return
      }
      await route.fallback()
    })

    await page.route("**/api/admin/dashboard/moderation**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          reportedContent: [
            { id: "mr-1", messageId: "m-1", threadId: "t-1", reporterUserId: "u-1", reason: "spam", status: "pending", createdAt: new Date().toISOString() },
          ],
          reportedUsers: [
            { id: "ur-1", reportedUserId: "user-3", reporterUserId: "u-2", reason: "abuse", status: "pending", createdAt: new Date().toISOString(), reportedEmail: "user3@example.com" },
          ],
          blockedUsers: [
            { id: "b-1", blockerUserId: "u-7", blockedUserId: "u-8", createdAt: new Date().toISOString(), blockedEmail: "user8@example.com" },
          ],
        }),
      })
    })
    await page.route("**/api/admin/moderation/reports/message/*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })
    await page.route("**/api/admin/moderation/reports/user/*", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })
    await page.route("**/api/admin/moderation/users/banned", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ banned: [{ userId: "user-44", email: "banned@example.com", username: "banned44", bannedAt: new Date().toISOString() }] }),
      })
    })
    await page.route("**/api/admin/moderation/users/muted", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ muted: [{ userId: "user-55", email: "muted@example.com", username: "muted55", mutedAt: new Date().toISOString(), expiresAt: null }] }),
      })
    })
    await page.route("**/api/admin/moderation/users/suspended", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ suspended: [{ userId: "user-66", email: "suspended@example.com", username: "suspended66", suspendedAt: new Date().toISOString(), expiresAt: null }] }),
      })
    })
    await page.route("**/api/admin/moderation/users/*/ban", async (route) => {
      if (route.request().method() === "DELETE") {
        const parts = route.request().url().split("/")
        const userId = decodeURIComponent(parts[parts.length - 2] || "")
        unbannedUsers.push(userId)
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })
    await page.route("**/api/admin/moderation/users/*/mute", async (route) => {
      if (route.request().method() === "DELETE") {
        const parts = route.request().url().split("/")
        const userId = decodeURIComponent(parts[parts.length - 2] || "")
        unmutedUsers.push(userId)
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })
    await page.route("**/api/admin/moderation/users/*/suspend", async (route) => {
      if (route.request().method() === "DELETE") {
        const parts = route.request().url().split("/")
        const userId = decodeURIComponent(parts[parts.length - 2] || "")
        unsuspendedUsers.push(userId)
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
    })

    await page.route("**/api/admin/system/health", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          api: {
            sleeper: { status: "active", latency: 120, lastCheck: new Date().toISOString() },
            yahoo: { status: "active", latency: 240, lastCheck: new Date().toISOString() },
            openai: { status: "active", latency: 210, lastCheck: new Date().toISOString() },
          },
          database: "healthy",
          databaseLatencyMs: 18,
          workerQueue: { status: "healthy", queued: 3, running: 1, failedLast24h: 0, lastCheck: new Date().toISOString() },
          sportsAlerts: {
            windowHours: 24,
            totalAlerts: 23,
            sampledAlerts: 22,
            p50Ms: 95,
            p95Ms: 240,
            p99Ms: 410,
            maxMs: 560,
            lastAlertAt: new Date().toISOString(),
            byType: [
              { alertType: "injury_alert", totalAlerts: 8, sampledAlerts: 8, p50Ms: 88, p95Ms: 220, maxMs: 400 },
              { alertType: "performance_alert", totalAlerts: 9, sampledAlerts: 8, p50Ms: 94, p95Ms: 255, maxMs: 520 },
              { alertType: "lineup_alert", totalAlerts: 6, sampledAlerts: 6, p50Ms: 104, p95Ms: 260, maxMs: 560 },
            ],
          },
        }),
      })
    })

    await page.goto("/e2e/admin-dashboard", { waitUntil: "domcontentloaded" })
    const openButton = page.getByTestId("admin-open-dashboard-button")
    const overviewRefresh = page.getByTestId("admin-overview-refresh")
    for (let i = 0; i < 20; i += 1) {
      if (await overviewRefresh.isVisible().catch(() => false)) break
      if (await openButton.isVisible().catch(() => false)) {
        await openButton.click().catch(() => {})
      }
      await page.waitForTimeout(300)
    }
    if (!(await overviewRefresh.isVisible().catch(() => false))) {
      await page.reload({ waitUntil: "domcontentloaded" })
      for (let i = 0; i < 12; i += 1) {
        if (await overviewRefresh.isVisible().catch(() => false)) break
        if (await openButton.isVisible().catch(() => false)) {
          await openButton.click().catch(() => {})
        }
        await page.waitForTimeout(300)
      }
    }
    await expect(overviewRefresh).toBeVisible({ timeout: 20_000 })
    await overviewRefresh.click()
    await page.getByTestId("admin-overview-quick-action-calibration").click()

    await page.locator('a[href*="tab=users"]').first().click({ timeout: 20_000 })
    await expect(page.getByTestId("admin-users-search")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("admin-users-search").fill("user1")
    await page.getByTestId("admin-users-filter-email-status").selectOption("verified")
    await page.getByTestId("admin-users-sort").selectOption("email_asc")
    await page.getByTestId("admin-users-export-visible").click()
    await page.getByTestId("admin-users-select-user-1").click()
    await page.getByTestId("admin-users-select-user-11").click()
    await expect(page.getByTestId("admin-users-bulk-bar")).toBeVisible()
    await page.getByTestId("admin-users-export-selected").click()
    await page.getByTestId("admin-users-bulk-ban").click()
    await page.getByTestId("admin-users-select-user-1").click()
    await page.getByTestId("admin-users-select-user-11").click()
    await page.getByTestId("admin-users-bulk-unban").click()
    await page.getByTestId("admin-users-select-user-1").click()
    await page.getByTestId("admin-users-select-user-11").click()
    await page.getByTestId("admin-users-bulk-unmute").click()
    await page.getByTestId("admin-users-select-user-1").click()
    await page.getByTestId("admin-users-select-user-11").click()
    await page.getByTestId("admin-users-bulk-unsuspend").click()
    await page.getByTestId("admin-users-select-user-1").click()
    await page.getByTestId("admin-users-select-user-11").click()
    await page.getByTestId("admin-users-bulk-delete").click()
    const usersNext = page.getByTestId("admin-users-page-next")
    if (await usersNext.isEnabled()) {
      await usersNext.click()
      await page.getByTestId("admin-users-page-prev").click()
    }
    await page.getByTestId("admin-users-ban-user-13").click()
    await page.getByTestId("admin-users-suspend-user-13").click()

    await page.locator('a[href*="tab=leagues"]').first().click({ timeout: 20_000 })
    await expect(page.getByTestId("admin-leagues-refresh")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("admin-leagues-kind-filter").selectOption("recent")
    await page.getByTestId("admin-leagues-sort").selectOption("size_desc")
    await page.getByTestId("admin-leagues-export-visible").click()
    await page.getByTestId("admin-leagues-sport-bar-NFL").hover()
    await page.getByTestId("admin-leagues-sport-bar-SOCCER").click()
    await page.getByTestId("admin-leagues-page-next").click()
    await page.getByTestId("admin-leagues-page-prev").click()
    await page.getByTestId("admin-leagues-select-league-2").click()
    await page.getByTestId("admin-leagues-export-selected").click()
    await expect(page.getByTestId("admin-leagues-view-league-league-2")).toHaveAttribute("href", /\/app\/league\/league-2/)
    await page.getByTestId("admin-leagues-bulk-delete").click()
    await page.getByTestId("admin-leagues-delete-league-2").click()
    await page.getByRole("button", { name: "Delete league" }).click()

    await page.locator('a[href*="tab=moderation"]').first().click({ timeout: 20_000 })
    await expect(page.getByTestId("admin-moderation-refresh")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("admin-moderation-export-visible").click()
    await page.getByTestId("admin-moderation-export-actions").click()
    await page.getByTestId("admin-moderation-status-filter").selectOption("pending")
    await page.getByTestId("admin-moderation-content-select-mr-1").check()
    await expect(page.getByTestId("admin-moderation-content-bulk-bar")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("admin-moderation-content-bulk-resolve").click()
    await page.getByTestId("admin-moderation-users-select-ur-1").check()
    await expect(page.getByTestId("admin-moderation-users-bulk-bar")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("admin-moderation-users-bulk-suspend").click()
    await page.getByTestId("admin-moderation-resolve-message-mr-1").click()
    await page.getByTestId("admin-moderation-resolve-user-ur-1").click()
    await page.getByTestId("admin-moderation-ban-user-user-3").click()
    await page.getByTestId("admin-moderation-suspend-user-user-3").click()
    await page.getByTestId("admin-moderation-banned-select-all").check()
    await page.getByTestId("admin-moderation-banned-bulk-unban").click()
    await page.getByTestId("admin-moderation-muted-select-all").check()
    await page.getByTestId("admin-moderation-muted-bulk-unmute").click()
    await page.getByTestId("admin-moderation-suspended-select-all").check()
    await page.getByTestId("admin-moderation-suspended-bulk-unsuspend").click()

    await page.locator('a[href*="tab=system"]').first().click({ timeout: 20_000 })
    await expect(page.getByTestId("admin-system-refresh")).toBeVisible({ timeout: 20_000 })
    await page.getByTestId("admin-system-refresh").click()
    await expect(page.getByTestId("admin-worker-queue-panel")).toBeVisible()
    await expect(page.getByTestId("admin-sports-alert-latency-panel")).toBeVisible()
    await expect(page.getByTestId("admin-sports-alert-latency-p95")).toHaveText("240ms")

    expect(moderationActions.some((x) => x.actionType === "ban")).toBe(true)
    expect(moderationActions.some((x) => x.actionType === "suspend")).toBe(true)
    expect(deletedLeagues.length).toBeGreaterThan(0)
    expect(deletedUsers.length).toBeGreaterThan(0)
    expect(unbannedUsers.length).toBeGreaterThan(1)
    expect(unmutedUsers.length).toBeGreaterThan(1)
    expect(unsuspendedUsers.length).toBeGreaterThan(1)
  })

  test("admin dashboard APIs are permission-gated", async ({ page }) => {
    const overview = await page.request.get("/api/admin/dashboard/overview")
    const leagues = await page.request.get("/api/admin/dashboard/leagues?kind=recent")
    const users = await page.request.get("/api/admin/dashboard/users?kind=newest")
    const moderation = await page.request.get("/api/admin/dashboard/moderation")
    const system = await page.request.get("/api/admin/system/health")

    expect(overview.status()).toBe(401)
    expect(leagues.status()).toBe(401)
    expect(users.status()).toBe(401)
    expect(moderation.status()).toBe(401)
    expect(system.status()).toBe(401)
  })
})

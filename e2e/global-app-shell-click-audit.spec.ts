import { expect, test } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth-flow"

test.describe("@db @shell global app shell click audit", () => {
  test.describe.configure({ timeout: 180_000, mode: "serial" })

  test("audits global shell interactions across desktop and mobile", async ({ page }) => {
    const runAuthedShellE2E = process.env.PLAYWRIGHT_ENABLE_AUTH_DB_E2E === "1"
    test.skip(
      !runAuthedShellE2E,
      "Set PLAYWRIGHT_ENABLE_AUTH_DB_E2E=1 in a DB-configured environment to run authenticated shell/routing E2E."
    )

    await registerAndLogin(page)

    const profileState: Record<string, unknown> = {
      userId: "shell-audit-user",
      username: "shellaudit",
      email: "shell.audit@example.com",
      displayName: "Shell Audit",
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
      bio: "Shell audit profile",
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

    let markAllReadCalls = 0

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
            legalAcceptanceState: (profileState.settings as { legalAcceptanceState: Record<string, unknown> }).legalAcceptanceState,
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

    await page.route("**/api/shared/notifications?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [
            {
              id: "n1",
              type: "mention",
              title: "You were mentioned",
              body: "Commissioner tagged you",
              product: "app",
              severity: "medium",
              read: false,
              createdAt: new Date().toISOString(),
              meta: { actionHref: "/messages" },
            },
          ],
        }),
      })
    })

    await page.route("**/api/shared/notifications/read-all", async (route) => {
      if (route.request().method() === "PATCH") {
        markAllReadCalls += 1
      }
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

    await page.route("**/api/profile/highlights", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          gmPrestigeScore: 55.1,
          gmTierLabel: "Veteran",
          reputationTier: "Silver",
          reputationScore: 61.2,
          legacyScore: 44.3,
          contextLeagueName: "League One",
        }),
      })
    })

    await page.route("**/api/profile/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          record: { wins: 10, losses: 7, ties: 0, byLeague: [] },
          rankings: [],
          achievements: [],
        }),
      })
    })

    await page.route("**/api/xp/profile?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profileId: "xp-1",
          managerId: String(profileState.userId),
          totalXP: 1200,
          currentTier: "Bronze",
          xpToNextTier: 200,
          updatedAt: new Date().toISOString(),
        }),
      })
    })

    await page.route("**/api/marketplace/cosmetics", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ cosmetics: [] }),
      })
    })

    await page.goto("/settings?tab=profile")
    const shellHeader = page.locator("header").first()
    await expect(shellHeader.getByRole("link", { name: "AllFantasy.ai" })).toBeVisible()

    // Search entry
    await shellHeader.getByRole("button", { name: "Search" }).click()
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByRole("dialog", { name: "Search" })).not.toBeVisible()

    // Notifications entry
    await shellHeader.getByRole("button", { name: "Notifications" }).click()
    await expect(page.getByRole("heading", { name: "Notifications" }).first()).toBeVisible()
    await page.getByRole("button", { name: "Mark all read" }).click()
    expect(markAllReadCalls).toBeGreaterThan(0)
    await page.keyboard.press("Escape")

    // Product switcher
    await expect(shellHeader.locator('a[href="/af-legacy"]').first()).toBeVisible()
    await page.goto("/af-legacy")
    await expect(page).toHaveURL(/\/af-legacy/, { timeout: 15_000 })
    await page.goto("/settings?tab=profile")

    // Top nav links + route transitions
    await expect(shellHeader.locator('a[href="/messages"]').first()).toBeVisible()
    await page.goto("/messages")
    await expect(page).toHaveURL(/\/messages/, { timeout: 15_000 })
    await page.goto("/settings?tab=profile")
    await expect(shellHeader.locator('a[href="/dashboard"]').first()).toBeVisible()
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    await page.goto("/settings?tab=profile")

    // User menu + profile/settings entry points + logout entry presence
    await shellHeader.getByRole("button", { name: "User menu" }).click()
    const profileMenuItem = page.getByRole("menuitem", { name: "Profile" })
    await expect(profileMenuItem).toBeVisible()
    await profileMenuItem.click()
    await expect(page).toHaveURL(/\/profile/, { timeout: 15_000 })
    await page.goto("/settings?tab=profile")
    await shellHeader.getByRole("button", { name: "User menu" }).click()
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible()

    // Non-admin should not see admin crest in shell
    await expect(shellHeader.locator('a[href="/admin"]')).toHaveCount(0)

    // Mobile drawer open/close + link routing
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/settings?tab=profile")
    const mobileHeader = page.locator("header").first()
    await mobileHeader.getByRole("button", { name: "Open menu" }).click()
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible()
    await page.getByRole("dialog", { name: "Navigation menu" }).locator('a[href="/brackets"]').click()
    await expect(page).toHaveURL(/\/brackets/, { timeout: 15_000 })

    await page.goto("/settings?tab=profile")
    await mobileHeader.getByRole("button", { name: "Open menu" }).click()
    await page.getByRole("button", { name: "Close menu" }).click()
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).not.toBeVisible()
  })
})

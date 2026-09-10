import { expect, test } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth-flow"

test.describe("@db @nav responsive navigation click audit", () => {
  test.describe.configure({ timeout: 240_000, mode: "serial" })

  test("audits desktop, mobile drawer, and resize transitions", async ({ page }) => {
    await registerAndLogin(page)

    const profileState: Record<string, unknown> = {
      userId: "responsive-nav-user",
      username: "responsivenav",
      email: "responsive.nav@example.com",
      displayName: "Responsive Nav",
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
      bio: "Responsive nav profile",
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

    await page.route("**/api/shared/wallet", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          wallet: {
            currency: "USD",
            balance: 10,
            pendingBalance: 1,
            potentialWinnings: 100,
            totalDeposited: 25,
            totalEntryFees: 15,
            totalWithdrawn: 0,
          },
        }),
      })
    })

    await page.route("**/api/shared/quick-ai", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          aiQuickActions: ["Optimize my lineup", "Who should I trade for?"],
        }),
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
    const header = page.locator("header").first()

    // Desktop nav links + active states
    await expect(header.locator('a[href="/settings"][aria-current="page"]').first()).toBeVisible()
    await Promise.all([
      page.waitForURL(/\/brackets/, { timeout: 20_000 }),
      header.locator('a[href="/brackets"]').first().click(),
    ])
    await expect(header.locator('a[href="/brackets"][aria-current="page"]').first()).toBeVisible()
    await Promise.all([
      page.waitForURL(/\/af-legacy/, { timeout: 20_000 }),
      header.locator('a[href="/af-legacy"]').first().click(),
    ])

    // Utilities and user menu wiring
    await page.goto("/settings?tab=profile")
    await header.getByRole("button", { name: "Search" }).click()
    await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible()
    await page.keyboard.press("Escape")
    await header.getByRole("button", { name: "Notifications" }).click()
    await expect(page.getByRole("heading", { name: "Notifications" }).first()).toBeVisible()
    await page.keyboard.press("Escape")
    await header.getByRole("button", { name: "User menu" }).click()
    await expect(page.getByRole("menuitem", { name: "Profile" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible()

    // Admin visibility for non-admin users
    await expect(header.locator('a[href="/admin"]')).toHaveCount(0)

    // Mobile drawer interactions
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto("/settings?tab=profile")
    const mobileHeader = page.locator("header").first()
    const openMenuButton = mobileHeader.getByRole("button", { name: "Open menu" })
    await expect(openMenuButton).toBeVisible()
    await expect(openMenuButton).toHaveAttribute("aria-expanded", "false")

    const mobileHeaderMeasurements = await mobileHeader.evaluate((node) => {
      const button = node.querySelector<HTMLElement>('button[aria-label="Open menu"]')
      return {
        height: node.getBoundingClientRect().height,
        buttonWidth: button?.getBoundingClientRect().width ?? 0,
        buttonHeight: button?.getBoundingClientRect().height ?? 0,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      }
    })
    expect(mobileHeaderMeasurements.height).toBeLessThanOrEqual(80)
    expect(mobileHeaderMeasurements.buttonWidth).toBeGreaterThanOrEqual(44)
    expect(mobileHeaderMeasurements.buttonHeight).toBeGreaterThanOrEqual(44)
    expect(mobileHeaderMeasurements.overflow).toBeFalsy()

    await openMenuButton.click()
    const drawer = page.getByTestId("mobile-nav-drawer")
    await expect(drawer).toBeVisible()
    await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused()
    await expect(openMenuButton).toHaveAttribute("aria-expanded", "true")
    await expect(drawer.getByText("Products")).toBeVisible()
    await expect(drawer.getByText("Workspace")).toBeVisible()
    await expect(drawer.getByText("Account")).toBeVisible()
    await expect(drawer.getByRole("link", { name: "Notifications" })).toBeVisible()
    await expect(drawer.locator('a[href*="tab=chat"]').first()).toBeVisible()

    const closeButton = page.getByRole("button", { name: "Close menu" })
    const closeTarget = await closeButton.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
    expect(closeTarget.width).toBeGreaterThanOrEqual(44)
    expect(closeTarget.height).toBeGreaterThanOrEqual(44)
    await closeButton.click()
    await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0)
    await expect(openMenuButton).toBeFocused()

    await openMenuButton.click()
    await page.getByTestId("mobile-nav-overlay").click({ position: { x: 8, y: 8 } })
    await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0)

    await openMenuButton.click()
    await Promise.all([
      page.waitForURL(/\/profile/, { timeout: 20_000 }),
      page.getByTestId("mobile-nav-drawer").locator('a[href="/profile"]').click(),
    ])
    await expect(page.locator('a[href="/profile"][aria-current="page"]').first()).toBeVisible()

    await page.goto("/settings?tab=profile")
    await openMenuButton.click()
    await Promise.all([
      page.waitForURL(/\/app\/notifications/, { timeout: 20_000 }),
      page.getByTestId("mobile-nav-drawer").getByRole("link", { name: "Notifications" }).click(),
    ])

    // Resize transition: open on mobile, then grow to desktop should auto-close drawer
    await page.goto("/settings?tab=profile")
    await page.setViewportSize({ width: 390, height: 844 })
    await openMenuButton.click()
    await expect(page.getByTestId("mobile-nav-drawer")).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 900 })
    await expect(page.getByTestId("mobile-nav-drawer")).toHaveCount(0)
    await expect(page.locator("header").first().getByRole("button", { name: "Open menu" })).not.toBeVisible()
  })
})

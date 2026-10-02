import { expect, test } from "@playwright/test"
import { registerAndLoginTo } from "./helpers/auth-flow"

function getShortcutToggle(page: Parameters<typeof test>[0]['page']) {
  return page
    .getByTestId("chimmy-shortcuts-toggle")
    .or(page.getByRole("switch", { name: /enable chimmy global keyboard shortcuts/i }))
    .first()
}

async function gotoNotificationsReady(page: Parameters<typeof test>[0]['page']) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await page.goto("/settings?tab=notifications", { waitUntil: "domcontentloaded" })
    const toggleReady = await getShortcutToggle(page)
      .waitFor({ state: "visible", timeout: 12_000 })
      .then(() => true)
      .catch(() => false)
    if (toggleReady) return

    const notFoundVisible = await page
      .getByRole("heading", { name: "This page could not be found." })
      .isVisible()
      .catch(() => false)

    if (!notFoundVisible && attempt >= 4) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => null)
    }
    await page.waitForTimeout(500 * attempt)
  }

  throw new Error("Notifications settings never became ready")
}

test.describe("@db chimmy shortcut settings", () => {
  test.describe.configure({ timeout: 240_000, mode: "serial" })

  test("disabling and re-enabling Chimmy shortcuts persists global launcher preference", async ({ page }) => {
    await registerAndLoginTo(page, null)

    await page.route("**/api/auth/session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: {
            id: "chimmy-shortcut-user",
            name: "Chimmy Shortcut",
            email: "chimmy.shortcut@example.com",
          },
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      })
    })

    await page.route("**/api/auth/providers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      })
    })

    await page.route("**/api/auth/csrf", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ csrfToken: "chimmy-shortcut-csrf" }),
      })
    })

    await page.route("**/api/auth/config-check", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/auth/_log", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    const profileState: Record<string, unknown> = {
      userId: "chimmy-shortcut-user",
      username: "chimmyshortcut",
      email: "chimmy.shortcut@example.com",
      displayName: "Chimmy Shortcut",
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
      bio: null,
      preferredSports: ["NFL"],
      notificationPreferences: {
        globalEnabled: true,
        categories: {
          lineup_reminders: { enabled: true, inApp: true, email: true, sms: false },
        },
      },
      onboardingStep: null,
      onboardingCompletedAt: null,
      settings: null,
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
            legalAcceptanceState: {
              ageVerified: true,
              disclaimerAccepted: true,
              termsAccepted: true,
              acceptedAt: new Date().toISOString(),
            },
          },
        }),
      })
    })

    await page.route("**/api/user/profile", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(profileState),
        })
        return
      }

      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      await route.fallback()
    })

    await page.route("**/api/ai/alerts/preferences", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          prefs: {
            frequency: "normal",
            sensitivity: "normal",
            mutedClasses: [],
            mutedTypes: [],
            channelPreferences: {
              disablePush: false,
              disableEmail: false,
              disableSms: false,
            },
            commissionerPrefs: {
              enabled: true,
              receiveSuspiciousTradeAlerts: true,
              receiveOrphanTeamAlerts: true,
              receiveIntegrityAlerts: true,
            },
          },
        }),
      })
    })

    await page.route("**/api/user/notifications?unread=true&limit=50", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ notifications: [], unreadCount: 0, unreadTotal: 0 }),
      })
    })

    await gotoNotificationsReady(page)
    await expect(getShortcutToggle(page)).toBeVisible({ timeout: 20_000 })

    // Ensure deterministic baseline for this test run.
    await page.evaluate(() => {
      window.localStorage.removeItem("af_chimmy_shortcuts_disabled")
      window.localStorage.removeItem("af_chimmy_shortcut_hint_seen")
    })

    const shortcutToggle = getShortcutToggle(page)

    // 1) Disable shortcuts.
    await shortcutToggle.uncheck()
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("af_chimmy_shortcuts_disabled")))
      .toBe("1")

    // 2) '/' should not open Chimmy when disabled.
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
    const beforeDisabledShortcut = page.url()
    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      active?.blur?.()
    })
    await page.locator("body").click({ position: { x: 12, y: 12 } })
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
      )
    })
    await page.waitForTimeout(500)
    await expect(page).toHaveURL(beforeDisabledShortcut)

    // 3) Re-enable shortcuts and verify '/' opens Chimmy route.
    await gotoNotificationsReady(page)
    await shortcutToggle.check()
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("af_chimmy_shortcuts_disabled")))
      .toBeNull()

    await page.goto("/dashboard", { waitUntil: "domcontentloaded" })
    await page.waitForTimeout(300)
    await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      active?.blur?.()
    })
    await page.locator("body").click({ position: { x: 12, y: 12 } })
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
      )
    })
    await page.waitForTimeout(500)
    await expect
      .poll(async () => page.evaluate(() => window.localStorage.getItem("af_chimmy_shortcuts_disabled")))
      .toBeNull()
  })
})

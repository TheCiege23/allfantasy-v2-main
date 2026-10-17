import { expect, test } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth-flow"

test.describe("@db @connected @legacy connected accounts + legacy import click audit", () => {
  test.describe.configure({ timeout: 180_000, mode: "serial" })

  test("audits connected account and legacy import click paths", async ({ page }) => {
    await registerAndLogin(page)

    const settingsProfile: Record<string, unknown> = {
      userId: "connected-audit-user",
      username: "connectedaudit",
      email: "connected.audit@example.com",
      displayName: "Connected Audit",
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
      hasPassword: false,
      profileComplete: true,
      sleeperUsername: "legacytester",
      sleeperLinkedAt: new Date().toISOString(),
      bio: null,
      preferredSports: ["NFL"],
      notificationPreferences: null,
      onboardingStep: null,
      onboardingCompletedAt: null,
      settings: null,
      updatedAt: new Date().toISOString(),
    }

    let connectedProviders: Array<{
      id: string
      name: string
      configured: boolean
      linked: boolean
      disconnectable: boolean
      disconnectBlockedReason: string | null
    }> = [
      { id: "google", name: "Google", configured: true, linked: true, disconnectable: true, disconnectBlockedReason: null },
      { id: "apple", name: "Apple", configured: true, linked: true, disconnectable: true, disconnectBlockedReason: null },
      { id: "facebook", name: "Facebook", configured: false, linked: false, disconnectable: false, disconnectBlockedReason: null },
      { id: "instagram", name: "Instagram", configured: false, linked: false, disconnectable: false, disconnectBlockedReason: null },
      { id: "x", name: "X (Twitter)", configured: false, linked: false, disconnectable: false, disconnectBlockedReason: null },
      { id: "tiktok", name: "TikTok", configured: false, linked: false, disconnectable: false, disconnectBlockedReason: null },
    ]

    const legacyProviders = {
      sleeper: {
        linked: true,
        available: true,
        importStatus: "failed",
        error: "Provider timeout",
      },
      yahoo: { linked: false, available: false, importStatus: null },
      espn: { linked: false, available: false, importStatus: null },
      mfl: { linked: false, available: false, importStatus: null },
      fleaflicker: { linked: false, available: false, importStatus: null },
      fantrax: { linked: false, available: false, importStatus: null },
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
          profile: settingsProfile,
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

    await page.route("**/api/user/connected-accounts", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ providers: connectedProviders }),
      })
    })

    await page.route("**/api/user/connected-accounts/google", async (route) => {
      if (route.request().method() !== "DELETE") {
        await route.fallback()
        return
      }
      connectedProviders = connectedProviders.map((provider) =>
        provider.id === "google"
          ? { ...provider, linked: false, disconnectable: false }
          : provider.id === "apple"
            ? { ...provider, disconnectable: false, disconnectBlockedReason: "LOCKOUT_RISK" }
            : provider
      )
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, providers: connectedProviders }),
      })
    })

    await page.route("**/api/user/legacy-import-status", async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sleeperUsername: "@legacytester",
          providers: legacyProviders,
        }),
      })
    })

    await page.goto("/settings?tab=connected")
    await expect(page.getByRole("heading", { name: "Connected Accounts" })).toBeVisible()

    // Provider status cards + fallback connect path
    await expect(page.getByText("Google", { exact: true })).toBeVisible()
    await expect(page.getByText("Apple", { exact: true })).toBeVisible()
    await page.locator('li:has([data-provider="facebook"])').getByRole("button", { name: "Connect" }).click()
    await expect(page.getByText("Facebook sign-in is planned. Follow updates for when it's available.")).toBeVisible()

    // Safe disconnect path
    // In-app confirmation (ConfirmDialog), not window.confirm.
    await page.locator('li:has([data-provider="google"])').getByRole("button", { name: "Disconnect" }).click()
    await page.getByTestId("settings-confirm-accept").click()
    await expect(page.getByText("Google disconnected.")).toBeVisible()
    await expect(page.locator('li:has([data-provider="apple"])').getByText("Connected (protected)")).toBeVisible()

    // Navigation between tabs
    await page.goto("/settings?tab=legacy")
    await expect(page.getByRole("heading", { name: "Legacy Import" })).toBeVisible()
    await page.goto("/settings?tab=connected")
    await expect(page.getByRole("heading", { name: "Connected Accounts" })).toBeVisible()
    await page.goto("/settings?tab=legacy")

    // Legacy import status + retry/reconnect/help actions
    await expect(page.getByText("Linked · Import: Failed")).toBeVisible()
    await expect(page.getByText("Provider timeout")).toBeVisible()
    await expect(page.getByRole("link", { name: "Retry import" })).toHaveAttribute("href", "/af-legacy?retry=1&provider=sleeper")
    await expect(page.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/dashboard")
    await expect(page.getByRole("link", { name: "Help" }).first()).toHaveAttribute("href", "/import")

    // Retry/refresh controls and instruction links remain clickable
    await page.getByRole("button", { name: "Refresh status" }).click()
    await expect(page.getByRole("link", { name: "Open Legacy app" })).toHaveAttribute("href", "/af-legacy")
    await expect(page.getByRole("link", { name: "Dashboard (link Sleeper)" })).toHaveAttribute("href", "/dashboard")
    await expect(page.getByRole("link", { name: "Import instructions" })).toHaveAttribute("href", "/import")
  })
})

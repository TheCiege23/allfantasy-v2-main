import { expect, test } from "@playwright/test"
import { registerAndLoginTo } from "./helpers/auth-flow"

test.describe("@db @notifications notification preferences click audit", () => {
  test.describe.configure({ timeout: 300_000, mode: "serial" })

  test("audits notification toggles, persistence, and mobile navigation", async ({ page, browserName }) => {
    await registerAndLoginTo(page, null)

    let savedPrefs: Record<string, unknown> = {
      globalEnabled: true,
      categories: {
        lineup_reminders: { enabled: true, inApp: true, email: true, sms: false },
        matchup_results: { enabled: true, inApp: true, email: true, sms: false },
        waiver_processing: { enabled: true, inApp: true, email: true, sms: false },
        trade_proposals: { enabled: true, inApp: true, email: true, sms: false },
        trade_accept_reject: { enabled: true, inApp: true, email: true, sms: false },
        chat_mentions: { enabled: true, inApp: true, email: true, sms: false },
        bracket_updates: { enabled: true, inApp: true, email: true, sms: false },
        ai_alerts: { enabled: true, inApp: true, email: true, sms: false },
        league_drama: { enabled: true, inApp: true, email: true, sms: false },
        commissioner_alerts: { enabled: true, inApp: true, email: true, sms: false },
        system_account: { enabled: true, inApp: true, email: true, sms: false },
        injury_alerts: { enabled: true, inApp: true, email: true, sms: false },
        performance_alerts: { enabled: true, inApp: true, email: true, sms: false },
        lineup_alerts: { enabled: true, inApp: true, email: true, sms: false },
        draft_alerts: { enabled: true, inApp: true, email: true, sms: false },
      },
    }

    const profileState: Record<string, unknown> = {
      userId: "notif-audit-user",
      username: "notifaudit",
      email: "notif.audit@example.com",
      displayName: "Notif Audit",
      profileImageUrl: null,
      avatarPreset: "crest",
      preferredLanguage: "en",
      timezone: "America/New_York",
      themePreference: "dark",
      phone: "+15555550199",
      phoneVerifiedAt: new Date().toISOString(),
      emailVerifiedAt: null,
      ageConfirmedAt: null,
      verificationMethod: "EMAIL",
      hasPassword: true,
      profileComplete: true,
      sleeperUsername: null,
      sleeperLinkedAt: null,
      bio: null,
      preferredSports: ["NFL"],
      notificationPreferences: savedPrefs,
      onboardingStep: null,
      onboardingCompletedAt: null,
      settings: null,
      updatedAt: new Date().toISOString(),
    }

    let lastPatchedPrefs: {
      globalEnabled?: boolean
      categories?: Record<string, { enabled: boolean; inApp: boolean; email: boolean; sms: boolean }>
    } | null = null

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
      if (route.request().method() === "PATCH") {
        const payload = route.request().postDataJSON() as { notificationPreferences?: Record<string, unknown> }
        if (payload.notificationPreferences) {
          savedPrefs = payload.notificationPreferences
          profileState.notificationPreferences = savedPrefs
          lastPatchedPrefs = payload.notificationPreferences as {
            globalEnabled?: boolean
            categories?: Record<string, { enabled: boolean; inApp: boolean; email: boolean; sms: boolean }>
          }
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
        return
      }

      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(profileState),
        })
        return
      }

      await route.fallback()
    })

    await page.route("**/api/user/notifications/test", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          sent: { inApp: true, email: true, sms: false },
          blockedReasons: [],
        }),
      })
    })

    await page.route("**/api/alerts/preferences", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            injuryAlerts: true,
            performanceAlerts: true,
            lineupAlerts: true,
          }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.route("**/api/ai/alerts/preferences", async (route) => {
      if (route.request().method() === "GET") {
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
        return
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
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

    await page.goto("/settings?tab=notifications")
    await expect(page.getByRole("heading", { name: "Notifications" }).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText("Chimmy alert controls").first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Tune Chimmy alert frequency/i).first()).toBeVisible({ timeout: 20_000 })

    // Global toggle
    const globalCard = page.getByTestId("notifications-global-card")
    const globalToggle = page.getByTestId("notifications-global-toggle")
    await globalToggle.uncheck()

    // Category expand/collapse and toggle wiring. `lineup_reminders` no longer
    // renders a toggle (no automatic lineup reminder fires yet), so the audit
    // drives Matchup results instead — and asserts the dead toggle is gone.
    await expect(page.getByRole("button", { name: /Lineup reminders/i })).toHaveCount(0)
    const matchupHeader = page.getByRole("button", { name: /Matchup results/i }).first()
    if ((await matchupHeader.getAttribute("aria-expanded")) !== "true") {
      await matchupHeader.click()
    }
    await expect(matchupHeader).toHaveAttribute("aria-expanded", "true")
    await page.getByRole("checkbox", { name: "Matchup results enabled" }).uncheck()
    await page.getByRole("checkbox", { name: "Matchup results Email" }).uncheck()
    await page.getByRole("checkbox", { name: "Matchup results SMS" }).check()

    const waiverHeader = page.getByRole("button", { name: /Waiver processing/i }).first()
    await waiverHeader.click()
    await expect(waiverHeader).toHaveAttribute("aria-expanded", "true")
    await expect(matchupHeader).toHaveAttribute("aria-expanded", "false")

    // Save flow
    await page.getByTestId("notifications-save-button").click()
    await expect.poll(() => lastPatchedPrefs !== null).toBe(true)
    const patchedPrefs = lastPatchedPrefs as {
      globalEnabled?: boolean
      categories?: Record<string, { enabled: boolean; inApp: boolean; email: boolean; sms: boolean }>
    } | null
    if (!patchedPrefs?.categories) {
      throw new Error("Patched preferences were not captured")
    }
    expect(patchedPrefs.globalEnabled).toBe(false)
    const patchedMatchup = patchedPrefs.categories.matchup_results
    expect(patchedMatchup.enabled).toBe(false)
    expect(patchedMatchup.email).toBe(false)
    expect(patchedMatchup.sms).toBe(true)

    // Persist after reload
    await page.reload()
    await expect(page.getByTestId("notifications-global-toggle")).not.toBeChecked()
    const matchupHeaderAfterReload = page.getByRole("button", { name: /Matchup results/i }).first()
    if ((await matchupHeaderAfterReload.getAttribute("aria-expanded")) !== "true") {
      await matchupHeaderAfterReload.click()
    }
    await expect(page.getByRole("checkbox", { name: "Matchup results enabled" })).not.toBeChecked()
    await expect(page.getByRole("checkbox", { name: "Matchup results SMS" })).toBeChecked()

    // Reset flow
    await page.getByTestId("notifications-reset-button").click()
    await page.getByTestId("notifications-save-button").click()
    await page.reload()
    await expect(page.getByTestId("notifications-global-toggle")).toBeChecked()

    // Test notification button
    await page.getByRole("button", { name: "Send test notification" }).click()
    await expect(page.getByText("Test sent via inApp, email.")).toBeVisible()

    // Back/help links in notification area
    await page.getByTestId("notifications-sports-alerts-link").click()
    await expect(page).toHaveURL(/\/alerts\/settings/, { timeout: 15_000 })
    await expect(page.getByRole("heading", { name: "Chimmy alert controls" })).toBeVisible({ timeout: 15_000 })
    await page.goto("/settings?tab=notifications")
    await page.getByTestId("notifications-back-to-profile-link").click()
    await expect(page).toHaveURL(/\/settings\?tab=profile/, { timeout: 15_000 })

    // Firefox intermittently stalls on runtime viewport resize in this long serial flow.
    if (browserName === "firefox") {
      return
    }

    // Mobile settings navigation
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/settings")
    await page.getByRole("button", { name: "Notifications" }).click()
    await expect(page.getByRole("heading", { name: "Notifications" }).first()).toBeVisible()
  })
})

import { expect, test } from "@playwright/test"
import { registerAndLogin } from "./helpers/auth-flow"

test.describe("@db @settings full settings profile preferences click audit", () => {
  test.describe.configure({ timeout: 180_000, mode: "serial" })

  test("audits profile, preferences, referral, legal, account, and profile page wiring", async ({ page }) => {
    const runAuthedSettingsE2E = process.env.PLAYWRIGHT_ENABLE_AUTH_DB_E2E === "1"
    test.skip(
      !runAuthedSettingsE2E,
      "Set PLAYWRIGHT_ENABLE_AUTH_DB_E2E=1 in a DB-configured environment to run authenticated settings E2E."
    )

    await registerAndLogin(page)

    const profileState: Record<string, unknown> = {
      userId: "settings-full-audit-user",
      username: "settingsfullaudit",
      email: "settings.full.audit@example.com",
      displayName: "Settings Audit",
      profileImageUrl: null,
      avatarPreset: "crest",
      preferredLanguage: "en",
      timezone: "America/New_York",
      themePreference: "dark",
      phone: "+15555550101",
      phoneVerifiedAt: null,
      emailVerifiedAt: null,
      ageConfirmedAt: null,
      verificationMethod: "EMAIL",
      hasPassword: true,
      profileComplete: true,
      sleeperUsername: null,
      sleeperLinkedAt: null,
      bio: "Original bio",
      preferredSports: ["NFL"],
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

    const profilePatchPayloads: Array<Record<string, unknown>> = []

    await page.route("**/api/user/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        const payload = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
        profilePatchPayloads.push(payload)
        Object.assign(profileState, payload, { updatedAt: new Date().toISOString() })
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        })
        return
      }

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
            legalAcceptanceState: profileState.settings
              ? (profileState.settings as { legalAcceptanceState: Record<string, unknown> }).legalAcceptanceState
              : null,
          },
        }),
      })
    })

    await page.route("**/api/user/profile", async (route) => {
      if (route.request().method() === "PATCH") {
        const payload = (route.request().postDataJSON() ?? {}) as Record<string, unknown>
        profilePatchPayloads.push(payload)
        Object.assign(profileState, payload, { updatedAt: new Date().toISOString() })
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

    await page.route("**/api/profile/highlights", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          gmPrestigeScore: 72.4,
          gmTierLabel: "Veteran",
          reputationTier: "Silver",
          reputationScore: 64.2,
          legacyScore: 58.5,
          contextLeagueName: "Dynasty League",
        }),
      })
    })

    await page.route("**/api/profile/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          record: { wins: 12, losses: 6, ties: 0, byLeague: [] },
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
          totalXP: 1234,
          currentTier: "Bronze",
          xpToNextTier: 200,
          updatedAt: new Date().toISOString(),
          tierBadgeColor: "#38bdf8",
          progressInTier: 0.42,
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

    await page.route("**/api/referral/link", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: "QA1234",
          link: "https://allfantasy.ai/signup?ref=QA1234",
        }),
      })
    })

    await page.route("**/api/referral/stats", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stats: { clicks: 3, signups: 1, pendingRewards: 1, redeemedRewards: 0 },
        }),
      })
    })

    await page.route("**/api/referral/rewards", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rewards: [{ id: "reward-1", type: "credit", label: "$5 credit", status: "pending", grantedAt: new Date().toISOString(), redeemedAt: null }],
        }),
      })
    })

    await page.route("**/api/referral/rewards/redeem", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      })
    })

    // Settings profile tab
    await page.goto("/settings?tab=profile")
    await expect(page.getByRole("heading", { name: "Profile" }).first()).toBeVisible()
    const displayNameInput = page.locator('input[placeholder="Your display name"]').first()
    await displayNameInput.fill("Temp Name")
    await page.getByRole("button", { name: "Cancel changes" }).click()
    await expect(displayNameInput).toHaveValue("Settings Audit")
    await displayNameInput.fill("Settings Audit Updated")
    await page.getByRole("button", { name: "Save profile" }).click()
    await expect(displayNameInput).toHaveValue("Settings Audit Updated")

    // Navigate to full profile editor from settings profile tab
    await page.getByRole("link", { name: /Edit full profile/i }).click()
    await expect(page).toHaveURL(/\/profile/)
    await expect(page.getByRole("heading", { name: "Profile" }).first()).toBeVisible()

    // Profile page edit flow: bio + preferred sports save/persist
    await page.getByRole("button", { name: "Edit" }).click()
    await page.locator('textarea[placeholder="A few words about you…"]').fill("Updated QA bio")
    await page.getByRole("button", { name: "Soccer" }).click()
    await page.getByRole("button", { name: "NCAA Football" }).click()
    await page.getByRole("button", { name: "Save" }).click()
    expect(
      profilePatchPayloads.some((payload) => {
        const sports = payload.preferredSports as string[] | undefined
        return Array.isArray(sports) && sports.includes("SOCCER") && sports.includes("NCAAF")
      })
    ).toBe(true)

    await page.reload()
    await expect(page.getByText("Soccer")).toBeVisible()
    await expect(page.getByText("NCAA Football")).toBeVisible()

    // Quick links back into settings/preferences
    await page.getByRole("link", { name: "Profile & settings" }).click()
    await expect(page).toHaveURL(/\/settings/)
    await page.getByRole("button", { name: "Preferences" }).click()
    await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible()
    await page.locator("select").first().selectOption("America/Chicago")
    await page.getByRole("button", { name: "Cancel changes" }).click()

    // Referral tab interactions
    await page.getByRole("button", { name: "Referrals" }).click()
    await expect(page.getByRole("heading", { name: "Refer friends" })).toBeVisible()
    await expect(page.getByRole("button", { name: "Redeem" })).toBeVisible()
    await page.getByRole("button", { name: "Redeem" }).click()
    await expect(page.getByText("Redeemed").first()).toBeVisible()

    // Legal links
    await page.getByRole("button", { name: "Legal & Agreements" }).click()
    await expect(page.getByRole("heading", { name: "Legal & Agreements" })).toBeVisible()
    await expect(page.getByRole("link", { name: "Disclaimer" })).toHaveAttribute("href", "/disclaimer")
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms")
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy")

    // Account actions visibility
    await page.goto("/settings?tab=account")
    await expect(page.getByRole("heading", { name: /^Account$/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible()
    await expect(page.getByTestId("settings-account-delete-open")).toBeVisible()

    // Mobile navigation sanity
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/settings?tab=profile")
    await expect(page.getByRole("heading", { name: "Profile" }).first()).toBeVisible()
  })
})

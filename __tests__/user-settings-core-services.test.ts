import { describe, expect, it } from "vitest"
import { resolveUniversalPreferences } from "@/lib/user-settings/UniversalPreferenceResolver"
import { resolveSharedProfileBootstrap } from "@/lib/user-settings/SharedProfileBootstrapService"

describe("user-settings core services", () => {
  it("resolves language/theme/timezone with safe defaults", () => {
    const result = resolveUniversalPreferences({
      preferredLanguage: "xx",
      themePreference: "invalid",
      timezone: "Invalid/Timezone",
    })

    expect(result.preferredLanguage).toBe("en")
    // Dark is the deliberate default since the launch audit: the flagship
    // signed-in surfaces are authored dark and the light clamp is partial —
    // a fresh user landed in the theme the product handles worst.
    expect(result.themePreference).toBe("dark")
    expect(typeof result.timezone).toBe("string")
  })

  it("normalizes preferred sports to supported sport scope", () => {
    const result = resolveSharedProfileBootstrap({
      profile: {
        userId: "u1",
        username: "tester",
        email: "qa@example.com",
        displayName: "Tester",
        profileImageUrl: null,
        avatarPreset: null,
        preferredLanguage: "en",
        timezone: "America/New_York",
        themePreference: "dark",
        phone: null,
        phoneVerifiedAt: null,
        emailVerifiedAt: null,
        ageConfirmedAt: null,
        verificationMethod: "EMAIL",
        hasPassword: true,
        profileComplete: false,
        sleeperUsername: null,
        sleeperLinkedAt: null,
        bio: null,
        preferredSports: ["NFL", "foo", "SOCCER", "NBA", "nba"],
        notificationPreferences: null,
        onboardingStep: null,
        onboardingCompletedAt: null,
        updatedAt: new Date(),
      },
    })

    expect(result.profile.preferredSports).toEqual(["NFL", "NBA", "SOCCER"])
    expect(result.patchPayload.preferredSports).toEqual(["NFL", "NBA", "SOCCER"])
  })
})

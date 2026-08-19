import { describe, expect, it } from "vitest"

import { resolveAuthRedirect } from "@/lib/auth/AuthRedirectResolver"
import { resolvePostAuthIntentDestination } from "@/lib/auth/PostAuthIntentRouter"
import { resolveSharedSessionBootstrap } from "@/lib/auth/SharedSessionBootstrapService"
import { resolveLanguagePreferenceSync } from "@/lib/preferences/LanguagePreferenceSyncService"
import { resolveThemePreferenceSync } from "@/lib/preferences/ThemePreferenceSyncService"
import { getStoredThemePreference } from "@/lib/preferences/ThemePreferenceService"
import { resolveTimezonePreferenceSync } from "@/lib/preferences/TimezonePreferenceSyncService"

describe("Unified auth integration services", () => {
  it("resolves post-auth destination with safe precedence", () => {
    // External callbackUrl is rejected; `next` wins over `returnTo`
    expect(
      resolvePostAuthIntentDestination({
        callbackUrl: "https://bad.site",
        next: "/dashboard",
        returnTo: "/brackets",
      })
    ).toBe("/dashboard")

    // bracket-challenge intent correctly resolves to /brackets (not /dashboard)
    // canonicalizeProductRoute now preserves /brackets paths instead of collapsing them
    expect(
      resolvePostAuthIntentDestination({
        intent: "bracket-challenge",
      })
    ).toBe("/brackets")
  })

  it("canonicalizes plural league URLs after login intent resolution", () => {
    expect(
      resolvePostAuthIntentDestination({
        next: "/leagues/season-42",
      })
    ).toBe("/league/season-42")
  })

  it("restores remembered intent when query params are missing", () => {
    expect(
      resolvePostAuthIntentDestination({
        rememberedIntent: "/af-legacy",
      })
    ).toBe("/dashboard")
  })

  it("downgrades admin destination when user is non-admin", () => {
    expect(
      resolvePostAuthIntentDestination({
        callbackUrl: "/admin",
        isAdmin: false,
      })
    ).toBe("/dashboard")
  })

  it("auth redirect resolver honors returnTo fallback", () => {
    expect(
      resolveAuthRedirect({
        callbackUrl: null,
        next: null,
        returnTo: "/messages",
      })
    ).toBe("/messages")
  })

  it("sync resolvers preserve stored values when profile is missing", () => {
    expect(
      resolveLanguagePreferenceSync({
        profilePreferredLanguage: null,
        storedLanguagePreference: "es",
      })
    ).toEqual({
      language: "es",
      shouldPersistToProfile: true,
    })

    expect(
      resolveThemePreferenceSync({
        profileThemePreference: null,
        storedThemePreference: "dark",
      })
    ).toEqual({
      theme: "dark",
      shouldPersistToProfile: true,
    })

    expect(
      resolveTimezonePreferenceSync({
        profileTimezone: null,
        browserTimezone: "America/Chicago",
      })
    ).toEqual({
      timezone: "America/Chicago",
      shouldPersistToProfile: true,
    })
  })

  it("shared session bootstrap builds profile patch payload", () => {
    const bootstrap = resolveSharedSessionBootstrap({
      profile: {
        preferredLanguage: null,
        themePreference: null,
        timezone: null,
      },
      storedLanguagePreference: "es",
      storedThemePreference: "dark",
    })

    expect(bootstrap.language).toBe("es")
    expect(bootstrap.theme).toBe("dark")
    expect(bootstrap.patchPayload.preferredLanguage).toBe("es")
    expect(bootstrap.patchPayload.themePreference).toBe("dark")
  })

  it("does not treat a missing local theme as an explicit light preference", () => {
    window.localStorage.removeItem("af_mode")
    expect(getStoredThemePreference()).toBeNull()

    window.localStorage.setItem("af_mode", "dark")
    expect(getStoredThemePreference()).toBe("dark")
  })
})

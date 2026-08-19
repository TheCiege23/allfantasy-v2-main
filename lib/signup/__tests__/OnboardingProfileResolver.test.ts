import { describe, it, expect } from "vitest"
import { resolveOnboardingProfile } from "@/lib/signup/OnboardingProfileResolver"
import { DEFAULT_SIGNUP_TIMEZONE } from "@/lib/signup/timezones"
import { DEFAULT_LANG } from "@/lib/i18n/constants"

describe("resolveOnboardingProfile — displayName", () => {
  it("requires a non-empty display name", () => {
    for (const displayName of ["", "   ", undefined, null, 42]) {
      const r = resolveOnboardingProfile({ displayName })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe("DISPLAYNAME_REQUIRED")
    }
  })

  it("trims the display name", () => {
    const r = resolveOnboardingProfile({ displayName: "  Jordan Rivera  " })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.displayName).toBe("Jordan Rivera")
  })
})

describe("resolveOnboardingProfile — username", () => {
  it("treats a blank/absent username as unchanged (null)", () => {
    for (const username of [undefined, "", "   "]) {
      const r = resolveOnboardingProfile({ displayName: "Jordan", username })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.username).toBeNull()
    }
  })

  it("preserves case of a valid username", () => {
    const r = resolveOnboardingProfile({ displayName: "Jordan", username: "Jordan_R" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.username).toBe("Jordan_R")
  })

  it("rejects an invalid username (length/charset)", () => {
    for (const username of ["ab", "has space", "no-dashes", "way_too_long_username_exceeding_limit_x"]) {
      const r = resolveOnboardingProfile({ displayName: "Jordan", username })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.code).toBe("USERNAME_INVALID")
    }
  })

  it("rejects a profane username", () => {
    const r = resolveOnboardingProfile({ displayName: "Jordan", username: "shitlord" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("USERNAME_PROFANE")
  })
})

describe("resolveOnboardingProfile — timezone", () => {
  it("accepts a valid timezone", () => {
    const r = resolveOnboardingProfile({ displayName: "Jordan", timezone: DEFAULT_SIGNUP_TIMEZONE })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.timezone).toBe(DEFAULT_SIGNUP_TIMEZONE)
  })

  it("rejects a disallowed timezone", () => {
    const r = resolveOnboardingProfile({ displayName: "Jordan", timezone: "Europe/London" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe("TIMEZONE_INVALID")
  })

  it("defaults the timezone when omitted or blank", () => {
    for (const timezone of [undefined, "", null]) {
      const r = resolveOnboardingProfile({ displayName: "Jordan", timezone })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.timezone).toBe(DEFAULT_SIGNUP_TIMEZONE)
    }
  })
})

describe("resolveOnboardingProfile — avatar / language / phone", () => {
  it("keeps an explicit null avatar preset (initials)", () => {
    const r = resolveOnboardingProfile({ displayName: "Jordan", avatarPreset: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.avatarPreset).toBeNull()
  })

  it("resolves a known preset and falls back for junk", () => {
    const known = resolveOnboardingProfile({ displayName: "Jordan", avatarPreset: "bolt" })
    expect(known.ok).toBe(true)
    if (known.ok) expect(known.value.avatarPreset).toBe("bolt")

    const junk = resolveOnboardingProfile({ displayName: "Jordan", avatarPreset: "not-a-preset" })
    expect(junk.ok).toBe(true)
    if (junk.ok) expect(typeof junk.value.avatarPreset).toBe("string") // resolved to a valid default
  })

  it("defaults the language when omitted", () => {
    const r = resolveOnboardingProfile({ displayName: "Jordan" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.preferredLanguage).toBe(DEFAULT_LANG)
  })

  it("normalizes phone to trimmed-or-null", () => {
    const withPhone = resolveOnboardingProfile({ displayName: "Jordan", phone: "  +15551234567 " })
    expect(withPhone.ok).toBe(true)
    if (withPhone.ok) expect(withPhone.value.phone).toBe("+15551234567")

    const noPhone = resolveOnboardingProfile({ displayName: "Jordan", phone: "   " })
    expect(noPhone.ok).toBe(true)
    if (noPhone.ok) expect(noPhone.value.phone).toBeNull()
  })

  it("produces a fully normalized profile for complete input", () => {
    const r = resolveOnboardingProfile({
      displayName: "Jordan Rivera",
      username: "jordan_r",
      phone: "+15551234567",
      timezone: DEFAULT_SIGNUP_TIMEZONE,
      preferredLanguage: DEFAULT_LANG,
      avatarPreset: "crest",
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value).toEqual({
        displayName: "Jordan Rivera",
        username: "jordan_r",
        phone: "+15551234567",
        timezone: DEFAULT_SIGNUP_TIMEZONE,
        preferredLanguage: DEFAULT_LANG,
        avatarPreset: "crest",
      })
    }
  })
})

import { describe, expect, it } from "vitest"

import {
  formatSignupPhoneDisplay,
  normalizePhoneForSubmit,
  normalizeSignupPhoneDigits,
} from "@/lib/signup/SignupFlowController"
import {
  isAllowedSignupTimezone,
  resolveSignupTimezone,
} from "@/lib/signup/TimezoneSelectorService"
import { resolvePreferredLanguage } from "@/lib/signup/LanguagePreferenceResolver"
import {
  resolveAvatarPreset,
  validateAvatarUploadFile,
} from "@/lib/signup/AvatarPickerService"
import { validateSignupAgreements } from "@/lib/signup/AgreementAcceptanceService"

describe("Signup onboarding services", () => {
  it("normalizes and formats phone values", () => {
    expect(normalizeSignupPhoneDigits("(555) 123-4567")).toBe("5551234567")
    expect(normalizePhoneForSubmit("5551234567")).toBe("+15551234567")
    expect(formatSignupPhoneDisplay("15551234567")).toBe("(555) 123-4567")
    expect(normalizePhoneForSubmit("20 7946 0958", "+44")).toBe("+442079460958")
    expect(normalizePhoneForSubmit("+34 612 345 678", "+1")).toBe("+34612345678")
    expect(formatSignupPhoneDisplay("2079460958", "+44")).toBe("207 946 095 8")
  })

  it("validates signup timezone list", () => {
    expect(isAllowedSignupTimezone("America/New_York")).toBe(true)
    expect(isAllowedSignupTimezone("Europe/London")).toBe(false)
    expect(resolveSignupTimezone("Europe/London")).toBe("America/New_York")
  })

  it("resolves language preference to supported values", () => {
    expect(resolvePreferredLanguage("es")).toBe("es")
    expect(resolvePreferredLanguage("fr")).toBe("fr")
    expect(resolvePreferredLanguage("ar")).toBe("ar")
    expect(resolvePreferredLanguage("de")).toBe("en")
  })

  it("handles avatar preset and file validation", () => {
    expect(resolveAvatarPreset("trophy")).toBe("trophy")
    expect(resolveAvatarPreset("custom-value")).toBe("crest")
    expect(
      validateAvatarUploadFile({
        size: 500_000,
        type: "image/png",
      } as File)
    ).toBeNull()
    expect(
      validateAvatarUploadFile({
        size: 3 * 1024 * 1024,
        type: "image/png",
      } as File)
    ).toBeNull()
    expect(
      validateAvatarUploadFile({
        size: 3 * 1024 * 1024 + 1,
        type: "image/png",
      } as File)
    ).toContain("3MB")
  })

  it("validates mandatory agreement acceptance", () => {
    expect(
      validateSignupAgreements({
        ageConfirmed: true,
        disclaimerAgreed: true,
        termsAgreed: true,
      })
    ).toEqual({ ok: true })
    expect(
      validateSignupAgreements({
        ageConfirmed: false,
        disclaimerAgreed: true,
        termsAgreed: true,
      })
    ).toEqual({
      ok: false,
      error: "You must confirm you are 18 or older.",
    })
  })
})

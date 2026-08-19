/**
 * Pure validation + normalization for the onboarding "complete your profile" step.
 *
 * The onboarding form lets a user replace the auto-generated placeholder username
 * (see AutoUsernameGenerator) with a real one and set avatar/timezone/language.
 * This resolver validates the raw request body and produces a normalized shape;
 * the route layer handles DB uniqueness, avatar persistence, and the actual
 * writes. Kept dependency-light (no prisma) so it is unit-testable.
 */

import { validateUsername } from "@/lib/auth/username-validation"
import { containsProfanity } from "@/lib/profanity"
import { isAllowedSignupTimezone, resolveSignupTimezone } from "@/lib/signup/TimezoneSelectorService"
import { resolvePreferredLanguage } from "@/lib/signup/LanguagePreferenceResolver"
import { resolveAvatarPreset } from "@/lib/signup/AvatarPickerService"

export interface OnboardingProfileInput {
  displayName?: unknown
  username?: unknown
  phone?: unknown
  timezone?: unknown
  preferredLanguage?: unknown
  avatarPreset?: unknown
}

export interface ResolvedOnboardingProfile {
  displayName: string
  /** Normalized (case-preserving) username, or null when the user left it unchanged/blank. */
  username: string | null
  phone: string | null
  timezone: string
  preferredLanguage: string
  /** A preset id, or null for an initials-only avatar (explicit `null` in the payload). */
  avatarPreset: string | null
}

export type OnboardingProfileError =
  | "DISPLAYNAME_REQUIRED"
  | "USERNAME_INVALID"
  | "USERNAME_PROFANE"
  | "TIMEZONE_INVALID"

export type OnboardingProfileResolution =
  | { ok: true; value: ResolvedOnboardingProfile }
  | { ok: false; error: string; code: OnboardingProfileError }

export function resolveOnboardingProfile(input: OnboardingProfileInput): OnboardingProfileResolution {
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : ""
  if (!displayName) {
    return { ok: false, error: "Display name is required.", code: "DISPLAYNAME_REQUIRED" }
  }

  // Username is optional here — blank means "keep the current handle". A provided
  // value must satisfy the canonical rules and be clean.
  let username: string | null = null
  if (typeof input.username === "string" && input.username.trim().length > 0) {
    const validation = validateUsername(input.username)
    if (!validation.ok) {
      return { ok: false, error: validation.reason, code: "USERNAME_INVALID" }
    }
    if (containsProfanity(validation.normalized)) {
      return { ok: false, error: "Please choose a different username.", code: "USERNAME_PROFANE" }
    }
    username = validation.normalized
  }

  const timezone = typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : undefined
  if (timezone && !isAllowedSignupTimezone(timezone)) {
    return { ok: false, error: "Please choose a valid US/Canada/Mexico timezone.", code: "TIMEZONE_INVALID" }
  }

  const preferredLanguage =
    typeof input.preferredLanguage === "string" ? input.preferredLanguage : undefined

  return {
    ok: true,
    value: {
      displayName,
      username,
      phone: typeof input.phone === "string" && input.phone.trim() ? input.phone.trim() : null,
      timezone: resolveSignupTimezone(timezone),
      preferredLanguage: resolvePreferredLanguage(preferredLanguage),
      // Explicit null = initials-only avatar; anything else resolves to a valid preset.
      avatarPreset: input.avatarPreset === null ? null : resolveAvatarPreset(input.avatarPreset),
    },
  }
}

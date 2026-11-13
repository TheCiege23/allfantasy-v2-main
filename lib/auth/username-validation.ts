/**
 * Canonical username validation shared by auth, settings, and username checks.
 *
 * Product policy:
 * - 3-30 characters
 * - Letters, numbers, and underscores only
 * - Preserve the user's chosen casing for storage/display
 * - Compare case-insensitively for login and uniqueness
 * - Must not look like a phone number
 */

export const USERNAME_MIN = 3
export const USERNAME_MAX = 30

const USERNAME_RE = /^[A-Za-z0-9_]+$/

export type UsernameValidationResult =
  | { ok: true; normalized: string; lookup: string }
  | { ok: false; reason: string }

export function normalizeUsernameLookup(raw: string): string {
  return String(raw ?? "").trim().toLowerCase()
}

/**
 * Validates a raw username input.
 * `normalized` is the canonical stored username and intentionally preserves case.
 * `lookup` is only for case-insensitive comparisons.
 */
export function validateUsername(raw: string): UsernameValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Username is required" }
  }

  const normalized = raw.trim()
  if (!normalized) {
    return { ok: false, reason: "Username is required" }
  }
  if (normalized.length < USERNAME_MIN) {
    return { ok: false, reason: `Must be at least ${USERNAME_MIN} characters` }
  }
  if (normalized.length > USERNAME_MAX) {
    return { ok: false, reason: `Must be at most ${USERNAME_MAX} characters` }
  }
  if (!USERNAME_RE.test(normalized)) {
    return { ok: false, reason: "Letters, numbers, and underscores only" }
  }
  if (/\d{7,}/.test(normalized)) {
    return { ok: false, reason: "Cannot look like a phone number" }
  }

  return { ok: true, normalized, lookup: normalized.toLowerCase() }
}


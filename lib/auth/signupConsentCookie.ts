/**
 * Carries the signup consent tick across the OAuth redirect.
 *
 * The signup form's single checkbox drives all three agreements (18+, disclaimer, terms)
 * and the credentials path POSTs them straight to /api/auth/register. The OAuth buttons
 * sit on the SAME form, below the same checkbox — but they only ever received
 * `callbackUrl`, so ticking the box and then clicking "Continue with Google" discarded the
 * consent entirely. `ensureSharedAccountProfile` never set `ageConfirmedAt`, so the account
 * was created with none recorded, and every later gate (`hasConfirmedAge`, bracket entry,
 * the settings legal panel) correctly reported that the user had never confirmed — telling
 * people who HAD ticked the box that they hadn't.
 *
 * The provider redirect leaves the page, so the tick has to survive a full round trip to
 * the provider and back. A short-lived cookie is how the account-creation path can still
 * see it, mirroring the admission-cookie pattern already used here.
 *
 * This records only what the user asserted in our own UI, exactly like the checkbox on the
 * credentials path — age is self-attested either way, and this neither strengthens nor
 * weakens that. It is NOT a substitute for the tick: the OAuth buttons are disabled until
 * the box is checked, so a missing cookie means no consent was given and none is recorded.
 */

export const SIGNUP_CONSENT_COOKIE = "af_signup_consent"

/** Ten minutes — long enough for a provider round trip, short enough not to linger. */
export const SIGNUP_CONSENT_MAX_AGE_SECONDS = 600

/** The only value treated as consent. Anything else reads as absent. */
const CONSENT_VALUE = "1"

export function isConsentCookieValue(value: string | null | undefined): boolean {
  return value === CONSENT_VALUE
}

/**
 * Client-side setter, called immediately before `signIn(provider)`.
 *
 * Not httpOnly by necessity — it is written in the browser at the moment of the click.
 * `SameSite=Lax` survives the provider's top-level GET redirect back to us, which
 * `Strict` would not.
 */
export function buildSignupConsentCookie(secure: boolean): string {
  const parts = [
    `${SIGNUP_CONSENT_COOKIE}=${CONSENT_VALUE}`,
    "path=/",
    `max-age=${SIGNUP_CONSENT_MAX_AGE_SECONDS}`,
    "samesite=lax",
  ]
  if (secure) parts.push("secure")
  return parts.join("; ")
}

/** Expire it once consumed, so a later OAuth sign-in cannot inherit an old tick. */
export function buildSignupConsentClearCookie(secure: boolean): string {
  const parts = [`${SIGNUP_CONSENT_COOKIE}=`, "path=/", "max-age=0", "samesite=lax"]
  if (secure) parts.push("secure")
  return parts.join("; ")
}

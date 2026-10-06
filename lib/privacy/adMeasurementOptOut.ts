/**
 * "Do Not Sell or Share" for advertising measurement — the one definition of who has opted
 * out, shared by the browser tags in app/layout.tsx, the client pixel (lib/meta-client) and
 * the server-side Conversions API (lib/meta-capi).
 *
 * Three signals, any one of which opts a request out:
 *   1. Global Privacy Control — `navigator.globalPrivacyControl` in the browser, the
 *      `Sec-GPC: 1` header on the server. Honoured automatically (Privacy Policy §5.3).
 *   2. The `af_ad_optout=1` cookie, set from /privacy/choices — the per-BROWSER choice,
 *      which works signed out.
 *   3. The account record (notificationPreferences.adMeasurementOptOut), set when a signed-in
 *      user opts out or browses with GPC on — the per-PERSON choice, which reaches the
 *      server-side events (a Stripe purchase webhook has no browser to read a cookie from).
 *
 * Pure: no Prisma, no DOM access at import time. lib/privacy/adOptOutStore reads and writes
 * the account record.
 */

export const AD_OPT_OUT_COOKIE = "af_ad_optout"

/** One year — the choice should not lapse quietly; the page shows it and lets it be undone. */
export const AD_OPT_OUT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

/**
 * Inline-script expression that is true when this browser has opted out. Spliced into the
 * tag guards in app/layout.tsx beside IOS_APP_UA_TEST_JS, so it must stay a self-contained
 * expression with no dependencies.
 */
export const AD_OPT_OUT_TEST_JS =
  `(typeof navigator!=="undefined"&&navigator.globalPrivacyControl===true)` +
  `||(typeof document!=="undefined"&&/(?:^|;\s*)${AD_OPT_OUT_COOKIE}=1(?:;|$)/.test(document.cookie))`

export type AdOptOutSource = "choices_page" | "settings" | "gpc"

export type AdOptOutRecord = { optedOutAt: string; source: AdOptOutSource }

function cookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const eq = part.indexOf("=")
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/** `Sec-GPC: 1` — the request header form of Global Privacy Control. */
export function hasGpcHeader(headers: Pick<Headers, "get"> | null | undefined): boolean {
  return headers?.get("sec-gpc")?.trim() === "1"
}

/** Whether a request carries any per-browser opt-out signal (GPC or the cookie). */
export function isAdOptOutRequest(headers: Pick<Headers, "get"> | null | undefined): boolean {
  if (!headers) return false
  return hasGpcHeader(headers) || cookieValue(headers.get("cookie"), AD_OPT_OUT_COOKIE) === "1"
}

/** Browser-side: whether this browser has opted out. */
export function isAdOptOutClient(): boolean {
  if (typeof navigator !== "undefined" && (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) {
    return true
  }
  if (typeof document === "undefined") return false
  return cookieValue(document.cookie, AD_OPT_OUT_COOKIE) === "1"
}

/** The account record, if the person has opted out. Tolerates any stored shape. */
export function readAdOptOut(notificationPreferences: unknown): AdOptOutRecord | null {
  if (!notificationPreferences || typeof notificationPreferences !== "object") return null
  const rec = (notificationPreferences as Record<string, unknown>).adMeasurementOptOut
  if (!rec || typeof rec !== "object") return null
  const { optedOutAt, source } = rec as Record<string, unknown>
  return typeof optedOutAt === "string" ? { optedOutAt, source: (source as AdOptOutSource) ?? "settings" } : null
}

/**
 * The preferences JSON with the opt-out set or cleared — MERGED, never replacing the object,
 * because the SMS consent record and every notification toggle live in the same column.
 */
export function withAdOptOut(
  notificationPreferences: unknown,
  optOut: { source: AdOptOutSource; at?: Date } | null,
): Record<string, unknown> {
  const prev =
    notificationPreferences && typeof notificationPreferences === "object"
      ? { ...(notificationPreferences as Record<string, unknown>) }
      : {}
  if (optOut) {
    prev.adMeasurementOptOut = { optedOutAt: (optOut.at ?? new Date()).toISOString(), source: optOut.source }
  } else {
    delete prev.adMeasurementOptOut
  }
  return prev
}

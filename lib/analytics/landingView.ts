/**
 * Server-side admission control for `acquisition.landing_viewed`.
 *
 * A landing beacon is the one funnel event a caller can fire freely, so the server —
 * not the client — decides whether it counts. Three gates, each closing a specific way
 * the number could be inflated into a lie:
 *
 *  1. ANON-ID REQUIRED. The beacon is dropped unless the request carries the `af_anon_id`
 *     cookie that middleware sets on a real page load. A bot, uptime probe, or scripted
 *     POST straight at the API never loaded a page, so it has no cookie and cannot
 *     manufacture landing visits.
 *  2. DEDUPLICATION WINDOW. One landing view per anonymous visitor per window. React
 *     rerenders, StrictMode double-effects, duplicate requests, and back-navigation all
 *     reuse the same cookie jar and collapse to one event.
 *  3. BOUNDED METADATA. Only an allowlisted, length-capped set of fields is stored.
 *
 * The window is 30 minutes: long enough to absorb a visitor reading the page, opening a
 * pricing link, and returning, but short enough that a genuine later session on the same
 * device is still counted as a distinct visit. It is deliberately cookie-based rather
 * than a database lookup — the landing page is the highest-traffic surface on the site,
 * and a read-before-write on every visit would be the most expensive query we own.
 */

/** Marks that a landing view was already counted for this visitor. Value is the ISO time. */
export const LANDING_VIEW_DEDUPE_COOKIE = "af_lv_seen"

/** 30 minutes, in seconds. */
export const LANDING_VIEW_DEDUPE_WINDOW_SECONDS = 30 * 60

export type LandingViewDecision =
  | { accept: true }
  | { accept: false; reason: "no_anon_id" | "duplicate_in_window" }

/**
 * Decide whether this landing beacon should be recorded.
 *
 * Never throws: a malformed cookie must not turn an analytics beacon into a 500.
 */
export function decideLandingView(input: {
  anonId: string | null
  dedupeCookie: string | undefined
}): LandingViewDecision {
  if (!input.anonId) return { accept: false, reason: "no_anon_id" }
  if (input.dedupeCookie) return { accept: false, reason: "duplicate_in_window" }
  return { accept: true }
}

/** Allowlisted, length-capped landing metadata. Everything else is discarded. */
const MAX_VALUE_LENGTH = 120

/**
 * Sanitize the client-supplied portion of a landing beacon.
 *
 * Only `landing_path` survives, and only its pathname — the query string is dropped
 * entirely rather than filtered, because an allowlist of *safe* query keys would still
 * leak the next unanticipated one (a reset token, an email in a share link). Campaign
 * data does not come from here at all; it is read server-side from the attribution
 * cookies, so nothing of value is lost by discarding the client's version.
 */
export function sanitizeLandingMeta(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {}
  const source = raw as Record<string, unknown>
  const out: Record<string, string> = {}

  const path = source.landing_path ?? source.path
  if (typeof path === "string" && path.trim()) {
    let pathname = path.trim()
    try {
      // Accept either a bare path or a full URL; keep only the pathname.
      pathname = new URL(pathname, "http://placeholder.invalid").pathname
    } catch {
      pathname = pathname.split("?")[0].split("#")[0]
    }
    out.landing_path = pathname.slice(0, MAX_VALUE_LENGTH)
  }

  return out
}

/**
 * Where a buyer goes after paying: back to the lock that sold them (2026-11-17).
 *
 * A lock's upgrade link carries two things:
 *   - `from=lock_<featureId>` — which lock sold it. `lib/monetization/upgradeEntrySource.ts` already
 *     carries `from` to the Stripe session's metadata and the admin funnel groups checkouts, trials and
 *     paid conversions by it. Before this, only the /core depth lock sent one, so every
 *     `LockedFeatureCard` purchase landed in the funnel as "no source".
 *   - `back=<the page they were on>` — the exact page, league id and tab included. `/upgrade` keeps
 *     every query parameter in its checkout return path (`purchaseReturnPath`), so `back` comes home
 *     on Stripe's success URL, and the success panel's primary button goes there. Before this the
 *     button knew seven hand-listed features and sent everyone else to /core; a league-scoped lock
 *     (waivers, the draft room) could never be returned to, because the upgrade page had no league id.
 *
 * PURE.
 */
import { withEntrySource } from "@/lib/monetization/upgradeEntrySource"

export const BACK_PARAM = "back"

/** Pages that are never "where you were": buying, signing in, or an API. Returning there is a loop. */
const NOT_A_RESUME = /^\/(upgrade|commissioner-upgrade|pricing|tokens|login|signup|register|logout|api)(?=[/?#]|$)/i

/**
 * An internal path to send someone back to, or null.
 *
 * 🛑 THIS IS AN OPEN-REDIRECT SURFACE: `back` arrives in a URL anyone can craft and becomes a link on a
 * page that has just taken a payment. So: a single leading slash only (`//host` and `/\host` both leave
 * the site in a browser), no control characters, bounded length, and never a purchase or auth page.
 */
export function safeBackPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const v = value.trim()
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null
  if (v.length > 300) return null
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null
  if (NOT_A_RESUME.test(v)) return null
  return v
}

/**
 * The lock's upgrade link: `from` (an existing one wins) and `back` (an existing one wins; an unsafe
 * one is never added). Anything that is not an internal path passes through untouched — the lock card
 * must never be the crash.
 */
export function withLockReturn(path: string, opts: { source?: string | null; back?: string | null }): string {
  if (typeof path !== "string" || !path.startsWith("/")) return path
  const tagged = opts.source ? withEntrySource(path, opts.source) : path
  const back = safeBackPath(opts.back)
  if (!back) return tagged
  const [base, hash] = tagged.split("#", 2)
  const [pathname, query = ""] = base!.split("?", 2)
  const params = new URLSearchParams(query)
  if (params.has(BACK_PARAM)) return tagged
  params.set(BACK_PARAM, back)
  return `${pathname}?${params.toString()}${hash ? `#${hash}` : ""}`
}

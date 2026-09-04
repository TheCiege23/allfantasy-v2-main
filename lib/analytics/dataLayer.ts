'use client'

/**
 * AllFantasy — analytics event layer
 * ---------------------------------------------------------------------------
 * Single source of truth for every conversion event. The app never touches
 * fbq / gtag / ttq / rdt directly — it pushes here, GTM fans out to all four
 * ad platforms. Adding or fixing a pixel then never requires a redeploy.
 *
 * ⚠ INSTALLED AT `lib/analytics/dataLayer.ts`, NOT `src/lib/analytics.ts`.
 * There is no `src/` in this repo, and `lib/analytics/` is already a DIRECTORY
 * whose `index.ts` is imported by
 * `server/api-route-modules/legacy/rank/refresh/route.ts` for
 * `recordProductEvent`. A file at `lib/analytics.ts` wins over
 * `lib/analytics/index.ts` in both tsc and webpack resolution, so it would break
 * that import with no error at the definition site. Living inside the directory
 * is the same shape `lib/analytics/client.ts` already uses. Import it directly;
 * it is deliberately NOT re-exported from `index.ts`, because that barrel is
 * pulled into a server bundle and this module is `'use client'`.
 *
 * Two rules that keep the data trustworthy:
 *   1. Fire from success callbacks, never from a component render or a bare
 *      useEffect. In the App Router a render-time push fires again on every
 *      client-side navigation and silently inflates conversions.
 *   2. Anything that can only happen once per user gets trackOnce(), which
 *      survives refreshes and back-button returns via sessionStorage.
 */

import type { ImportProvider } from '@/lib/league-import/types'
import type { MonetizationPlanTier } from '@/lib/monetization-analytics'

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

export type SignupMethod = 'email' | 'google' | 'apple'

/**
 * ⚠ WIDENED FROM THE SPEC'S `sleeper | espn | yahoo`, AND DERIVED RATHER THAN
 * RETYPED. `IMPORT_PROVIDERS` in lib/league-import/types.ts has six entries —
 * fantrax, mfl and fleaflicker were missing, and each has a live import path in
 * ImportV4, so the three-value union rejected real code. Aliasing the source of
 * truth means a seventh provider cannot silently fall out of the funnel.
 */
export type LeaguePlatform = ImportProvider

export type Sport = 'nfl' | 'nba' | 'nhl' | 'mlb'

/**
 * ⚠ ALSO WIDENED AND DERIVED. The spec's `af_pro | af_legacy` does not describe
 * this catalog: `af_legacy` is sold nowhere, and lib/monetization/catalog.ts
 * ships four families (af_pro, af_commissioner, af_war_room, af_supreme) each in
 * monthly and yearly. `MonetizationPlanTier` is what the purchase path already
 * resolves a SKU down to, so it is what the event can actually carry.
 */
export type Plan = MonetizationPlanTier

export type AnalyticsEvent =
  | { event: 'sign_up'; method: SignupMethod }
  | {
      event: 'league_connected'
      platform: LeaguePlatform
      sport: Sport
      /** Leagues connected by THIS import. See the note in ImportV4 — the
       *  account-wide total is not available client-side. */
      league_count: number
      /** True the first time this user ever connects anything — the real activation. */
      first_connection: boolean
    }
  | { event: 'view_pricing' }
  | { event: 'begin_checkout'; plan: Plan }
  | {
      event: 'purchase'
      plan: Plan
      /**
       * ⚠ OPTIONAL, AGAINST THE SPEC, AND THIS IS THE ONE DEVIATION THAT COSTS
       * SOMETHING. No charge amount reaches the browser on the checkout return:
       * entitlements are granted on the `invoice.payment_succeeded` webhook, and
       * nothing in the post-purchase sync response carries a price. Required
       * fields here would leave two options, and both are worse than an absent
       * number — hardcode a figure that silently trains ad bidding, or drop the
       * purchase event entirely. Revenue belongs on the server-side Conversions
       * API event, keyed to the same transaction_id.
       */
      value?: number
      currency?: 'USD'
      transaction_id: string
    }

/**
 * Meta and TikTok both accept a browser event and a server event for the same
 * action and de-duplicate them when the IDs match. Generating the ID here means
 * the server-side Conversions API can reuse it later without any rework.
 */
function newEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `af_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Push an event to the dataLayer. Safe to call during SSR — it no-ops on the
 * server rather than throwing.
 */
export function track(payload: AnalyticsEvent): string | undefined {
  if (typeof window === 'undefined') return

  const eventId = newEventId()
  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push({ ...payload, event_id: eventId })

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[analytics]', payload.event, { ...payload, event_id: eventId })
  }

  return eventId
}

const ONCE_PREFIX = 'af_evt:'

/**
 * Claims `key`, returning true only the first time it is claimed in this
 * browser session.
 *
 * ⚠ NOT IN THE SPEC, AND ADDED ONLY BECAUSE THE SPEC NEEDS IT. `first_connection`
 * is a required FIELD on league_connected, so something has to decide it, and
 * trackOnce cannot: trackOnce suppresses the whole event, whereas a repeat
 * import must still fire with first_connection:false.
 *
 * ⚠ localStorage, WHERE trackOnce BELOW USES sessionStorage — the difference is
 * deliberate and the two are answering different questions. trackOnce dedupes a
 * refresh or a back-button return, which is a within-session problem, so a
 * session-scoped key is exactly right. `first_connection` claims "ever", and on
 * sessionStorage that would read true again in every new tab, reporting the same
 * user as activating repeatedly. localStorage does not make it truthful — see
 * the call site — but it is the closer of the two by a wide margin.
 *
 * Still browser-scoped, so it cannot answer "has this ACCOUNT ever connected a
 * league". Every caller using it for a `first_*` field says so at the call site.
 */
export function markOnce(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const storageKey = ONCE_PREFIX + key
    if (window.localStorage.getItem(storageKey)) return false
    window.localStorage.setItem(storageKey, '1')
  } catch {
    // Private mode or storage disabled. Matching trackOnce's stance below: treat
    // it as first rather than lose the activation signal entirely.
    return true
  }
  return true
}

/**
 * Fire an event at most once per browser session for a given key.
 *
 * Use for sign_up and the first league_connected — the two events a refresh or
 * a back-button return would otherwise double-count. Scope the key to the user
 * so a second account in the same session still registers:
 *
 *   trackOnce(`sign_up:${user.id}`, { event: "sign_up", method: "google" });
 */
export function trackOnce(key: string, payload: AnalyticsEvent): string | undefined {
  if (typeof window === 'undefined') return

  const storageKey = `${ONCE_PREFIX}${key}`
  try {
    if (window.sessionStorage.getItem(storageKey)) return
    window.sessionStorage.setItem(storageKey, '1')
  } catch {
    // Private mode or storage disabled — fire anyway rather than lose the
    // conversion. A rare duplicate beats a systematic undercount.
  }

  return track(payload)
}

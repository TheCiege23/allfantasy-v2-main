'use client'

import { useEffect, useState } from 'react'
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/platform/appStoreLinks'
import { isInIosAppClient } from '@/lib/platform/iosApp'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'
import { track } from '@/lib/analytics/dataLayer'
import '@/components/core-app/screens/landing-store-badges.css'

export type LandingStoreBadgesCopy = {
  /** Accessible name for the group, e.g. "Get the app". */
  label: string
  appStoreAlt: string
  playAlt: string
}

/** English copy for pages that have no translated copy of their own (/commissioners, /signup). */
export const STORE_BADGES_EN: LandingStoreBadgesCopy = {
  label: 'Get the app',
  appStoreAlt: 'Download on the App Store',
  playAlt: 'Get it on Google Play',
}

/**
 * The official App Store and Google Play badges (public/badges/). Shown under the hero CTAs on / and
 * /commissioners, and under the form on /signup (not /login).
 *
 * 🛑 THESE ARE THE STORES' OWN ARTWORK AND THEIR RULES APPLY. Do not redraw, recolor, add a border,
 * or animate them (no hover lift). What the rules require, and where this file meets them:
 *   - Apple: the black badge when other stores' badges appear; App Store badge FIRST; at least 40px
 *     high; clear space of 1/4 the badge height on every side; the localized badge, never a translation.
 *   - Google: the Google Play badge the same size or larger than the other badges; at least 28px high;
 *     clear space of 1/4 the badge height; the localized badge for the page language.
 * Both render at the same height (CSS `.af-lp-store-img`), and the gaps around them are at least 1/4
 * of it. Google ships its PNG with built-in padding; the files here are trimmed to the visible badge so
 * the two heights compare honestly — the clear space comes from CSS instead.
 * The trademark credit lines both stores ask for are in the / and /commissioners footers
 * (`footer.storeTrademarks`); Apple asks for them once per site, wherever legal notices sit.
 *
 * Hidden inside our own iOS app and Android TWA: someone already in the app has nothing to install.
 */
export type StoreBadgesPage = 'landing' | 'commissioners' | 'signup' | 'partner-code'

export function LandingStoreBadges({
  page,
  copy = STORE_BADGES_EN,
  lang = 'en',
  className,
  testId = 'landing-store-badges',
}: {
  /** Which page the badges are on — sent with every tap as `app_store_badge_click.page`. */
  page: StoreBadgesPage
  copy?: LandingStoreBadgesCopy
  lang?: 'en' | 'es'
  /** e.g. `af-lp-stores--center` */
  className?: string
  testId?: string
}) {
  const [inApp, setInApp] = useState(false)
  useEffect(() => {
    setInApp(isInIosAppClient() || isTrustedWebActivity())
  }, [])
  if (inApp) return null

  return (
    <div
      className={className ? `af-lp-stores ${className}` : 'af-lp-stores'}
      role="group"
      aria-label={copy.label}
      data-hide-in-ios-app
      data-testid={testId}
    >
      {/* Tracking is a synchronous dataLayer push on click; it never delays opening the store. */}
      <a
        className="af-lp-store"
        href={APP_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="landing-store-apple"
        onClick={() => track({ event: 'app_store_badge_click', store: 'app_store', page })}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="af-lp-store-img" src={`/badges/app-store-${lang}.svg`} alt={copy.appStoreAlt} />
      </a>
      <a
        className="af-lp-store"
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="landing-store-google"
        onClick={() => track({ event: 'app_store_badge_click', store: 'google_play', page })}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="af-lp-store-img" src={`/badges/google-play-${lang}.png`} alt={copy.playAlt} />
      </a>
    </div>
  )
}

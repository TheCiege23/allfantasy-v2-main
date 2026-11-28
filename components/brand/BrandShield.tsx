'use client'

import { useEffect, useState } from 'react'
import { resolveBrandShieldSrc, seasonalShieldSrc } from '@/lib/brand/seasonalShield'
import { getHolidaySale, holidaySaleName } from '@/lib/monetization/holidaySale'
import { isInIosAppClient } from '@/lib/platform/iosApp'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'

/**
 * The AllFantasy shield for the public pages' nav bars (landing, commissioners, sign-in / sign-up,
 * import, pricing, tokens, password recovery) — one component, so they always match.
 *
 * WHAT IT SHOWS
 *   - Seasonal art by date (fall / winter / New Year, plain otherwise). Always the first render.
 *   - "50% OFF" sale art, only on the WEB and only while a real 50% offer applies:
 *       • the store-wide Black Friday → Cyber Monday sale (lib/monetization/holidaySale.ts), live
 *         for everyone — gold on its "Black Friday" days, cyber on its "Cyber Monday" days;
 *       • otherwise, where the caller passes `founding` (pricing only, server-resolved for this
 *         viewer), the founding offer when its label says 50%.
 *
 * ⚠ THE SALE ART IS A PRICE PROMISE, AND THE APPS DO NOT HAVE THE SALE. iOS and Android sell
 * through their stores at the store's price, so inside either app the shield must never say
 * 50% OFF. Both checks need the browser, so the server render and the first client render show
 * the seasonal shield, and the sale art is swapped in only after mount, once the page is known to
 * be on the web. The apps therefore never flash it; a web visitor sees it a moment after load.
 *
 * The sale is re-checked every 30s, so a page left open across the sale's start or end follows it.
 */
export function BrandShield({
  height = 34,
  founding,
}: {
  height?: number
  founding?: { label: string | null } | null
}) {
  const [onWeb, setOnWeb] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const inIosApp = isInIosAppClient() || document.documentElement.hasAttribute('data-ios-app')
    setOnWeb(!inIosApp && !isTrustedWebActivity())
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 30_000)
    return () => window.clearInterval(id)
  }, [])

  const src =
    now === null
      ? seasonalShieldSrc()
      : resolveBrandShieldSrc({
          now: new Date(now),
          onWeb,
          holidaySale: getHolidaySale(now),
          holidaySaleName: holidaySaleName(now),
          founding,
        })

  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand art, already sized
    <img
      src={src}
      suppressHydrationWarning
      alt=""
      aria-hidden
      draggable={false}
      style={{ height, width: 'auto', display: 'block', flex: 'none' }}
    />
  )
}

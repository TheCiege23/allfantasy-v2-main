'use client'

import '@/components/launch/af-holiday-sale.css'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getHolidaySale, holidaySaleName, type HolidaySaleView } from '@/lib/monetization/holidaySale'
import { pad2, splitRemaining, type CountdownParts } from '@/components/launch/launchTime'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'

/*
 * The Black Friday → Cyber Monday banner (lib/monetization/holidaySale.ts): "50% off your first
 * year", a countdown to Monday midnight ET, and — off /pricing — a button to the plans.
 *
 * Renders nothing outside the sale window, and it re-checks the clock every second, so a page left
 * open across Friday midnight or Monday midnight turns it on or off without a reload.
 *
 * ⚠ WEB ONLY. `data-hide-in-ios-app` hides it in the iOS app, and it hides itself in the Android app
 * (a Trusted Web Activity) — both sell through their store at the store's price, which this sale does
 * not change. The Android check needs the browser, so it runs after mount.
 */
export type HolidaySaleSurface = 'pricing' | 'landing' | 'signup' | 'core'

export function useHolidaySale(): HolidaySaleView | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return getHolidaySale(now)
}

function remaining(sale: HolidaySaleView, now: number): CountdownParts | null {
  return splitRemaining(Date.parse(sale.endsAt) - now)
}

export function HolidaySaleStrip({ surface, className }: { surface: HolidaySaleSurface; className?: string }) {
  const sale = useHolidaySale()
  const [inAndroidApp, setInAndroidApp] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setInAndroidApp(isTrustedWebActivity())
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [])
  if (!sale || inAndroidApp) return null

  const parts = now === null ? null : remaining(sale, now)
  const name = holidaySaleName(now ?? Date.now())
  const cls = ['af-hs', className].filter(Boolean).join(' ')
  return (
    <section
      className={cls}
      data-hide-in-ios-app
      data-surface={surface}
      aria-label={`${name} sale: ${sale.percentOff}% off your first year`}
      data-testid={`holiday-sale-${surface}`}
    >
      <div className="af-hs-copy">
        <span className="af-hs-tag">{name}</span>
        <p className="af-hs-title">{sale.percentOff}% off your first year</p>
        <p className="af-hs-body">
          Any plan, monthly or yearly. Applied at checkout. Ends Monday at midnight ET.
        </p>
      </div>
      <div className="af-hs-side">
        {parts ? (
          <span
            className="af-hs-clock"
            role="timer"
            aria-live="off"
            aria-label={`${parts.days} days, ${parts.hours} hours and ${parts.minutes} minutes left`}
          >
            <span aria-hidden>
              {parts.days > 0 ? `${parts.days}d ` : ''}
              {pad2(parts.hours)}h {pad2(parts.minutes)}m {pad2(parts.seconds)}s
            </span>
            <span className="af-hs-clock-label" aria-hidden>
              left
            </span>
          </span>
        ) : null}
        {/* No button on /pricing (the plans are right there) or /signup (it would pull people out of signing up). */}
        {surface === 'landing' || surface === 'core' ? (
          <Link href="/pricing" className="af-hs-cta" data-testid={`holiday-sale-cta-${surface}`}>
            See the deal
          </Link>
        ) : null}
      </div>
    </section>
  )
}

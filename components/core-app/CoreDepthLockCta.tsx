'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useLockUpgradeHref } from '@/hooks/useLockUpgradeHref'
import { trackLockedFeatureConversionClick, trackLockedFeatureViewed } from '@/lib/monetization-analytics'
import { monthlyUpgradeHref } from '@/lib/monetization/upgradeDestination'
import { useLockTrialOffer } from '@/lib/monetization/useLockTrialOffer'

/**
 * The /core depth lock's upgrade link. A client island so `CoreDepthLock` itself stays renderable on the
 * server: the link needs this page's path for `back=` (lib/monetization/lockReturn.ts), which only the
 * browser knows. `data-ios-purchase` stays on the anchor — the iOS no-IAP build hides it by that mark.
 *
 * `offerTrial` (2026-11-24, the lock card only — not the one-line AF ADP header or Chimmy's upsell): when
 * the server calls this viewer eligible for the AF Pro free trial and the lock sells AF Pro, the button
 * says "Try AF Pro free for 7 days" and a line under it gives the price after. Never in any iOS app
 * build or the Play TWA — `useLockTrialOffer` does not even ask there.
 */
export function CoreDepthLockCta({
  href, source, requiredPlan, children, testId, className = 'af-core-lock-cta', offerTrial = false, lang,
}: {
  href: string
  source: string
  requiredPlan: string
  children: ReactNode
  className?: string
  testId?: string
  offerTrial?: boolean
  /** The lock's language, for the trial words only. */
  lang?: string
}) {
  const trial = useLockTrialOffer(requiredPlan, lang, offerTrial)
  const planHref = useLockUpgradeHref(monthlyUpgradeHref(href), source)
  const linkRef = useRef<HTMLAnchorElement>(null)
  const tracked = useRef(false)

  useEffect(() => {
    const link = linkRef.current
    if (!link || tracked.current) return
    const record = () => {
      if (tracked.current || link.getClientRects().length === 0) return
      tracked.current = true
      trackLockedFeatureViewed({ surface: source, requiredPlan })
    }
    if (typeof IntersectionObserver === 'undefined') {
      record()
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      record()
      observer.disconnect()
    })
    observer.observe(link)
    return () => observer.disconnect()
  }, [requiredPlan, source])

  const link = (
    <a
      ref={linkRef}
      className={className}
      href={planHref}
      data-testid={testId}
      data-ios-purchase
      data-trial={trial ? 'offered' : undefined}
      onClick={() => trackLockedFeatureConversionClick({ surface: source, ctaType: 'upgrade', requiredPlan })}
    >
      {trial ? trial.cta : children}
    </a>
  )
  if (!trial?.then) return link
  return (
    <>
      {link}
      <span className="af-core-lock-trial-then" data-testid="core-lock-trial-then" data-ios-purchase data-hide-in-ios-app>
        {trial.then}
      </span>
    </>
  )
}

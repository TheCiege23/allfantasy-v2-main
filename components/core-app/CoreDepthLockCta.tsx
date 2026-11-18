'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useLockUpgradeHref } from '@/hooks/useLockUpgradeHref'
import { trackLockedFeatureConversionClick, trackLockedFeatureViewed } from '@/lib/monetization-analytics'
import { monthlyUpgradeHref } from '@/lib/monetization/upgradeDestination'

/**
 * The /core depth lock's upgrade link. A client island so `CoreDepthLock` itself stays renderable on the
 * server: the link needs this page's path for `back=` (lib/monetization/lockReturn.ts), which only the
 * browser knows. `data-ios-purchase` stays on the anchor — the iOS no-IAP build hides it by that mark.
 */
export function CoreDepthLockCta({
  href, source, requiredPlan, children, testId, className = 'af-core-lock-cta',
}: {
  href: string
  source: string
  requiredPlan: string
  children: ReactNode
  className?: string
  testId?: string
}) {
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

  return (
    <a
      ref={linkRef}
      className={className}
      href={planHref}
      data-testid={testId}
      data-ios-purchase
      onClick={() => trackLockedFeatureConversionClick({ surface: source, ctaType: 'upgrade', requiredPlan })}
    >
      {children}
    </a>
  )
}

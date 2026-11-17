'use client'

import type { ReactNode } from 'react'
import { useLockUpgradeHref } from '@/hooks/useLockUpgradeHref'

/**
 * The /core depth lock's upgrade link. A client island so `CoreDepthLock` itself stays renderable on the
 * server: the link needs this page's path for `back=` (lib/monetization/lockReturn.ts), which only the
 * browser knows. `data-ios-purchase` stays on the anchor — the iOS no-IAP build hides it by that mark.
 */
export function CoreDepthLockCta({ href, source, children }: { href: string; source: string; children: ReactNode }) {
  const planHref = useLockUpgradeHref(href, source)
  return (
    <a className="af-core-lock-cta" href={planHref} data-ios-purchase>
      {children}
    </a>
  )
}

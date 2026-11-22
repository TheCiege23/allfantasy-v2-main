'use client'

import { useEffect, useMemo, useState } from 'react'
import { withLockReturn } from '@/lib/monetization/lockReturn'

/**
 * A lock's upgrade link with `from=<source>` and `back=<this page>` (lib/monetization/lockReturn.ts).
 *
 * The first render carries `from` only, so the server and client renders agree; `back` is added after
 * mount, when the page's own path and query are known. A lock that never mounts in a browser (a test,
 * a server render) still says which lock sold the plan.
 */
export function useLockUpgradeHref(href: string, source: string | null): string {
  const tagged = useMemo(() => withLockReturn(href, { source }), [href, source])
  const [withBack, setWithBack] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    setWithBack(withLockReturn(href, { source, back: `${window.location.pathname}${window.location.search}` }))
  }, [href, source])
  return withBack ?? tagged
}

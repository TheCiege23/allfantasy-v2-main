'use client'

import { useEffect, useState } from 'react'
import type { PartnerNudge } from '@/lib/partner-codes/nudgeCopy'

/*
 * One fetch per page load, shared by the home card and the account menu, so
 * opening the menu does not ask again. Anything but a clean answer (program off
 * → 404, signed out → 401, offline) means "show nothing": a missing nudge costs
 * nothing, a broken one on the home page costs trust.
 */
let pending: Promise<PartnerNudge> | null = null

function loadNudge(): Promise<PartnerNudge> {
  if (!pending) {
    pending = fetch('/api/partner-codes/me?nudge=1', { credentials: 'same-origin' })
      .then(async (res) => (res.ok ? ((await res.json()) as PartnerNudge) : { show: false as const }))
      .catch(() => ({ show: false as const }))
  }
  return pending
}

export function usePartnerNudge(): PartnerNudge | null {
  const [nudge, setNudge] = useState<PartnerNudge | null>(null)
  useEffect(() => {
    let live = true
    void loadNudge().then((n) => {
      if (live) setNudge(n)
    })
    return () => {
      live = false
    }
  }, [])
  return nudge
}

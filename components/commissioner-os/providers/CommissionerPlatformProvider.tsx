'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { commissionerEventBus } from '@/lib/commissioner-ui/platform/eventBus'
import type { CommissionerPlatformEvent } from '@/lib/commissioner-ui/platform/events'
import type { CommissionerPlatformServiceId } from '@/lib/commissioner-ui/platform/serviceRegistry'

interface CommissionerPlatformContextValue {
  /** At most one platform service overlay is open at a time. */
  openServiceId: CommissionerPlatformServiceId | null
  openService: (id: CommissionerPlatformServiceId) => void
  closeService: () => void
  publish: (event: CommissionerPlatformEvent) => void
  subscribe: typeof commissionerEventBus.subscribe
}

const Ctx = createContext<CommissionerPlatformContextValue | null>(null)

/**
 * Holds the UI-open/closed state for whichever platform service overlay is
 * active (Search, Notifications, Activity Stream, Help Center), plus
 * access to the shared event bus. Infrastructure only — no service's
 * actual behavior is implemented here, per Phase 0.3's explicit scope.
 */
export function CommissionerPlatformProvider({ children }: { children: ReactNode }) {
  const [openServiceId, setOpenServiceId] = useState<CommissionerPlatformServiceId | null>(null)

  const openService = useCallback((id: CommissionerPlatformServiceId) => {
    setOpenServiceId(id)
  }, [])

  const closeService = useCallback(() => {
    setOpenServiceId(null)
  }, [])

  const publish = useCallback((event: CommissionerPlatformEvent) => {
    commissionerEventBus.publish(event)
  }, [])

  const subscribe = useMemo(() => commissionerEventBus.subscribe.bind(commissionerEventBus), [])

  const value = useMemo<CommissionerPlatformContextValue>(
    () => ({ openServiceId, openService, closeService, publish, subscribe }),
    [openServiceId, openService, closeService, publish, subscribe]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCommissionerPlatform() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommissionerPlatform must be used inside CommissionerPlatformProvider')
  return ctx
}

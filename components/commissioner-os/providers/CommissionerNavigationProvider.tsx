'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { getActiveCommissionerModuleId, type CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'
import { resolveBreadcrumbs, type Breadcrumb } from '@/lib/commissioner-ui/navigation/breadcrumbs'

interface CommissionerNavigationContextValue {
  activeModuleId: CommissionerModuleId | null
  breadcrumbs: Breadcrumb[]
}

const Ctx = createContext<CommissionerNavigationContextValue | null>(null)

export function CommissionerNavigationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  const value = useMemo<CommissionerNavigationContextValue>(() => {
    const activeModuleId = getActiveCommissionerModuleId(pathname)
    // Depth isn't derivable from real page state yet — every route in this
    // placeholder phase is a depth-1 landing. Module pages pass their own
    // depth once they have real Detail/Evidence views (Design Language §3).
    const breadcrumbs = resolveBreadcrumbs(activeModuleId, 1)
    return { activeModuleId, breadcrumbs }
  }, [pathname])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCommissionerNavigation() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommissionerNavigation must be used inside CommissionerNavigationProvider')
  return ctx
}

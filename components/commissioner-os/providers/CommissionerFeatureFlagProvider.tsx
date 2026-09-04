'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  DEFAULT_COMMISSIONER_MODULE_FLAGS,
  isCommissionerModuleEnabled,
  type CommissionerModuleFlags,
} from '@/lib/commissioner-ui/featureFlags'
import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'

interface CommissionerFeatureFlagContextValue {
  flags: CommissionerModuleFlags
  isModuleEnabled: (moduleId: CommissionerModuleId) => boolean
}

const Ctx = createContext<CommissionerFeatureFlagContextValue | null>(null)

export function CommissionerFeatureFlagProvider({
  children,
  flags = DEFAULT_COMMISSIONER_MODULE_FLAGS,
}: {
  children: ReactNode
  flags?: CommissionerModuleFlags
}) {
  const value = useMemo<CommissionerFeatureFlagContextValue>(
    () => ({
      flags,
      isModuleEnabled: (moduleId) => isCommissionerModuleEnabled(moduleId, flags),
    }),
    [flags]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCommissionerFeatureFlags() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCommissionerFeatureFlags must be used inside CommissionerFeatureFlagProvider')
  return ctx
}

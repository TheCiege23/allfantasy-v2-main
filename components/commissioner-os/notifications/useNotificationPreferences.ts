'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'

const MUTED_MODULES_STORAGE_KEY = 'commissioner_os_notifications_muted_modules'

/**
 * Notification preferences, scoped to exactly what this phase needs — a
 * per-source-module mute toggle — rather than a speculative full
 * preferences system. Same localStorage pattern as every other
 * client-persisted piece of state in this program.
 */
export function useNotificationPreferences() {
  const [mutedModuleIds, setMutedModuleIds] = useState<Set<CommissionerModuleId>>(new Set())

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(MUTED_MODULES_STORAGE_KEY)
      if (stored) setMutedModuleIds(new Set(JSON.parse(stored)))
    } catch {
      /* ignore */
    }
  }, [])

  const toggleMuted = useCallback((moduleId: CommissionerModuleId) => {
    setMutedModuleIds((prev) => {
      const next = new Set(prev)
      if (next.has(moduleId)) {
        next.delete(moduleId)
      } else {
        next.add(moduleId)
      }
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(MUTED_MODULES_STORAGE_KEY, JSON.stringify(Array.from(next)))
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [])

  const isMuted = useCallback((moduleId: CommissionerModuleId) => mutedModuleIds.has(moduleId), [mutedModuleIds])

  return { mutedModuleIds, toggleMuted, isMuted }
}

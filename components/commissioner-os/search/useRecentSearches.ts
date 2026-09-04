'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CommissionerSearchResultContract } from '@/lib/commissioner-ui/contracts'

const RECENT_SEARCHES_STORAGE_KEY = 'commissioner_os_recent_searches'
const MAX_RECENT = 5

/**
 * Client-only, localStorage-backed — mirrors CommissionerLayoutProvider's
 * exact persistence pattern (same key-prefix convention, same
 * window-guard, same silent try/catch) rather than inventing a second
 * storage convention. Recent searches are recently *selected results*,
 * not recently typed query strings — clicking one jumps straight back to
 * that item, the more directly useful of the two interpretations.
 */
export function useRecentSearches() {
  const [recent, setRecent] = useState<CommissionerSearchResultContract[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)
      if (stored) setRecent(JSON.parse(stored))
    } catch {
      /* ignore */
    }
  }, [])

  const addRecent = useCallback((result: CommissionerSearchResultContract) => {
    setRecent((prev) => {
      const next = [result, ...prev.filter((item) => item.id !== result.id)].slice(0, MAX_RECENT)
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next))
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [])

  const clearRecent = useCallback(() => {
    setRecent([])
    if (typeof window === 'undefined') return
    try {
      window.localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  return { recent, addRecent, clearRecent }
}

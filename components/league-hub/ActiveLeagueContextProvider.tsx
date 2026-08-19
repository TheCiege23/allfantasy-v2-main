'use client'

/**
 * Universal League Hub — Active League Context provider (Parts 2, 5, 8).
 *
 * Establishes the single shared "active league" context every downstream OS
 * module (User OS, Commissioner OS, Trade OS, Waiver OS, Lineup OS,
 * Rankings, Chimmy) should read from instead of independently re-deriving
 * league membership. This phase only wires the context itself — it renders
 * nothing beyond what's passed to it and implements no OS module.
 *
 * Selecting a league never re-authenticates: the selector already has the
 * portfolio's own real data (provider, sport, commissioner flag) from the
 * canonical Portfolio fetch, so it sets an optimistic context immediately,
 * then hydrates it against `/api/league-hub/context/[leagueId]` (which
 * reuses the same real session cookie) for the fields the portfolio doesn't
 * carry (roster id, real scoring string, live sync freshness).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ActiveLeagueContext, LeagueHubEntry } from '@/lib/shared-services/league-hub/types'

const STORAGE_KEY = 'af.leagueHub.activeLeagueId'

interface ActiveLeagueContextValue {
  context: ActiveLeagueContext | null
  isLoading: boolean
  error: string | null
  selectLeague: (entry: LeagueHubEntry) => void
  clearLeague: () => void
}

const ActiveLeagueContextReactContext = createContext<ActiveLeagueContextValue | null>(null)

function readStoredLeagueId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredLeagueId(leagueId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (leagueId) window.sessionStorage.setItem(STORAGE_KEY, leagueId)
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // sessionStorage unavailable (private mode, etc.) — selection just won't persist across reloads.
  }
}

function toOptimisticContext(entry: LeagueHubEntry): ActiveLeagueContext {
  return {
    canonicalLeagueId: entry.canonicalLeagueId,
    provider: entry.provider,
    sport: entry.sport,
    season: entry.season,
    teamId: entry.userTeam.id,
    rosterId: null,
    isCommissioner: entry.commissionerStatus.isCommissioner,
    commissionerVerificationMethod: entry.commissionerStatus.verificationMethod,
    syncFreshness: entry.syncFreshness,
    scoring: null,
  }
}

export function ActiveLeagueContextProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<ActiveLeagueContext | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const hydrate = useCallback((leagueId: string) => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    setError(null)
    fetch(`/api/league-hub/context/${encodeURIComponent(leagueId)}`, { cache: 'no-store' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Failed to load league context'))
      )
      .then((full: ActiveLeagueContext) => {
        if (requestIdRef.current !== requestId) return
        setContext(full)
      })
      .catch(() => {
        if (requestIdRef.current !== requestId) return
        setError('Could not load full league context')
      })
      .finally(() => {
        if (requestIdRef.current !== requestId) return
        setIsLoading(false)
      })
  }, [])

  const selectLeague = useCallback(
    (entry: LeagueHubEntry) => {
      setContext(toOptimisticContext(entry))
      writeStoredLeagueId(entry.canonicalLeagueId)
      hydrate(entry.canonicalLeagueId)
    },
    [hydrate]
  )

  const clearLeague = useCallback(() => {
    requestIdRef.current += 1
    setContext(null)
    setError(null)
    setIsLoading(false)
    writeStoredLeagueId(null)
  }, [])

  useEffect(() => {
    const storedId = readStoredLeagueId()
    if (storedId) hydrate(storedId)
    // Only on mount — subsequent changes go through `selectLeague`/`clearLeague`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<ActiveLeagueContextValue>(
    () => ({ context, isLoading, error, selectLeague, clearLeague }),
    [context, isLoading, error, selectLeague, clearLeague]
  )

  return (
    <ActiveLeagueContextReactContext.Provider value={value}>
      {children}
    </ActiveLeagueContextReactContext.Provider>
  )
}

export function useActiveLeagueContext(): ActiveLeagueContextValue {
  const ctx = useContext(ActiveLeagueContextReactContext)
  if (!ctx) {
    throw new Error('useActiveLeagueContext must be used within an ActiveLeagueContextProvider')
  }
  return ctx
}

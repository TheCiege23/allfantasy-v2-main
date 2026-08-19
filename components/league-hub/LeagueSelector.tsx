'use client'

/**
 * Universal League Hub — global league selector (Part 2).
 *
 * Fetches the canonical portfolio (`/api/league-hub/portfolio`) and renders
 * every league as a `UniversalLeagueCard`. Selecting one calls
 * `useActiveLeagueContext().selectLeague`, which is the one shared entry
 * point every future OS module should read from — this component has no
 * knowledge of what happens after selection.
 */
import { useEffect, useState } from 'react'
import { useActiveLeagueContext } from './ActiveLeagueContextProvider'
import { UniversalLeagueCard } from './UniversalLeagueCard'
import type { LeagueHubEntry, LeaguePortfolio } from '@/lib/shared-services/league-hub/types'

export function LeagueSelector() {
  const { context, selectLeague } = useActiveLeagueContext()
  const [portfolio, setPortfolio] = useState<LeaguePortfolio | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setIsLoading(true)
    fetch('/api/league-hub/portfolio', { cache: 'no-store' })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error('Failed to load leagues'))
      )
      .then((payload: LeaguePortfolio) => {
        if (!active) return
        setPortfolio(payload)
        setError(null)
      })
      .catch(() => {
        if (!active) return
        setError('Could not load your leagues')
      })
      .finally(() => {
        if (!active) return
        setIsLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl border border-white/10 bg-white/5" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-red-300">{error}</p>
  }

  const leagues: LeagueHubEntry[] = portfolio?.leagues ?? []

  if (leagues.length === 0) {
    return <p className="text-sm text-white/50">No leagues found yet — import or create one to get started.</p>
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {leagues.map((entry) => (
        <UniversalLeagueCard
          key={entry.canonicalLeagueId}
          entry={entry}
          isActive={context?.canonicalLeagueId === entry.canonicalLeagueId}
          onSelect={selectLeague}
        />
      ))}
    </div>
  )
}

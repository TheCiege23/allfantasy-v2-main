'use client'

import { useEffect, useState } from 'react'
import {
  fetchRedraftSeason,
  fetchRedraftStandings,
  type RedraftRosterRow,
} from '@/lib/redraft/client'
import { StandingsView } from './StandingsView'

/**
 * Real standings + playoffs surface for the nflRedraftCore Standings tab.
 *
 * Replaces the "coming soon" placeholder by loading the canonical redraft season
 * + standings and rendering the existing {@link StandingsView} (bracket display +
 * commissioner Generate/Advance/Finalize controls wired to the real
 * `/api/redraft/playoffs/*` + `/api/redraft/seasons/finalize` routes). No bracket
 * data is fabricated: when there is no active redraft season, an honest empty
 * state is shown instead of a mock table.
 */
export function RedraftStandingsPlayoffsView({
  leagueId,
  isCommissioner = false,
}: {
  leagueId: string
  isCommissioner?: boolean
}) {
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [rows, setRows] = useState<RedraftRosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [noSeason, setNoSeason] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      setNoSeason(false)
      try {
        const season = await fetchRedraftSeason(leagueId)
        if (cancelled) return
        if (!season?.id) {
          setNoSeason(true)
          setSeasonId(null)
          setRows([])
          return
        }
        setSeasonId(season.id)
        const standings = await fetchRedraftStandings(season.id)
        if (!cancelled) setRows(standings)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load standings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (loading) {
    return (
      <div data-testid="redraft-standings-loading" className="p-5 text-[12px] text-white/55">
        Loading standings…
      </div>
    )
  }

  if (error) {
    return (
      <div data-testid="redraft-standings-error" className="p-5 text-[12px] text-rose-300">
        {error}
      </div>
    )
  }

  if (noSeason) {
    return (
      <div
        data-testid="redraft-standings-no-season"
        className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      >
        <p className="text-[14px] font-semibold text-white/60">Standings &amp; Playoffs</p>
        <p className="max-w-[280px] text-[11px] text-white/40">
          Standings and the playoff bracket appear once the draft is finalized into an active redraft season.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4">
      <StandingsView rows={rows} seasonId={seasonId} isCommissioner={isCommissioner} />
    </div>
  )
}

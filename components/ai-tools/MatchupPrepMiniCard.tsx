'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, Swords } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import type { MatchupPrepDashboardResult } from '@/lib/matchup-prep-dashboard/types'
import { isSupportedSport } from '@/lib/sport-scope'

function scrollToAiTools() {
  const el = document.querySelector('[data-testid="ai-tools-grid"]')
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openMatchupPrepModal() {
  scrollToAiTools()
  window.dispatchEvent(new CustomEvent('af-open-ai-tool', { detail: { tool: 'matchupPrep' } }))
}

const DEFAULT_TOGGLES = {
  includeLiveNews: true,
  includeInjuries: true,
  includeScheduleAdjustments: true,
  includeWeather: false,
  includeStreamingRecommendations: true,
  includeOpponentTrendAnalysis: true,
  includePlayoffContext: true,
  includeRookieProspectContext: false,
}

export function MatchupPrepMiniCard({
  leagues,
  selectedLeagueId,
}: {
  leagues: UserLeague[]
  selectedLeagueId: string | null
}) {
  const leagueId = selectedLeagueId ?? ''
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MatchupPrepDashboardResult | null>(null)

  const activeLeague = useMemo(() => leagues.find((l) => l.id === leagueId) ?? null, [leagues, leagueId])

  const load = useCallback(async () => {
    if (!leagueId) {
      setData(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const sportFilter =
        activeLeague && isSupportedSport(activeLeague.sport) ? String(activeLeague.sport).toUpperCase() : 'ALL'
      const res = await fetch('/api/ai-tools/matchup-prep/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId,
          teamFocus: 'my_team',
          teamExternalId: null,
          opponentExternalId: null,
          timeHorizon: 'this_matchup',
          strategyMode: 'balanced',
          skipAi: true,
          toggles: DEFAULT_TOGGLES,
        }),
      })
      const json = (await res.json()) as MatchupPrepDashboardResult | { ok: false; error?: string }
      if (!res.ok || !json.ok) {
        setData(null)
        setError((json as { error?: string }).error || 'Could not load matchup prep')
        return
      }
      setData(json)
    } catch {
      setData(null)
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [leagueId, activeLeague])

  useEffect(() => {
    void load()
  }, [load])

  if (leagues.length === 0) {
    return (
      <div
        className="rounded-2xl border border-white/[0.08] bg-[#0a0f18] p-4"
        data-testid="matchup-prep-mini-empty"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10">
            <Swords className="h-4 w-4 text-sky-300" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#e8eaf6]">Matchup Prep</p>
            <p className="text-[11px] text-[#5c6480]">Opponent scouting + game plan</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-[#8b93ab]">Join a league to unlock live matchup intelligence.</p>
      </div>
    )
  }

  const edge = data?.projectedEdge
  const win = data?.winProbability

  return (
    <div
      className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0a0f18] to-[#070b12] p-4"
      data-testid="matchup-prep-mini-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-sky-500/30 bg-sky-500/10">
            <Swords className="h-4 w-4 text-sky-300" />
          </div>
          <div>
            <p className="text-[14px] font-bold leading-none text-[#e8eaf6]">Matchup Prep</p>
            <p className="mt-1 text-[11px] leading-none text-[#5c6480]">Opponent scouting + game plan</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2e3347] bg-[#121725] text-[#9ba3bf] transition hover:border-sky-500/35 hover:text-white disabled:opacity-50"
          aria-label="Refresh matchup prep"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="mt-3 min-h-[52px]">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-[12px] text-[#5c6480]">
            <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
            Building matchup board…
          </div>
        ) : error ? (
          <p className="text-[12px] text-amber-200/90">{error}</p>
        ) : data?.ok ? (
          <>
            <p className="text-[11px] text-[#7a8199]">
              <span className="text-white/80">vs {data.oppTeamName ?? 'Opponent'}</span>
              {data.degraded ? (
                <span className="ml-1.5 rounded border border-amber-500/30 px-1 text-[11px] font-bold uppercase text-amber-200/90">
                  Partial
                </span>
              ) : (
                <span className="ml-1.5 rounded border border-emerald-500/25 px-1 text-[11px] font-bold uppercase text-emerald-200/85">
                  Live
                </span>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-sky-300/80">Proj. edge</p>
                <p className="text-[26px] font-black tabular-nums leading-none text-white/95">
                  {edge != null ? `${edge > 0 ? '+' : ''}${edge.toFixed(1)}` : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase text-[#5c6480]">Win chance</p>
                <p className="text-[22px] font-black tabular-nums text-emerald-200/90">
                  {win != null ? `${win}%` : '—'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[#5c6480]">Updated {new Date(data.computedAt).toLocaleString()}</p>
          </>
        ) : (
          <p className="text-[12px] text-[#8b93ab]">Select a league above.</p>
        )}
      </div>

      <button
        type="button"
        onClick={openMatchupPrepModal}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-sky-500/25 bg-sky-500/[0.08] py-2.5 text-[12px] font-semibold text-sky-100 transition hover:border-sky-400/45 hover:bg-sky-500/[0.12]"
        data-testid="matchup-prep-mini-open-full"
      >
        Open full matchup prep
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

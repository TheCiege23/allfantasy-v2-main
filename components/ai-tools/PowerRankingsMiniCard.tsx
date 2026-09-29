'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Crown, Loader2, RefreshCw } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import type { PowerRankingsDashboardResult } from '@/lib/power-rankings-dashboard/types'
import { isSupportedSport } from '@/lib/sport-scope'
import { buildMyRankTrailFromSnapshots } from '@/lib/power-rankings-dashboard/snapshotTeamRow'

function scrollToAiTools() {
  const el = document.querySelector('[data-testid="ai-tools-grid"]')
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openPowerRankingsModal() {
  scrollToAiTools()
  window.dispatchEvent(new CustomEvent('af-open-ai-tool', { detail: { tool: 'power' } }))
}

export function PowerRankingsMiniCard({
  leagues,
  selectedLeagueId,
}: {
  leagues: UserLeague[]
  /** Dashboard tool league — shared with Global AI Tools grid */
  selectedLeagueId: string | null
}) {
  const leagueId = selectedLeagueId ?? ''
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<PowerRankingsDashboardResult | null>(null)
  const [snapshotTrail, setSnapshotTrail] = useState<number[] | null>(null)

  const activeLeague = useMemo(() => leagues.find((l) => l.id === leagueId) ?? null, [leagues, leagueId])

  const load = useCallback(async () => {
    if (!leagueId) {
      setData(null)
      setError(null)
      setSnapshotTrail(null)
      return
    }
    setLoading(true)
    setError(null)
    setSnapshotTrail(null)
    try {
      const sportFilter = activeLeague && isSupportedSport(activeLeague.sport) ? String(activeLeague.sport).toUpperCase() : 'ALL'
      const [dashRes, snapRes] = await Promise.all([
        fetch('/api/ai-tools/power-rankings/dashboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sportFilter,
            leagueId,
            rankingMode: 'current_power',
            timeWindow: 'season',
            teamContext: 'full_league',
            week: null,
            skipAi: true,
            toggles: {
              includeProjections: true,
              includeScheduleStrength: true,
              includeInjuries: true,
              includeTransactionMomentum: true,
              includeRookies: true,
              includePlayoffHistory: true,
              includeRecentForm: true,
              includeDynastyWeighting: true,
            },
          }),
        }),
        fetch(
          `/api/ai-tools/power-rankings/snapshots?leagueId=${encodeURIComponent(leagueId)}&limit=12&rankingMode=current_power`,
        ),
      ])
      const json = (await dashRes.json()) as PowerRankingsDashboardResult | { ok: false; error?: string }
      if (!dashRes.ok || !json.ok) {
        setData(null)
        setError((json as { error?: string }).error || 'Could not load power rankings')
        return
      }
      setData(json)

      if (snapRes.ok) {
        const snapJson = (await snapRes.json()) as {
          ok?: boolean
          snapshots?: Array<{ teams: unknown; computedAt: string }>
        }
        if (snapJson.ok && Array.isArray(snapJson.snapshots)) {
          const mapped = snapJson.snapshots.map((s) => ({
            teams: s.teams,
            computedAt: new Date(s.computedAt),
          }))
          const myRow =
            json.ok && json.analysisScope === 'league' ? json.teams.find((t) => t.isCurrentUser) : null
          if (myRow) {
            setSnapshotTrail(buildMyRankTrailFromSnapshots(mapped, 6))
          }
        }
      }
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
        data-testid="power-rankings-mini-empty"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10">
            <Crown className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#e8eaf6]">Power Rankings</p>
            <p className="text-[11px] text-[#5c6480]">League standings and momentum</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-[#8b93ab]">Import or join a league to see live power rankings.</p>
      </div>
    )
  }

  const my = data?.ok && data.analysisScope === 'league' ? data.teams.find((t) => t.isCurrentUser) : null
  const delta = my?.rankDelta
  const deltaText =
    delta == null ? '—' : delta > 0 ? `↑${delta}` : delta < 0 ? `↓${Math.abs(delta)}` : '—'

  return (
    <div
      className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0a0f18] to-[#070b12] p-4"
      data-testid="power-rankings-mini-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/10">
            <Crown className="h-4 w-4 text-violet-300" />
          </div>
          <div>
            <p className="text-[14px] font-bold leading-none text-[#e8eaf6]">Power Rankings</p>
            <p className="mt-1 text-[11px] leading-none text-[#5c6480]">League standings and momentum</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2e3347] bg-[#121725] text-[#9ba3bf] transition hover:border-violet-500/35 hover:text-white disabled:opacity-50"
            aria-label="Refresh power rankings"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="mt-3 min-h-[52px]">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-[12px] text-[#5c6480]">
            <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
            Loading standings…
          </div>
        ) : error ? (
          <p className="text-[12px] text-amber-200/90">{error}</p>
        ) : data?.ok && data.analysisScope === 'league' ? (
          <>
            <p className="text-[11px] text-[#7a8199]">
              <span className="text-white/80">{data.leagueName || 'League'}</span>
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
            {my ? (
              <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-violet-300/80">Your rank</p>
                  <p className="text-[26px] font-black tabular-nums leading-none text-white/95">#{my.rank}</p>
                  <p className="mt-0.5 truncate text-[12px] font-semibold text-white/80">{my.teamName}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase text-[#5c6480]">vs prior</p>
                  <p
                    className={`text-[16px] font-bold tabular-nums ${
                      (delta ?? 0) > 0 ? 'text-emerald-300' : (delta ?? 0) < 0 ? 'text-red-300' : 'text-white/40'
                    }`}
                  >
                    {deltaText}
                  </p>
                  <p className="text-[11px] text-cyan-200/85">Power {my.powerScore.toFixed(1)}</p>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-[#8b93ab]">
                Claim a team in this league to see &quot;your&quot; rank here. Full leaderboard is in the tool.
              </p>
            )}
            <p className="mt-2 text-[11px] text-[#5c6480]">
              Updated {new Date(data.computedAt).toLocaleString()}
              {data.week != null ? ` · Week ${data.week}` : ''}
            </p>
            {my && snapshotTrail != null && snapshotTrail.length >= 2 ? (
              <p className="mt-1.5 text-[11px] leading-snug text-[#7a8199]" data-testid="power-rankings-mini-trail">
                <span className="font-semibold text-[#8b93ab]">Saved rank trail (DB): </span>
                {snapshotTrail.map((n) => `#${n}`).join(' → ')}
              </p>
            ) : my && snapshotTrail != null && snapshotTrail.length === 1 ? (
              <p className="mt-1.5 text-[11px] text-[#5c6480]">
                One snapshot stored — more history appears as rankings are saved each week.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-[#8b93ab]">Select a league above to load rankings.</p>
        )}
      </div>

      <button
        type="button"
        onClick={openPowerRankingsModal}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-violet-500/25 bg-violet-500/[0.08] py-2.5 text-[12px] font-semibold text-violet-100 transition hover:border-violet-400/45 hover:bg-violet-500/[0.12]"
        data-testid="power-rankings-mini-open-full"
      >
        Open full power rankings
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

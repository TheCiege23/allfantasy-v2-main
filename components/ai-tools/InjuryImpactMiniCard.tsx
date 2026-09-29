'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import type { InjuryImpactDashboardResult } from '@/lib/injury-impact-dashboard/types'
import { formatInjuryAvailabilitySummary } from '@/lib/injury-impact-dashboard/formatAvailabilitySummary'
import { isSupportedSport } from '@/lib/sport-scope'

function scrollToAiTools() {
  const el = document.querySelector('[data-testid="ai-tools-grid"]')
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openInjuryImpactModal() {
  scrollToAiTools()
  window.dispatchEvent(new CustomEvent('af-open-ai-tool', { detail: { tool: 'injury' } }))
}

function formatAvailabilitySummary(c: InjuryImpactDashboardResult['summaryCounts']) {
  const parts: string[] = []
  if (c.outIr > 0) parts.push(`${c.outIr} out/IR`)
  if (c.doubtful > 0) parts.push(`${c.doubtful} doubtful`)
  if (c.questionable > 0) parts.push(`${c.questionable} questionable`)
  if (c.limited > 0) parts.push(`${c.limited} limited`)
  if (parts.length === 0) return 'No flagged availability issues in current feed'
  return parts.join(' · ')
}

export function InjuryImpactMiniCard({
  leagues,
  selectedLeagueId,
}: {
  leagues: UserLeague[]
  selectedLeagueId: string | null
}) {
  const leagueId = selectedLeagueId ?? ''
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<InjuryImpactDashboardResult | null>(null)

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
      const res = await fetch('/api/ai-tools/injury-impact/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sportFilter,
          leagueId,
          teamContext: 'my_team',
          specificTeamExternalId: null,
          opponentTeamExternalId: null,
          statusFilter: 'all',
          timeHorizon: 'this_week',
          skipAi: true,
          toggles: {
            includePractice: true,
            includeNews: true,
            includeReturnTimelines: true,
            includeHandcuffs: true,
            includePlayoffImpact: true,
            includeDynastyImpact: true,
          },
        }),
      })
      const json = (await res.json()) as InjuryImpactDashboardResult | { ok: false; error?: string }
      if (!res.ok || !json.ok) {
        setData(null)
        setError((json as { error?: string }).error || 'Could not load injury impact')
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
        data-testid="injury-impact-mini-empty"
      >
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
            <ShieldAlert className="h-4 w-4 text-red-300" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#e8eaf6]">Injury Impact</p>
            <p className="text-[11px] text-[#5c6480]">Roster availability risk</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-[#8b93ab]">Import or join a league to see live injury intelligence for your roster.</p>
      </div>
    )
  }

  const riskPct = data?.ok ? Math.round(Math.min(100, Math.max(0, data.overallRisk))) : null

  return (
    <div
      className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0a0f18] to-[#070b12] p-4"
      data-testid="injury-impact-mini-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
            <ShieldAlert className="h-4 w-4 text-red-300" />
          </div>
          <div>
            <p className="text-[14px] font-bold leading-none text-[#e8eaf6]">Injury Impact</p>
            <p className="mt-1 text-[11px] leading-none text-[#5c6480]">Roster availability risk</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#2e3347] bg-[#121725] text-[#9ba3bf] transition hover:border-red-500/35 hover:text-white disabled:opacity-50"
            aria-label="Refresh injury impact"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="mt-3 min-h-[52px]">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-[12px] text-[#5c6480]">
            <Loader2 className="h-4 w-4 animate-spin text-red-400" />
            Scanning roster & injury feed…
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
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-red-300/80">Availability risk</p>
                <p className="text-[26px] font-black tabular-nums leading-none text-white/95">
                  {riskPct != null ? `${riskPct}` : '—'}
                  <span className="text-[14px] font-bold text-white/50">/100</span>
                </p>
              </div>
              <div className="max-w-[200px] text-right">
                <p className="text-[11px] uppercase text-[#5c6480]">This week</p>
                <p className="text-[12px] font-semibold leading-snug text-cyan-100/90">
                  {formatInjuryAvailabilitySummary(data.summaryCounts)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[#5c6480]">
              Updated {new Date(data.computedAt).toLocaleString()}
            </p>
          </>
        ) : (
          <p className="text-[12px] text-[#8b93ab]">Select a league above to load injury intelligence.</p>
        )}
      </div>

      <button
        type="button"
        onClick={openInjuryImpactModal}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-red-500/25 bg-red-500/[0.08] py-2.5 text-[12px] font-semibold text-red-100 transition hover:border-red-400/45 hover:bg-red-500/[0.12]"
        data-testid="injury-impact-mini-open-full"
      >
        Open full injury view
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

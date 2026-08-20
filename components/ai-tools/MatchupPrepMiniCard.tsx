'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, Loader2, RefreshCw, Swords } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
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
  const { t, tInterpolate } = useLanguage()
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
        className="relative overflow-hidden rounded-2xl border border-sky-500/15 bg-gradient-to-br from-[#091522] via-[#091420] to-[#0a1818] p-4"
        data-testid="matchup-prep-mini-empty"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-sky-500/10 blur-2xl"
        />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/35 bg-gradient-to-br from-sky-500/20 to-emerald-500/12 text-sky-200 shadow-[0_0_12px_-4px_rgba(56,189,248,0.5)]">
            <Swords className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-white">{t('dashboard.miniCard.matchup.title')}</p>
            <p className="text-[11px] text-white/50">{t('dashboard.miniCard.matchup.subtitle')}</p>
          </div>
        </div>
        <p className="relative mt-3 text-[12px] text-white/55">Join a league to unlock live matchup intelligence.</p>
      </div>
    )
  }

  const edge = data?.projectedEdge
  const win = data?.winProbability
  const edgeTone =
    edge == null
      ? 'text-white/45'
      : edge > 0
        ? 'text-emerald-300 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]'
        : edge < 0
          ? 'text-rose-300 drop-shadow-[0_0_8px_rgba(244,63,94,0.35)]'
          : 'text-sky-200'

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-sky-500/15 bg-gradient-to-br from-[#091522] via-[#091420] to-[#0a1818] p-4 transition hover:border-sky-400/30 hover:shadow-[0_8px_28px_-12px_rgba(56,189,248,0.4)]"
      data-testid="matchup-prep-mini-card"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-sky-500/10 blur-3xl"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-sky-400/35 bg-gradient-to-br from-sky-500/20 to-emerald-500/12 text-sky-200 shadow-[0_0_12px_-4px_rgba(56,189,248,0.5)]">
            <Swords className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[14px] font-bold leading-none text-white">{t('dashboard.miniCard.matchup.title')}</p>
            <p className="mt-1 text-[11px] leading-none text-white/50">{t('dashboard.miniCard.matchup.subtitle')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition hover:border-sky-400/40 hover:bg-sky-500/10 hover:text-sky-200 disabled:opacity-50"
          aria-label={t('dashboard.miniCard.matchup.refreshAria')}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="relative mt-3 min-h-[64px]">
        {loading && !data ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[12px] text-white/55">
              <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
              {t('dashboard.miniCard.matchup.loading')}
            </div>
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.05]" />
            <div className="h-8 w-1/3 animate-pulse rounded bg-white/[0.05]" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="text-[12px] font-semibold text-amber-200">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1 text-[11px] font-bold text-amber-100/90 underline-offset-2 hover:underline"
            >
              {t('dashboard.miniCard.common.retry')}
            </button>
          </div>
        ) : data?.ok ? (
          <>
            <p className="text-[11px] text-white/55">
              <span className="text-white/85">{tInterpolate('dashboard.miniCard.matchup.vsOpponent', { name: data.oppTeamName ?? t('dashboard.miniCard.matchup.opponentFallback') })}</span>
              {data.degraded ? (
                <span className="ml-1.5 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-200">
                  {t('dashboard.miniCard.common.partial')}
                </span>
              ) : (
                <span className="ml-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300">
                  {t('dashboard.miniCard.common.live')}
                </span>
              )}
            </p>
            <div className="mt-2.5 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.08] via-transparent to-emerald-500/[0.05] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider text-sky-300/80">{t('dashboard.miniCard.matchup.projEdge')}</p>
                <p className={`text-[28px] font-black tabular-nums leading-none ${edgeTone}`}>
                  {edge != null ? `${edge > 0 ? '+' : ''}${edge.toFixed(1)}` : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-white/45">{t('dashboard.miniCard.matchup.winChance')}</p>
                <p className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/8 px-2 py-0.5 text-[16px] font-black tabular-nums text-emerald-200 drop-shadow-[0_0_8px_rgba(52,211,153,0.35)]">
                  {win != null ? `${win}%` : '—'}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-white/35">{tInterpolate('dashboard.miniCard.common.updated', { when: new Date(data.computedAt).toLocaleString() })}</p>
          </>
        ) : (
          <p className="text-[12px] text-white/55">{t('dashboard.miniCard.matchup.selectLeague')}</p>
        )}
      </div>

      <button
        type="button"
        onClick={openMatchupPrepModal}
        className="relative mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-sky-400/30 bg-gradient-to-r from-sky-500/15 to-emerald-500/12 py-2.5 text-[12px] font-bold text-sky-100 transition hover:border-sky-400/50 hover:from-sky-500/22 hover:to-emerald-500/18"
        data-testid="matchup-prep-mini-open-full"
      >
        {t('dashboard.miniCard.matchup.openFull')}
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

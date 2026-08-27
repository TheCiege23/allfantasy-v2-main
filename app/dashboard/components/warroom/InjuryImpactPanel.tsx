'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, HeartPulse, RefreshCw, ShieldCheck } from 'lucide-react'
import type { UserLeague } from '../../types'
import type { InjuryImpactDashboardResult, InjuryPlayerIntelRow } from '@/lib/injury-impact-dashboard/types'
import { WarRoomCard } from './WarRoomCard'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

/** Concerning severities worth surfacing for a starter (probable/other are noise for this panel). */
const CONCERN = new Set(['out', 'ir', 'doubtful', 'questionable', 'gtd', 'suspended'])

const SEVERITY_STYLE: Record<string, string> = {
  out: 'bg-red-500/15 text-red-300',
  ir: 'bg-red-500/15 text-red-300',
  suspended: 'bg-red-500/15 text-red-300',
  doubtful: 'bg-orange-500/15 text-orange-300',
  questionable: 'bg-amber-500/15 text-amber-300',
  gtd: 'bg-amber-500/15 text-amber-300',
  probable: 'bg-white/[0.06] text-white/50',
  other: 'bg-white/[0.06] text-white/50',
}

function SummaryChip({ label, count, tone }: { label: string; count: number; tone: string }) {
  if (count <= 0) return null
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>
      <span className="tabular-nums">{count}</span>
      <span className="uppercase tracking-wide opacity-80">{label}</span>
    </span>
  )
}

/**
 * Dashboard V2 Phase 3.2 — Injury Impact (Monitor + Explain). Adapts the existing injury-impact
 * engine (POST /api/ai-tools/injury-impact/dashboard, the same source InjuryImpactMiniCard uses) into
 * a Team-context panel: severity chips from the real summary counts, and the most impactful affected
 * starters with a real impact bar and their real status/news as the "why". No gauges, no fabricated
 * numbers — every value comes from the engine; honest empty/degraded states where data is missing.
 */
export function InjuryImpactPanel({ league }: { league: UserLeague }) {
  const { t, tInterpolate } = useLanguage()
  const [data, setData] = useState<InjuryImpactDashboardResult | null>(null)
  const [ready, setReady] = useState(false)

  const sportKey = league.sport ? String(league.sport).toUpperCase() : 'ALL'

  // Extracted from the mount effect so the refresh below can re-read the panel
  // without duplicating the request body.
  const fetchImpact = useCallback(async (): Promise<InjuryImpactDashboardResult | null> => {
    const r = await fetch('/api/ai-tools/injury-impact/dashboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sportFilter: sportKey,
        leagueId: league.id,
        teamContext: 'my_team',
        statusFilter: 'all',
        timeHorizon: 'this_week',
        skipAi: true,
        toggles: {
          includePractice: true,
          includeNews: true,
          includeReturnTimelines: true,
          includeHandcuffs: false,
          includePlayoffImpact: false,
          includeDynastyImpact: false,
        },
      }),
    })
    if (!r.ok) return null
    const json = (await r.json()) as InjuryImpactDashboardResult | { ok: false }
    return (json as InjuryImpactDashboardResult).ok ? (json as InjuryImpactDashboardResult) : null
  }, [league.id, sportKey])

  useEffect(() => {
    let cancelled = false
    setReady(false)
    void fetchImpact()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [fetchImpact])

  const affectedStarters = useMemo<InjuryPlayerIntelRow[]>(() => {
    if (!data) return []
    return data.players
      .filter((p) => p.isStarter && CONCERN.has(p.severity))
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, 5)
  }, [data])

  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)

  /**
   * Search X for fresh reports on the starters shown, then re-read the panel.
   *
   * Scoped to exactly the players on screen — which is at most 5, the same cap
   * the endpoint enforces. That is deliberate: each player searched costs real
   * money, so the button never asks about anyone the user cannot currently see.
   */
  const onRefresh = useCallback(async () => {
    if (refreshing || affectedStarters.length === 0) return
    setRefreshing(true)
    setRefreshNote(null)
    try {
      const res = await fetch('/api/injury-news/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport: sportKey, players: affectedStarters.map((p) => p.name) }),
      })
      const json = res.ok ? await res.json() : null
      if (!json?.ok) {
        // Covers 401, 429 and a disabled spend switch alike: the panel keeps
        // showing what it already had rather than emptying itself.
        setRefreshNote(t('dashboard.warroom.injury.refreshFailed'))
        return
      }
      const found = Number(json.refresh?.newRecords ?? 0)
      setRefreshNote(
        found > 0
          ? tInterpolate('dashboard.warroom.injury.refreshFound', { n: found })
          : t('dashboard.warroom.injury.refreshNone'),
      )
      // Only re-read when something actually landed. Re-fetching after a
      // confirmed "no news" is latency that cannot change what is on screen.
      if (found > 0) setData(await fetchImpact())
    } catch {
      setRefreshNote(t('dashboard.warroom.injury.refreshFailed'))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, affectedStarters, sportKey, t, tInterpolate, fetchImpact])

  if (!ready) {
    return (
      <WarRoomCard className="h-[120px] animate-pulse" accentBorder="rgba(248,113,113,0.1)">
        <span className="sr-only">{t('dashboard.warroom.injury.title')}</span>
      </WarRoomCard>
    )
  }

  const counts = data?.summaryCounts
  const anyConcern = counts ? counts.outIr + counts.doubtful + counts.questionable > 0 : false

  return (
    <WarRoomCard className="overflow-hidden" accentBorder="rgba(248,113,113,0.18)">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-red-300/80">
          <HeartPulse className="h-3 w-3" aria-hidden />
          {t('dashboard.warroom.injury.title')}
        </p>
        {counts ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <SummaryChip label={t('dashboard.warroom.injury.out')} count={counts.outIr} tone="bg-red-500/15 text-red-300" />
            <SummaryChip label={t('dashboard.warroom.injury.doubtful')} count={counts.doubtful} tone="bg-orange-500/15 text-orange-300" />
            <SummaryChip label={t('dashboard.warroom.injury.questionable')} count={counts.questionable} tone="bg-amber-500/15 text-amber-300" />
          </div>
        ) : null}
      </div>

      {affectedStarters.length > 0 ? (
        <ul>
          {affectedStarters.map((p) => {
            const impact = Math.max(0, Math.min(100, Math.round(p.impactScore)))
            const why = p.injuryNewsSummary || p.freshnessNote || p.statusRaw
            return (
              <li key={p.playerKey} className="border-b border-white/[0.04] px-4 py-2.5 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[12px] font-semibold text-white/90">
                    {p.name} <span className="text-white/35">· {p.position} · {p.team}</span>
                  </p>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[p.severity] ?? SEVERITY_STYLE.other}`}>
                    {p.statusRaw || p.severity}
                  </span>
                </div>
                {/* Impact bar — real impactScore, not a gauge. */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-400 to-red-400"
                      style={{ width: `${impact}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-white/40">
                    {tInterpolate('dashboard.warroom.injury.impact', { n: impact })}
                  </span>
                </div>
                {/* Explain — the real status/news, no fabricated reasoning. */}
                {why ? <p className="mt-1 truncate text-[10px] text-white/40">{why}</p> : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="flex items-center gap-2 px-4 py-4 text-[12px] text-emerald-300/80">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
          {anyConcern
            ? t('dashboard.warroom.injury.emptyBench')
            : t('dashboard.warroom.injury.emptyClean')}
        </div>
      )}

      {/* Only offered when there is someone to ask about — a button that can
          only ever spend money on an empty list is worse than no button. */}
      {affectedStarters.length > 0 ? (
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.04] px-4 py-2">
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/60 transition hover:bg-white/[0.1] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
            {refreshing
              ? t('dashboard.warroom.injury.refreshing')
              : t('dashboard.warroom.injury.refresh')}
          </button>
          {refreshNote ? (
            <span aria-live="polite" className="truncate text-[10px] text-white/40">
              {refreshNote}
            </span>
          ) : null}
        </div>
      ) : null}

      {data?.degraded ? (
        <p className="flex items-center gap-1.5 border-t border-white/[0.04] px-4 py-2 text-[10px] text-white/30">
          <Activity className="h-3 w-3" aria-hidden />
          {t('dashboard.warroom.injury.degraded')}
        </p>
      ) : null}
    </WarRoomCard>
  )
}

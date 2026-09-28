'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Compass, Loader2, Sparkles } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { AIToolModalShell } from '../AIToolModalShell'
import { currentPathForReturn, readPlanRefusal, type PlanRefusal } from '@/lib/monetization/planRefusal'
import { getChimmyChatHrefWithPrompt } from '@/lib/ai-product-layer/UnifiedChimmyEntryResolver'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import type { LongTermCoachingAnalysis } from '@/lib/long-term-coaching/types'
import { useEntitlement } from '@/hooks/useEntitlement'
import { FeatureGate } from '@/components/subscription/FeatureGate'

type SportFilter = 'ALL' | (typeof SUPPORTED_SPORTS)[number]

const HORIZONS = [2, 3, 4, 5] as const
const MODES: { id: 'auto' | 'compete_now' | 'soft_rebuild' | 'full_rebuild'; label: string }[] = [
  { id: 'auto', label: 'Auto (data-driven)' },
  { id: 'compete_now', label: 'Compete now' },
  { id: 'soft_rebuild', label: 'Soft rebuild' },
  { id: 'full_rebuild', label: 'Full rebuild' },
]

export function LongTermCoachingModal({
  open,
  onClose,
  leagues,
  initialLeagueId = '',
  initialSport = 'ALL',
}: {
  open: boolean
  onClose: () => void
  leagues: UserLeague[]
  initialLeagueId?: string
  initialSport?: string
}) {
  const { featureAccess: coachingUnlocked, loading: entitlementLoading } = useEntitlement('league_ai_coaching')
  const [sportFilter, setSportFilter] = useState<SportFilter>('ALL')
  const [leagueId, setLeagueId] = useState('')
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(3)
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('auto')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<PlanRefusal | null>(null)
  const [data, setData] = useState<LongTermCoachingAnalysis | null>(null)
  const [narrative, setNarrative] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const s = (initialSport || 'ALL').toUpperCase()
    if (s === 'ALL') setSportFilter('ALL')
    else if (SUPPORTED_SPORTS.includes(s as (typeof SUPPORTED_SPORTS)[number])) {
      setSportFilter(s as SportFilter)
    }
    if (initialLeagueId && leagues.some((l) => l.id === initialLeagueId)) {
      setLeagueId(initialLeagueId)
    }
  }, [open, initialLeagueId, initialSport, leagues])

  const filteredLeagues = useMemo(() => {
    if (sportFilter === 'ALL') return leagues
    return leagues.filter((l) => String(l.sport).toUpperCase() === sportFilter)
  }, [leagues, sportFilter])

  const run = useCallback(async () => {
    if (!leagueId) {
      setError('Select a league.')
      return
    }
    setLoading(true)
    setError(null)
    setRefusal(null)
    setData(null)
    setNarrative(null)
    try {
      const res = await fetch('/api/ai-tools/long-term-coaching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          horizonYears: horizon,
          strategyMode: mode,
          teamExternalId: null,
          skipAi: false,
        }),
      })
      const json = (await res.json()) as
        | { ok: true; analysis: LongTermCoachingAnalysis; aiNarrative: string | null }
        | { ok?: false; error?: string; message?: string; code?: string; upgradePath?: string }
      if (res.status === 403) {
        setRefusal(readPlanRefusal(res.status, json, { returnTo: currentPathForReturn() }))
        setError(
          json && typeof json === 'object' && 'message' in json && typeof json.message === 'string'
            ? json.message
            : 'League AI Coaching requires AF Pro. Upgrade to continue.',
        )
        return
      }
      if (!res.ok || !json || !('ok' in json) || json.ok !== true || !json.analysis) {
        setRefusal(readPlanRefusal(res.status, json, { returnTo: currentPathForReturn() }))
        setError((json as { error?: string }).error ?? 'Request failed')
        return
      }
      setData(json.analysis)
      setNarrative(json.aiNarrative ?? null)
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }, [leagueId, horizon, mode])

  const fmt = useMemo(() => {
    if (!data) return null
    return {
      cls: data.signals.strategyClass.replace(/_/g, ' '),
      dir: data.plan.recommendedDirection.replace(/_/g, ' '),
    }
  }, [data])

  return (
    <AIToolModalShell
      open={open}
      onClose={onClose}
      title="Long-Term Coach"
      subtitle="Dynasty · Devy · C2C · Keeper — grounded multi-year plan"
      accentColor="violet"
      icon={<Compass className="h-5 w-5 text-violet-300" aria-hidden />}
      wide
      loading={loading && !data}
      error={error}
      refusal={refusal}
      empty={!loading && !data && !error}
      emptyMessage="Choose a league and horizon, then run analysis."
      chimmyPrompt={
        data
          ? `Explain my ${horizon}-year dynasty plan for league ${data.leagueContext.leagueName ?? ''}. Strategy class: ${data.signals.strategyClass}.`
          : undefined
      }
      chimmyContext={data ? { tool: 'long_term_coaching', leagueId: data.leagueId } : undefined}
      actions={
        entitlementLoading || !coachingUnlocked ? null : (
          <button
            type="button"
            onClick={run}
            disabled={loading || !leagueId}
            className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/15 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:bg-violet-500/25 disabled:opacity-40"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Run coach
          </button>
        )
      }
    >
      <FeatureGate
        featureId="league_ai_coaching"
        featureNameOverride="Long-Term Coach"
        className="border-0 bg-transparent p-0"
        showTokenFallback={false}
      >
        <div className="space-y-4 text-[13px] leading-relaxed text-white/85">
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-xs text-white/90"
            value={sportFilter}
            onChange={(e) => setSportFilter(e.target.value as SportFilter)}
            aria-label="Sport filter"
          >
            <option value="ALL">All sports</option>
            {SUPPORTED_SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="min-w-[200px] rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-xs text-white/90"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
            aria-label="League"
          >
            <option value="">Select league…</option>
            {filteredLeagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.sport}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-xs text-white/90"
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value) as (typeof HORIZONS)[number])}
            aria-label="Horizon years"
          >
            {HORIZONS.map((h) => (
              <option key={h} value={h}>
                {h} years
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-white/10 bg-[#0a1220] px-3 py-2 text-xs text-white/90"
            value={mode}
            onChange={(e) => setMode(e.target.value as (typeof MODES)[number]['id'])}
            aria-label="Strategy mode"
          >
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {data?.formatWarning ? (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/95">
            {data.formatWarning}
          </p>
        ) : null}

        {data ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Classification</p>
                <p className="mt-1 text-sm font-bold capitalize text-white">{fmt?.cls}</p>
                <p className="text-[11px] text-white/55">Direction: {fmt?.dir}</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Short-term index</p>
                <p className="mt-1 text-lg font-bold text-emerald-200/95">
                  {data.signals.shortTermStrengthIndex.toFixed(0)}
                </p>
                <p className="text-[11px] text-white/55">Starter projections (normalized)</p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Long-term assets</p>
                <p className="mt-1 text-lg font-bold text-sky-200/95">{data.signals.longTermAssetIndex.toFixed(0)}</p>
                <p className="text-[11px] text-white/55">
                  Dynasty DB coverage {(data.signals.dynastyValueCoverageRatio * 100).toFixed(0)}%
                </p>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">Pick capital</p>
                <p className="mt-1 text-lg font-bold text-violet-200/95">{data.signals.pickCapitalScore.toFixed(0)}</p>
                <p className="text-[11px] text-white/55">From synced future picks</p>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarRange className="h-4 w-4 text-violet-300" aria-hidden />
                Year-by-year outlook
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.yearOutlooks.map((y) => (
                  <div key={y.labelYear} className="rounded-lg border border-white/[0.06] bg-[#040915] p-3">
                    <p className="text-[11px] font-bold text-white">{y.labelYear}</p>
                    <p className="mt-1 text-lg font-semibold text-white/90">{y.projectedTeamStrengthIndex.toFixed(0)}</p>
                    <p className="text-[10px] uppercase text-white/45">{y.contentionBand} · {y.confidence} conf.</p>
                    <ul className="mt-2 list-disc pl-4 text-[11px] text-white/60">
                      {y.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-4">
              <p className="text-sm font-semibold text-white">Plan priorities</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-white/70">
                {data.plan.topPriorities.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-4">
                <p className="text-sm font-semibold text-emerald-200/90">Hold / build around</p>
                <ul className="mt-2 space-y-2 text-[12px] text-white/70">
                  {data.plan.playersToHold.slice(0, 5).map((p) => (
                    <li key={p.playerId}>
                      <span className="font-medium text-white/85">{p.name ?? p.playerId}</span> — {p.rationale}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-4">
                <p className="text-sm font-semibold text-amber-200/90">Sell candidates (contextual)</p>
                <ul className="mt-2 space-y-2 text-[12px] text-white/70">
                  {data.plan.playersToSell.length === 0 ? (
                    <li className="text-white/50">No clear sell signals from current data split.</li>
                  ) : (
                    data.plan.playersToSell.slice(0, 6).map((p) => (
                      <li key={p.playerId}>
                        <span className="font-medium text-white/85">{p.name ?? p.playerId}</span> — {p.rationale}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.08] bg-[#070d18] p-4">
              <p className="text-sm font-semibold text-white">Methodology (auditable)</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-white/55">
                {data.methodologyNotes.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>

            {narrative ? (
              <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.07] p-4">
                <p className="text-sm font-semibold text-violet-100">AI coach narrative</p>
                <div className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-white/80">{narrative}</div>
                <a
                  href={getChimmyChatHrefWithPrompt(
                    `Follow up on my long-term plan for ${data.leagueContext.leagueName ?? 'my league'}`,
                    { source: 'long_term_coaching' },
                  )}
                  className="mt-3 inline-flex text-xs font-semibold text-violet-300 underline-offset-2 hover:underline"
                >
                  Continue in Chimmy →
                </a>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      </FeatureGate>
    </AIToolModalShell>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronDown, GitCompare, Loader2, Sparkles } from 'lucide-react'
import { SUPPORTED_SPORTS, DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope'
import type { AiPlayerComparisonStrategyMode } from '@/lib/ai-player-comparison/types'
import { useAiPlayerComparison } from '@/hooks/useAiPlayerComparison'
import { trackPlayerComparisonUsage } from '@/lib/analytics/player-comparison-analytics'
import { cn } from '@/lib/utils'

const SCORING_OPTIONS = [
  { value: 'ppr', label: 'Full PPR' },
  { value: 'half_ppr', label: 'Half PPR' },
  { value: 'non_ppr', label: 'Non-PPR' },
] as const

const FORMAT_OPTIONS = [
  { value: 'redraft', label: 'Redraft' },
  { value: 'keeper', label: 'Keeper' },
  { value: 'dynasty', label: 'Dynasty' },
] as const

const SLOT_OPTIONS = [
  { value: 'FLEX', label: 'FLEX' },
  { value: 'RB', label: 'RB' },
  { value: 'WR', label: 'WR' },
  { value: 'TE', label: 'TE' },
  { value: 'SUPERFLEX', label: 'Superflex' },
  { value: 'QB', label: 'QB' },
  { value: 'BENCH', label: 'Bench' },
  { value: 'OTHER', label: 'Other' },
] as const

const STRATEGY_OPTIONS: { value: AiPlayerComparisonStrategyMode; label: string }[] = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'need_upside', label: 'Need upside' },
  { value: 'need_floor', label: 'Need floor' },
  { value: 'need_safety', label: 'Need safety' },
  { value: 'underdog', label: 'Underdog' },
  { value: 'favored', label: 'Favored' },
]

export function PlayerDecisionTool() {
  const sp = useSearchParams()
  const params = useMemo(() => sp ?? new URLSearchParams(), [sp])
  const { data, loading, error, run, reset } = useAiPlayerComparison()

  const [playerA, setPlayerA] = useState('')
  const [playerB, setPlayerB] = useState('')
  const [sport, setSport] = useState(DEFAULT_SPORT)
  const [scoring, setScoring] = useState<string>('ppr')
  const [format, setFormat] = useState<string>('redraft')
  const [slot, setSlot] = useState<string>('FLEX')
  const [strategy, setStrategy] = useState<AiPlayerComparisonStrategyMode>('balanced')
  const [includeAi, setIncludeAi] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)

  useEffect(() => {
    const a = params.get('playerA')?.trim()
    const b = params.get('playerB')?.trim()
    const s = normalizeToSupportedSport(params.get('sport')) ?? DEFAULT_SPORT
    const st = params.get('strategyMode')?.trim()
    if (a) setPlayerA(a)
    if (b) setPlayerB(b)
    setSport(s)
    if (st && STRATEGY_OPTIONS.some((o) => o.value === st)) {
      setStrategy(st as AiPlayerComparisonStrategyMode)
    }
    trackPlayerComparisonUsage({
      event: 'player_comparison_open_tool',
      meta: { source: 'player_decision_page' },
    })
  }, [params])

  const leagueContext = useMemo(() => {
    const leagueId = params.get('leagueId')
    const teamId = params.get('teamId')
    const weekRaw = params.get('week')
    const week = weekRaw ? Number(weekRaw) : null
    return {
      leagueId: leagueId || null,
      teamId: teamId || null,
      week: Number.isFinite(week) ? week : null,
      format: format as 'redraft' | 'keeper' | 'dynasty',
    }
  }, [params, format])

  const onSubmit = useCallback(async () => {
    reset()
    const result = await run({
      playerA: playerA.trim(),
      playerB: playerB.trim(),
      sport,
      scoringFormat: scoring,
      lineupSlot: slot,
      strategyMode: strategy,
      leagueContext,
      includeAiNarrative: includeAi,
    })
    if (result) {
      trackPlayerComparisonUsage({
        event: 'player_comparison_run',
        meta: {
          sport,
          strategyMode: strategy,
          slot,
          recommended: result.recommendedPlayer,
        },
      })
    }
  }, [run, reset, playerA, playerB, sport, scoring, slot, strategy, leagueContext, includeAi])

  const catList = data
    ? Object.values(data.categories)
    : []

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          AI Start A vs B
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Player decision engine</h1>
        <p className="max-w-2xl text-sm text-white/60">
          Deterministic projections, matchup, usage, and risk signals — with an optional AI explanation layer that
          narrates the numbers (never overrides them).
        </p>
      </header>

      <section className="rounded-2xl border border-white/10 bg-[#0a1228]/90 p-4 shadow-xl sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Player A</span>
            <input
              value={playerA}
              onChange={(e) => setPlayerA(e.target.value)}
              placeholder={"e.g. Ja'Marr Chase"}
              className="w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/40 focus:outline-none"
              data-testid="player-decision-input-a"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Player B</span>
            <input
              value={playerB}
              onChange={(e) => setPlayerB(e.target.value)}
              placeholder="e.g. Amon-Ra St. Brown"
              className="w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-cyan-400/40 focus:outline-none"
              data-testid="player-decision-input-b"
            />
          </label>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Sport</span>
            <div className="relative">
              <select
                value={sport}
                onChange={(e) => setSport(normalizeToSupportedSport(e.target.value))}
                className="w-full appearance-none rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 pr-9 text-sm text-white focus:border-cyan-400/40 focus:outline-none"
                data-testid="player-decision-sport"
              >
                {SUPPORTED_SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            </div>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Scoring</span>
            <select
              value={scoring}
              onChange={(e) => setScoring(e.target.value)}
              className="w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-sm text-white focus:border-cyan-400/40 focus:outline-none"
              data-testid="player-decision-scoring"
            >
              {SCORING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">League format</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-sm text-white focus:border-cyan-400/40 focus:outline-none"
            >
              {FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Lineup slot</span>
            <select
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-sm text-white focus:border-cyan-400/40 focus:outline-none"
              data-testid="player-decision-slot"
            >
              {SLOT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">Scenario</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as AiPlayerComparisonStrategyMode)}
              className="w-full rounded-xl border border-white/12 bg-[#040915] px-3 py-2.5 text-sm text-white focus:border-cyan-400/40 focus:outline-none"
              data-testid="player-decision-strategy"
            >
              {STRATEGY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-end gap-2 pb-1">
            <input
              type="checkbox"
              checked={includeAi}
              onChange={(e) => setIncludeAi(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-transparent"
            />
            <span className="text-sm text-white/75">Include AI narrative (Pro / gated)</span>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={loading || !playerA.trim() || !playerB.trim()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-5 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25 disabled:opacity-40"
            data-testid="player-decision-run"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
            Compare
          </button>
          <Link
            href="/chimmy/chat"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 px-4 py-2.5 text-sm text-white/75 hover:bg-white/5"
          >
            Ask Chimmy
          </Link>
        </div>
        {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
      </section>

      {data && (
        <section className="space-y-4" data-testid="player-decision-results">
          <div
            className={cn(
              'rounded-2xl border px-4 py-4 sm:px-6',
              data.recommendedSide === 'tie'
                ? 'border-amber-400/35 bg-amber-500/10'
                : 'border-emerald-400/35 bg-emerald-500/10'
            )}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-white/50">Verdict</p>
            <p className="mt-1 text-lg font-semibold text-white">{data.verdict}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs text-white/80">
                Confidence {data.confidencePct}%
              </span>
              <div className="h-2 flex-1 min-w-[120px] max-w-xs overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500/80 to-emerald-400/90"
                  style={{ width: `${data.confidencePct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {[data.playerA, data.playerB].map((p, i) => (
              <div
                key={p.name}
                className={cn(
                  'rounded-2xl border p-4',
                  data.recommendedPlayer === p.name
                    ? 'border-cyan-400/40 bg-cyan-500/10'
                    : 'border-white/10 bg-[#0a1228]/80'
                )}
                data-testid={`player-decision-card-${i}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white/45">
                      {i === 0 ? 'Player A' : 'Player B'}
                    </p>
                    <p className="text-lg font-semibold text-white">{p.name}</p>
                    <p className="text-xs text-white/55">
                      {p.position ?? '—'} · {p.team ?? '—'}
                    </p>
                  </div>
                  {data.recommendedPlayer === p.name && (
                    <span className="rounded-md border border-cyan-400/40 bg-black/30 px-2 py-0.5 text-[11px] font-semibold uppercase text-cyan-200">
                      Lean
                    </span>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-white/45">Proj pts</dt>
                    <dd className="font-medium tabular-nums text-white">{p.projectedPoints?.toFixed(1) ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-white/45">Rank</dt>
                    <dd className="font-medium tabular-nums text-white">{p.rank ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-white/45">Volatility</dt>
                    <dd className="font-medium tabular-nums text-white">{p.volatility?.toFixed(2) ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-white/45">Injury risk</dt>
                    <dd className="font-medium tabular-nums text-white">{p.injuryRisk?.toFixed(1) ?? '—'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#0a1228]/80 overflow-hidden">
            <div className="border-b border-white/10 px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Category battle</h2>
              <p className="text-xs text-white/50">Head-to-head on deterministic signals</p>
            </div>
            <div className="divide-y divide-white/8">
              {catList.map((row) => (
                <div key={row.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">{row.label}</p>
                    <p className="text-xs text-white/55">{row.detail}</p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold',
                      row.winner === 'tie'
                        ? 'border-amber-400/35 text-amber-100'
                        : 'border-cyan-400/35 text-cyan-100'
                    )}
                  >
                    {row.winner === 'tie' ? 'Even' : row.winner === 'playerA' ? data.playerA.name : data.playerB.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-[#060d1e] p-4">
            <h3 className="text-sm font-semibold text-white">Scenario tips</h3>
            <ul className="mt-2 space-y-2 text-xs text-white/70">
              <li>
                <span className="text-cyan-300/90">Upside: </span>
                {data.scenarioAdvice.needUpside}
              </li>
              <li>
                <span className="text-cyan-300/90">Floor: </span>
                {data.scenarioAdvice.needFloor}
              </li>
              <li>
                <span className="text-cyan-300/90">Safety: </span>
                {data.scenarioAdvice.needSafety}
              </li>
              <li>
                <span className="text-cyan-300/90">Favorite: </span>
                {data.scenarioAdvice.favored}
              </li>
              <li>
                <span className="text-cyan-300/90">Underdog: </span>
                {data.scenarioAdvice.underdog}
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-white/12 bg-black/25 px-4 py-3 text-left text-sm text-white hover:bg-white/5"
            data-testid="player-decision-why-toggle"
          >
            <span>Why this call? ({data.narrativeSource === 'ai' ? 'AI + data' : 'Data-first'})</span>
            <ChevronDown className={cn('h-4 w-4 transition', whyOpen && 'rotate-180')} />
          </button>
          {whyOpen && (
            <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/80">
              <p className="text-xs uppercase tracking-wide text-white/45">Summary</p>
              <p className="mt-1">{data.summary}</p>
              <ul className="mt-3 list-inside list-disc space-y-1 text-xs text-white/70">
                {data.reasoningBullets.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs uppercase tracking-wide text-white/45">Narrative</p>
              <p className="mt-1 text-sm">{data.narrative}</p>
              {data.riskNotes.length > 0 && (
                <>
                  <p className="mt-3 text-xs uppercase tracking-wide text-amber-300/80">Risk notes</p>
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-100/90">
                    {data.riskNotes.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-3 text-[11px] text-white/40">Sources: {data.dataSources.join(', ')}</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

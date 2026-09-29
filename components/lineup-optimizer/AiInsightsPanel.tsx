'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Trophy, Flame, Shield, Sparkles } from 'lucide-react'
import type { DecisionEngineJson } from './types'

function Callout({
  title,
  value,
  sub,
  icon: Icon,
}: {
  title: string
  value: string
  sub?: string
  icon: typeof Trophy
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">
        <Icon className="h-3.5 w-3.5 text-cyan-300/80" aria-hidden />
        {title}
      </div>
      <p className="mt-1 font-medium text-white">{value}</p>
      {sub ? <p className="text-xs text-white/50">{sub}</p> : null}
    </div>
  )
}

export function AiInsightsPanel({
  engine,
  aiConfidencePct,
  loading,
}: {
  engine: DecisionEngineJson | null
  aiConfidencePct: number
  loading: boolean
}) {
  const [deep, setDeep] = useState(false)

  if (loading) {
    return (
      <div className="animate-pulse space-y-3 rounded-2xl border border-white/10 bg-[#0a1228]/80 p-4">
        <div className="h-6 w-2/3 rounded bg-white/10" />
        <div className="h-24 rounded bg-white/5" />
        <div className="h-20 rounded bg-white/5" />
      </div>
    )
  }

  if (!engine) {
    return (
      <div className="rounded-2xl border border-dashed border-white/15 bg-[#0a1228]/40 p-6 text-center text-sm text-white/55">
        Run <span className="text-cyan-200">Optimize Lineup</span> to generate AI insights, start/sit callouts, and
        explanations.
      </div>
    )
  }

  const lineup = engine.optimizedLineup
  const best =
    lineup.length > 0
      ? lineup.reduce((a, b) => (a.weeklyStartScore >= b.weeklyStartScore ? a : b), lineup[0])
      : null
  const riskiest =
    lineup.length > 0
      ? lineup.reduce((a, b) => (a.volatilityScore >= b.volatilityScore ? a : b), lineup[0])
      : null
  const bestBench = engine.benchDecisions[0]

  const calls = engine.startSitCalls.slice(0, 4)

  return (
    <div className="space-y-4" data-testid="lineup-optimizer-ai-insights">
      <div className="rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-cyan-500/10 to-transparent p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-200/80">Lineup summary</p>
            <p className="text-lg font-semibold text-white">{engine.lineupMode}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-white/45">AI confidence</p>
            <p className="text-xl font-semibold tabular-nums text-cyan-200">{aiConfidencePct}%</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-white/75">{engine.teamContext.strategyRecommendation}</p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Callout
          title="Best start"
          value={best?.playerName ?? '—'}
          sub="Highest Weekly Start Score"
          icon={Trophy}
        />
        <Callout title="Riskiest start" value={riskiest?.playerName ?? '—'} sub="Volatility spotlight" icon={Flame} />
        <Callout
          title="Best bench option"
          value={bestBench?.playerName ?? '—'}
          sub={bestBench ? `Swap priority ${bestBench.swapPriority}` : undefined}
          icon={Shield}
        />
        <Callout
          title="Upside play"
          value={
            lineup.length
              ? lineup.reduce((a, b) => (a.ceilingScore >= b.ceilingScore ? a : b), lineup[0])?.playerName ?? '—'
              : '—'
          }
          sub="Ceiling lean"
          icon={Sparkles}
        />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">Key start / sit calls</h3>
        <ul className="space-y-2">
          {calls.map((c, idx) => (
            <li
              key={`${c.slot}-${idx}`}
              className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-emerald-200">{c.startPlayer}</span>
                <span className="text-white/35">vs</span>
                <span className="font-medium text-white/70">{c.sitPlayer}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase text-white/55">
                  {c.edgeType}
                </span>
                <span className="text-cyan-200/90">{Math.round(c.confidence)}% conf</span>
              </div>
              <p className="mt-2 text-xs text-white/55">{c.explanation}</p>
              {deep ? (
                <p className="mt-2 border-t border-white/10 pt-2 text-xs text-white/40">
                  Tie-breakers respect your learned preferences only when projections are within a close band.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setDeep((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-cyan-300 hover:text-cyan-200"
          data-testid="lineup-optimizer-deep-analysis-toggle"
        >
          {deep ? (
            <>
              <ChevronUp className="h-4 w-4" />
              Hide deep analysis
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4" />
              Show deep analysis
            </>
          )}
        </button>
      </div>
    </div>
  )
}

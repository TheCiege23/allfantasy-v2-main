'use client'

import { Brain, Loader2, Sparkles } from 'lucide-react'
import type { LeagueMatchupAiResult } from '@/lib/ai-matchup-engine/types'

export function MatchupAiAnalysisPanel({
  sport,
  loading,
  result,
  error,
  onRun,
}: {
  sport: string
  loading: boolean
  result: LeagueMatchupAiResult | null
  error: string | null
  onRun: () => void
}) {
  return (
    <div className="rounded-2xl border border-brand-decision/20 bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-300/90" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">AI matchup breakdown</h3>
          <span className="text-[10px] text-muted">{sport}</span>
        </div>
        <button
          type="button"
          data-testid="matchup-ai-run"
          disabled={loading}
          onClick={onRun}
          className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/35 bg-violet-500/15 px-3 py-1.5 text-[11px] font-semibold text-violet-100/95 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {loading ? 'Analyzing…' : 'Run AI analysis'}
        </button>
      </div>

      {error ? <p className="mt-2 text-[12px] text-red-200/90">{error}</p> : null}

      {result ? (
        <div className="mt-3 space-y-2 text-[12px] leading-snug text-secondary">
          <p>
            <span className="font-semibold text-violet-200/90">Summary: </span>
            {result.summary}
          </p>
          <p>
            <span className="font-semibold text-violet-200/90">Edge: </span>
            {result.edge.headline}{' '}
            <span className="text-muted">
              ({result.edge.side === 'left' ? 'you' : result.edge.side === 'right' ? 'opp' : 'toss-up'} ·{' '}
              {result.edge.confidencePct}%)
            </span>
          </p>
          <p>
            <span className="font-semibold text-violet-200/90">Upset watch: </span>
            {(result.upsetProbability * 100).toFixed(0)}% implied upset range vs projections
          </p>
          {result.keyPlayers.length > 0 ? (
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-secondary">
              {result.keyPlayers.map((k, i) => (
                <li key={i}>
                  <span className="font-medium text-primary">{k.name}</span> - {k.note}
                </li>
              ))}
            </ul>
          ) : null}
          {result.xFactors.length > 0 ? (
            <div>
              <span className="font-semibold text-violet-200/90">X-factors: </span>
              <ul className="mt-1 list-disc pl-4 text-[11px]">
                {result.xFactors.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p>
            <span className="font-semibold text-emerald-200/85">If you need floor → </span>
            {result.scenarios.ifNeedFloor}
          </p>
          <p>
            <span className="font-semibold text-amber-200/85">If you need upside → </span>
            {result.scenarios.ifNeedUpside}
          </p>
          <p className="text-[10px] text-muted">{result.winProbabilityNotes}</p>
          <p className="text-[10px] text-muted">
            Providers: OA {result.providers.openai} · DS {result.providers.deepseek} · Grok {result.providers.grok}.{' '}
            {result.dataNotes}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-muted">
          Uses DeepSeek + Grok (xAI) + OpenAI on server - grounded in your lineup and scoring context.
        </p>
      )}
    </div>
  )
}

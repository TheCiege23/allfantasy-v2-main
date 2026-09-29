'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Bot, AlertTriangle, Info, MessageCircle, RefreshCw } from 'lucide-react'
import { useAIDraftAssistant, type FetchSuggestionParams } from '@/hooks/useAIDraftAssistant'
import { buildAskChimmyAboutPickPrompt, getDraftAIChatUrl } from '@/lib/draft-room/DraftToAIContextBridge'

export interface AIDraftAssistantPanelProps {
  /** When non-null, fetch suggestion for this pick/context */
  params: FetchSuggestionParams | null
  /** Auto-fetch when params change */
  autoFetch?: boolean
  /** Compact layout */
  compact?: boolean
}

export function AIDraftAssistantPanel({
  params,
  autoFetch = true,
  compact = false,
}: AIDraftAssistantPanelProps) {
  const {
    bestPick,
    explanation,
    compareOptions,
    positionalRunWarning,
    rosterWarning,
    reachWarning,
    valueWarning,
    scarcityInsight,
    stackInsight,
    correlationInsight,
    formatInsight,
    byeNote,
    evidence,
    caveats,
    uncertainty,
    strategyMetaContext,
    loading,
    error,
    fetchSuggestion,
    clear,
  } = useAIDraftAssistant()

  const chimmyPrompt = buildAskChimmyAboutPickPrompt({
    sport: params?.sport,
    round: params?.round,
    pick: params?.pick,
    leagueName: params?.leagueName,
    rosterPositions: params?.rosterSlots,
    recommendedPlayer: bestPick?.player,
    recommendedPosition: bestPick?.position,
    explanation: explanation || bestPick?.reason,
  })
  const chimmyHref = getDraftAIChatUrl(chimmyPrompt, {
    leagueId: params?.leagueId,
    insightType: 'draft',
    sport: params?.sport,
  })

  useEffect(() => {
    if (!params || !autoFetch) return
    fetchSuggestion(params)
    return () => clear()
  }, [params, autoFetch, fetchSuggestion, clear])

  return (
    <section
      className={`rounded-2xl border border-white/12 bg-black/25 text-sm text-white/90 ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10">
          <Bot className="h-4 w-4 text-cyan-400" />
        </span>
        <div>
          <p className="font-semibold text-white">AI Draft Assistant</p>
          <p className="text-[11px] text-white/55">
            Suggestions only - not a guarantee. You decide.
          </p>
        </div>
        <button
          type="button"
          disabled={!params || loading}
          onClick={() => params && fetchSuggestion(params)}
          className="ml-auto rounded-lg border border-white/15 bg-black/20 p-1.5 text-white/70 hover:bg-white/10 disabled:opacity-50"
          data-testid="mock-draft-ai-assistant-refresh"
          aria-label="Refresh AI suggestion"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && (
        <p className="text-white/55">Loading suggestion...</p>
      )}

      {!loading && bestPick && (
        <>
          <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3">
            <p className="mb-1 text-[11px] uppercase tracking-wider text-cyan-400/80">Best pick</p>
            <p className="font-semibold text-white">
              {bestPick.player}
              <span className="ml-2 text-white/60">
                {bestPick.position}
                {bestPick.team ? ` - ${bestPick.team}` : ''}
              </span>
            </p>
            {bestPick.reason && (
              <p className="mt-1.5 text-[11px] text-white/70">{bestPick.reason}</p>
            )}
          </div>

          {explanation && (
            <div className="mb-3 flex gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2">
              <Info className="h-4 w-4 shrink-0 text-cyan-400/80" />
              <p className="text-[11px] text-white/75">{explanation}</p>
            </div>
          )}

          {compareOptions.length > 1 && (
            <div className="mb-3">
              <p className="mb-1.5 text-[11px] uppercase tracking-wider text-white/55">
                Compare options
              </p>
              <ul className="space-y-1.5">
                {compareOptions.slice(0, 3).map((option, index) => (
                  <li
                    key={`${option.player}-${index}`}
                    className="flex justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[11px]"
                  >
                    <span className="font-medium text-white">{option.player}</span>
                    <span className="text-white/55">{option.position}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {strategyMetaContext.length > 0 && (
            <div className="mb-3 rounded-lg border border-purple-500/25 bg-purple-500/10 p-2.5">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-purple-200/90">
                Strategy meta context
              </p>
              <ul className="space-y-1 text-[11px] text-purple-100/85">
                {strategyMetaContext.slice(0, 2).map((row) => (
                  <li key={`${row.strategyType}-${row.trendingDirection}`}>
                    {row.strategyLabel ?? row.strategyType}: {Math.round(row.usageRate * 100)}% usage, {Math.round(row.successRate * 100)}% success
                  </li>
                ))}
              </ul>
              <Link
                href={`/app/strategy-meta?sport=${encodeURIComponent(params?.sport ?? 'NFL')}&timeframe=30d`}
                className="mt-1 inline-block text-[11px] text-purple-200 hover:underline"
              >
                View strategy details
              </Link>
            </div>
          )}

          {positionalRunWarning && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {positionalRunWarning}
            </div>
          )}

          {rosterWarning && (
            <div className="flex items-center gap-2 rounded-lg border border-purple-500/25 bg-purple-500/10 px-2.5 py-1.5 text-[11px] text-purple-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {rosterWarning}
            </div>
          )}
          {(reachWarning || valueWarning || scarcityInsight || stackInsight || correlationInsight || formatInsight || byeNote) && (
            <div className="mt-2 space-y-1.5">
              {reachWarning && <p className="text-[11px] text-amber-200">{reachWarning}</p>}
              {valueWarning && <p className="text-[11px] text-emerald-200">{valueWarning}</p>}
              {scarcityInsight && <p className="text-[11px] text-cyan-200">{scarcityInsight}</p>}
              {stackInsight && <p className="text-[11px] text-violet-200">{stackInsight}</p>}
              {correlationInsight && <p className="text-[11px] text-indigo-200">{correlationInsight}</p>}
              {formatInsight && <p className="text-[11px] text-sky-200">{formatInsight}</p>}
              {byeNote && <p className="text-[11px] text-amber-200">{byeNote}</p>}
            </div>
          )}
          {evidence.length > 0 && (
            <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-white/55">Evidence</p>
              <ul className="list-inside list-disc space-y-1 text-[11px] text-white/75">
                {evidence.slice(0, 4).map((item, idx) => (
                  <li key={`ev-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {caveats.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
              <p className="mb-1 text-[11px] uppercase tracking-wider text-amber-200/90">Caveats</p>
              <ul className="list-inside list-disc space-y-1 text-[11px] text-amber-100/85">
                {caveats.slice(0, 3).map((item, idx) => (
                  <li key={`cv-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {uncertainty && (
            <p className="mt-2 text-[11px] text-amber-200/90">{uncertainty}</p>
          )}
          <a
            href={chimmyHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="mock-draft-ai-assistant-ask-chimmy"
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-cyan-300/35 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] text-cyan-100 hover:bg-cyan-500/20"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Ask Chimmy about this pick
          </a>
        </>
      )}

      {!loading && !bestPick && !error && params && (
        <p className="text-white/55">Select a pick or start the draft to see AI suggestions.</p>
      )}
    </section>
  )
}

"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Brain, Info, Sparkles, Target, Zap } from "lucide-react"
import BracketBrainLockedCard from "@/components/bracket-brain/BracketBrainLockedCard"
import type { WorldCupAiStrategy, WorldCupMatchupIntelligence } from "@/lib/world-cup/types"
import { getWorldCupMatchupIntelligence } from "@/lib/world-cup/worldCupClientApi"
import WorldCupTeamFlag from "./WorldCupTeamFlag"

const STRATEGY_OPTIONS: { value: WorldCupAiStrategy; label: string; emoji: string }[] = [
  { value: "safe", label: "Safe", emoji: "🛡️" },
  { value: "balanced", label: "Balanced", emoji: "⚖️" },
  { value: "upset", label: "Upset", emoji: "💥" },
  { value: "chaos", label: "Chaos", emoji: "🌪️" },
]

function ProbBar({
  label,
  pct,
  side,
  flagUrl,
}: {
  label: string
  pct: number
  side: "home" | "away"
  flagUrl?: string | null
}) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
      <span className="flex max-w-[38%] min-w-0 items-center justify-end gap-1 truncate text-right text-[11px] text-white/50 sm:w-24 sm:max-w-none">
        <WorldCupTeamFlag flagUrl={flagUrl} teamName={label} size="xs" />
        {label}
      </span>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            side === "home" ? "bg-cyan-400" : "bg-violet-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-9 text-[11px] tabular-nums text-white/60">{pct}%</span>
    </div>
  )
}

function riskBadgeClass(risk: "low" | "medium" | "high") {
  if (risk === "high") return "bg-red-500/20 text-red-300"
  if (risk === "medium") return "bg-amber-500/20 text-white/70"
  return "bg-emerald-500/20 text-white/85"
}

export default function WorldCupMatchupIntelligencePanel({
  challengeId,
  entryId,
  matchId,
  homeName,
  awayName,
  homeLogo,
  awayLogo,
  disabled,
  hasBracketBrainAi = false,
  stagedSide,
  onStageSide,
  onUseThisPick,
}: {
  challengeId: string
  entryId: string
  matchId: string
  homeName: string
  awayName: string
  homeLogo?: string | null
  awayLogo?: string | null
  disabled: boolean
  /** AF Pro — enables Ask AI / Explain Matchup (server still enforces). */
  hasBracketBrainAi?: boolean
  stagedSide: "home" | "away" | null
  onStageSide: (side: "home" | "away") => void
  onUseThisPick: (side: "home" | "away") => void
}) {
  const [strategy, setStrategy] = useState<WorldCupAiStrategy>("balanced")
  const [intel, setIntel] = useState<WorldCupMatchupIntelligence | null>(null)
  const [loading, setLoading] = useState(false)
  const [intentLoading, setIntentLoading] = useState<"ask_ai" | "explain" | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIntel(null)
    setError(null)
    setLoading(true)
    getWorldCupMatchupIntelligence(challengeId, entryId, {
      matchId,
      strategy,
      intent: "panel",
    })
      .then((i) => {
        if (!cancelled) {
          setIntel(i)
          setLoading(false)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load matchup intelligence")
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [challengeId, entryId, matchId, strategy])

  async function runIntent(intent: "ask_ai" | "explain") {
    setIntentLoading(intent)
    setError(null)
    try {
      const next = await getWorldCupMatchupIntelligence(challengeId, entryId, {
        matchId,
        strategy,
        intent,
      })
      setIntel(next)
      if (intent === "ask_ai" && next.recommendedSide) {
        onStageSide(next.recommendedSide)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setIntentLoading(null)
    }
  }

  const busy = loading || intentLoading !== null

  return (
    <div
      data-testid="world-cup-matchup-intelligence-panel"
      className="mt-3 max-h-[min(42vh,300px)] space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 sm:max-h-none sm:overflow-visible"
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-white/85" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-white/85">
            Matchup intelligence
          </span>
        </div>
        {!hasBracketBrainAi && (
          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/35">
            Basic stats (non-AI)
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {STRATEGY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={strategy === opt.value}
            aria-label={`Strategy ${opt.label}`}
            onClick={() => setStrategy(opt.value)}
            disabled={disabled || busy}
            className={`min-h-9 touch-manipulation rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors ${
              strategy === opt.value
                ? "bg-cyan-300 text-black"
                : "bg-white/[0.06] text-white/60 hover:bg-white/10"
            }`}
          >
            {opt.emoji} {opt.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="space-y-2 animate-pulse">
          <div className="h-2.5 w-3/4 rounded bg-white/10" />
          <div className="h-2.5 w-1/2 rounded bg-white/10" />
          <div className="h-2.5 w-5/6 rounded bg-white/10" />
        </div>
      )}

      {!loading && error && (
        <p className="flex items-start gap-2 text-[11px] text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {!loading && intel && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <ProbBar
              label={homeName}
              pct={Math.round(intel.homeWinProbability * 100)}
              side="home"
              flagUrl={homeLogo}
            />
            <ProbBar
              label={awayName}
              pct={Math.round(intel.awayWinProbability * 100)}
              side="away"
              flagUrl={awayLogo}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${riskBadgeClass(intel.riskLevel)}`}>
              Risk {intel.riskLevel}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/60">
              Upset volatility {intel.upsetRisk}
            </span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white/60">
              Confidence {intel.confidence}
            </span>
            {intel.generative && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-bold text-violet-300">
                AI summary
              </span>
            )}
            {intel.narrativesGenerative && (
              <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] font-bold text-violet-300">
                AI insight
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <div className="rounded-lg bg-white/[0.05] px-2 py-1.5">
              <span className="block text-[11px] font-semibold uppercase text-white/40">Safe pick</span>
              <span className="font-bold text-white/90">{intel.safePickTeamName}</span>
            </div>
            <div className="rounded-lg bg-white/[0.05] px-2 py-1.5">
              <span className="block text-[11px] font-semibold uppercase text-white/40">Upset pick</span>
              <span className="font-bold text-white/90">{intel.upsetPickTeamName}</span>
            </div>
          </div>

          {intel.keyFactors.length > 0 && (
            <div>
              <span className="text-[11px] font-bold uppercase text-white/35">Key factors</span>
              <ul className="mt-1 space-y-0.5">
                {intel.keyFactors.slice(0, 5).map((f) => (
                  <li key={f} className="text-[11px] text-white/45 before:content-['·_']">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-white/45">{intel.recentFormSummary}</p>

          <p className="text-[11px] leading-relaxed text-white/55">{intel.rankingSeedComparison}</p>

          <div className="space-y-1 rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-[11px] text-white/55">
            <span className="font-bold text-white/45">If {homeName} wins</span>
            <p>{intel.bracketImpactIfHomeWins}</p>
            <span className="mt-2 block font-bold text-white/45">If {awayName} wins</span>
            <p>{intel.bracketImpactIfAwayWins}</p>
          </div>

          <p className="text-[11px] leading-relaxed text-white/70">{intel.summary}</p>

          <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2">
            <div className="flex items-center gap-1 text-[11px] font-bold text-white/80">
              <Target className="h-3 w-3" /> Why this pick makes sense
            </div>
            <p className="text-[11px] leading-relaxed text-white/60">{intel.whyThisPickMakesSense}</p>
            <div className="flex items-center gap-1 text-[11px] font-bold text-white/75">
              <Zap className="h-3 w-3" /> How risky this pick is
            </div>
            <p className="text-[11px] leading-relaxed text-white/60">{intel.howRiskyIsThisPick}</p>
            <div className="flex items-center gap-1 text-[11px] font-bold text-white/75">
              <Brain className="h-3 w-3" /> What this means for your bracket
            </div>
            <p className="text-[11px] leading-relaxed text-white/60">{intel.whatThisMeansForYourBracket}</p>
          </div>

          {!hasBracketBrainAi && <BracketBrainLockedCard className="mt-1" />}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="wc-ai-ask-button"
              disabled={disabled || busy}
              onClick={() => runIntent("ask_ai")}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-bold text-white/85 disabled:opacity-40"
            >
              <Sparkles className="h-3 w-3" />
              {intentLoading === "ask_ai" ? "Asking…" : "Ask Chimmy"}
            </button>
            <button
              type="button"
              data-testid="wc-ai-explain-button"
              disabled={disabled || busy}
              onClick={() => runIntent("explain")}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-white/75 disabled:opacity-40"
            >
              <Info className="h-3 w-3" />
              {intentLoading === "explain" ? "Explaining…" : "Explain Matchup"}
            </button>
            <button
              type="button"
              data-testid="wc-pick-safe-button"
              disabled={disabled || busy || !intel}
              onClick={() => onStageSide(intel.safePickSide)}
              className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-bold text-white/85 disabled:opacity-40"
            >
              Pick Safe
            </button>
            <button
              type="button"
              data-testid="wc-pick-upset-button"
              disabled={disabled || busy || !intel}
              onClick={() => onStageSide(intel.upsetPickSide)}
              className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-white/75 disabled:opacity-40"
            >
              Pick Upset
            </button>
          </div>

          {stagedSide !== null && (
            <p
              data-testid="wc-ai-staged-side"
              data-side={stagedSide}
              className="text-center text-[11px] text-white/80"
            >
              Staged: {stagedSide === "home" ? homeName : awayName}
            </p>
          )}

          <button
            type="button"
            data-testid="wc-use-this-pick-button"
            disabled={disabled || busy || stagedSide === null}
            onClick={() => stagedSide !== null && onUseThisPick(stagedSide)}
            className="w-full rounded-xl bg-cyan-300/90 py-2.5 text-xs font-black text-black transition-colors hover:bg-cyan-300 disabled:opacity-40"
          >
            Use This Pick
          </button>
        </div>
      )}
    </div>
  )
}

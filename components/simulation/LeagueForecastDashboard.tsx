'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { PlayoffOddsPanel } from './PlayoffOddsPanel'
import { SimulationConfidenceIndicator } from './SimulationConfidenceIndicator'
import type { TeamSeasonForecastDisplay } from './TeamForecastCard'
import { getToolToAIChatHref } from '@/lib/chimmy-chat'

type LeagueForecastDashboardProps = {
  teamForecasts: TeamSeasonForecastDisplay[]
  playoffSpots?: number
  leagueId?: string
  season?: number
  week?: number
  teamNames?: Record<string, string>
  teamRanks?: Record<string, number>
  /** Optional AI-generated summary (e.g. weekly playoff race summary) */
  aiSummary?: string | null
  /** Optional: when the forecast was generated (ISO or display string) */
  generatedAt?: string | null
  /** Optional: avg confidence across teams for indicator */
  avgConfidence?: number
  /** Optional: simulation count for confidence indicator */
  simulationCount?: number
  className?: string
}

function formatFreshness(isoOrLabel: string): string {
  if (!isoOrLabel) return ''
  try {
    const d = new Date(isoOrLabel)
    if (Number.isNaN(d.getTime())) return isoOrLabel
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 60) return `Updated ${diffMins}m ago`
    if (diffHours < 24) return `Updated ${diffHours}h ago`
    if (diffDays < 7) return `Updated ${diffDays}d ago`
    return d.toLocaleDateString()
  } catch {
    return isoOrLabel
  }
}

export function LeagueForecastDashboard({
  teamForecasts,
  playoffSpots = 6,
  leagueId,
  season,
  week,
  teamNames = {},
  teamRanks = {},
  aiSummary,
  generatedAt,
  avgConfidence,
  simulationCount,
  className = '',
}: LeagueForecastDashboardProps) {
  const { contenders, bubble, volatile } = useMemo(() => {
    if (!teamForecasts.length) {
      return { contenders: [], bubble: [], volatile: [] }
    }
    const sorted = [...teamForecasts].sort(
      (a, b) => b.championshipProbability - a.championshipProbability
    )
    const contenders = sorted.slice(0, 4)
    const bubble = teamForecasts.filter(
      (t) =>
        t.playoffProbability >= 15 &&
        t.playoffProbability <= 85
    )
    const volatile = teamForecasts.filter(
      (t) => (t.finishRange.max - t.finishRange.min) >= 4
    )
    return { contenders, bubble, volatile }
  }, [teamForecasts])

  const freshness = useMemo(
    () => (generatedAt ? formatFreshness(generatedAt) : ''),
    [generatedAt]
  )

  const volTag = useMemo<'low' | 'medium' | 'high'>(() => {
    if (volatile.length >= teamForecasts.length / 2) return 'high'
    if (volatile.length >= 2) return 'medium'
    return 'low'
  }, [volatile.length, teamForecasts.length])

  const playoffChatHref = useMemo(() => {
    return getToolToAIChatHref('playoff', {
      prompt: "Explain my league's playoff odds, title race, and best next move.",
      insightType: 'playoff',
      leagueId,
      season,
      week,
    })
  }, [leagueId, season, week])

  return (
    <div className={`space-y-6 ${className}`}>
      <SimulationConfidenceIndicator
        confidenceScore={avgConfidence ?? 60}
        volatility={volTag}
        dataFreshness={freshness || undefined}
        simulationCount={simulationCount}
      />

      {aiSummary && (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
          <h3 className="text-xs font-semibold text-cyan-400/90 uppercase tracking-wider mb-2">
            AI summary
          </h3>
          <p className="text-sm text-white/80 whitespace-pre-wrap">{aiSummary}</p>
          <Link
            href={playoffChatHref}
            className="mt-2 inline-block text-[11px] text-cyan-400 hover:text-cyan-300"
          >
            Ask Chimmy about playoff odds →
          </Link>
        </div>
      )}

      {contenders.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">
            Title contenders
          </h3>
          <ul className="space-y-2">
            {contenders.map((t, i) => (
              <li
                key={t.teamId}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <span className="text-sm text-white/90 truncate">
                  {i + 1}. {teamNames[t.teamId] ?? t.teamName ?? t.teamId}
                </span>
                <span className="text-amber-400 font-semibold tabular-nums shrink-0 ml-2">
                  {t.championshipProbability.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bubble.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">
            Bubble (playoff prob 15–85%)
          </h3>
          <ul className="space-y-2">
            {bubble.slice(0, 6).map((t) => (
              <li
                key={t.teamId}
                className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
              >
                <span className="text-sm text-white/90 truncate">
                  {teamNames[t.teamId] ?? t.teamName ?? t.teamId}
                </span>
                <span className="text-amber-400/90 font-semibold tabular-nums shrink-0 ml-2">
                  {t.playoffProbability.toFixed(0)}% playoffs
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PlayoffOddsPanel
        teamForecasts={teamForecasts}
        playoffSpots={playoffSpots}
        leagueId={leagueId}
        season={season}
        week={week}
        teamNames={teamNames}
        teamRanks={teamRanks}
        title="Playoff & championship odds"
      />
    </div>
  )
}

'use client'

import Link from 'next/link'
import { getToolToAIChatHref } from '@/lib/chimmy-chat'

export type TeamSeasonForecastDisplay = {
  teamId: string
  teamName?: string
  playoffProbability: number
  firstPlaceProbability: number
  championshipProbability: number
  expectedWins: number
  expectedFinalSeed: number
  finishRange: { min: number; max: number }
  eliminationRisk: number
  byeProbability: number
  confidenceScore: number
}

type TeamForecastCardProps = {
  forecast: TeamSeasonForecastDisplay
  rank?: number
  playoffSpots?: number
  leagueId?: string
  season?: number
  week?: number
  className?: string
}

export function TeamForecastCard({
  forecast,
  rank,
  playoffSpots = 6,
  leagueId,
  season,
  week,
  className = '',
}: TeamForecastCardProps) {
  const inPlayoffZone = rank != null && playoffSpots > 0 && rank <= playoffSpots
  const name = forecast.teamName ?? `Team ${forecast.teamId}`
  const explainPrompt = `Explain this playoff outlook: ${name} has ${forecast.playoffProbability.toFixed(1)}% playoff odds, ${forecast.championshipProbability.toFixed(1)}% championship odds, expected wins ${forecast.expectedWins.toFixed(1)}, and expected seed ${forecast.expectedFinalSeed.toFixed(1)}.`
  const chatHref = getToolToAIChatHref('playoff', {
    prompt: explainPrompt,
    insightType: 'playoff',
    teamId: forecast.teamId,
    leagueId,
    season,
    week,
  })

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3 ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {rank != null && (
            <span className="text-[11px] text-white/40 mr-1.5">#{rank}</span>
          )}
          <p className="text-sm font-semibold text-white truncate" title={name}>
            {name}
          </p>
        </div>
        {inPlayoffZone && (
          <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            Playoff zone
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div className="flex justify-between">
          <span className="text-white/50">Expected wins</span>
          <span className="font-semibold text-white/90 tabular-nums">
            {forecast.expectedWins.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Expected seed</span>
          <span className="font-semibold text-white/90 tabular-nums">
            {forecast.expectedFinalSeed.toFixed(1)}
          </span>
        </div>
        <div className="flex justify-between col-span-2">
          <span className="text-white/50">Finish range</span>
          <span className="font-semibold text-white/90 tabular-nums">
            #{forecast.finishRange.min} – #{forecast.finishRange.max}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-white/50">Elimination risk</span>
          <span
            className={
              forecast.eliminationRisk >= 70
                ? 'text-red-400 font-semibold'
                : forecast.eliminationRisk >= 40
                  ? 'text-amber-400 font-semibold'
                  : 'text-white/90 font-semibold'
            }
          >
            {forecast.eliminationRisk.toFixed(0)}%
          </span>
        </div>
        {forecast.byeProbability > 0 && (
          <div className="flex justify-between">
            <span className="text-white/50">Bye probability</span>
            <span className="font-semibold text-cyan-400/90 tabular-nums">
              {forecast.byeProbability.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      <div className="pt-2 border-t border-white/10 space-y-1.5">
        <div className="flex justify-between text-[11px]">
          <span className="text-white/50">Playoffs</span>
          <span className="font-bold text-emerald-400 tabular-nums">
            {forecast.playoffProbability.toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500/80 transition-all duration-500"
            style={{ width: `${Math.min(forecast.playoffProbability, 100)}%` }}
          />
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-white/50">1st place</span>
          <span className="text-amber-400/90 font-semibold tabular-nums">
            {forecast.firstPlaceProbability.toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-white/50">Championship</span>
          <span className="text-cyan-400/90 font-semibold tabular-nums">
            {forecast.championshipProbability.toFixed(1)}%
          </span>
        </div>
      </div>
      <div className="pt-1">
        <Link
          href={chatHref}
          className="text-[11px] text-cyan-300 hover:text-cyan-200 underline-offset-2 hover:underline"
          aria-label={`Explain playoff odds for ${name}`}
        >
          Explain playoff odds
        </Link>
      </div>
    </div>
  )
}

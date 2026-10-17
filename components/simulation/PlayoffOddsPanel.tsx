'use client'

import { TeamForecastCard, type TeamSeasonForecastDisplay } from './TeamForecastCard'

export type PlayoffOddsPanelProps = {
  teamForecasts: TeamSeasonForecastDisplay[]
  playoffSpots?: number
  leagueId?: string
  season?: number
  week?: number
  /** Optional: teamId -> display name */
  teamNames?: Record<string, string>
  /** Optional: teamId -> current rank (1-based) */
  teamRanks?: Record<string, number>
  title?: string
  className?: string
}

export function PlayoffOddsPanel({
  teamForecasts,
  playoffSpots = 6,
  leagueId,
  season,
  week,
  teamNames = {},
  teamRanks = {},
  title = 'Playoff & title odds',
  className = '',
}: PlayoffOddsPanelProps) {
  if (!teamForecasts?.length) {
    return (
      <div
        className={`rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center text-sm text-white/50 ${className}`}
      >
        No forecast data yet. Run a season forecast to see playoff and championship odds.
      </div>
    )
  }

  const withNames = teamForecasts.map((t) => ({
    ...t,
    teamName: teamNames[t.teamId] ?? t.teamName,
  }))

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white/90">{title}</h2>
        <span className="text-[11px] text-white/40">
          {playoffSpots} playoff spots
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {withNames.map((forecast) => (
          <TeamForecastCard
            key={forecast.teamId}
            forecast={forecast}
            rank={teamRanks[forecast.teamId]}
            playoffSpots={playoffSpots}
            leagueId={leagueId}
            season={season}
            week={week}
          />
        ))}
      </div>
    </div>
  )
}

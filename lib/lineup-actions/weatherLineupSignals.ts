import { listHeldTeams } from '@/lib/league/viewerTeams'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { buildWeatherAugmentFromCachedWeather } from '@/lib/weather/applyWeatherToFantasyProjection'
import { defaultGameTimeForSport } from '@/lib/weather/defaultGameTimes'
import { fetchWeatherForTeamHomeWindow } from '@/lib/weather/venueResolver'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import type { LeagueSport } from '@prisma/client'

/**
 * Surfaces urgent outdoor weather risk for NFL lineups (OpenWeather forecast at home venue / city window).
 */
export async function appendWeatherRiskLineupActions(
  perLeague: Array<{
    leagueId: string
    leagueName: string
    sport: string
    platform: string
    actions: LineupActionItem[]
  }>,
  userId: string,
): Promise<void> {
  if (!process.env.OPENWEATHERMAP_API_KEY?.trim()) return

  const gt = defaultGameTimeForSport('NFL')

  for (const block of perLeague) {
    if (block.sport !== 'NFL') continue

    // Every team the manager runs in this league, not just one of them (lib/league/viewerTeams.ts).
    const held = await listHeldTeams(block.leagueId, userId)
    const idSet = new Set<string>()
    for (const team of held) {
      const roster = await prisma.roster.findFirst({ where: { id: team.rosterId, leagueId: block.leagueId }, select: { playerData: true } })
      if (roster?.playerData) for (const id of getRosterPlayerIds(roster.playerData).slice(0, 28)) idSet.add(id)
    }
    const ids = [...idSet]
    if (ids.length === 0) continue

    const teams = new Set<string>()
    for (const id of ids) {
      const rec = await prisma.sportsPlayerRecord.findUnique({
        where: { id },
        select: { team: true, sport: true },
      })
      if (rec?.sport === 'NFL' && rec.team?.trim()) {
        teams.add(rec.team.trim().toUpperCase())
      }
    }
    if (teams.size === 0) continue

    let best: { team: string; summary: string; risk: string; rank: number } | null = null
    for (const t of teams) {
      try {
        const w = await fetchWeatherForTeamHomeWindow({ sport: 'NFL', teamAbbrev: t, gameTime: gt })
        const aug = buildWeatherAugmentFromCachedWeather({
          sport: 'NFL',
          position: 'QB',
          teamAbbrev: t,
          baselinePoints: 18,
          weather: w,
        })
        if (!aug?.weatherRiskLevel || aug.weatherRiskLevel === 'none' || aug.weatherRiskLevel === 'low') continue
        const rank =
          aug.weatherRiskLevel === 'extreme'
            ? 4
            : aug.weatherRiskLevel === 'high'
              ? 3
              : aug.weatherRiskLevel === 'moderate'
                ? 2
                : 1
        if (!best || rank > best.rank) {
          best = {
            team: t,
            summary: aug.weatherSummary ?? aug.weatherImpactReason ?? 'Outdoor forecast risk',
            risk: aug.weatherRiskLevel,
            rank,
          }
        }
      } catch {
        /* skip team */
      }
    }

    if (!best || best.rank < 2) continue

    block.actions.push({
      leagueId: block.leagueId,
      leagueName: block.leagueName,
      sport: 'NFL' as LeagueSport,
      platform: block.platform,
      teamId: null,
      slotIndex: null,
      slotId: null,
      slotLabel: null,
      playerId: null,
      playerName: null,
      reasonType: 'weather_risk',
      urgency: best.risk === 'extreme' ? 'urgent' : 'soon',
      lockTime: null,
      recommendedAction: 'Review starters in outdoor games with wind/precip — passing and kicking may be depressed.',
      suggestedReplacementPlayerId: null,
      confidence: best.risk === 'extreme' ? 78 : 65,
      expectedGain: null,
      sourceModule: 'StartSit',
      message: `${best.team}: ${best.summary}`,
      severity: 'warning',
    })
  }
}

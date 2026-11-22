/**
 * Weekly recap payload: who was chopped, who is in danger (for AI recap or UI).
 */

import { getSurvivalStandings } from './GuillotineStandingsProjectionService'
import { getLiveDangerTiers } from './chopWatchLoad'
import { getRecentEvents } from './GuillotineEventLog'
import { GUILLOTINE_LEAGUE_IMAGE, GUILLOTINE_INTRO_VIDEO } from './constants'

export interface WeeklySummaryInput {
  leagueId: string
  weekOrPeriod: number
  /** Include danger tiers in summary. */
  includeDanger?: boolean
}

export interface GuillotineWeeklySummary {
  leagueId: string
  weekOrPeriod: number
  choppedThisWeek: { rosterId: string; displayName?: string }[]
  survivalStandings: { rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }[]
  dangerTiers?: { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number }[]
  recentChopEvents: { weekOrPeriod: number; choppedRosterIds: string[] }[]
  assets: {
    leagueImage: string
    introVideo: string
  }
}

/**
 * Build weekly recap payload for guillotine league (chop events, standings, danger, assets).
 */
export async function buildWeeklySummary(input: WeeklySummaryInput): Promise<GuillotineWeeklySummary | null> {
  const { leagueId, weekOrPeriod, includeDanger = true } = input
  const events = await getRecentEvents(leagueId, {
    limit: 20,
    eventTypes: ['chop'],
  })
  const recentChopEvents = events
    .filter((e) => e.metadata && typeof (e.metadata as any).weekOrPeriod === 'number')
    .map((e) => ({
      weekOrPeriod: (e.metadata as { weekOrPeriod: number }).weekOrPeriod,
      choppedRosterIds: ((e.metadata as { choppedRosterIds?: string[] }).choppedRosterIds ?? []),
    }))

  const choppedThisWeek = recentChopEvents
    .filter((e) => e.weekOrPeriod === weekOrPeriod)
    .flatMap((e) => e.choppedRosterIds)
  const standings = await getSurvivalStandings({
    leagueId,
    throughWeekOrPeriod: weekOrPeriod,
  })
  const displayByRoster = Object.fromEntries(
    standings.map((s) => [s.rosterId, s.displayName])
  )
  const choppedWithNames = [...new Set(choppedThisWeek)].map((rosterId) => ({
    rosterId,
    displayName: displayByRoster[rosterId],
  }))

  let dangerTiers: GuillotineWeeklySummary['dangerTiers'] | undefined
  if (includeDanger) {
    const danger = (await getLiveDangerTiers({ leagueId, weekOrPeriod })).rows
    dangerTiers = danger.map((d) => ({
      rosterId: d.rosterId,
      displayName: d.displayName,
      tier: d.tier,
      pointsFromChopZone: d.pointsFromChopZone,
    }))
  }

  return {
    leagueId,
    weekOrPeriod,
    choppedThisWeek: choppedWithNames,
    survivalStandings: standings.map((s) => ({
      rosterId: s.rosterId,
      displayName: s.displayName,
      rank: s.rank,
      seasonPointsCumul: s.seasonPointsCumul,
    })),
    dangerTiers,
    recentChopEvents,
    assets: {
      leagueImage: GUILLOTINE_LEAGUE_IMAGE,
      introVideo: GUILLOTINE_INTRO_VIDEO,
    },
  }
}

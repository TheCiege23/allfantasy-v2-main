import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export type ZombieStatusCadence = {
  sport: LeagueSport
  scoringPeriod: 'weekly' | 'daily' | 'hybrid'
  lineupSummary: string
  statCorrectionWindow: string
  boardCadenceSummary: string
}

/**
 * Human-readable cadence for weekly status board + resolution timing (all supported sports).
 */
export function getZombieStatusCadence(sportInput: string | undefined | null): ZombieStatusCadence {
  const sport = normalizeToSupportedSport(sportInput ?? 'NFL') as LeagueSport

  const dailyCluster: LeagueSport[] = ['NBA', 'NHL', 'MLB']
  const hybrid: LeagueSport[] = ['SOCCER']

  let scoringPeriod: ZombieStatusCadence['scoringPeriod'] = 'weekly'
  if (dailyCluster.includes(sport)) scoringPeriod = 'daily'
  if (hybrid.includes(sport)) scoringPeriod = 'hybrid'

  const lineupSummary =
    sport === 'SOCCER'
      ? 'Match-day lineups; confirm league scoring period (GW vs round) in settings.'
      : scoringPeriod === 'daily'
        ? 'Lineups typically lock at scheduled game start each slate.'
        : 'Weekly lineup lock — usually before the first game of the scoring week.'

  const statCorrectionWindow =
    sport === 'NFL'
      ? 'NFL: stat corrections often finalize Tuesday–Wednesday after the slate.'
      : sport === 'NBA' || sport === 'NHL'
        ? `${sport}: corrections usually within 24–48h after games finalize.`
        : sport === 'MLB'
          ? 'MLB: same-day corrections are common; watch for pitcher swaps.'
          : sport === 'SOCCER'
            ? 'Soccer: provider stat fixes may arrive after final whistle — commissioner review window should be explicit.'
            : 'Allow a short commissioner review window after provider finals post.'

  const boardCadenceSummary =
    scoringPeriod === 'weekly'
      ? 'Generate the weekly status board after the scoring week is final; align with your `weeklyUpdateDay` / hour when auto-posting.'
      : scoringPeriod === 'daily'
        ? 'For daily sports, roll up a board each scoring slice you choose (e.g. nightly) or weekly summary — set expectations in league chat.'
        : 'Soccer: align board posts to your gameweek or cup round boundaries.'

  return {
    sport,
    scoringPeriod,
    lineupSummary,
    statCorrectionWindow,
    boardCadenceSummary,
  }
}

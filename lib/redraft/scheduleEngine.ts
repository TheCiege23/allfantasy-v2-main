export { getScheduleDefaults } from '@/lib/sportConfig'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { generateCanonicalRegularSeasonSchedule } from '@/lib/schedule-runtime/canonicalScheduleRuntime'

function buildScheduleOnlyRules(input: {
  sport: string
  regularSeasonWeeks: number
  playoffStartWeek: number
}): CanonicalLeagueRules {
  return {
    version: 1,
    leagueId: 'redraft-schedule-helper',
    generatedAtIso: new Date(0).toISOString(),
    general: {
      sport: input.sport,
      season: null,
      format: 'redraft',
      status: 'setup',
    },
    playoffs: {
      startWeek: input.playoffStartWeek,
      teamCount: null,
      standingsTiebreakers: [],
    },
    schedule: {
      regularSeasonLength: input.regularSeasonWeeks,
      playoffTransitionPoint: input.playoffStartWeek,
    },
  } as unknown as CanonicalLeagueRules
}

/**
 * Regular-season schedule: canonical round-robin with rotation; supports bye weeks for odd team counts.
 * When medianGame is true, emits additional synthetic rows with type "median" (caller may persist separately).
 */
export function generateSchedule(
  rosters: { id: string }[],
  totalWeeks: number,
  playoffStartWeek: number,
  sport: string,
  options?: {
    medianGame?: boolean
    /**
     * The commissioner's divisions (`loadSeasonRosterDivisions(...).byRoster`, keyed by season roster
     * id). Absent or empty means no divisions, and the schedule is exactly what it was before.
     */
    divisionByRoster?: ReadonlyMap<string, { key: string; name: string }> | null
    /** `division_config.rivalsTwice`: every division rival is played a second time. */
    divisionRivalsTwice?: boolean
    /** `settings.games_per_week`: head-to-head games each team plays per week. Default 1. */
    gamesPerWeek?: number | null
  },
): { week: number; home: string; away: string | null; type: string; sport: string }[] {
  const medianGame = options?.medianGame ?? false
  const regularEnd = Math.min(totalWeeks, Math.max(1, playoffStartWeek - 1))
  const out: { week: number; home: string; away: string | null; type: string; sport: string }[] = []

  if (rosters.length < 2) return out

  const generated = generateCanonicalRegularSeasonSchedule({
    rules: buildScheduleOnlyRules({ sport, regularSeasonWeeks: regularEnd, playoffStartWeek }),
    teams: rosters.map((roster) => {
      const division = options?.divisionByRoster?.get(roster.id)
      return division ? { rosterId: roster.id, divisionId: division.key, divisionName: division.name } : { rosterId: roster.id }
    }),
    divisionRivalsTwice: options?.divisionRivalsTwice === true,
    gamesPerWeek: options?.gamesPerWeek ?? 1,
    totalWeeks,
    playoffStartWeek,
    regularSeasonWeeks: regularEnd,
  })

  const medianSlots = new Set<string>()
  for (const matchup of generated.matchups) {
    out.push({
      week: matchup.week,
      home: matchup.homeRosterId,
      away: matchup.awayRosterId,
      type: 'regular',
      sport,
    })
    // One median slot per home team per week, however many games it plays that week.
    const medianKey = `${matchup.week}|${matchup.homeRosterId}`
    if (medianGame && !matchup.bye && !medianSlots.has(medianKey)) {
      medianSlots.add(medianKey)
      out.push({ week: matchup.week, home: matchup.homeRosterId, away: null, type: 'median', sport })
    }
  }

  return out
}

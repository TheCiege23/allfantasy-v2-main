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
  options?: { medianGame?: boolean },
): { week: number; home: string; away: string | null; type: string; sport: string }[] {
  const medianGame = options?.medianGame ?? false
  const regularEnd = Math.min(totalWeeks, Math.max(1, playoffStartWeek - 1))
  const out: { week: number; home: string; away: string | null; type: string; sport: string }[] = []

  if (rosters.length < 2) return out

  const generated = generateCanonicalRegularSeasonSchedule({
    rules: buildScheduleOnlyRules({ sport, regularSeasonWeeks: regularEnd, playoffStartWeek }),
    teams: rosters.map((roster) => ({ rosterId: roster.id })),
    totalWeeks,
    playoffStartWeek,
    regularSeasonWeeks: regularEnd,
  })

  for (const matchup of generated.matchups) {
    out.push({
      week: matchup.week,
      home: matchup.homeRosterId,
      away: matchup.awayRosterId,
      type: 'regular',
      sport,
    })
    if (medianGame && !matchup.bye) {
      out.push({ week: matchup.week, home: matchup.homeRosterId, away: null, type: 'median', sport })
    }
  }

  return out
}

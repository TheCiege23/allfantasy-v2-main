/**
 * Which league tabs are worth offering.
 *
 * 🛑 THE RULE THIS PROTECTS: only a MEASURED false hides a tab. A failed read
 * returns null, and null shows everything — because hiding a working league's
 * Matchup, Your week, Standings and Season outlook because one count errored is
 * a worse failure than showing an empty tab on a league that has not started.
 *
 * ⚠ AND A FIXTURE IS NOT A RESULT. Measured on production: the Fantrax league
 * holds 60 MatchupFact rows and zero scores, because `scoreA`/`scoreB` default
 * to 0 and the week has not been played. Counting rows would call that a played
 * season; the test below is the one that stops it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const matchupFactCount = vi.fn()
const weeklyMatchupCount = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    matchupFact: { count: (...a: unknown[]) => matchupFactCount(...a) },
    weeklyMatchup: { count: (...a: unknown[]) => weeklyMatchupCount(...a) },
  },
}))

import { getLeagueDataSignals } from '@/lib/core-app/leagueDataSignals'

const ARGS = { leagueId: 'lg-1', platformLeagueId: 'plat-1' }

beforeEach(() => {
  matchupFactCount.mockReset()
  weeklyMatchupCount.mockReset()
})

describe('getLeagueDataSignals', () => {
  it('reports scored when a matchup fact carries a non-zero score', async () => {
    matchupFactCount.mockResolvedValue(12)
    weeklyMatchupCount.mockResolvedValue(0)
    expect(await getLeagueDataSignals(ARGS)).toEqual({ hasScoredWeek: true })
  })

  /**
   * ⚠ THE TWO PLATFORMS FILL DIFFERENT TABLES. The paired Sleeper league has 216
   * WeeklyMatchup rows; the Fantrax league has none. Reading only MatchupFact
   * would under-report Sleeper leagues, and only WeeklyMatchup would report every
   * Fantrax league unscored forever.
   */
  it('reports scored from WeeklyMatchup even when no scored fact exists', async () => {
    matchupFactCount.mockResolvedValue(0)
    weeklyMatchupCount.mockResolvedValue(216)
    expect(await getLeagueDataSignals(ARGS)).toEqual({ hasScoredWeek: true })
  })

  /**
   * 🛑 THE FANTRAX CASE, AND THE WHOLE POINT. A full fixture list with no scores
   * is a season that has not started, not one that has been played. The query
   * filters on a non-zero score precisely so 60 rows of `0-0` do not read as
   * results.
   */
  it('reports UNSCORED for a full fixture list with no scores', async () => {
    /* The count is already score-filtered, so the fixture rows never reach it. */
    matchupFactCount.mockResolvedValue(0)
    weeklyMatchupCount.mockResolvedValue(0)
    expect(await getLeagueDataSignals(ARGS)).toEqual({ hasScoredWeek: false })
  })

  it('filters on a non-zero score rather than counting rows', async () => {
    matchupFactCount.mockResolvedValue(0)
    weeklyMatchupCount.mockResolvedValue(0)
    await getLeagueDataSignals(ARGS)
    const where = matchupFactCount.mock.calls[0]![0].where
    /* If this ever becomes a bare `{ leagueId }`, a fixture list starts counting
       as a played season and every unplayed league shows four dead tabs again. */
    expect(where.OR).toEqual([{ scoreA: { not: 0 } }, { scoreB: { not: 0 } }])
  })

  /**
   * 🛑 UNKNOWN IS NOT FALSE. Both reads failing must not hide tabs.
   */
  it('returns null when both reads fail, so the caller shows everything', async () => {
    matchupFactCount.mockRejectedValue(new Error('db down'))
    weeklyMatchupCount.mockRejectedValue(new Error('db down'))
    expect(await getLeagueDataSignals(ARGS)).toEqual({ hasScoredWeek: null })
  })

  it('trusts the surviving read when only one fails', async () => {
    matchupFactCount.mockRejectedValue(new Error('db down'))
    weeklyMatchupCount.mockResolvedValue(5)
    expect(await getLeagueDataSignals(ARGS)).toEqual({ hasScoredWeek: true })
  })

  it('does not query WeeklyMatchup without a platform league id', async () => {
    matchupFactCount.mockResolvedValue(0)
    expect(await getLeagueDataSignals({ leagueId: 'lg-1', platformLeagueId: null })).toEqual({
      hasScoredWeek: false,
    })
    expect(weeklyMatchupCount).not.toHaveBeenCalled()
  })
})

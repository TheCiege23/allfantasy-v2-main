/**
 * What a league actually holds, for deciding which tabs are worth offering.
 *
 * 🛑 A TAB THAT CANNOT WORK IS WORSE THAN A MISSING ONE. Matchup, Your week,
 * Standings and Season outlook all read scored weeks. A league with none — an
 * imported Fantrax college league before week 1, measured on production with 60
 * fixtures and 0 scores — renders four tabs that each land on a variation of
 * "we cannot tell which week this league is in yet". The user cannot tell a
 * feature that is broken from one that is merely early.
 *
 * ⚠ GATED ON DATA, NEVER ON PLATFORM. "Hide these for Fantrax" would be wrong in
 * both directions: a Fantrax league mid-season has scores and should show them,
 * and a Sleeper league imported the day before kickoff has none and should not.
 * The question is what the league holds, which is also why the tabs come back on
 * their own once a week is scored — nothing has to be un-hidden by hand.
 *
 * ⚠ AND A ZERO HERE MUST MEAN "NO SCORES", NOT "WE DID NOT LOOK". Every read
 * below is a count with a catch that returns null, and null is treated as
 * unknown — which SHOWS the tabs. Hiding a working league's tabs because one
 * query failed is a worse failure than showing an empty one.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'

export type LeagueDataSignals = {
  /**
   * At least one week carries a non-zero score.
   *
   * Null when we could not determine it — the caller shows everything rather
   * than hiding on an unknown.
   */
  hasScoredWeek: boolean | null
}

/**
 * ⚠ TWO TABLES, BECAUSE THE TWO PLATFORMS FILL DIFFERENT ONES. Measured on
 * production: the paired Sleeper league has 500 `MatchupFact` and 216
 * `WeeklyMatchup` rows; the Fantrax league has 60 `MatchupFact` and 0
 * `WeeklyMatchup`. Reading only `WeeklyMatchup` would report every Fantrax
 * league unscored forever, and reading only `MatchupFact` would count a fixture
 * list as a played season — the Fantrax rows exist with `scoreA`/`scoreB` at
 * their `0` default because the week has not been played.
 *
 * So the test is a non-zero SCORE, not the presence of a row.
 */
export async function getLeagueDataSignals(args: {
  leagueId: string
  /** `League.platformLeagueId` — `WeeklyMatchup` keys on the PROVIDER id. */
  platformLeagueId: string | null
}): Promise<LeagueDataSignals> {
  const [scoredFacts, weekly] = await Promise.all([
    prisma.matchupFact
      .count({
        where: {
          leagueId: args.leagueId,
          OR: [{ scoreA: { not: 0 } }, { scoreB: { not: 0 } }],
        },
      })
      .catch(() => null),
    args.platformLeagueId
      ? prisma.weeklyMatchup.count({ where: { leagueId: args.platformLeagueId } }).catch(() => null)
      : Promise.resolve(0),
  ])

  /*
   * Both unknown → unknown. One known → trust it. This keeps a single failed
   * read from hiding tabs on a league that has a perfectly good season.
   */
  if (scoredFacts == null && weekly == null) return { hasScoredWeek: null }
  return { hasScoredWeek: (scoredFacts ?? 0) > 0 || (weekly ?? 0) > 0 }
}

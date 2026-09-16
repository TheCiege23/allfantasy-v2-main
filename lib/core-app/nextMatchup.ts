import 'server-only'

import { prisma } from '@/lib/prisma'
import { hasScoringRules } from '@/lib/projections/leagueScoring'
import { leagueProjectionGap, leagueScoredLineupTotal, lookupProjections } from './playerProjections'

/**
 * Who you play next, and what both sides are projected to score.
 *
 * ⚠ THIS REPLACES TWO EMPTY TILES. "Points for" and "Points against" were the
 * season's running totals, which are 0-0 for every team in the league until the
 * first game is scored. So from launch until week 1 ends, the most prominent
 * numbers on My Team were two em dashes — accurate, and completely useless at
 * exactly the moment people are looking at their roster most.
 *
 * A projected matchup is the number that means something in that window: it is
 * what "points for" is going to be, before it exists.
 *
 * ⚠ `WeeklyMatchup.leagueId` HOLDS THE PLATFORM LEAGUE ID, NOT `League.id`.
 * This repo has two league id spaces and they are both strings, so passing the
 * wrong one returns an empty result rather than an error — the screen would
 * simply say "no matchup found" forever. The caller must pass
 * `League.platformLeagueId`.
 */

export type MatchupSide = {
  rosterId: string
  teamName: string | null
  managerName: string | null
  avatarUrl: string | null
  /** Projected total under the league's own scoring, null when unscoreable. */
  projected: number | null
  /** How many of their starters that total was built from. */
  projectedFrom: number
  starterCount: number
}

export type NextMatchup = {
  seasonYear: number
  week: number
  you: MatchupSide
  opponent: MatchupSide | null
  /** Set when the league recorded a matchup with no second team in it. */
  bye: boolean
  /**
   * Why neither side shows a projected total, or null when at least one does. Printed in place
   * of the one-line read, so a pair of dashes is never left to explain itself.
   */
  unpricedReason: string | null
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? '' : String(x))).filter(Boolean) : []
}

/** Sleeper writes an unfilled starting slot as "0". It is a hole, not a player. */
const EMPTY_SLOT = '0'

export async function getNextMatchup(args: {
  /** Internal `League.id` — used for LeagueTeam and Roster lookups. */
  leagueId: string
  /** `League.platformLeagueId` — used for WeeklyMatchup lookups. NOT the same id. */
  platformLeagueId: string | null
  /** The claimed team's `externalId`, which is the platform's roster id. */
  myExternalId: string | null
  /**
   * The signed-in user's `User.id`.
   *
   * ⚠ IT IS ONE OF THE THREE KEYS `Roster.platformUserId` CAN HOLD, and without
   * it this function priced the opponent and left YOUR side as an em dash — see
   * the note on the roster join below.
   */
  userId: string | null
  seasonYear: number
  week: number
  scoringSettings: Record<string, unknown> | null
  projectionWeek: { season: string; week: number } | null
}): Promise<NextMatchup | null> {
  const { leagueId, platformLeagueId, myExternalId, seasonYear, week } = args
  if (!platformLeagueId || !myExternalId) return null

  // WeeklyMatchup.rosterId is String now, matching LeagueTeam.externalId
  // directly -- was Number(myExternalId), which stopped matching the moment
  // rosterId became a native string instead of an Int this always had to
  // round-trip through.
  const myRosterId = myExternalId

  const rows = await prisma.weeklyMatchup
    .findMany({
      where: { leagueId: platformLeagueId, seasonYear, week },
      select: { rosterId: true, matchupId: true },
    })
    .catch(() => [])

  const mine = rows.find((r) => r.rosterId === myRosterId)
  if (!mine) return null

  /*
   * A null matchupId means the league recorded the week without pairing teams —
   * common in leagues that have not started. Treated as "no opponent known"
   * rather than guessing at one, because naming the wrong opponent is worse
   * than naming none.
   */
  const opponentRow =
    mine.matchupId == null
      ? null
      : rows.find((r) => r.matchupId === mine.matchupId && r.rosterId !== myRosterId) ?? null

  const rosterIds = [myRosterId, ...(opponentRow ? [opponentRow.rosterId] : [])]

  // LeagueTeam.externalId is the platform roster id, stored as a string.
  const teams = await prisma.leagueTeam
    .findMany({
      where: { leagueId, externalId: { in: rosterIds } },
      select: {
        externalId: true,
        teamName: true,
        ownerName: true,
        avatarUrl: true,
        platformUserId: true,
      },
    })
    .catch(() => [])

  const teamBy = new Map(teams.map((t) => [t.externalId, t]))

  /*
   * ⚠ THE HOP FROM A TEAM TO ITS ROSTER HAS NO SINGLE KEY, AND THIS FUNCTION
   * ONLY TRIED ONE OF THEM.
   *
   * `Roster.platformUserId` is always set but does not always hold the
   * PLATFORM's id — sometimes it holds `LeagueTeam.externalId`, and sometimes
   * our own `User` uuid. `lib/core-app/myRoster.ts` exists because of that and
   * spells out the measurement: with `platformUserId` alone, two thirds of
   * claimed teams failed to join a roster that was sitting right there.
   *
   * This file joined on `platformUserId` alone, so on any league where the
   * user's own roster is keyed the other way it read an EMPTY starting lineup
   * and returned `projected: null` — while the opponent, keyed normally,
   * priced fine. The visible symptom was a projected matchup reading
   * "— v 161.7" directly under a header tile saying 224.5, on the same screen,
   * built from the same starters. Observed on 33 1/3% Active.
   *
   * Candidate order matches `myRosterCandidates`: the platform id first, so a
   * normally-keyed roster still wins, and the user uuid is offered ONLY for the
   * caller's own team — an opponent's roster is never ours to find that way.
   */
  const candidatesFor = (rosterId: string): string[] => {
    const team = teamBy.get(String(rosterId))
    const keys = [
      team?.platformUserId,
      team?.externalId,
      rosterId === myRosterId ? args.userId : null,
    ]
    return [...new Set(keys.filter((v): v is string => typeof v === 'string' && v.length > 0))]
  }

  const rosters = await prisma.roster
    .findMany({
      where: {
        leagueId,
        platformUserId: { in: [...new Set(rosterIds.flatMap(candidatesFor))] },
      },
      select: { platformUserId: true, playerData: true },
    })
    .catch(() => [])

  const rosterBy = new Map(rosters.map((r) => [r.platformUserId, r]))

  // One projection lookup for both lineups.
  const allStarters = new Map<string, string[]>()
  for (const id of rosterIds) {
    const roster = candidatesFor(id)
      .map((key) => rosterBy.get(key))
      .find(Boolean)
    const pd = (roster?.playerData ?? {}) as Record<string, unknown>
    allStarters.set(
      id,
      asIds(pd.starters).filter((s) => s !== EMPTY_SLOT),
    )
  }

  const everyId = [...new Set([...allStarters.values()].flat())]
  // Without rules nothing can be priced this league's way, so the feed is not worth a read.
  const projections = everyId.length && hasScoringRules(args.scoringSettings)
    ? await lookupProjections(everyId, args.projectionWeek, {
        scoringSettings: args.scoringSettings,
      }).catch(() => new Map())
    : new Map()

  function side(rosterId: string): MatchupSide {
    const team = teamBy.get(String(rosterId))
    const starters = allStarters.get(rosterId) ?? []
    /*
     * Under the league's own rules only, so both sides are measured the same way and against
     * the number the roster above shows. This used to fall back to the generic figure "rather
     * than drop the player, because a total missing a starter reads low" — but the coverage line
     * beside the total and the withheld edge sentence already say when one is short, and a
     * standard-PPR number summed in is wrong without saying so. See `leagueScoredLineupTotal`.
     */
    const { projected, projectedFrom } = leagueScoredLineupTotal(starters, projections, args.scoringSettings)

    return {
      rosterId,
      teamName: team?.teamName ?? null,
      managerName: team?.ownerName ?? null,
      avatarUrl: team?.avatarUrl ?? null,
      projected,
      projectedFrom,
      starterCount: starters.length,
    }
  }

  const you = side(myRosterId)
  const opponent = opponentRow ? side(opponentRow.rosterId) : null
  const sides = opponent ? [you, opponent] : [you]

  return {
    seasonYear,
    week,
    you,
    opponent,
    bye: mine.matchupId != null && opponentRow == null,
    unpricedReason: leagueProjectionGap({
      scoringSettings: args.scoringSettings,
      starters: sides.reduce((n, s) => n + s.starterCount, 0),
      pricedStarters: sides.reduce((n, s) => n + s.projectedFrom, 0),
    }),
  }
}

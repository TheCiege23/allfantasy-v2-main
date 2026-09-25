import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
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

/**
 * Prices each lineup (roster id → starter ids) under the league's own rules.
 *
 * Supplied by a caller that has already priced players for the rest of its screen, so the
 * matchup card is a VIEW of those numbers rather than a second, disagreeing computation.
 */
export type MatchupLineupPricer = (
  lineups: ReadonlyMap<string, readonly string[]>,
) => Promise<ReadonlyMap<string, { projected: number | null; projectedFrom: number }>>

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
  /**
   * YOUR starters as the rest of the screen shows them, when the caller holds a fresher lineup
   * than the stored `Roster` row — My Team reads Sleeper's live weekly lineup. Omitted, your side
   * is read from the stored roster like the opponent's.
   *
   * 🛑 WITHOUT THIS THE CARD PRICED A DIFFERENT LINEUP FROM THE HEADER ABOVE IT. The stored row
   * is whatever the last sync wrote; a lineup set in Sleeper since then is invisible to it.
   */
  myStarters?: readonly string[] | null
  /**
   * The platform's live lineup for every roster the caller could read, and the week it is for.
   * Used for any side of this pairing it covers — above all the OPPONENT's — and ONLY when its
   * week is this matchup's week; a roster it does not cover falls back to the stored row.
   * `myStarters` still wins for your own side.
   *
   * 🛑 WITHOUT THIS THE OPPONENT WAS ALWAYS THE STORED ROW, so your live lineup was measured
   * against theirs as of the last sync — a starter they had since benched still counted for them.
   */
  liveStarters?: { week: number; byRosterId: Readonly<Record<string, readonly string[]>> } | null
  /**
   * How to price the lineups. Omitted, the feed is read here and summed with
   * `leagueScoredLineupTotal`. My Team passes its own pricer so a ruled-out or bye starter is the
   * 0 its roster row shows, not his full projection — see `sumLeagueScoredStarters`.
   */
  priceLineups?: MatchupLineupPricer | null
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
        claimedByUserId: true,
      },
    })
    .catch(() => [])

  const teamBy = new Map(teams.map((t) => [t.externalId, t]))

  /*
   * ⚠ THE HOP FROM A TEAM TO ITS ROSTER HAS NO SINGLE KEY, AND THIS FUNCTION TRIED ONLY OWNER KEYS.
   *
   * `Roster.platformUserId` is always set but does not always hold the PLATFORM's id — sometimes
   * it holds `LeagueTeam.externalId`, sometimes our own `User` uuid, and since #1005 sometimes
   * `orphan-<provider>-<teamId>`, which is nobody's manager id at all. Joining on owner keys alone
   * read an EMPTY starting lineup and returned `projected: null`: the "— v 161.7" a user sees under
   * a header tile reading 224.5, built from the same starters.
   *
   * First measured for the CALLER's own roster (33 1/3% Active). It then came back from the other
   * side: production 2026-09-17, 60 matchups of a claimed team in 16 leagues, across all 18 weeks,
   * are against a team whose roster no owner key can reach. `resolveRostersForTeams` owns the rule
   * for every reader — the provider team id first, then the manager id, then the owner keys below.
   *
   * ⚠ THE READ IS NO LONGER FILTERED BY OWNER KEY, because the key we need may be one we cannot
   * name. It is one league's rosters — a dozen rows — and the match happens here.
   */
  const rosters = await prisma.roster
    .findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true },
    })
    .catch(() => [])

  /*
   * The user uuid is offered ONLY for the caller's own team: an opponent's roster is never ours to
   * find that way. Order otherwise matches `myRosterCandidates`.
   */
  const rosterByTeam = resolveRostersForTeams(teams, rosters, (team) => [
    team.platformUserId,
    team.externalId,
    team.externalId === myRosterId ? args.userId : null,
  ])

  // A live lineup for another week describes a different game; it is not this one's.
  const live = args.liveStarters?.week === week ? args.liveStarters.byRosterId : null

  // One projection lookup for both lineups.
  const allStarters = new Map<string, string[]>()
  for (const id of rosterIds) {
    const liveIds = live && Object.hasOwn(live, id) ? live[id] : null
    const roster = rosterByTeam.get(String(id))
    const pd = (roster?.playerData ?? {}) as Record<string, unknown>
    allStarters.set(
      id,
      (liveIds ? [...liveIds] : asIds(pd.starters)).filter((s) => Boolean(s) && s !== EMPTY_SLOT),
    )
  }
  if (args.myStarters) {
    allStarters.set(myRosterId, args.myStarters.filter((s) => Boolean(s) && s !== EMPTY_SLOT))
  }

  const everyId = [...new Set([...allStarters.values()].flat())]
  // Without rules nothing can be priced this league's way, so the feed is not worth a read.
  const canPrice = everyId.length > 0 && hasScoringRules(args.scoringSettings)
  const priced = canPrice && args.priceLineups
    ? await args.priceLineups(allStarters).catch(() => null)
    : null
  const projections = canPrice && !args.priceLineups
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
    const { projected, projectedFrom } = args.priceLineups
      ? priced?.get(rosterId) ?? { projected: null, projectedFrom: 0 }
      : leagueScoredLineupTotal(starters, projections, args.scoringSettings)

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

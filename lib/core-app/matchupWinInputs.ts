import { loadSideProjections, type SideProjections } from './matchupProjections'
import { myRosterCandidates } from './myRoster'
import { prisma } from '@/lib/prisma'

/**
 * The inputs to one matchup's win probability, shared by the Matchup screen and the
 * home exposure breakdown so the two cannot price the same week differently.
 *
 * Extracted from `getMatchupData` unchanged; the notes below travelled with it.
 */

/**
 * Both sides of a matchup priced against this week's projections, or null when
 * either side cannot be matched to an imported roster.
 *
 * `opponent` is null when your team has no paired row this week.
 */
export async function loadMatchupSides(args: {
  leagueId: string
  season: number
  week: number
  userId: string
  you: { platformUserId: string | null; externalId: string | null }
  opponent: { platformUserId: string | null; rosterId: string } | null
}): Promise<SideProjections | null> {
  /*
   * ⚠ THE ROSTER JOIN IS RESOLVED HERE, NOT ASSUMED. `Roster.platformUserId` is
   * populated from several import paths and does not always hold the platform's
   * user id — it sometimes holds our own User uuid. Passing `LeagueTeam.
   * platformUserId` alone found a roster for 38 of 106 claimed teams elsewhere in
   * this codebase, so both candidates are tried and the ACTUAL matching
   * `Roster.platformUserId` is what gets handed on.
   */
  /*
   * ⚠ AND `externalId` IS THE THIRD CANDIDATE, NOT AN OPTIONAL EXTRA. This list
   * was `[platformUserId, userId]` and it is now `myRosterCandidates` — the
   * repo's canonical set, whose own note records that dropping one key took the
   * join from 93 claimed teams to 38. The cross-league pulse hit exactly this:
   * keyed on `platformUserId` alone it resolved every OPPONENT's roster and not
   * one of the user's own.
   */
  const yourCandidates = myRosterCandidates(args.you, args.userId)
  const theirCandidates = [args.opponent?.platformUserId, args.opponent?.rosterId]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  const rosterCandidates = [...new Set([...yourCandidates, ...theirCandidates])]

  const rosterRows = rosterCandidates.length
    ? await prisma.roster.findMany({
        where: { leagueId: args.leagueId, platformUserId: { in: rosterCandidates } },
        select: { platformUserId: true },
      })
    : []
  const rosterIds = new Set(rosterRows.map((r) => r.platformUserId))
  const yourRosterKey = yourCandidates.find((c) => rosterIds.has(c)) ?? null
  /*
   * ⚠ THE OPPONENT MUST NOT RESOLVE TO THE KEY THE USER JUST TOOK. `externalId`
   * and a roster id are both small integers, so without this the two sides of a
   * matchup can land on the same roster and the screen renders a team playing
   * itself.
   */
  const oppRosterKey = theirCandidates.find((c) => c !== yourRosterKey && rosterIds.has(c)) ?? null

  /*
   * ⚠ SEASON AND WEEK COME FROM THE MATCHUP ROW, NOT FROM THE PROJECTION FEED, and
   * that mismatch is load-bearing rather than a bug. Asking the feed for a week it
   * has not written returns nothing, every starter lands in `unprojected`, and the
   * callers refuse — which is exactly right for a COMPLETED week. A projected final
   * for a game that already finished is not a projection, it is noise printed over
   * a result.
   */
  return yourRosterKey && oppRosterKey
    ? await loadSideProjections({
        leagueId: args.leagueId,
        season: args.season,
        week: args.week,
        yourPlatformUserId: yourRosterKey,
        opponentPlatformUserId: oppRosterKey,
      }).catch(() => null)
    : null
}

/**
 * Points already on the board for each side. An in-progress game is scored from these
 * plus what is left, rather than from projections alone. Without a paired opponent row,
 * your row's `pointsAgainst` is the opponent's total.
 */
export function matchupCurrentPoints(
  mine: { pointsFor: number; pointsAgainst: number },
  opponentRow: { pointsFor: number } | null | undefined,
): { you: number; opponent: number } {
  return { you: mine.pointsFor, opponent: opponentRow?.pointsFor ?? mine.pointsAgainst }
}

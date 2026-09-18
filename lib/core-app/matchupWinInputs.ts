import { loadSideProjections, type LivePoints, type SideProjections } from './matchupProjections'
import { myRosterCandidates } from './myRoster'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
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
  /*
   * 🛑 AND SINCE #1005 THE KEY MAY BE ONE WE CANNOT NAME. A managerless team's roster is stored
   * under `orphan-<provider>-<teamId>` and a team whose manager changed keeps its old row — so no
   * list of manager ids can reach either, and a candidate-filtered query cannot even fetch the row.
   * Measured on production 2026-09-17: 60 matchups of a claimed team, in 16 leagues, over all 18
   * weeks, have such a team on one side. This returned null for every one of them, so the screen
   * showed no win probability at all — indistinguishable from a week the feed has not projected.
   *
   * `resolveRostersForTeams` owns the rule (provider team id, then manager id, then the owner keys
   * above). The read is scoped to the league rather than to keys, because the key is the unknown.
   */
  const yourCandidates = myRosterCandidates(args.you, args.userId)
  const sides = [
    { externalId: args.you.externalId, platformUserId: args.you.platformUserId, keys: yourCandidates },
    ...(args.opponent
      ? [
          {
            externalId: args.opponent.rosterId,
            platformUserId: args.opponent.platformUserId,
            /* Never `userId` here: that key is the CALLER's, and would match them to both sides. */
            keys: [args.opponent.platformUserId, args.opponent.rosterId],
          },
        ]
      : []),
  ]

  const rosterRows = await prisma.roster
    .findMany({
      where: { leagueId: args.leagueId },
      select: { id: true, platformUserId: true, playerData: true },
    })
    .catch(() => [])

  /*
   * ⚠ THE OPPONENT MUST NOT RESOLVE TO THE ROW THE USER JUST TOOK. `externalId` and a roster id are
   * both small integers, so without that the two sides can land on one roster and the screen renders
   * a team playing itself. The resolver gives one row to one team, and the caller is listed first.
   */
  const byTeam = resolveRostersForTeams(sides, rosterRows, (side) => side.keys)
  const yourRow = args.you.externalId ? byTeam.get(args.you.externalId) ?? null : null
  const oppRow = args.opponent ? byTeam.get(args.opponent.rosterId) ?? null : null

  /*
   * ⚠ A TEAM WITH NO PROVIDER ID CANNOT BE KEYED BY THE RESOLVER, so the owner keys still answer for
   * the caller's side. Production 2026-09-17: 0 of 392 claimed teams lack one — a guard against the
   * type, not a case anyone is in; without it such a team would lose a join it has today.
   */
  const yourRosterKey =
    yourRow?.platformUserId ??
    (args.you.externalId
      ? null
      : yourCandidates.find((c) => rosterRows.some((r) => r.platformUserId === c)) ?? null)

  /*
   * ⚠ THE SAME ROW ON BOTH SIDES IS A TEAM PLAYING ITSELF. `externalId` and a roster id are both
   * small integers, so a matchup can name one team twice. The resolver already gives one row to one
   * team; this refuses the degenerate case where BOTH sides carry the same team id, which no
   * one-row-per-team rule can separate.
   */
  const oppRosterKey = oppRow && oppRow !== yourRow ? oppRow.platformUserId : null

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

/**
 * The lineup ids whose own scores the model can use — both sides, as the rosters hold them.
 * An empty slot (`'0'`) and a `name:` descriptor can never have a score row.
 */
export function liveLineupIds(sides: SideProjections): string[] {
  return [
    ...new Set(
      [...sides.you.lineup, ...sides.opponent.lineup]
        .map((slot) => slot.playerId)
        .filter((id) => id !== '0' && id.length > 0 && !id.startsWith('name:')),
    ),
  ]
}

/**
 * Each lineup player's points so far, from the platform's own per-player scoring.
 *
 * ⚠ `league_player_weekly_scores.leagueId` IS THE PLATFORM LEAGUE ID, not ours — the same key
 * `WeeklyMatchup` uses. Null, never an empty map, when nothing was read or the read failed:
 * the model treats "no per-player scores" as a reason to refuse a live matchup, and an empty
 * map would say the same thing less clearly.
 */
export async function loadLivePlayerPoints(args: {
  platformLeagueId: string
  season: number
  week: number
  playerIds: string[]
}): Promise<Map<string, number> | null> {
  if (args.playerIds.length === 0) return null
  const rows = await Promise.resolve()
    .then(() =>
      prisma.leaguePlayerWeeklyScore.findMany({
        where: {
          leagueId: args.platformLeagueId,
          seasonYear: args.season,
          week: args.week,
          playerId: { in: args.playerIds },
        },
        select: { playerId: true, points: true },
      }),
    )
    .catch(() => [])
  return rows.length > 0 ? new Map(rows.map((r) => [r.playerId, r.points])) : null
}

/** The scoreboard totals and the per-player points, as one `LivePoints`. */
export function matchupLivePoints(
  mine: { pointsFor: number; pointsAgainst: number },
  opponentRow: { pointsFor: number } | null | undefined,
  byPlayer: ReadonlyMap<string, number> | null,
): LivePoints {
  return { team: matchupCurrentPoints(mine, opponentRow), byPlayer }
}

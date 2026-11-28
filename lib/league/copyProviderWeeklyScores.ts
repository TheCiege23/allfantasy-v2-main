import type { Prisma } from '@prisma/client'
import { rosterIdMapKeys } from '@/lib/core-app/rosterIdMatch'
import { NATIVE_PLAYER_SCORE_SOURCE, nativeRosterSeat } from '@/lib/redraft/nativePlayerWeeklyScores'
import { translateImportedPlayerIds } from '@/lib/league-creation/canonical/importedIdentityPlan'

/**
 * Copy a converted league's past provider weeks into AllFantasy's own score tables — owner decision Q4,
 * docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md step 4b-2. Runs inside the switch's transaction, BEFORE the
 * flip, while `League.platformLeagueId` still names the provider league the source rows are keyed by.
 *
 * What it writes, and how native readers find it:
 *   - `RedraftMatchup`, one row per provider matchup, `status: 'final'`, on the season's `RedraftRoster`s — what the
 *     schedule, history and recap screens read by `seasonId` + `week`. Playoff weeks get `type: 'playoff'`.
 *   - `LeaguePlayerWeeklyScore` rows re-keyed the native way (`nativePlayerWeeklyScores.ts`): `leagueId` = League.id,
 *     `source` = 'allfantasy', `rosterId` = `nativeRosterSeat(RedraftRoster.id)`, native player ids. The provider's
 *     own rows are left exactly where they are — other members' imports of the same provider league still use them.
 *
 * ⚠ IT SKIPS RATHER THAN GUESSES. A team it cannot match, a week with three sides, or a player with no AllFantasy
 * identity is counted and left out; a matchup with a wrong opponent is worse than a gap.
 *
 * ⚠ AND IT REFUSES TO RUN TWICE. `RedraftMatchup` has no unique key, so if the season already holds any matchups the
 * copy writes none and says why. The player rows are protected by their unique key (`skipDuplicates`).
 *
 * The standings are not recomputed from these rows: the season's records came from the provider and stay as they are.
 */

type Tx = Prisma.TransactionClient

export type ProviderScoreCopy = {
  matchups: number
  /** Provider matchups left out: a team that could not be matched, or more than two sides. */
  matchupsSkipped: number
  playerScores: number
  /** Player rows left out because the player has no AllFantasy identity. */
  playerScoresUnmapped: number
  /** Set when the matchup copy did not run at all. */
  matchupsNotCopied?: 'season_already_has_matchups' | 'no_provider_weeks'
  /** Ids of the matchups written, for undo. */
  matchupIds: string[]
}

export async function copyProviderWeeklyScores(tx: Tx, args: {
  leagueId: string
  /** `League.platformLeagueId` BEFORE the flip: the provider's league id the source rows are keyed by. */
  providerLeagueId: string
  season: number
  seasonId: string
  playoffStartWeek: number | null
  sport: string
  platform: string
  /** Provider team id (`LeagueTeam.externalId` before the switch) → the season's `RedraftRoster.id`. */
  redraftRosterIdByExternalId: Map<string, string>
  /** Provider player id → native player id, already resolved for the current rosters. */
  idMap: Map<string, string>
}): Promise<ProviderScoreCopy> {
  // A WeeklyMatchup roster id loses MFL's zero padding ("0001" → "1"); register every spelling.
  const redraftByRosterKey = new Map<string, string>()
  for (const [externalId, redraftId] of args.redraftRosterIdByExternalId) {
    for (const key of rosterIdMapKeys(externalId)) redraftByRosterKey.set(key, redraftId)
  }
  const resolve = (rosterId: string | number | null | undefined) => (rosterId == null ? undefined : redraftByRosterKey.get(String(rosterId)))
  const result: ProviderScoreCopy = { matchups: 0, matchupsSkipped: 0, playerScores: 0, playerScoresUnmapped: 0, matchupIds: [] }

  // ── Matchups ─────────────────────────────────────────────────────────────────────────────────
  const existing = await tx.redraftMatchup.count({ where: { seasonId: args.seasonId } })
  const weekly = await tx.weeklyMatchup.findMany({
    where: { leagueId: args.providerLeagueId, seasonYear: args.season },
    orderBy: [{ week: 'asc' }, { game: 'asc' }, { rosterId: 'asc' }],
    select: { week: true, game: true, matchupId: true, rosterId: true, pointsFor: true },
  })
  if (existing > 0) result.matchupsNotCopied = 'season_already_has_matchups'
  else if (!weekly.length) result.matchupsNotCopied = 'no_provider_weeks'
  else {
    const groups = new Map<string, typeof weekly>()
    for (const row of weekly) {
      // A row with no matchup id played nobody that week (a bye, or a median-only week): it stands alone.
      const key = `${row.week}:${row.game}:${row.matchupId ?? `solo-${row.rosterId}`}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    const data: Prisma.RedraftMatchupUncheckedCreateInput[] = []
    for (const sides of groups.values()) {
      const resolved = sides.map((side) => ({ side, redraftId: resolve(side.rosterId) }))
      if (sides.length > 2 || resolved.some((r) => !r.redraftId)) { result.matchupsSkipped++; continue }
      const [home, away] = resolved
      const week = home!.side.week
      data.push({
        seasonId: args.seasonId,
        leagueId: args.leagueId,
        week,
        type: args.playoffStartWeek != null && week >= args.playoffStartWeek ? 'playoff' : 'regular',
        homeRosterId: home!.redraftId!,
        awayRosterId: away?.redraftId ?? null,
        homeScore: home!.side.pointsFor,
        awayScore: away?.side.pointsFor ?? 0,
        status: 'final',
      })
    }
    if (data.length) {
      // createMany returns no ids, and undo needs them: write row by row (a season is a few hundred rows at most).
      for (const row of data) {
        const created = await tx.redraftMatchup.create({ data: row, select: { id: true } })
        result.matchupIds.push(created.id)
      }
      result.matchups = data.length
    }
  }

  // ── Per-player points ────────────────────────────────────────────────────────────────────────
  const playerRows = await tx.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: args.providerLeagueId, seasonYear: args.season, source: { not: NATIVE_PLAYER_SCORE_SOURCE } },
    select: { week: true, playerId: true, rosterId: true, isStarter: true, points: true },
  })
  if (playerRows.length) {
    // Past weeks name players no longer on any roster, so the current rosters' map is not enough.
    const missing = [...new Set(playerRows.map((r) => r.playerId).filter((id) => !args.idMap.has(id)))]
    const more = missing.length ? await translateImportedPlayerIds(tx, { sport: args.sport, platform: args.platform, sourceIds: missing }) : null
    const nativeId = (id: string) => args.idMap.get(id) ?? (more?.ambiguous.includes(id) ? undefined : more?.idMap.get(id))
    const data: Prisma.LeaguePlayerWeeklyScoreCreateManyInput[] = []
    for (const row of playerRows) {
      const playerId = nativeId(row.playerId)
      if (!playerId) { result.playerScoresUnmapped++; continue }
      const redraftId = resolve(row.rosterId)
      data.push({
        leagueId: args.leagueId,
        seasonYear: args.season,
        week: row.week,
        playerId,
        rosterId: redraftId ? nativeRosterSeat(redraftId) : null,
        isStarter: row.isStarter,
        points: row.points,
        isFinalized: true,
        source: NATIVE_PLAYER_SCORE_SOURCE,
      })
    }
    if (data.length) {
      const written = await tx.leaguePlayerWeeklyScore.createMany({ data, skipDuplicates: true })
      result.playerScores = written.count
    }
  }
  return result
}

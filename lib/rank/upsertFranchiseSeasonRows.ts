import type { Prisma } from '@prisma/client'

/**
 * Real, per-franchise season-outcome shape — matches exactly what
 * `RedraftOffseasonService.ts::enterRedraftOffseason` computes for
 * `LeagueSeason.teamRecords` on a NATIVE (AllFantasy-created) league. Not
 * the same shape `lib/league/history-aggregates.ts`'s `LeagueSeasonTeamRecord`
 * uses — that one is written by `syncLeagueHistory.ts` for Sleeper-imported
 * leagues' history sync (numeric roster_id/owner_id, no franchiseId/rank/
 * playoffSeed). `LeagueSeason.teamRecords` is a `Json` column populated by
 * two different code paths with two different real shapes depending on
 * whether the league is native or imported-then-synced — this type
 * describes only the native one, confirmed by reading
 * `RedraftOffseasonService.ts` directly rather than guessed.
 */
export interface NativeSeasonRecord {
  rosterId: string | null
  franchiseId: string | null
  managerUserId: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  playoffSeed: number | null
  rank: number
}

/**
 * Single source of truth for writing `FranchiseSeason` rows from a native
 * league's real, already-computed season records. Called both from the
 * live season-finalize path (`enterRedraftOffseason`) and the historical
 * backfill script (`scripts/backfill-franchise-seasons.ts`) — never a
 * second, independently-derived champion/record determination between the
 * two callers.
 */
export async function upsertFranchiseSeasonRows(
  tx: Prisma.TransactionClient,
  args: {
    leagueId: string
    season: number
    records: NativeSeasonRecord[]
    /** The real `rosterId` of the champion/runner-up, from the SAME `records` array — never re-derived. */
    championRosterId: string | null
    runnerUpRosterId: string | null
  },
): Promise<number> {
  let written = 0
  for (const record of args.records) {
    if (!record.rosterId) continue
    await tx.franchiseSeason.upsert({
      where: { leagueId_rosterId_season: { leagueId: args.leagueId, rosterId: record.rosterId, season: args.season } },
      update: {
        userId: record.managerUserId ?? null,
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        pointsFor: record.pointsFor,
        pointsAgainst: record.pointsAgainst,
        madePlayoffs: record.playoffSeed != null && record.playoffSeed > 0,
        wonChampionship: record.rosterId === args.championRosterId,
        runnerUp: record.rosterId === args.runnerUpRosterId,
        finalRank: record.rank,
      },
      create: {
        leagueId: args.leagueId,
        rosterId: record.rosterId,
        userId: record.managerUserId ?? null,
        season: args.season,
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        pointsFor: record.pointsFor,
        pointsAgainst: record.pointsAgainst,
        madePlayoffs: record.playoffSeed != null && record.playoffSeed > 0,
        wonChampionship: record.rosterId === args.championRosterId,
        runnerUp: record.rosterId === args.runnerUpRosterId,
        finalRank: record.rank,
      },
    })
    written++
  }
  return written
}

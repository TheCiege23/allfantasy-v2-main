/**
 * Phase 2C — RankingContextProvider
 *
 * Composes a real `RankingSnapshot` from:
 *   - the user's imported history (LegacyUser → LegacyLeague → LegacyRoster),
 *   - per-league difficulty ratings (computed in-line via the difficulty engine),
 * and returns it as `RankingContextSlice`.
 *
 * Rules:
 *   - DB-first (Prisma only).
 *   - Never throws.
 *   - Returns `{ snapshot: null }` when no imported history exists.
 *   - No persistence (cache table arrives in Batch 2).
 *
 * The manager's standing — ladder level, the ±2 class they can be matched in,
 * and per-sport skill — rides along on every return, history or not
 * (`managerStanding.ts`). A brand-new manager has a level and a class long
 * before they have legacy history.
 */

import { prisma } from "@/lib/prisma"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  ProviderResult,
  RankingContextSlice,
} from "@/lib/chimmy-context/types"
import { composeRankingSnapshot } from "@/lib/ranking/snapshot"
import { computeLeagueDifficulty } from "@/lib/ranking/league-difficulty"
import { loadManagerStanding, type ManagerStanding } from "@/lib/chimmy-context/providers/managerStanding"
import type {
  ImportedHistoryScore,
  LeagueDifficultyRating,
} from "@/lib/ranking/types"

async function resolveLegacyUserId(userId: string): Promise<string | null> {
  const appUser = await prisma.appUser
    .findUnique({ where: { id: userId }, select: { legacyUserId: true } })
    .catch(() => null)
  return appUser?.legacyUserId ?? null
}

export class RankingContextProvider
  implements ChimmyContextProvider<RankingContextSlice>
{
  readonly name = "ranking"
  readonly defaultTtlMs = 5 * 60 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<RankingContextSlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    const standingRead = loadManagerStanding(request.userId).catch((): ManagerStanding => ({}))
    try {
      const legacyUserId = await resolveLegacyUserId(request.userId)
      if (!legacyUserId) {
        return {
          ok: true,
          data: { snapshot: null, ...(await standingRead) },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const legacy = await prisma.legacyUser.findUnique({
        where: { id: legacyUserId },
        select: {
          id: true,
          sleeperUserId: true,
          leagues: {
            select: {
              id: true,
              season: true,
              sport: true,
              leagueType: true,
              scoringType: true,
              teamCount: true,
              rosters: {
                select: {
                  ownerId: true,
                  isOwner: true,
                  wins: true,
                  losses: true,
                  ties: true,
                  isChampion: true,
                  finalStanding: true,
                  playoffSeed: true,
                },
              },
            },
          },
        },
      })

      if (!legacy || legacy.leagues.length === 0) {
        return {
          ok: true,
          data: { snapshot: null, ...(await standingRead) },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      type LegacyLeagueRow = (typeof legacy.leagues)[number]
      type LegacyRosterRow = LegacyLeagueRow["rosters"][number]

      let wins = 0
      let losses = 0
      let ties = 0
      let championships = 0
      let playoffAppearances = 0
      const seasons = new Set<number>()

      const leagueDifficulties: LeagueDifficultyRating[] = []

      for (const league of legacy.leagues) {
        seasons.add(league.season)

        // pick this user's roster row
        const owned: LegacyRosterRow | undefined =
          league.rosters.find(
            (r: LegacyRosterRow) =>
              r.ownerId != null &&
              String(r.ownerId) === String(legacy.sleeperUserId)
          ) ??
          league.rosters.find((r: LegacyRosterRow) => r.isOwner === true)

        if (owned) {
          wins += owned.wins ?? 0
          losses += owned.losses ?? 0
          ties += owned.ties ?? 0
          if (owned.isChampion) championships += 1
          if (
            (owned.playoffSeed != null && owned.playoffSeed > 0) ||
            owned.isChampion ||
            (owned.finalStanding != null && owned.finalStanding > 0)
          ) {
            playoffAppearances += 1
          }
        }

        const difficulty = computeLeagueDifficulty({
          leagueId: league.id,
          sport: league.sport as unknown as string,
          leagueType: league.leagueType,
          scoring: league.scoringType,
          teamCount: league.teamCount,
        })
        leagueDifficulties.push({
          leagueId: difficulty.leagueId,
          base: difficulty.base,
          modifiers: difficulty.modifiers,
          effective: difficulty.effective,
        })
      }

      const importedHistory: ImportedHistoryScore[] = [
        {
          source: "sleeper_history",
          wins,
          losses,
          ties,
          championships,
          playoffAppearances,
          seasons: seasons.size,
        },
      ]

      const snapshot = composeRankingSnapshot({
        userId: request.userId,
        importedHistory,
        leagueDifficulties,
        capturedAt: fetchedAt,
      })

      return {
        ok: true,
        data: { snapshot, ...(await standingRead) },
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      return {
        ok: false,
        data: { snapshot: null, ...(await standingRead) },
        error: err instanceof Error ? err.message : "Unknown ranking error",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

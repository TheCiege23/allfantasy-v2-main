/**
 * Phase 2A — ImportHistoryContextProvider
 *
 * Pulls a compact rollup of the user's imported Sleeper history from the
 * existing `LegacyUser` model. Mirrors the shape the chat route already
 * derives via `getLegacyContext`, so a later Phase 2B refactor can replace
 * that inline call with this provider without behavioural drift.
 */

import { prisma } from "@/lib/prisma"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  ImportedHistorySlice,
  ProviderResult,
} from "@/lib/chimmy-context/types"

async function resolveSleeperUsername(userId: string): Promise<string | null> {
  const profile = await prisma.userProfile
    .findUnique({
      where: { userId },
      select: { sleeperUsername: true },
    })
    .catch(() => null)
  const v = profile?.sleeperUsername?.trim().toLowerCase()
  return v ? v : null
}

export class ImportHistoryContextProvider
  implements ChimmyContextProvider<ImportedHistorySlice>
{
  readonly name = "importedHistory"
  readonly defaultTtlMs = 60 * 60 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<ImportedHistorySlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    try {
      const username = await resolveSleeperUsername(request.userId)
      if (!username) {
        return {
          ok: true,
          data: {
            source: null,
            totalLeagues: 0,
            totalSeasons: 0,
            careerRecord: null,
            winPercentage: null,
            championships: 0,
            recentLeagues: [],
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const legacy = await prisma.legacyUser.findUnique({
        where: { sleeperUsername: username },
        include: {
          leagues: { include: { rosters: true } },
        },
      })

      if (!legacy) {
        return {
          ok: true,
          data: {
            source: "sleeper",
            totalLeagues: 0,
            totalSeasons: 0,
            careerRecord: null,
            winPercentage: null,
            championships: 0,
            recentLeagues: [],
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const allRosters = legacy.leagues.flatMap(
        (l: (typeof legacy.leagues)[number]) => l.rosters
      )
      const totalWins = allRosters.reduce(
        (sum: number, r: { wins?: number | null }) => sum + (r.wins ?? 0),
        0
      )
      const totalLosses = allRosters.reduce(
        (sum: number, r: { losses?: number | null }) => sum + (r.losses ?? 0),
        0
      )
      const championships = allRosters.filter(
        (r: { isChampion?: boolean | null }) => r.isChampion === true
      ).length

      const totalSeasons = Array.from(
        new Set(legacy.leagues.map((l: (typeof legacy.leagues)[number]) => l.season))
      ).length
      const winPct =
        totalWins + totalLosses > 0
          ? Math.round((totalWins / (totalWins + totalLosses)) * 100)
          : null

      type LegacyLeague = (typeof legacy.leagues)[number]
      const recentLeagues = legacy.leagues
        .slice()
        .sort((a: LegacyLeague, b: LegacyLeague) => b.season - a.season)
        .slice(0, 5)
        .map((l: LegacyLeague) => {
          const roster = l.rosters[0] as
            | { wins?: number | null; losses?: number | null; isChampion?: boolean | null }
            | undefined
          return {
            name: l.name,
            season: l.season,
            record:
              roster && (roster.wins != null || roster.losses != null)
                ? `${roster.wins ?? 0}-${roster.losses ?? 0}`
                : null,
            champion: roster?.isChampion === true,
          }
        })

      // 🛑 NO `archetype`. This slice used to copy the legacy AI report's manager archetype
      // ("Trader", "Sniper", ...) and the grounding serializer printed it into Chimmy's prompt.
      // Milestone 32: characterisation labels steer nothing a user sees. Facts only.
      const slice: ImportedHistorySlice = {
        source: "sleeper",
        totalLeagues: legacy.leagues.length,
        totalSeasons,
        careerRecord: totalWins + totalLosses > 0 ? `${totalWins}-${totalLosses}` : null,
        winPercentage: winPct,
        championships,
        recentLeagues,
      }

      return {
        ok: true,
        data: slice,
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : "Unknown import history error",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

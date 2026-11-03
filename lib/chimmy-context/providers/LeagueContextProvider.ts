/**
 * Phase 2A — LeagueContextProvider
 *
 * Returns a compact league list + active league projection for AI context.
 * Intentionally minimal: name, platform, sport, season, format, scoring, size,
 * commissioner flag. Heavier league internals (rosters, transactions) are
 * served by dedicated providers.
 *
 * Active league resolution order:
 *   1. `request.leagueId` (must belong to the user — guarded upstream)
 *   2. `AppUser.activeLeagueId` if it exists in the returned set
 *   3. Most-recently-created league
 */

import { prisma } from "@/lib/prisma"
import { EXCLUDED_VARIANTS } from "@/lib/leagues/leagueListFilter"
import { leagueTypeBasis } from "@/lib/league/leagueTypeGrading"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  LeagueContextSlice,
  LeagueSummary,
  ProviderResult,
} from "@/lib/chimmy-context/types"

const VARIANT_NOT_IN = Array.from(EXCLUDED_VARIANTS)

export function resolveFormat(row: {
  leagueType?: string | null
  settings?: unknown
  platform?: string | null
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
}): string | null {
  const basis = leagueTypeBasis({ settings: row.settings, leagueType: row.leagueType, platform: row.platform })
  if (basis.source === 'confirmed' || (basis.type !== 'redraft' && basis.type !== 'dynasty')) return basis.type
  if (row.guillotineMode) return 'guillotine'
  if (row.bestBallMode) return 'best_ball'
  if (row.isDynasty) return 'dynasty'
  return basis.type
}

export class LeagueContextProvider
  implements ChimmyContextProvider<LeagueContextSlice>
{
  readonly name = "league"
  readonly defaultTtlMs = 60 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<LeagueContextSlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    try {
      const [appUser, profile, rows] = await Promise.all([
        prisma.appUser.findUnique({
          where: { id: request.userId },
          select: { activeLeagueId: true },
        }),
        prisma.userProfile.findUnique({
          where: { userId: request.userId },
          select: { sleeperUsername: true },
        }),
        prisma.league.findMany({
          where: {
            name: { not: null },
            AND: [
              {
                OR: [
                  { userId: request.userId },
                  { redraftMembers: { some: { userId: request.userId } } },
                  { teams: { some: { claimedByUserId: request.userId } } },
                ],
              },
              {
                OR: [
                  { leagueVariant: null },
                  { leagueVariant: { notIn: VARIANT_NOT_IN } },
                ],
              },
            ],
          },
          orderBy: [{ season: "desc" }, { createdAt: "desc" }],
          take: 50,
          select: {
            id: true,
            name: true,
            platform: true,
            sport: true,
            season: true,
            scoring: true,
            isDynasty: true,
            leagueType: true,
            settings: true,
            guillotineMode: true,
            bestBallMode: true,
            leagueSize: true,
            isCommissioner: true,
            redraftMembers: {
              where: { userId: request.userId },
              select: { role: true },
            },
            teams: {
              where: { claimedByUserId: request.userId },
              select: { isCommissioner: true, isCoCommissioner: true },
            },
          },
        }),
      ])

      const leagues: LeagueSummary[] = rows.map((row: (typeof rows)[number]) => {
        const member = row.redraftMembers[0]
        const team = row.teams[0]
        const isCommissioner =
          row.isCommissioner === true ||
          team?.isCommissioner === true ||
          team?.isCoCommissioner === true ||
          member?.role === "COMMISSIONER"
        const platform = String(row.platform ?? "").toLowerCase()
        const role: LeagueSummary["role"] = isCommissioner
          ? "commissioner"
          : platform && platform !== "allfantasy" && platform !== "af" && platform !== "manual"
            ? "imported"
            : "member"

        return {
          id: row.id,
          name: row.name ?? null,
          platform: row.platform ?? "unknown",
          sport: row.sport ?? null,
          season: typeof row.season === "number" ? row.season : null,
          format: resolveFormat(row),
          scoring: row.scoring ?? null,
          numTeams: typeof row.leagueSize === "number" ? row.leagueSize : null,
          isCommissioner,
          role,
        }
      })

      const byId = new Map(leagues.map((l) => [l.id, l]))
      const explicit = request.leagueId ? byId.get(request.leagueId) : undefined
      const fromAppUser = appUser?.activeLeagueId ? byId.get(appUser.activeLeagueId) : undefined
      const activeLeague = explicit ?? fromAppUser ?? leagues[0] ?? null

      return {
        ok: true,
        data: {
          activeLeague,
          allLeagues: leagues,
          sleeperUsername: profile?.sleeperUsername ?? null,
        },
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : "Unknown league provider error",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

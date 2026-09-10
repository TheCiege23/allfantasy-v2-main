/**
 * Phase 2C — StandingsContextProvider
 *
 * Reads `LeagueTeam` rows for the active league and returns a compact,
 * Chimmy-ready standings slice. Uses `LeagueTeam` directly (not
 * `FantasyStanding`) so the provider works without knowing the active
 * season — `LeagueTeam` already carries cumulative W/L/PF/PA + currentRank.
 *
 * Rules:
 *   - DB-first (Prisma only — no external APIs).
 *   - Never throws.
 *   - Returns `{ rows: [] }` on any failure, keeping the engine bundle safe.
 *   - Default-off impact: Chimmy chat route remains gated by
 *     `CHIMMY_CONTEXT_ENGINE_INJECT`.
 */

import { prisma } from "@/lib/prisma"
import { resolveLeagueIdentity } from "@/lib/chimmy-context/providers/_helpers/leagueIdentity"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  ProviderResult,
  StandingsContextSlice,
  StandingsRow,
} from "@/lib/chimmy-context/types"

const MAX_TEAMS = 20

function safeNumber(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null
  if (typeof n !== "number" || !Number.isFinite(n)) return null
  return n
}

export class StandingsContextProvider
  implements ChimmyContextProvider<StandingsContextSlice>
{
  readonly name = "standings"
  readonly defaultTtlMs = 60 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<StandingsContextSlice>> {
    const startedAt = Date.now()
    const fetchedAt = new Date().toISOString()
    try {
      const identity = await resolveLeagueIdentity(request)
      if (!identity) {
        return {
          ok: true,
          data: null,
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const teams = await prisma.leagueTeam
        .findMany({
          /* Standings rows are built straight from this list — a vacant seat is in the standings. */
          where: { leagueId: identity.leagueId },
          select: {
            id: true,
            teamName: true,
            currentRank: true,
            wins: true,
            losses: true,
            ties: true,
            pointsFor: true,
            pointsAgainst: true,
          },
          orderBy: [
            { currentRank: "asc" },
            { pointsFor: "desc" },
          ],
          take: MAX_TEAMS,
        })
        .catch(() => null)

      if (!teams) {
        return {
          ok: false,
          data: { leagueId: identity.leagueId, rows: [] },
          error: "Standings query failed",
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      type TeamRow = {
        id: string
        teamName: string | null
        currentRank: number | null
        wins: number
        losses: number
        ties: number
        pointsFor: number
        pointsAgainst: number
      }
      const rows: StandingsRow[] = (teams as TeamRow[]).map((t: TeamRow) => ({
        teamId: t.id,
        teamName: t.teamName?.trim() || null,
        rank: safeNumber(t.currentRank),
        wins: safeNumber(t.wins),
        losses: safeNumber(t.losses),
        ties: safeNumber(t.ties),
        pointsFor: safeNumber(t.pointsFor),
        pointsAgainst: safeNumber(t.pointsAgainst),
      }))

      return {
        ok: true,
        data: { leagueId: identity.leagueId, rows },
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : "Unknown standings error",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

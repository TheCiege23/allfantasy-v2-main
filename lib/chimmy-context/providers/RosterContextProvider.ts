/**
 * Phase 2C — RosterContextProvider
 *
 * Reads the viewer's `Roster.playerData` and projects it into a compact
 * `RosterContextSlice` (starters + bench). Uses the existing canonical
 * `getNormalizedLineupSections` helper so every section honours the same
 * shape used by the rest of the platform.
 *
 * Resolution path:
 *   request → resolveLeagueIdentity → leagueTeam (OR clause: platformUserId
 *   or claimedByUserId === viewer) → Roster via (leagueId, platformUserId).
 *
 * Rules:
 *   - DB-first (Prisma only — no external APIs, no Player join this batch).
 *   - Never throws; returns `{ data: null }` on any missing input.
 *   - Default-off impact: gated upstream by `CHIMMY_CONTEXT_ENGINE_INJECT`.
 *   - Caps each section at MAX_PLAYERS to keep prompt budget safe.
 */

import { prisma } from "@/lib/prisma"
import { getNormalizedLineupSections } from "@/lib/roster/LineupTemplateValidation"
import { resolveLeagueIdentity } from "@/lib/chimmy-context/providers/_helpers/leagueIdentity"
import { extractProjectionFromStatLine } from "@/lib/chimmy-context/intel/projection"
import {
  computeRosterIntel,
  type RosterIntelPlayer,
} from "@/lib/chimmy-context/intel/rosterWeakness"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  ProviderResult,
  RosterContextSlice,
  RosterPlayerLite,
} from "@/lib/chimmy-context/types"
const MAX_PLAYERS = 30

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

function toRosterPlayerLite(item: Record<string, unknown>): RosterPlayerLite | null {
  const playerId = typeof item.id === "string" ? item.id : null
  if (!playerId) return null
  const name =
    pickString(item, ["name", "full_name", "fullName", "displayName"]) ?? playerId
  const position = pickString(item, ["position", "pos"])
  const team = pickString(item, ["team", "nflTeam", "proTeam", "teamAbbr"])
  const slot = pickString(item, ["slot", "lineupSlot", "starterSlot"])
  return {
    playerId,
    name,
    position: position ? position.toUpperCase() : null,
    team: team ? team.toUpperCase() : null,
    slot,
  }
}

function mapSection(items: Array<Record<string, unknown>>): RosterPlayerLite[] {
  const out: RosterPlayerLite[] = []
  for (const item of items) {
    if (out.length >= MAX_PLAYERS) break
    const lite = toRosterPlayerLite(item)
    if (lite) out.push(lite)
  }
  return out
}

type WeeklyScoreLite = {
  playerId: string
  points: number | null
  statLine: unknown
}

async function loadStarterProjectionMap(args: {
  leagueId: string
  season: number
  week: number
  rosterId: string
}): Promise<Map<string, number>> {
  const rows = (await prisma.weeklyScore
    .findMany({
      where: {
        leagueId: args.leagueId,
        season: args.season,
        week: args.week,
        rosterId: args.rosterId,
        isStarter: true,
      },
      select: { playerId: true, points: true, statLine: true },
    })
    .catch(() => [])) as WeeklyScoreLite[]
  const map = new Map<string, number>()
  for (const row of rows) {
    if (!row?.playerId) continue
    const actual =
      typeof row.points === "number" && Number.isFinite(row.points) ? row.points : 0
    const fromLine = extractProjectionFromStatLine(row.statLine)
    map.set(row.playerId, fromLine != null ? Math.max(actual, fromLine) : actual)
  }
  return map
}

export class RosterContextProvider
  implements ChimmyContextProvider<RosterContextSlice>
{
  readonly name = "roster"
  readonly defaultTtlMs = 30 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<RosterContextSlice>> {
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

      if (!identity.platformUserId) {
        return {
          ok: true,
          data: {
            leagueId: identity.leagueId,
            teamId: identity.teamId,
            starters: [],
            bench: [],
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      // C3: imported `LeagueTeam.platformUserId` keeps the RAW source manager id,
      // while `Roster.platformUserId` may be resolved to the AllFantasy user id.
      // Tolerate both so a claimed importer grounds on their real roster instead
      // of an empty one.
      const rosterPlatformKeys = Array.from(
        new Set(
          [identity.platformUserId, request.userId].filter(
            (v): v is string => typeof v === 'string' && v.length > 0,
          ),
        ),
      )
      const roster = await prisma.roster
        .findFirst({
          where: {
            leagueId: identity.leagueId,
            platformUserId: { in: rosterPlatformKeys },
          },
          select: { id: true, playerData: true },
        })
        .catch(() => null)

      if (!roster) {
        return {
          ok: true,
          data: {
            leagueId: identity.leagueId,
            teamId: identity.teamId,
            starters: [],
            bench: [],
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const sections = getNormalizedLineupSections(roster.playerData)
      const starters = mapSection(sections.starters)
      // Combine bench, ir, taxi, devy into a single "bench" bucket for the
      // Chimmy slice; the prompt summariser only differentiates starter/bench.
      const benchSource = [
        ...sections.bench,
        ...sections.ir,
        ...sections.taxi,
        ...sections.devy,
      ]
      const bench = mapSection(benchSource)

      // Optional projection enrichment: only when season+week are known.
      let projectionMap: Map<string, number> | null = null
      if (
        typeof request.season === "number" &&
        typeof request.week === "number"
      ) {
        projectionMap = await loadStarterProjectionMap({
          leagueId: identity.leagueId,
          season: request.season,
          week: request.week,
          rosterId: roster.id,
        })
      }

      const intelPlayers: RosterIntelPlayer[] = [
        ...starters.map((p) => ({
          playerId: p.playerId,
          position: p.position,
          isStarter: true,
          projection: projectionMap?.get(p.playerId) ?? null,
        })),
        ...bench.map((p) => ({
          playerId: p.playerId,
          position: p.position,
          isStarter: false,
        })),
      ]
      const intel = computeRosterIntel({
        players: intelPlayers,
        currentWeek: request.week ?? null,
      })

      return {
        ok: true,
        data: {
          leagueId: identity.leagueId,
          teamId: identity.teamId,
          starters,
          bench,
          starterProjectedTotal:
            projectionMap && projectionMap.size > 0
              ? intel.starterProjectedTotal
              : null,
          byPosition: intel.byPosition,
          depthByPosition: intel.depthByPosition,
          weaknessSignals: intel.weaknessSignals,
          strengthSignals: intel.strengthSignals,
          teamIdentityHint: intel.teamIdentityHint,
          teamIdentityScores: intel.teamIdentityScores,
        },
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      return {
        ok: false,
        data: null,
        error: err instanceof Error ? err.message : "Unknown roster error",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

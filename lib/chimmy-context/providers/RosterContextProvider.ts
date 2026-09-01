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
  /*
   * ⚠ NO `?? playerId` FALLBACK. That one operator is the whole bug: `playerData` holds the
   * provider's bare ids, so the fallback fired for EVERY player and Chimmy was told the roster
   * contained someone called "6804". An id is not a name; null is. Real names arrive below,
   * from the canonical registry.
   */
  const name = pickString(item, ["name", "full_name", "fullName", "displayName"])
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

      /*
       * ── 🛑 THE ROSTER HAD NO NAMES, AND THE RESOLVER ALREADY EXISTED ────────────────────
       *
       * `Roster.playerData` stores the PROVIDER's ids — deliberately, per the schema note on
       * `WeeklyScore.playerId`: resolving at ingestion would silently discard everyone who
       * fails to bridge, so the id is kept and resolution happens at read time. This provider
       * was the read that never resolved.
       *
       * `getCanonicalPlayersBySleeperIds` carries name, position AND team, which is why all
       * three came back wrong together — id-as-name, a flat "UTIL", and a null team. A model
       * asked "should I start my flex" could not answer any part of that.
       *
       * ⚠ PARTIAL RESOLUTION IS EXPECTED AND IS LEFT VISIBLE. `SportsPlayer.sleeperId` covers
       * roughly 87% of NFL players. Anyone the registry cannot bridge keeps `name: null` — not
       * a label, not the id back again. A gap the model can see beats a name it will trust.
       */
      const rosterIds = [...starters, ...bench].map((p) => p.playerId)
      if (rosterIds.length > 0) {
        try {
          const { getCanonicalPlayersBySleeperIds } = await import(
            "@/lib/canonical/getCanonicalPlayer"
          )
          const canonical = await getCanonicalPlayersBySleeperIds(rosterIds)
          for (const player of [...starters, ...bench]) {
            const match = canonical.get(player.playerId)
            if (!match) continue
            player.name = match.name || player.name
            player.position = match.position?.toUpperCase() || player.position
            player.team = match.team?.toUpperCase() || player.team
          }
        } catch {
          // A registry outage leaves names null, which the grounding packet reports as
          // `unresolved_identity`. Failing to enrich must never fail the roster itself —
          // the counts and the starter/bench split are still true.
        }
      }

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

/**
 * Phase 2C Batch 3 — MatchupContextProvider
 *
 * Reads the viewer's current-week matchup row from `TeamWeekResult`
 * (canonical) plus the opponent's row, and projects them into the typed
 * `MatchupContextSlice`. Adds optional season / actual-points / playoff /
 * opponent-name fields without breaking existing consumers.
 *
 * Resolution path:
 *   request → resolveLeagueIdentity → leagueId + viewer LeagueTeam.id
 *           → resolveCurrentWeek      → season + week + playoff context
 *           → Roster (leagueId + viewer platformUserId) → viewer rosterId
 *           → TeamWeekResult(viewer)  → opponentRosterId, totalPoints, status
 *           → TeamWeekResult(opponent) → opponent totalPoints + status
 *           → opponent Roster → opponent platformUserId
 *           → opponent LeagueTeam     → opponentTeamId + opponentTeamName
 *
 * Rules:
 *   - DB-first (Prisma only — no external APIs, no projections this batch).
 *   - Never throws; returns `{ data: null }` or a safe partial on any miss.
 *   - Imported leagues have no `TeamWeekResult` rows; their week comes from
 *     `WeeklyMatchup` instead (`loadImportedMatchup`).
 *   - Projections + opponent-strength + urgency are scaffolded but intentionally
 *     not wired into the slice (formulas not yet finalized — see
 *     `lib/chimmy-context/intel/opponentStrength.ts` and `urgency.ts`).
 */

import { prisma } from "@/lib/prisma"
import { nativeWeeklyLeague } from "@/lib/core-app/weeklyCapabilities"
import { resolveLeagueIdentity } from "@/lib/chimmy-context/providers/_helpers/leagueIdentity"
import { resolveCurrentWeekFromRequest } from "@/lib/chimmy-context/providers/_helpers/currentWeek"
import {
  computeMatchupProjection,
  summarizeRosterProjection,
  type RosterProjectionPlayer,
} from "@/lib/chimmy-context/intel/projection"
import { computeUrgency } from "@/lib/chimmy-context/intel/urgency"
import { computeOpponentStrength } from "@/lib/chimmy-context/intel/opponentStrength"
import { prioritizeRecommendation } from "@/lib/chimmy-context/intel/recommendationPriority"
import type {
  ChimmyContextProvider,
  ChimmyContextRequest,
  MatchupContextSlice,
  ProviderResult,
} from "@/lib/chimmy-context/types"

type TeamWeekRow = {
  totalPoints: number | null
  opponentRosterId: string | null
  status: string | null
}

type WeeklyScoreRow = {
  rosterId: string
  playerId: string
  points: number | null
  isStarter: boolean
  statLine: unknown
}

function mapStatus(raw: string | null | undefined): MatchupContextSlice["status"] {
  if (raw === "final" || raw === "in_progress" || raw === "scheduled") return raw
  return "unknown"
}

function roundPoints(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null
  return Math.round(Number(n) * 100) / 100
}

/**
 * Read per-player weekly scores for the viewer + opponent in a single
 * indexed query, then derive starter-side projection totals. Never throws.
 */
async function loadProjectionTotals(args: {
  leagueId: string
  season: number
  week: number
  rosterIds: string[]
}): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  if (args.rosterIds.length === 0) return totals
  const rows: WeeklyScoreRow[] = await prisma.weeklyScore
    .findMany({
      where: {
        leagueId: args.leagueId,
        season: args.season,
        week: args.week,
        rosterId: { in: args.rosterIds },
        isStarter: true,
      },
      select: {
        rosterId: true,
        playerId: true,
        points: true,
        isStarter: true,
        statLine: true,
      },
    })
    .catch(() => [] as WeeklyScoreRow[])

  if (rows.length === 0) return totals

  const byRoster = new Map<string, RosterProjectionPlayer[]>()
  for (const row of rows) {
    const list = byRoster.get(row.rosterId) ?? []
    // Position is not stored on WeeklyScore; the helper falls back to the
    // neutral default when position is unknown.
    list.push({
      playerId: row.playerId,
      position: null,
      actualPoints: typeof row.points === "number" ? row.points : null,
      statLine: row.statLine ?? null,
      isStarter: row.isStarter !== false,
    })
    byRoster.set(row.rosterId, list)
  }

  for (const [rosterId, players] of byRoster.entries()) {
    const summary = summarizeRosterProjection({ players })
    totals.set(rosterId, summary.projectedTotal)
  }
  return totals
}

type ImportedMatchup = {
  yourActualPoints: number | null
  opponentActualPoints: number | null
  opponentTeamId: string | null
  opponentTeamName: string | null
}

/**
 * An IMPORTED league's week, from `WeeklyMatchup` — the schedule the sync stores for it.
 *
 * Imports never get `TeamWeekResult` rows (the weekly processor writes those for AllFantasy-hosted
 * leagues only), so the canonical path above always came back empty for them and Chimmy answered
 * "no matchup" in every imported league. The rows are keyed the way `matchupPreviewGrounding` reads
 * them: the platform's league id, and the platform's team id (`LeagueTeam.externalId`), paired on
 * `matchupId`. Exactly two rows or nothing — a bye or an unsynced week is not an opponent.
 * Never throws.
 */
async function loadImportedMatchup(args: {
  leagueId: string
  teamId: string | null
  season: number
  week: number
}): Promise<ImportedMatchup | null> {
  try {
    if (!args.teamId) return null
    const [league, team] = await Promise.all([
      prisma.league.findUnique({
        where: { id: args.leagueId },
        select: { platform: true, platformLeagueId: true },
      }),
      prisma.leagueTeam.findFirst({
        where: { id: args.teamId, leagueId: args.leagueId },
        select: { externalId: true },
      }),
    ])
    if (!league?.platformLeagueId || nativeWeeklyLeague(league) || !team?.externalId) return null
    const rows = await prisma.weeklyMatchup.findMany({
      where: {
        leagueId: league.platformLeagueId,
        seasonYear: args.season,
        week: args.week,
        matchupId: { not: null },
      },
      select: { rosterId: true, matchupId: true, pointsFor: true },
    })
    const mine = rows.find((r) => r.rosterId === team.externalId)
    const pair = mine ? rows.filter((r) => r.matchupId === mine.matchupId) : []
    const opponent = pair.length === 2 ? pair.find((r) => r.rosterId !== team.externalId) : undefined
    if (!mine || !opponent) return null
    const oppTeam = await prisma.leagueTeam.findFirst({
      where: { leagueId: args.leagueId, externalId: opponent.rosterId },
      select: { id: true, teamName: true },
    })
    return {
      yourActualPoints: roundPoints(mine.pointsFor),
      opponentActualPoints: roundPoints(opponent.pointsFor),
      opponentTeamId: oppTeam?.id ?? null,
      opponentTeamName: oppTeam?.teamName ?? null,
    }
  } catch {
    return null
  }
}

export class MatchupContextProvider
  implements ChimmyContextProvider<MatchupContextSlice>
{
  readonly name = "matchup"
  readonly defaultTtlMs = 30 * 1000

  async load(
    request: ChimmyContextRequest
  ): Promise<ProviderResult<MatchupContextSlice>> {
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

      const week = await resolveCurrentWeekFromRequest(request, identity.leagueId)

      /* An imported league's week, used wherever the canonical rows come back empty. */
      const importedResult = async (): Promise<ProviderResult<MatchupContextSlice> | null> => {
        if (week.week == null) return null
        const imported = await loadImportedMatchup({
          leagueId: identity.leagueId,
          teamId: identity.teamId,
          season: week.season,
          week: week.week,
        })
        if (!imported) return null
        return {
          ok: true,
          data: {
            leagueId: identity.leagueId,
            week: week.week,
            yourTeamId: identity.teamId,
            opponentTeamId: imported.opponentTeamId,
            yourProjectedPoints: null,
            opponentProjectedPoints: null,
            // The stored schedule carries no game state, so the week is not called final here.
            status: "unknown",
            season: week.season,
            yourActualPoints: imported.yourActualPoints,
            opponentActualPoints: imported.opponentActualPoints,
            opponentTeamName: imported.opponentTeamName,
            playoffStartWeek: week.playoffStartWeek,
            isPlayoffWeek: week.isPlayoffWeek,
            weeksUntilPlayoffs: week.weeksUntilPlayoffs,
            currentWeekSource: week.source,
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      if (!identity.platformUserId) {
        const imported = await importedResult()
        if (imported) return imported
        return {
          ok: true,
          data: {
            leagueId: identity.leagueId,
            week: week.week,
            yourTeamId: identity.teamId,
            opponentTeamId: null,
            yourProjectedPoints: null,
            opponentProjectedPoints: null,
            status: "unknown",
            season: week.season,
            yourActualPoints: null,
            opponentActualPoints: null,
            opponentTeamName: null,
            playoffStartWeek: week.playoffStartWeek,
            isPlayoffWeek: week.isPlayoffWeek,
            weeksUntilPlayoffs: week.weeksUntilPlayoffs,
            currentWeekSource: week.source,
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const viewerRoster = await prisma.roster
        .findUnique({
          where: {
            leagueId_platformUserId: {
              leagueId: identity.leagueId,
              platformUserId: identity.platformUserId,
            },
          },
          select: { id: true },
        })
        .catch(() => null)

      if (!viewerRoster) {
        const imported = await importedResult()
        if (imported) return imported
        return {
          ok: true,
          data: {
            leagueId: identity.leagueId,
            week: week.week,
            yourTeamId: identity.teamId,
            opponentTeamId: null,
            yourProjectedPoints: null,
            opponentProjectedPoints: null,
            status: "unknown",
            season: week.season,
            yourActualPoints: null,
            opponentActualPoints: null,
            opponentTeamName: null,
            playoffStartWeek: week.playoffStartWeek,
            isPlayoffWeek: week.isPlayoffWeek,
            weeksUntilPlayoffs: week.weeksUntilPlayoffs,
            currentWeekSource: week.source,
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const viewerRow: TeamWeekRow | null = await prisma.teamWeekResult
        .findUnique({
          where: {
            leagueId_season_week_rosterId: {
              leagueId: identity.leagueId,
              season: week.season,
              week: week.week,
              rosterId: viewerRoster.id,
            },
          },
          select: {
            totalPoints: true,
            opponentRosterId: true,
            status: true,
          },
        })
        .catch(() => null)

      const opponentRosterId = viewerRow?.opponentRosterId ?? null

      if (!opponentRosterId) {
        const imported = await importedResult()
        if (imported) return imported
        return {
          ok: true,
          data: {
            leagueId: identity.leagueId,
            week: week.week,
            yourTeamId: identity.teamId,
            opponentTeamId: null,
            yourProjectedPoints: null,
            opponentProjectedPoints: null,
            status: mapStatus(viewerRow?.status ?? null),
            season: week.season,
            yourActualPoints: roundPoints(viewerRow?.totalPoints ?? null),
            opponentActualPoints: null,
            opponentTeamName: null,
            playoffStartWeek: week.playoffStartWeek,
            isPlayoffWeek: week.isPlayoffWeek,
            weeksUntilPlayoffs: week.weeksUntilPlayoffs,
            currentWeekSource: week.source,
          },
          fetchedAt,
          durationMs: Date.now() - startedAt,
        }
      }

      const [opponentRow, opponentRoster] = await Promise.all([
        prisma.teamWeekResult
          .findUnique({
            where: {
              leagueId_season_week_rosterId: {
                leagueId: identity.leagueId,
                season: week.season,
                week: week.week,
                rosterId: opponentRosterId,
              },
            },
            select: { totalPoints: true, status: true },
          })
          .catch(() => null),
        prisma.roster
          .findUnique({
            where: { id: opponentRosterId },
            select: { platformUserId: true },
          })
          .catch(() => null),
      ])

      let opponentTeamId: string | null = null
      let opponentTeamName: string | null = null
      if (opponentRoster?.platformUserId) {
        const oppTeam = await prisma.leagueTeam
          .findFirst({
            where: {
              leagueId: identity.leagueId,
              platformUserId: opponentRoster.platformUserId,
            },
            select: { id: true, teamName: true },
          })
          .catch(() => null)
        opponentTeamId = oppTeam?.id ?? null
        opponentTeamName = oppTeam?.teamName ?? null
      }

      const status = mapStatus(viewerRow?.status ?? opponentRow?.status ?? null)
      const yourActualPoints = roundPoints(viewerRow?.totalPoints ?? null)
      const opponentActualPoints = roundPoints(opponentRow?.totalPoints ?? null)

      // Phase 2C Batch 4 Sub-batch B — projection wiring (DB-first, single indexed read).
      const projectionTotals = await loadProjectionTotals({
        leagueId: identity.leagueId,
        season: week.season,
        week: week.week,
        rosterIds: [viewerRoster.id, opponentRosterId],
      })
      const yourProjectedPoints = projectionTotals.has(viewerRoster.id)
        ? roundPoints(projectionTotals.get(viewerRoster.id) ?? null)
        : null
      const opponentProjectedPoints = projectionTotals.has(opponentRosterId)
        ? roundPoints(projectionTotals.get(opponentRosterId) ?? null)
        : null

      const matchupProjection = computeMatchupProjection({
        yourTeamId: identity.teamId,
        opponentTeamId,
        yourActualPoints,
        opponentActualPoints,
        yourProjectedTotal: yourProjectedPoints,
        opponentProjectedTotal: opponentProjectedPoints,
        status,
      })

      const urgency = computeUrgency({
        week: week.week,
        playoffStartWeek: week.playoffStartWeek,
        weeksUntilPlayoffs: week.weeksUntilPlayoffs,
        isPlayoffWeek: week.isPlayoffWeek,
        matchupStatus: status,
        isEliminated: null,
        hasClinchedPlayoffs: null,
      })

      // Neutral opponent-strength scaffold — surfaces enough for the priority
      // helper to emit rationale without finalizing any formula.
      const opponentStrength = computeOpponentStrength({
        opponentTeamId,
        opponentAiPowerScore: null,
        opponentProjectedWins: null,
        opponentRecentForm: null,
        leagueMeanAiPowerScore: null,
      })

      const priority = prioritizeRecommendation({
        category: "lineup",
        urgency,
        opponentStrength,
        projectionMargin: matchupProjection.projectedMargin,
      })

      return {
        ok: true,
        data: {
          leagueId: identity.leagueId,
          week: week.week,
          yourTeamId: identity.teamId,
          opponentTeamId,
          yourProjectedPoints,
          opponentProjectedPoints,
          status,
          season: week.season,
          yourActualPoints,
          opponentActualPoints,
          opponentTeamName,
          playoffStartWeek: week.playoffStartWeek,
          isPlayoffWeek: week.isPlayoffWeek,
          weeksUntilPlayoffs: week.weeksUntilPlayoffs,
          currentWeekSource: week.source,
          projectedMargin: matchupProjection.projectedMargin,
          projectedLeader: matchupProjection.leader,
          projectedWinProbability: matchupProjection.projectedWinProbability,
          urgencySignals: urgency.signals,
          urgencyLevel: urgency.level,
          urgencyScore: urgency.score,
          recommendationPriority: priority.priority,
        },
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    } catch {
      return {
        ok: false,
        data: null,
        error: "Matchup query failed",
        fetchedAt,
        durationMs: Date.now() - startedAt,
      }
    }
  }
}

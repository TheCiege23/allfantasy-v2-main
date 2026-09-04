import "server-only"

import { prisma } from "@/lib/prisma"
import {
  getFantasyValueSnapshot,
  type FantasyValueSnapshot,
} from "@/lib/sports-reporting/FantasyValueSnapshotService"
import { normalizeTeamAbbrev } from "@/lib/team-abbrev"

// ─── Public types ─────────────────────────────────────────────────────────────

export type DraftAdvisorCandidateInput = {
  playerName: string
  playerId?: string | null
  position?: string | null
  team?: string | null
  /** ADP from caller's draft room (provider-supplied or AllFantasy ADP) */
  adp?: number | null
}

export type DraftAdvisorContextRequest = {
  sport: string
  candidates: DraftAdvisorCandidateInput[]
  /** Current roster — used to compute positional needs */
  currentRoster?: Array<{ position: string; team?: string | null }>
  leagueFormat?: string | null
  scoringFormat?: string | null
  /** 1-based draft position (the user's pick slot) */
  draftPosition?: number | null
  totalTeams?: number | null
  round?: number | null
}

export type PositionalScarcityEntry = {
  /** Total candidates at this position still in the available pool */
  totalAvailable: number
  /** Candidates whose snapshot confidence ≥ 0.65 (usable data) */
  tier1Available: number
  /**
   * Scarcity rating relative to the position's typical pool depth:
   *   high   — fewer candidates than the scarcity threshold
   *   medium — approaching threshold
   *   low    — plenty available
   */
  scarcityRating: "high" | "medium" | "low"
}

export type DraftAdvisorEnrichedCandidate = {
  playerName: string
  playerId: string | null
  position: string | null
  team: string | null
  /** ADP supplied by the caller (provider/AllFantasy ADP) */
  adp: number | null
  /** Bye week derived from DB game schedule — null when schedule unavailable */
  byeWeek: number | null
  /** Grounded snapshot from cached DB data — confidence = 0 when no records found */
  snapshot: FantasyValueSnapshot
}

export type DraftAdvisorContext = {
  sport: string
  /** Current NFL/NBA/MLB season year */
  season: number
  enrichedCandidates: DraftAdvisorEnrichedCandidate[]
  /** Per-position available count + scarcity rating */
  positionalScarcity: Record<string, PositionalScarcityEntry>
  /**
   * Roster positions still needed, ordered by urgency.
   * Computed from currentRoster vs. typical starting lineup requirements.
   */
  rosterNeeds: string[]
  /** team code (e.g. "KC") → bye week number */
  byeWeekMap: Record<string, number>
  /**
   * Positions already on the roster that share a bye week with 2+ other
   * rostered players — highlight these when selecting new picks.
   */
  byeWeekConflicts: string[]
  leagueFormat: string
  scoringFormat: string
  draftPosition: number | null
  totalTeams: number | null
  round: number | null
  /** 0–1 confidence across all enriched snapshots */
  confidence: number
  missingData: string[]
  generatedAt: string
}

// ─── Scarcity thresholds by position ─────────────────────────────────────────

/** Minimum available count below which scarcity is "high" (scales by total teams) */
const SCARCITY_HIGH: Record<string, number> = {
  QB: 4,
  RB: 10,
  WR: 14,
  TE: 3,
  K: 3,
  DEF: 3,
  DL: 3,
  LB: 3,
  DB: 3,
  EDGE: 3,
  OL: 3,
}

const SCARCITY_MEDIUM: Record<string, number> = {
  QB: 8,
  RB: 18,
  WR: 24,
  TE: 6,
  K: 6,
  DEF: 6,
  DL: 6,
  LB: 6,
  DB: 6,
  EDGE: 6,
  OL: 6,
}

/** Standard starting lineup requirements per position for need computation */
const STANDARD_STARTS: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DEF: 1,
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

function normalizeSport(sport: string): string {
  return sport.trim().toUpperCase()
}

function normalizeLeagueFormat(value: string | null | undefined): string {
  const v = String(value ?? "redraft")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
  if (v.includes("dynasty")) return "dynasty"
  if (v.includes("keeper")) return "keeper"
  if (v.includes("best")) return "best_ball"
  return v || "redraft"
}

function normalizeScoring(value: string | null | undefined): string {
  return String(value ?? "ppr")
    .trim()
    .toLowerCase() || "ppr"
}

function currentSeasonYear(): number {
  return new Date().getFullYear()
}

// ─── Bye week loader ──────────────────────────────────────────────────────────

/**
 * Builds a team → bye week map from the sportsGame table.
 * A team's bye week is the week number (1–18 for NFL) where they have no game.
 * Returns an empty map when no schedule data exists.
 */
async function loadByeWeekMap(sport: string): Promise<Record<string, number>> {
  const byeMap: Record<string, number> = {}
  try {
    const season = currentSeasonYear()
    const games = await prisma.sportsGame.findMany({
      where: {
        sport,
        season,
        week: { gt: 0, lte: 18 },
        status: { not: "cancelled" },
      },
      select: { homeTeam: true, awayTeam: true, week: true },
    })

    if (games.length === 0) return {}

    const teamWeeks = new Map<string, Set<number>>()
    for (const game of games) {
      const teams = [game.homeTeam, game.awayTeam]
      for (const rawTeam of teams) {
        const team = normalizeTeamAbbrev(rawTeam) ?? rawTeam.trim().toUpperCase()
        if (!team || !game.week) continue
        const weeks = teamWeeks.get(team) ?? new Set<number>()
        weeks.add(game.week)
        teamWeeks.set(team, weeks)
      }
    }

    const allWeeks = Array.from(new Set(games.map((g) => g.week ?? 0).filter((w) => w > 0))).sort(
      (a, b) => a - b
    )

    for (const [team, playedWeeks] of teamWeeks.entries()) {
      for (const week of allWeeks) {
        if (!playedWeeks.has(week)) {
          byeMap[team] = week
          break
        }
      }
    }
  } catch {
    // no-op — schedule not available
  }
  return byeMap
}

// ─── Positional scarcity ──────────────────────────────────────────────────────

function computePositionalScarcity(
  enriched: DraftAdvisorEnrichedCandidate[],
  totalTeams: number | null
): Record<string, PositionalScarcityEntry> {
  const scarcity: Record<string, PositionalScarcityEntry> = {}
  const teams = Math.max(8, totalTeams ?? 12)

  const byPosition = new Map<string, DraftAdvisorEnrichedCandidate[]>()
  for (const c of enriched) {
    const pos = c.position?.toUpperCase() ?? "FLEX"
    const group = byPosition.get(pos) ?? []
    group.push(c)
    byPosition.set(pos, group)
  }

  for (const [pos, candidates] of byPosition.entries()) {
    const total = candidates.length
    const tier1 = candidates.filter((c) => c.snapshot.confidence >= 0.65).length
    const highThresh = Math.max(SCARCITY_HIGH[pos] ?? 3, Math.ceil(teams * 0.2))
    const medThresh = Math.max(SCARCITY_MEDIUM[pos] ?? 6, Math.ceil(teams * 0.5))
    const rating: PositionalScarcityEntry["scarcityRating"] =
      total <= highThresh ? "high" : total <= medThresh ? "medium" : "low"
    scarcity[pos] = { totalAvailable: total, tier1Available: tier1, scarcityRating: rating }
  }

  return scarcity
}

// ─── Roster needs ─────────────────────────────────────────────────────────────

function computeRosterNeeds(
  currentRoster: Array<{ position: string; team?: string | null }> | undefined
): string[] {
  if (!currentRoster || currentRoster.length === 0) {
    return Object.entries(STANDARD_STARTS)
      .sort(([, a], [, b]) => b - a)
      .map(([pos]) => pos)
  }
  const rosterCounts: Record<string, number> = {}
  for (const slot of currentRoster) {
    const pos = slot.position.toUpperCase()
    rosterCounts[pos] = (rosterCounts[pos] ?? 0) + 1
  }
  const needs: Array<{ pos: string; deficit: number }> = []
  for (const [pos, required] of Object.entries(STANDARD_STARTS)) {
    const have = rosterCounts[pos] ?? 0
    const deficit = required - have
    if (deficit > 0) needs.push({ pos, deficit })
  }
  return needs.sort((a, b) => b.deficit - a.deficit).map((n) => n.pos)
}

// ─── Bye week conflicts ───────────────────────────────────────────────────────

function computeByeWeekConflicts(
  currentRoster: Array<{ position: string; team?: string | null }> | undefined,
  byeWeekMap: Record<string, number>
): string[] {
  if (!currentRoster || currentRoster.length === 0 || Object.keys(byeWeekMap).length === 0) {
    return []
  }
  const byeConflicts = new Map<number, string[]>() // bye week → positions
  for (const slot of currentRoster) {
    const team = normalizeTeamAbbrev(slot.team ?? "") ?? (slot.team ?? "").toUpperCase()
    const bye = byeWeekMap[team]
    if (!bye) continue
    const positions = byeConflicts.get(bye) ?? []
    positions.push(slot.position.toUpperCase())
    byeConflicts.set(bye, positions)
  }
  const conflicts: string[] = []
  for (const [, positions] of byeConflicts.entries()) {
    if (positions.length >= 2) {
      for (const pos of positions) {
        if (!conflicts.includes(pos)) conflicts.push(pos)
      }
    }
  }
  return conflicts
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Assembles a grounded draft context for the given list of available candidates.
 *
 * For each candidate:
 *   1. Calls getFantasyValueSnapshot to retrieve cached injury/stats/ADP context
 *   2. Looks up bye week from DB game schedule
 *
 * Then computes:
 *   - Positional scarcity ratings across the available pool
 *   - Roster needs (positions still uncovered in currentRoster)
 *   - Bye week conflicts on the existing roster
 *
 * All DB lookups use try/catch so a missing table or empty schedule degrades
 * gracefully — the context is returned with confidence = 0 and missingData fields.
 *
 * @param request
 * @param snapshotLoader Optional override for testing — defaults to getFantasyValueSnapshot
 */
export async function getDraftAdvisorContext(
  request: DraftAdvisorContextRequest,
  snapshotLoader = getFantasyValueSnapshot
): Promise<DraftAdvisorContext> {
  const sport = normalizeSport(request.sport)
  const leagueFormat = normalizeLeagueFormat(request.leagueFormat)
  const scoringFormat = normalizeScoring(request.scoringFormat)
  const season = currentSeasonYear()

  // Resolve snapshots + bye week map in parallel
  const [byeWeekMap, snapshots] = await Promise.all([
    loadByeWeekMap(sport),
    Promise.all(
      request.candidates.map((c) =>
        snapshotLoader({
          sport,
          playerId: c.playerId ?? null,
          playerName: c.playerName,
          leagueFormat,
          scoringFormat,
        }).catch(
          (): FantasyValueSnapshot => ({
            sport,
            playerId: c.playerId ?? null,
            playerName: c.playerName,
            position: c.position ?? null,
            team: c.team ?? null,
            leagueFormat,
            scoringFormat,
            shortTermValue: null,
            longTermValue: null,
            riskScore: null,
            injuryRisk: "unknown",
            roleConfidence: null,
            dataFreshness: { latestAt: null, stale: false, staleDomains: [] },
            sourcesUsed: [],
            missingData: ["snapshot_load_error"],
            confidence: 0,
          })
        )
      )
    ),
  ])

  const enrichedCandidates: DraftAdvisorEnrichedCandidate[] = request.candidates.map((c, i) => {
    const snap = snapshots[i]
    const team = normalizeTeamAbbrev(c.team ?? snap.team ?? "") ?? (c.team ?? snap.team ?? null)
    return {
      playerName: snap.playerName,
      playerId: snap.playerId ?? c.playerId ?? null,
      position: snap.position ?? c.position ?? null,
      team,
      adp: c.adp ?? null,
      byeWeek: team ? (byeWeekMap[team] ?? null) : null,
      snapshot: snap,
    }
  })

  const positionalScarcity = computePositionalScarcity(enrichedCandidates, request.totalTeams ?? null)
  const rosterNeeds = computeRosterNeeds(request.currentRoster)
  const byeWeekConflicts = computeByeWeekConflicts(request.currentRoster, byeWeekMap)

  // Aggregate confidence and missing data
  const missingDomains = new Set<string>()
  let totalConfidence = 0
  for (const c of enrichedCandidates) {
    totalConfidence += c.snapshot.confidence
    for (const m of c.snapshot.missingData) missingDomains.add(m)
  }
  if (Object.keys(byeWeekMap).length === 0) missingDomains.add("bye_week_schedule")
  const confidence =
    enrichedCandidates.length === 0 ? 0 : Math.round((totalConfidence / enrichedCandidates.length) * 100) / 100

  return {
    sport,
    season,
    enrichedCandidates,
    positionalScarcity,
    rosterNeeds,
    byeWeekMap,
    byeWeekConflicts,
    leagueFormat,
    scoringFormat,
    draftPosition: request.draftPosition ?? null,
    totalTeams: request.totalTeams ?? null,
    round: request.round ?? null,
    confidence,
    missingData: Array.from(missingDomains),
    generatedAt: new Date().toISOString(),
  }
}

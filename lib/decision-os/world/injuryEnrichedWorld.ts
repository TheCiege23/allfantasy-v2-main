/**
 * Decision OS — Phase 2 / F2.3: Canonical World INJURY / AVAILABILITY enrichment (read-only derived VIEW).
 *
 * Builds ADDITIVELY on the F2.1 metadata-enriched world. The frozen Canonical World still carries ids only;
 * this module never mutates it. It folds deterministic injury/availability context onto F2.1 enriched
 * players:
 *   - player availability category (available / uncertain / unavailable / unknown)
 *   - injury status freshness (fetchedAt / expiresAt / isStale)
 *   - source / provenance
 *   - honest completeness / uncertainty / warnings
 *
 * 🛑 THE DESIGNATION COMES FROM THE INJURY FEED — NEVER FROM `SportsPlayer.status` (2026-10-11).
 * `SportsPlayer.status` on Sleeper's row is Sleeper's ROSTER status ("Active", "Injured Reserve"), and on
 * Rolling Insights' row "ACT"/"INACT" — so an Out player read "Active" here and was reported AVAILABLE to
 * the lineup signal facts and to this world. `resolveInjuryContext` now reads the player's IDENTITY
 * (name / team / position) off his cached row — keyed in the league's id space by `indexRowsByLeagueId`,
 * so a Sleeper id never resolves to the Rolling Insights player who shares its number — and asks
 * `resolveCurrentInjuryDesignations` for his current designation: live feed rows by verified name,
 * stale game-day words suppressed, and a ROSTER status counted only when it is Sleeper's own row AND a
 * season-scale absence (`isRosterAbsence`: IR, PUP, NFI, a suspension — never a game-day "Out").
 *
 * HONEST DEGRADATION (P2 — never fabricate):
 *   - practiceStatus / gameStatus / bodyPart / description are not carried — always null + warned.
 *   - No live API calls, no cache warming, no writes.
 *   - Missing rows (or a row with no name to ask about) → all fields null + injury_status_unavailable.
 *   - No current designation → status null, category 'unknown' ("no news" — never "healthy").
 *
 * READ-ONLY: this file imports NO prisma. The port function is in world/port.ts.
 */
import type { RawInjuryContextRow } from './facts'
import { loadInjuryContextRows } from './port'
import type { EnrichedCanonicalWorld, EnrichedPlayer, EnrichedRosterFacts } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { ResolveCanonicalWorldOptions } from './index'
import { indexRowsByLeagueId } from './rowKeys'
import {
  designationSeverity,
  resolveCurrentInjuryDesignations,
  type CurrentInjuryDesignation,
  type DesignationLookup,
} from '@/lib/injuries/currentInjuryDesignations'

export type InjuryAvailabilityCategory = 'available' | 'uncertain' | 'unavailable' | 'unknown'

const AVAILABLE_STATUSES = new Set(['active', 'healthy', 'act'])
const UNCERTAIN_STATUSES = new Set(['q', 'questionable', 'd', 'doubtful'])
const UNAVAILABLE_STATUSES = new Set([
  'o', 'out', 'ir', 'pup', 'sus', 'suspended', 'na', 'inactive', 'nfi', 'cov',
])

/**
 * Pure: derive a deterministic availability category from the Sleeper-sourced status string.
 * Not AI-generated — a fixed mapping of known status strings. Unrecognized → 'unknown'.
 */
export function deriveAvailabilityCategory(status: string | null | undefined): InjuryAvailabilityCategory {
  if (!status || typeof status !== 'string') return 'unknown'
  const key = status.trim().toLowerCase()
  if (!key) return 'unknown'
  if (AVAILABLE_STATUSES.has(key)) return 'available'
  if (UNCERTAIN_STATUSES.has(key)) return 'uncertain'
  if (UNAVAILABLE_STATUSES.has(key)) return 'unavailable'
  return 'unknown'
}

export interface InjuryStatusFreshness {
  fetchedAt: string | null
  expiresAt: string | null
  updatedAt: string | null
  /** True when expiresAt is in the past; null when expiresAt is unknown. */
  isStale: boolean | null
  /** Human-readable reason for staleness / unknown freshness. */
  staleReason: string | null
}

export interface InjuryContext {
  /**
   * The player's CURRENT injury designation as its source spelled it ("Out", "Questionable", "IR",
   * "Injured Reserve") — from the injury feed, or Sleeper's season-scale roster absence. Null when there
   * is none or the player is unresolved: "no news", never "healthy".
   */
  status: string | null
  /** Deterministic category derived from status. 'unknown' when status unrecognized or null. */
  availabilityCategory: InjuryAvailabilityCategory
  /**
   * Practice participation (DNP / Limited / Full / None). NULL — no player-id-keyed source
   * carries this in a joinable namespace. Documented gap, never fabricated.
   */
  practiceStatus: null
  /**
   * Game-day designation (Active / Out / Doubtful / Questionable / IR). NULL — same reason:
   * InjuryReportRecord uses API-Sports IDs which don't match canonical roster player IDs.
   */
  gameStatus: null
  /**
   * Injured body part (knee, ankle, shoulder…). NULL — same reason as practiceStatus/gameStatus.
   */
  bodyPart: null
  /** Injury notes / description. NULL — same reason. */
  description: null
  freshness: InjuryStatusFreshness
  /** Which import source produced the cached row (provenance only). */
  provenance: { source: string | null }
  /** True when status is non-null AND freshness data is present (expiresAt not null). */
  resolved: boolean
  /** Honest uncertainty notes (provenance/debug — never a decision input). */
  uncertainty: string[]
}

export interface InjuryEnrichedPlayer extends EnrichedPlayer {
  injuryContext: InjuryContext
}

export interface InjuryEnrichedRosterFacts extends Omit<EnrichedRosterFacts, 'players'> {
  players: InjuryEnrichedPlayer[]
  /** 0–100 share of this roster's players that have a resolved injury context. */
  injuryCompleteness: number
  /** Per-roster injury enrichment warnings. */
  injuryWarnings: string[]
}

export interface InjuryEnrichmentSummary {
  requestedPlayers: number
  resolvedPlayers: number
  unavailablePlayers: number
  uncertainPlayers: number
  stalePlayers: number
  completeness: number
  warnings: string[]
}

export interface InjuryEnrichedCanonicalWorld extends Omit<EnrichedCanonicalWorld, 'rosters'> {
  rosters: InjuryEnrichedRosterFacts[]
  injurySummary: InjuryEnrichmentSummary
}

export interface InjuryContextResult {
  byId: Map<string, InjuryContext>
  resolvedCount: number
  unresolvedIds: string[]
  warnings: string[]
}

export interface InjuryContextPort {
  /** The players' cached rows — their IDENTITY (name / team / position) and, on Sleeper's row, roster status. */
  loadRows: (sport: string, ids: string[]) => Promise<RawInjuryContextRow[]>
  /**
   * The CURRENT designation per player, from the injury feed. Defaults to
   * `resolveCurrentInjuryDesignations`; injectable for tests.
   */
  resolveDesignations?: (args: {
    sport: string
    players: DesignationLookup<string>[]
  }) => Promise<Map<string, CurrentInjuryDesignation>>
}

export const defaultInjuryContextPort: InjuryContextPort = {
  loadRows: (sport, ids) => loadInjuryContextRows(sport, ids),
  resolveDesignations: (args) => resolveCurrentInjuryDesignations(args),
}

export interface InjuryEnrichedWorldDeps {
  resolveEnrichedWorld: (leagueId: string, options?: ResolveCanonicalWorldOptions) => Promise<EnrichedCanonicalWorld | null>
  resolveInjuryContext: (sport: string, ids: string[]) => Promise<InjuryContextResult>
}

export const defaultInjuryEnrichedWorldDeps: InjuryEnrichedWorldDeps = {
  resolveEnrichedWorld: (leagueId, options) => resolveEnrichedCanonicalWorld(leagueId, options ? { ...options } : undefined),
  resolveInjuryContext: (sport, ids) => resolveInjuryContext(sport, ids),
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function pct(resolved: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((resolved / total) * 100)
}

function emptyFreshness(): InjuryStatusFreshness {
  return {
    fetchedAt: null,
    expiresAt: null,
    updatedAt: null,
    isStale: null,
    staleReason: 'freshness_unavailable',
  }
}

function computeFreshness(row: RawInjuryContextRow, now: Date): InjuryStatusFreshness {
  const fetchedAt = toIso(row.fetchedAt)
  const expiresAt = toIso(row.expiresAt)
  const updatedAt = toIso(row.updatedAt)

  if (row.expiresAt instanceof Date && !Number.isNaN(row.expiresAt.getTime())) {
    const isStale = row.expiresAt.getTime() < now.getTime()
    return { fetchedAt, expiresAt, updatedAt, isStale, staleReason: isStale ? 'expired' : null }
  }
  return { fetchedAt, expiresAt: null, updatedAt, isStale: null, staleReason: 'freshness_unavailable' }
}

/**
 * Pure: build an InjuryContext from a row whose `status` IS a designation. Deterministic, no IO.
 * Richer fields (practiceStatus / gameStatus / bodyPart / description) are always null —
 * no player-id-keyed source available (see ADR §2). These are documented as uncertainty, not errors.
 *
 * ⚠ NOT FOR A RAW `SportsPlayer` ROW. Its `status` is a roster status ("Active", "ACT"), which this maps
 * to 'available' whatever the injury report says. `resolveInjuryContext` no longer feeds it one; it
 * builds a context from the feed's designation with {@link projectDesignationContext}, and uses this
 * only for a player it could not resolve (`row = null`).
 */
export function projectInjuryContext(row: RawInjuryContextRow | null | undefined, now: Date): InjuryContext {
  if (!row) {
    return {
      status: null,
      availabilityCategory: 'unknown',
      practiceStatus: null,
      gameStatus: null,
      bodyPart: null,
      description: null,
      freshness: emptyFreshness(),
      provenance: { source: null },
      resolved: false,
      uncertainty: [
        'injury_status_unavailable',
        'practice_status_unavailable',
        'game_status_unavailable',
        'body_part_unavailable',
        'injury_description_unavailable',
      ],
    }
  }

  const status = row.status && row.status.trim() ? row.status.trim() : null
  const category = deriveAvailabilityCategory(status)
  const freshness = computeFreshness(row, now)

  const uncertainty: string[] = [
    'practice_status_unavailable',
    'game_status_unavailable',
    'body_part_unavailable',
    'injury_description_unavailable',
  ]
  if (category === 'unknown' && status != null) uncertainty.push('availability_category_unrecognized')
  if (freshness.isStale === true) uncertainty.push('injury_status_stale')
  if (freshness.staleReason === 'freshness_unavailable') uncertainty.push('injury_freshness_unknown')

  return {
    status,
    availabilityCategory: category,
    practiceStatus: null,
    gameStatus: null,
    bodyPart: null,
    description: null,
    freshness,
    provenance: { source: row.source ?? null },
    resolved: status != null && row.expiresAt != null,
    uncertainty,
  }
}

/**
 * Pure: the availability category a CURRENT designation supports — the shared buckets
 * (`designationSeverity`, i.e. `isRuledOut` for absence). Null designation → 'unknown': "no news"
 * is not "healthy".
 */
export function categoryForDesignation(status: string | null | undefined): InjuryAvailabilityCategory {
  const severity = designationSeverity(status)
  if (severity == null) return 'unknown'
  if (severity === 'unavailable') return 'unavailable'
  // Doubtful, questionable, or any other word on the report (a bare body part, "Day-To-Day") — a risk.
  return 'uncertain'
}

const ALWAYS_UNAVAILABLE_FIELDS = [
  'practice_status_unavailable',
  'game_status_unavailable',
  'body_part_unavailable',
  'injury_description_unavailable',
]

/**
 * Pure: build an InjuryContext from a player's resolved CURRENT designation (or none). `row` is the
 * identity row the feed was asked about — used for freshness only when the designation IS that row's
 * Sleeper roster absence. Deterministic, no IO.
 */
export function projectDesignationContext(
  row: RawInjuryContextRow,
  designation: CurrentInjuryDesignation | null | undefined,
  now: Date,
): InjuryContext {
  const status = designation?.status?.trim() || null
  const uncertainty = [...ALWAYS_UNAVAILABLE_FIELDS]
  let freshness: InjuryStatusFreshness
  let source: string | null
  if (designation && status && designation.source === 'roster_status') {
    freshness = computeFreshness(row, now)
    source = `${row.source ?? 'unknown'}_roster_status`
  } else if (designation && status && designation.fact) {
    const fact = designation.fact
    const fetchedAt = toIso(fact.fetchedAt)
    freshness = {
      fetchedAt,
      expiresAt: null,
      updatedAt: toIso(fact.reportedAt) ?? fetchedAt,
      isStale: fact.stale,
      staleReason: fact.stale ? 'injury_claim_stale' : null,
    }
    source = fact.source ?? 'injury_feed'
  } else {
    freshness = emptyFreshness()
    source = 'injury_feed'
    uncertainty.push('no_current_injury_designation')
  }
  if (freshness.isStale === true) uncertainty.push('injury_status_stale')
  return {
    status,
    availabilityCategory: categoryForDesignation(status),
    practiceStatus: null,
    gameStatus: null,
    bodyPart: null,
    description: null,
    freshness,
    provenance: { source },
    // Resolved = the injury source was asked about THIS player. A player with no current designation is
    // resolved too — the answer was "nothing to report", which is not the same as never having asked.
    resolved: true,
    uncertainty,
  }
}

function unresolvedContexts(ids: string[], now: Date, warning: string): InjuryContextResult {
  return {
    byId: new Map(ids.map((id) => [id, projectInjuryContext(null, now)])),
    resolvedCount: 0,
    unresolvedIds: ids,
    warnings: [warning],
  }
}

/**
 * Read-only resolver for per-player injury context, keyed by the league's player ids. NEVER throws — a
 * read failure degrades to unresolved contexts.
 *
 * 🛑 THE DESIGNATION IS THE INJURY FEED'S, NOT `SportsPlayer.status` (2026-10-11). The ids give only an
 * identity: each id's cached row is found in the league's id space (`loadRows`, then
 * `indexRowsByLeagueId` — a Sleeper id is answered by a row carrying THAT Sleeper id, never by a provider
 * row whose own number happens to match), and the row's name / team / position are what the feed is
 * matched on. Only Sleeper's own row offers a roster status, and `resolveCurrentInjuryDesignations`
 * counts it only as a season-scale absence when no fresh fact contradicts it.
 */
export async function resolveInjuryContext(
  sport: string,
  ids: string[],
  port: InjuryContextPort = defaultInjuryContextPort,
): Promise<InjuryContextResult> {
  const requested = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)))
  if (requested.length === 0) {
    return { byId: new Map(), resolvedCount: 0, unresolvedIds: [], warnings: [] }
  }

  const now = new Date()
  let rows: RawInjuryContextRow[]
  try {
    rows = await port.loadRows(sport, requested)
  } catch {
    return unresolvedContexts(requested, now, 'injury_context_source_unavailable')
  }

  // One key per row, in the space it belongs to — never a provider number as a Sleeper id (rowKeys.ts).
  const rowByKey = indexRowsByLeagueId(rows)

  const lookups: DesignationLookup<string>[] = []
  for (const id of requested) {
    const row = rowByKey.get(id)
    const name = row?.name?.trim()
    if (!row || !name) continue
    lookups.push({
      key: id,
      name,
      team: row.team ?? null,
      position: row.position ?? null,
      // Only Sleeper's own row holds a roster status; another provider's `status` is its own vocabulary.
      rosterStatus: row.source === 'sleeper' ? row.status ?? null : null,
    })
  }

  let designations: Map<string, CurrentInjuryDesignation>
  try {
    const resolveDesignations = port.resolveDesignations ?? defaultInjuryContextPort.resolveDesignations!
    designations = lookups.length > 0 ? await resolveDesignations({ sport, players: lookups }) : new Map()
  } catch {
    return unresolvedContexts(requested, now, 'injury_feed_unavailable')
  }

  const asked = new Set(lookups.map((l) => l.key))
  const byId = new Map<string, InjuryContext>()
  const unresolvedIds: string[] = []
  let resolvedCount = 0

  for (const id of requested) {
    const row = rowByKey.get(id)
    const ctx = row && asked.has(id) ? projectDesignationContext(row, designations.get(id) ?? null, now) : projectInjuryContext(null, now)
    byId.set(id, ctx)
    if (ctx.resolved) {
      resolvedCount++
    } else {
      unresolvedIds.push(id)
    }
  }

  return { byId, resolvedCount, unresolvedIds, warnings: [] }
}

/**
 * Pure: fold per-player injury context onto the F2.1 metadata-enriched world. Never mutates
 * the base enriched view; returns a new additive injury/availability view.
 */
export function projectInjuryEnrichedWorld(
  world: EnrichedCanonicalWorld,
  contextResult: InjuryContextResult,
): InjuryEnrichedCanonicalWorld {
  const now = new Date()
  let requestedPlayers = 0
  let resolvedPlayers = 0
  let unavailablePlayers = 0
  let uncertainPlayers = 0
  let stalePlayers = 0
  const worldWarnings = new Set<string>()

  const rosters: InjuryEnrichedRosterFacts[] = world.rosters.map((roster) => {
    const injuryWarnings = new Set<string>()
    const players: InjuryEnrichedPlayer[] = roster.players.map((player) => {
      requestedPlayers += 1
      const ctx = contextResult.byId.get(player.playerId) ?? projectInjuryContext(null, now)

      if (ctx.resolved) resolvedPlayers++
      if (ctx.availabilityCategory === 'unavailable') unavailablePlayers++
      if (ctx.availabilityCategory === 'uncertain') uncertainPlayers++
      if (ctx.freshness.isStale === true) stalePlayers++
      for (const w of ctx.uncertainty) injuryWarnings.add(w)

      return { ...player, injuryContext: ctx }
    })

    const resolved = players.filter((p) => p.injuryContext.resolved).length

    for (const w of injuryWarnings) worldWarnings.add(w)

    return {
      ...roster,
      players,
      injuryCompleteness: pct(resolved, players.length),
      injuryWarnings: [...injuryWarnings],
    }
  })

  return {
    ...world,
    rosters,
    injurySummary: {
      requestedPlayers,
      resolvedPlayers,
      unavailablePlayers,
      uncertainPlayers,
      stalePlayers,
      completeness: pct(resolvedPlayers, requestedPlayers),
      warnings: [...worldWarnings],
    },
  }
}

/**
 * Read-only resolver: F2.1 metadata-enriched world → per-player injury context → additive
 * injury/availability view. Never throws; misses degrade to unresolved injury contexts.
 */
export async function resolveInjuryEnrichedCanonicalWorld(
  leagueId: string,
  deps: InjuryEnrichedWorldDeps = defaultInjuryEnrichedWorldDeps,
): Promise<InjuryEnrichedCanonicalWorld | null> {
  const world = await deps.resolveEnrichedWorld(leagueId)
  if (!world) return null
  const ids = Array.from(new Set(world.rosters.flatMap((r) => r.players.map((p) => p.playerId))))
  let contextResult: InjuryContextResult
  try {
    contextResult = await deps.resolveInjuryContext(world.league.sport, ids)
  } catch {
    const now = new Date()
    contextResult = {
      byId: new Map(ids.map((id) => [id, projectInjuryContext(null, now)])),
      resolvedCount: 0,
      unresolvedIds: ids,
      warnings: ['injury_context_source_unavailable'],
    }
  }
  return projectInjuryEnrichedWorld(world, contextResult)
}

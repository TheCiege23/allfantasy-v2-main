/**
 * Decision OS — Phase 2 / F2.4: Canonical World ADP / MARKET-VALUE enrichment (read-only derived VIEW).
 *
 * Builds ADDITIVELY on the F2.1 metadata-enriched world. The frozen Canonical World still carries ids only;
 * this module never mutates it. It reads ONLY already-persisted cache rows:
 *   - ADP: `AdpDataRecord` (same table Phase E trade enrichment reads — proven ID space)
 *   - Market value: `AllFantasyMarketPlayerValue` (published=true; leagueConcept='redraft' currently)
 *
 * FORMAT-CONTEXTUAL ADP SELECTION (pure, deterministic — see ADR_F2_4_ADP_MARKET_VALUE.md §4):
 *   The projector selects the best ADP row for a player by priority:
 *   1. Exact match: format === derivedFormat AND scoring === derivedScoring
 *   2. Same-format fallback: format === derivedFormat (any scoring) + adp_scoring_format_mismatch warning
 *   3. Any-format fallback: any row + adp_format_mismatch warning
 *   4. No rows → null + adp_unavailable warning
 *   Within each tier, freshest by createdAt wins.
 *
 * HONEST DEGRADATION (P2 — never fabricate):
 *   - Missing ADP rows → adp: null + adp_unavailable warning.
 *   - Missing market value rows → marketValue: null + market_value_unavailable warning.
 *   - Stale ADP (>7 days) → isStale: true + adp_age_exceeded_7_days warning.
 *   - Stale market value (>24h) → isStale: true + market_value_stale warning.
 *   - No live API calls, no cache warming, no writes.
 *
 * READ-ONLY: this file imports NO prisma. The port functions are in world/port.ts.
 */
import type { RawAdpRow, RawMarketValueRow } from './facts'
import { loadAdpRows, loadMarketValueRows } from './port'
import type { EnrichedCanonicalWorld, EnrichedPlayer, EnrichedRosterFacts } from './enrichedWorld'
import { resolveEnrichedCanonicalWorld } from './enrichedWorld'
import type { LeagueFacts } from './facts'
import type { ResolveCanonicalWorldOptions } from './index'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdpFreshness {
  createdAt: string | null
  /** Age-based: true when createdAt > 7 days ago; null when createdAt absent. */
  isStale: boolean | null
  staleReason: string | null
}

export interface AdpContext {
  /** ADP value from the best-matching row; null when unavailable. */
  adp: number | null
  /** Week-over-week ADP change; null when not available. */
  adpChange: number | null
  /** Spread across providers; null when not available. */
  adpSpread: number | null
  /** Consensus confidence (0–100); null when not available. */
  confidenceScore: number | null
  /** Number of providers that contributed to this ADP. */
  providerCount: number | null
  /** Format the ADP row came from ('redraft' | 'dynasty') — provenance, not a decision input. */
  format: string | null
  /** Scoring the ADP row came from ('ppr' | 'half-ppr' | 'standard' | '2qb' | 'superflex'). */
  scoring: string | null
  season: number | null
  week: number | null
  /** Import source label — provenance only. */
  source: string | null
  freshness: AdpFreshness
  /** True when ADP is non-null and freshness data is present. */
  resolved: boolean
  uncertainty: string[]
}

export interface MarketValueFreshness {
  generatedAt: string | null
  updatedAt: string | null
  /** True when generatedAt > 24 hours ago; null when generatedAt absent. */
  isStale: boolean | null
  staleReason: string | null
}

export interface MarketValueContext {
  marketValue: number | null
  baseValue: number | null
  adjustmentPercent: number | null
  /** Signal confidence; null when unavailable. */
  confidence: number | null
  /** Number of trade signals contributing to this value. */
  sampleSize: number | null
  /** Trending direction ('up' | 'down' | 'stable'); null when unavailable. */
  direction: string | null
  leagueConcept: string | null
  scoringFormat: string | null
  freshness: MarketValueFreshness
  resolved: boolean
  uncertainty: string[]
}

export interface AdpMarketContext {
  adp: AdpContext
  marketValue: MarketValueContext
}

export interface AdpEnrichedPlayer extends EnrichedPlayer {
  adpMarketContext: AdpMarketContext
}

export interface AdpEnrichedRosterFacts extends Omit<EnrichedRosterFacts, 'players'> {
  players: AdpEnrichedPlayer[]
  /** 0–100 share of this roster's players that have a resolved ADP. */
  adpCompleteness: number
  /** 0–100 share with a resolved market value. */
  marketValueCompleteness: number
  adpWarnings: string[]
}

export interface AdpEnrichmentSummary {
  requestedPlayers: number
  adpResolvedPlayers: number
  marketValueResolvedPlayers: number
  staleAdpPlayers: number
  adpCompleteness: number
  marketValueCompleteness: number
  warnings: string[]
}

export interface AdpEnrichedCanonicalWorld extends Omit<EnrichedCanonicalWorld, 'rosters'> {
  rosters: AdpEnrichedRosterFacts[]
  adpSummary: AdpEnrichmentSummary
}

// ─── Port interfaces ──────────────────────────────────────────────────────────

export interface AdpPort {
  loadAdp: (sport: string, ids: string[]) => Promise<RawAdpRow[]>
  loadMarketValues: (sport: string, ids: string[]) => Promise<RawMarketValueRow[]>
}

export const defaultAdpPort: AdpPort = {
  loadAdp: (sport, ids) => loadAdpRows(sport, ids),
  loadMarketValues: (sport, ids) => loadMarketValueRows(sport, ids),
}

export interface AdpEnrichedWorldDeps {
  resolveEnrichedWorld: (leagueId: string, options?: ResolveCanonicalWorldOptions) => Promise<EnrichedCanonicalWorld | null>
  resolveAdpContext: (sport: string, ids: string[], leagueFacts: LeagueFacts) => Promise<AdpContextResult>
}

export const defaultAdpEnrichedWorldDeps: AdpEnrichedWorldDeps = {
  resolveEnrichedWorld: (leagueId, options) => resolveEnrichedCanonicalWorld(leagueId, options ? { ...options } : undefined),
  resolveAdpContext: (sport, ids, leagueFacts) => resolveAdpContext(sport, ids, leagueFacts),
}

export interface AdpContextResult {
  adpById: Map<string, AdpContext>
  marketValueById: Map<string, MarketValueContext>
  adpResolvedCount: number
  marketValueResolvedCount: number
  warnings: string[]
}

// ─── ADP staleness threshold ──────────────────────────────────────────────────

const ADP_STALE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MARKET_VALUE_STALE_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Pure: derive the ADP format string from league isDynasty.
 * Matches what `lib/workers/adp-blender.ts` writes: `isDynasty ? 'dynasty' : 'redraft'`.
 */
export function deriveAdpFormat(isDynasty: boolean): 'dynasty' | 'redraft' {
  return isDynasty ? 'dynasty' : 'redraft'
}

/**
 * Pure: derive the ADP scoring string from a scoring preset ID.
 * Matches what `lib/workers/adp-importer.ts` writes.
 */
export function deriveAdpScoring(scoringPresetId: string | null): string | null {
  if (!scoringPresetId) return null
  switch (scoringPresetId.toLowerCase()) {
    case 'ppr': return 'ppr'
    // FFC importer writes 'halfPPR' (camelCase) — not 'half-ppr'; see ADR_F2_4 §2.1 + probe results
    case 'half_ppr': case 'half-ppr': return 'halfPPR'
    case 'standard': return 'standard'
    case '2qb': return '2qb'
    case 'superflex': return 'superflex'
    default: return null
  }
}

/**
 * Pure: select the best ADP row for a player from all available rows (all formats/scorings).
 * Implements the tiered selection from ADR_F2_4 §4. Within each tier, freshest row wins
 * (rows are pre-sorted by createdAt desc from the port).
 *
 * Returns { row, matchTier } where matchTier describes which fallback level was reached.
 */
export function selectBestAdpRow(
  rows: RawAdpRow[],
  derivedFormat: string,
  derivedScoring: string | null,
): { row: RawAdpRow; matchTier: 'exact' | 'same_format' | 'any_format' } | null {
  if (rows.length === 0) return null

  // Tier 1: exact format + scoring match
  if (derivedScoring) {
    const exact = rows.find((r) => r.format === derivedFormat && r.scoring === derivedScoring)
    if (exact) return { row: exact, matchTier: 'exact' }
  }

  // Tier 2: same format, any scoring
  const sameFormat = rows.find((r) => r.format === derivedFormat)
  if (sameFormat) return { row: sameFormat, matchTier: 'same_format' }

  // Tier 3: any format (freshest by port ordering)
  return { row: rows[0]!, matchTier: 'any_format' }
}

function toIso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null
}

function pct(resolved: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((resolved / total) * 100)
}

/**
 * Pure: build AdpFreshness from a raw ADP row. Age-based since AdpDataRecord has no expiresAt.
 */
export function projectAdpFreshness(row: RawAdpRow, now: Date): AdpFreshness {
  const createdAt = toIso(row.createdAt)
  if (!(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime())) {
    return { createdAt: null, isStale: null, staleReason: 'adp_freshness_unavailable' }
  }
  const ageMs = now.getTime() - row.createdAt.getTime()
  const isStale = ageMs > ADP_STALE_MS
  return {
    createdAt,
    isStale,
    staleReason: isStale ? 'adp_age_exceeded_7_days' : null,
  }
}

/**
 * Pure: build MarketValueFreshness from a raw market value row.
 */
export function projectMarketValueFreshness(row: RawMarketValueRow, now: Date): MarketValueFreshness {
  const generatedAt = toIso(row.generatedAt)
  const updatedAt = toIso(row.updatedAt)
  if (!(row.generatedAt instanceof Date) || Number.isNaN(row.generatedAt.getTime())) {
    return { generatedAt: null, updatedAt, isStale: null, staleReason: 'market_value_freshness_unavailable' }
  }
  const ageMs = now.getTime() - row.generatedAt.getTime()
  const isStale = ageMs > MARKET_VALUE_STALE_MS
  return {
    generatedAt,
    updatedAt,
    isStale,
    staleReason: isStale ? 'market_value_stale' : null,
  }
}

/**
 * Pure: build an AdpContext from available rows for a single player. No IO.
 * `playerRows` = all AdpDataRecord rows for this player (freshest first from port).
 */
export function projectAdpContext(
  playerRows: RawAdpRow[],
  derivedFormat: string,
  derivedScoring: string | null,
  now: Date,
): AdpContext {
  const uncertainty: string[] = []

  if (playerRows.length === 0) {
    return {
      adp: null, adpChange: null, adpSpread: null, confidenceScore: null, providerCount: null,
      format: null, scoring: null, season: null, week: null, source: null,
      freshness: { createdAt: null, isStale: null, staleReason: 'adp_freshness_unavailable' },
      resolved: false,
      uncertainty: ['adp_unavailable'],
    }
  }

  const selected = selectBestAdpRow(playerRows, derivedFormat, derivedScoring)
  if (!selected) {
    return {
      adp: null, adpChange: null, adpSpread: null, confidenceScore: null, providerCount: null,
      format: null, scoring: null, season: null, week: null, source: null,
      freshness: { createdAt: null, isStale: null, staleReason: 'adp_freshness_unavailable' },
      resolved: false,
      uncertainty: ['adp_unavailable'],
    }
  }

  const { row, matchTier } = selected
  if (matchTier === 'same_format') uncertainty.push('adp_scoring_format_mismatch')
  if (matchTier === 'any_format') uncertainty.push('adp_format_mismatch')
  if (!derivedScoring) uncertainty.push('adp_scoring_format_unknown')

  const freshness = projectAdpFreshness(row, now)
  if (freshness.isStale === true) uncertainty.push('adp_age_exceeded_7_days')

  return {
    adp: row.adp,
    adpChange: row.adpChange,
    adpSpread: row.adpSpread,
    confidenceScore: row.confidenceScore,
    providerCount: row.providerCount,
    format: row.format,
    scoring: row.scoring,
    season: row.season,
    week: row.week,
    source: row.source,
    freshness,
    resolved: true,
    uncertainty,
  }
}

/**
 * Pure: build a MarketValueContext from a raw row. Null row → honest degrade.
 */
export function projectMarketValueContext(
  row: RawMarketValueRow | null | undefined,
  now: Date,
): MarketValueContext {
  if (!row) {
    return {
      marketValue: null, baseValue: null, adjustmentPercent: null, confidence: null,
      sampleSize: null, direction: null, leagueConcept: null, scoringFormat: null,
      freshness: { generatedAt: null, updatedAt: null, isStale: null, staleReason: 'market_value_freshness_unavailable' },
      resolved: false,
      uncertainty: ['market_value_unavailable'],
    }
  }

  const freshness = projectMarketValueFreshness(row, now)
  const uncertainty: string[] = []
  if (freshness.isStale === true) uncertainty.push('market_value_stale')

  return {
    marketValue: row.marketValue,
    baseValue: row.baseValue,
    adjustmentPercent: row.adjustmentPercent,
    confidence: row.confidence,
    sampleSize: row.sampleSize,
    direction: row.direction,
    leagueConcept: row.leagueConcept,
    scoringFormat: row.scoringFormat,
    freshness,
    resolved: true,
    uncertainty,
  }
}

/**
 * Pure: fold ADP + market-value context onto the F2.1 metadata-enriched world.
 * Never mutates the base enriched view; returns a new additive ADP/market-value view.
 */
export function projectAdpEnrichedWorld(
  world: EnrichedCanonicalWorld,
  contextResult: AdpContextResult,
  leagueFacts: LeagueFacts,
): AdpEnrichedCanonicalWorld {
  const now = new Date()
  const derivedFormat = deriveAdpFormat(leagueFacts.isDynasty)
  const derivedScoring = deriveAdpScoring(leagueFacts.scoringPresetId)

  let requestedPlayers = 0
  let adpResolvedPlayers = 0
  let marketValueResolvedPlayers = 0
  let staleAdpPlayers = 0
  const worldWarnings = new Set<string>()

  const rosters: AdpEnrichedRosterFacts[] = world.rosters.map((roster) => {
    const rosterWarnings = new Set<string>()
    const players: AdpEnrichedPlayer[] = roster.players.map((player) => {
      requestedPlayers += 1

      const adpCtx = contextResult.adpById.get(player.playerId)
        ?? projectAdpContext([], derivedFormat, derivedScoring, now)
      const mvCtx = contextResult.marketValueById.get(player.playerId)
        ?? projectMarketValueContext(null, now)

      if (adpCtx.resolved) adpResolvedPlayers++
      if (mvCtx.resolved) marketValueResolvedPlayers++
      if (adpCtx.freshness.isStale === true) staleAdpPlayers++
      for (const w of adpCtx.uncertainty) rosterWarnings.add(w)
      for (const w of mvCtx.uncertainty) rosterWarnings.add(w)

      return { ...player, adpMarketContext: { adp: adpCtx, marketValue: mvCtx } }
    })

    const adpResolved = players.filter((p) => p.adpMarketContext.adp.resolved).length
    const mvResolved = players.filter((p) => p.adpMarketContext.marketValue.resolved).length

    for (const w of rosterWarnings) worldWarnings.add(w)

    return {
      ...roster,
      players,
      adpCompleteness: pct(adpResolved, players.length),
      marketValueCompleteness: pct(mvResolved, players.length),
      adpWarnings: [...rosterWarnings],
    }
  })

  return {
    ...world,
    rosters,
    adpSummary: {
      requestedPlayers,
      adpResolvedPlayers,
      marketValueResolvedPlayers,
      staleAdpPlayers,
      adpCompleteness: pct(adpResolvedPlayers, requestedPlayers),
      marketValueCompleteness: pct(marketValueResolvedPlayers, requestedPlayers),
      warnings: [...worldWarnings],
    },
  }
}

/**
 * Read-only resolver for per-player ADP + market-value context. Reads both seams in parallel.
 * NEVER throws — a read failure degrades to unresolved contexts.
 */
export async function resolveAdpContext(
  sport: string,
  ids: string[],
  leagueFacts: LeagueFacts,
  port: AdpPort = defaultAdpPort,
): Promise<AdpContextResult> {
  const requested = Array.from(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)))
  if (requested.length === 0) {
    return {
      adpById: new Map(),
      marketValueById: new Map(),
      adpResolvedCount: 0,
      marketValueResolvedCount: 0,
      warnings: [],
    }
  }

  const now = new Date()
  const derivedFormat = deriveAdpFormat(leagueFacts.isDynasty)
  const derivedScoring = deriveAdpScoring(leagueFacts.scoringPresetId)

  let adpRows: RawAdpRow[] = []
  let marketValueRows: RawMarketValueRow[] = []

  const [adpResult, mvResult] = await Promise.allSettled([
    port.loadAdp(sport, requested),
    port.loadMarketValues(sport, requested),
  ])

  const warnings: string[] = []
  if (adpResult.status === 'fulfilled') {
    adpRows = adpResult.value
  } else {
    warnings.push('adp_context_source_unavailable')
  }
  if (mvResult.status === 'fulfilled') {
    marketValueRows = mvResult.value
  } else {
    warnings.push('market_value_source_unavailable')
  }

  // Group ADP rows by playerId (port returns freshest-first, so order is preserved)
  const adpByPlayer = new Map<string, RawAdpRow[]>()
  for (const row of adpRows) {
    const existing = adpByPlayer.get(row.playerId)
    if (existing) { existing.push(row) } else { adpByPlayer.set(row.playerId, [row]) }
  }

  // Market value: freshest row per player (port orders by generatedAt desc)
  const mvByPlayer = new Map<string, RawMarketValueRow>()
  for (const row of marketValueRows) {
    if (!mvByPlayer.has(row.playerId)) mvByPlayer.set(row.playerId, row)
  }

  const adpById = new Map<string, AdpContext>()
  const marketValueById = new Map<string, MarketValueContext>()
  let adpResolvedCount = 0
  let marketValueResolvedCount = 0

  for (const id of requested) {
    const playerAdpRows = adpByPlayer.get(id) ?? []
    const adpCtx = projectAdpContext(playerAdpRows, derivedFormat, derivedScoring, now)
    adpById.set(id, adpCtx)
    if (adpCtx.resolved) adpResolvedCount++

    const mvRow = mvByPlayer.get(id)
    const mvCtx = projectMarketValueContext(mvRow ?? null, now)
    marketValueById.set(id, mvCtx)
    if (mvCtx.resolved) marketValueResolvedCount++
  }

  return { adpById, marketValueById, adpResolvedCount, marketValueResolvedCount, warnings }
}

/**
 * Read-only resolver: F2.1 metadata-enriched world → per-player ADP + market-value context →
 * additive ADP/market-value view. Never throws; misses degrade to unresolved contexts.
 */
export async function resolveAdpEnrichedCanonicalWorld(
  leagueId: string,
  deps: AdpEnrichedWorldDeps = defaultAdpEnrichedWorldDeps,
): Promise<AdpEnrichedCanonicalWorld | null> {
  const world = await deps.resolveEnrichedWorld(leagueId)
  if (!world) return null

  const ids = Array.from(new Set(world.rosters.flatMap((r) => r.players.map((p) => p.playerId))))
  let contextResult: AdpContextResult

  try {
    contextResult = await deps.resolveAdpContext(world.league.sport, ids, world.league)
  } catch {
    const now = new Date()
    const emptyAdp = projectAdpContext([], deriveAdpFormat(world.league.isDynasty), deriveAdpScoring(world.league.scoringPresetId), now)
    const emptyMv = projectMarketValueContext(null, now)
    contextResult = {
      adpById: new Map(ids.map((id) => [id, emptyAdp])),
      marketValueById: new Map(ids.map((id) => [id, emptyMv])),
      adpResolvedCount: 0,
      marketValueResolvedCount: 0,
      warnings: ['adp_context_source_unavailable'],
    }
  }

  return projectAdpEnrichedWorld(world, contextResult, world.league)
}

/**
 * Decision OS — Phase E.1: the reusable Canonical Asset contract (Resolution layer).
 *
 * This is the provider-agnostic, purpose-blind ASSET fact contract every decision consumes. Per
 * ADR-DOS-003 (§0.1 binding rule, §3) it lives in the WORLD layer, not under `trade/`: Trade *consumes*
 * a `CanonicalAsset` and adds only exchange direction (`from → to`); it does not define the asset. The
 * same contract is reusable by lineup / waiver / commissioner / future tools.
 *
 * Three layers, built across phases:
 *   Resolution (E.1, here)  → Enrichment (Phase F)  → Context (E.2 / E.3)
 * E.1 fills ONLY the Resolution layer (what the asset IS + who owns it). `enrichment`, `context`, and
 * `value` are present-but-HONESTLY-EMPTY (every field null, flagged in `completeness.layers`). An empty
 * layer is honestly empty — never fabricated, never silently omitted.
 *
 * Nothing here performs IO. No prisma. No import from `lib/decision-os/trade/` (the world layer never
 * depends on a decision slice). Pure functions only — the read-only loaders that produce the raw inputs
 * live at the route seam (Phase E.3), exactly like the rest of the substrate.
 */

// ──────────────────────────────────────────────────────────────────────────
// Canonical Asset contract (origin-blind, purpose-blind, reusable)
// ──────────────────────────────────────────────────────────────────────────

export type CanonicalAssetType =
  | 'player'
  | 'draft_pick'
  | 'faab'
  | 'contract'
  | 'keeper'
  | 'salary'
  | 'devy'
  | 'future_consideration'

export type AssetTrust = 'high' | 'medium' | 'low' | 'unverified'

/** Current canonical ownership. `rosterId` null when unowned/unknown — never fabricated. */
export interface AssetOwner {
  rosterId: string | null
  teamId: string | null
}

// Intrinsic facts (what the asset IS). Only the slot matching `assetType` is populated; the rest stay
// null so the contract is uniform across decisions and additive across phases.
export interface PlayerAssetMetadata {
  playerId: string | null
  name: string | null
  position: string | null
  team: string | null
}
export interface PickAssetMetadata {
  season: number | null
  round: number | null
  pickNumber: number | null
  /** The roster the pick originally belonged to (pick provenance) — models a tradeable pick without a redraft draft. */
  originalRosterId: string | null
  label: string | null
}
export interface FaabAssetMetadata {
  amount: number | null
}
export interface KeeperAssetMetadata {
  playerId: string | null
  name: string | null
  /** Filled by keeper-settings enrichment (Phase F) — null = modeled-but-unvalued. */
  keeperRound: number | null
  keeperCost: number | null
}
export interface ContractAssetMetadata {
  years: number | null
  capHit: number | null
}
export interface SalaryAssetMetadata {
  amount: number | null
}
export interface DevyAssetMetadata {
  playerId: string | null
  name: string | null
}

export interface AssetMetadata {
  player: PlayerAssetMetadata | null
  pick: PickAssetMetadata | null
  faab: FaabAssetMetadata | null
  keeper: KeeperAssetMetadata | null
  contract: ContractAssetMetadata | null
  salary: SalaryAssetMetadata | null
  devy: DevyAssetMetadata | null
}

/**
 * External truths about the asset — origin/purpose-blind facts the Canonical World holds (P1/P2).
 * Honestly EMPTY (all null) until Phase F enrichment lands. Each field will, in Phase F, become a
 * fact-with-provenance; at E.1 the slots exist so enrichment extends the contract additively.
 */
export interface AssetEnrichment {
  projections: unknown
  injuries: unknown
  weather: unknown
  news: unknown
  depthChart: unknown
  usage: unknown
  marketValue: unknown
  trends: unknown
  analytics: unknown
}

/**
 * Situational meaning of the asset in THIS league/roster. Honestly empty (null) until E.2/E.3 compute
 * it from the canonical world (profiles, scoring, schedule).
 */
export interface AssetContext {
  contenderScore: number | null
  rebuildScore: number | null
  rosterFit: number | null
  positionalScarcity: number | null
  leagueScoring: string | null
  managerTendencies: unknown
  playoffImpact: number | null
  schedule: unknown
}

/**
 * Deterministic value. `null` at E.1 (not yet computed) — E.2 rehosts the pure value engine to fill it.
 * `sources` is a neutral named map (projection/adp/ranking/market…) so the world layer never imports a
 * higher decision/value module; each source is null when unavailable (honest).
 */
export interface AssetValue {
  internalValue: number | null
  sources: Record<string, number | null>
}

/** Per-asset provenance — origin lives HERE, never in decision logic (origin-blindness). */
export interface AssetProvenance {
  /** Canonical model the Resolution layer came from (e.g. 'AfLeagueTradeItem' / 'RedraftTradeAsset'). */
  sourceModel: string
  /** Origin marker (provider name / 'native' / 'redraft') — PROVENANCE ONLY. Never a decision input. */
  origin: string | null
  trust: AssetTrust
}

export interface AssetLayerPresence {
  resolution: boolean
  enrichment: boolean
  context: boolean
  value: boolean
}

export interface AssetCompleteness {
  /** 0–100 honest completeness of the RESOLUTION layer at E.1 (identity + ownership). */
  score: number
  /** Which layers are present vs honestly-empty. Downstream phases flip these on as they fill layers. */
  layers: AssetLayerPresence
}

/**
 * The contract the Decision OS sees — and the ONLY thing it sees. It does not care where `value`,
 * `enrichment`, or `context` came from (purpose-blindness). Adding a provider or an enrichment API
 * changes nothing above this shape.
 */
export interface CanonicalAsset {
  assetId: string
  assetType: CanonicalAssetType
  owner: AssetOwner
  value: AssetValue | null
  metadata: AssetMetadata
  enrichment: AssetEnrichment
  context: AssetContext
  provenance: AssetProvenance
  completeness: AssetCompleteness
  uncertainty: string[]
}

/**
 * Pre-canonical staging row — the neutral shape both the canonical (`AfLeagueTradeItem`) and the redraft
 * (`RedraftTradeAsset`) graphs adapt into before resolution. It carries `toRosterId` because the SOURCE
 * rows do (and the trade layer needs it to build movements), but `toRosterId` is exchange semantics and
 * is deliberately NOT part of `CanonicalAsset` — the asset records only its current `owner`.
 */
export interface RawCanonicalAssetInput {
  id: string
  /** Raw asset-type token from the source graph (itemType / assetType). Normalized by the resolver. */
  rawType: string
  /** Current owner / sender. */
  fromRosterId: string
  /** Recipient — exchange semantics; consumed by the trade layer, not stored on the asset. */
  toRosterId: string
  playerId: string | null
  playerName: string | null
  position: string | null
  team: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
  pickOriginalRosterId: string | null
  pickLabel: string | null
  faabAmount: number | null
  /** Provenance only. */
  origin: string | null
  sourceModel: string
}

// ──────────────────────────────────────────────────────────────────────────
// Type normalization
// ──────────────────────────────────────────────────────────────────────────

const ASSET_TYPE_SYNONYMS: Record<string, CanonicalAssetType> = {
  player: 'player',
  draft_pick: 'draft_pick',
  pick: 'draft_pick',
  draftpick: 'draft_pick',
  faab: 'faab',
  faab_dollars: 'faab',
  budget: 'faab',
  keeper: 'keeper',
  contract: 'contract',
  salary: 'salary',
  cap: 'salary',
  devy: 'devy',
  future_consideration: 'future_consideration',
  future: 'future_consideration',
  consideration: 'future_consideration',
}

/** Map a raw source token to a canonical asset type. `recognized:false` ⇒ honest unverified fallback. */
export function normalizeAssetType(raw: string | null | undefined): {
  type: CanonicalAssetType
  recognized: boolean
} {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  const mapped = ASSET_TYPE_SYNONYMS[key]
  if (mapped) return { type: mapped, recognized: true }
  return { type: 'future_consideration', recognized: false }
}

// ──────────────────────────────────────────────────────────────────────────
// Honest-empty layer factories (Phase F / E.2 fill these)
// ──────────────────────────────────────────────────────────────────────────

export function emptyEnrichment(): AssetEnrichment {
  return {
    projections: null,
    injuries: null,
    weather: null,
    news: null,
    depthChart: null,
    usage: null,
    marketValue: null,
    trends: null,
    analytics: null,
  }
}

export function emptyContext(): AssetContext {
  return {
    contenderScore: null,
    rebuildScore: null,
    rosterFit: null,
    positionalScarcity: null,
    leagueScoring: null,
    managerTendencies: null,
    playoffImpact: null,
    schedule: null,
  }
}

function emptyMetadata(): AssetMetadata {
  return { player: null, pick: null, faab: null, keeper: null, contract: null, salary: null, devy: null }
}

// ──────────────────────────────────────────────────────────────────────────
// Resolution
// ──────────────────────────────────────────────────────────────────────────

/** Resolve the Resolution layer for every staged asset. Pure; order-preserving. */
export function resolveCanonicalAssets(inputs: RawCanonicalAssetInput[]): CanonicalAsset[] {
  return inputs.map(resolveCanonicalAsset)
}

/** Resolve a single staged asset into the Resolution layer of the reusable contract. Pure. */
export function resolveCanonicalAsset(row: RawCanonicalAssetInput): CanonicalAsset {
  const { type, recognized } = normalizeAssetType(row.rawType)
  const uncertainty: string[] = []
  if (!recognized) {
    uncertainty.push(`Unrecognized asset type "${row.rawType}" — modeled as future_consideration (unvalued).`)
  }

  const metadata = buildMetadata(type, row)

  // The §5 Missing fact: pick OWNERSHIP cannot be verified against a canonical pick-inventory yet.
  if (type === 'draft_pick') {
    uncertainty.push('Pick ownership not verified against a canonical pick-inventory fact (ADR-DOS-003 §5).')
  }

  const owner: AssetOwner = { rosterId: row.fromRosterId || null, teamId: null }
  if (!owner.rosterId) uncertainty.push('Asset has no current owner (fromRosterId missing).')

  return {
    assetId: row.id,
    assetType: type,
    owner,
    // E.1 does not compute value — that is E.2 (rehosted pure engine). Honestly null, never fabricated.
    value: null,
    metadata,
    enrichment: emptyEnrichment(),
    context: emptyContext(),
    provenance: { sourceModel: row.sourceModel, origin: row.origin, trust: recognized ? 'high' : 'unverified' },
    completeness: {
      score: resolutionCompleteness(type, metadata, owner),
      // E.1 fills only resolution; the rest are honestly empty until later phases.
      layers: { resolution: true, enrichment: false, context: false, value: false },
    },
    uncertainty,
  }
}

function buildMetadata(type: CanonicalAssetType, row: RawCanonicalAssetInput): AssetMetadata {
  const meta = emptyMetadata()
  switch (type) {
    case 'player':
      meta.player = { playerId: row.playerId, name: row.playerName, position: row.position, team: row.team }
      break
    case 'keeper':
      meta.keeper = { playerId: row.playerId, name: row.playerName, keeperRound: null, keeperCost: null }
      break
    case 'devy':
      meta.devy = { playerId: row.playerId, name: row.playerName }
      break
    case 'draft_pick':
      meta.pick = {
        season: row.pickSeason,
        round: row.pickRound,
        pickNumber: row.pickNumber,
        originalRosterId: row.pickOriginalRosterId,
        label: row.pickLabel,
      }
      break
    case 'faab':
      meta.faab = { amount: row.faabAmount }
      break
    case 'salary':
      meta.salary = { amount: row.faabAmount }
      break
    case 'contract':
      meta.contract = { years: null, capHit: null }
      break
    case 'future_consideration':
    default:
      break
  }
  return meta
}

/**
 * Honest completeness of the RESOLUTION layer only (E.1). Enrichment/context/value completeness is added
 * by later phases — see `completeness.layers`. Ownership is always required; identity requirements vary
 * by type.
 */
function resolutionCompleteness(type: CanonicalAssetType, metadata: AssetMetadata, owner: AssetOwner): number {
  const checks: boolean[] = [owner.rosterId != null]
  switch (type) {
    case 'player':
      checks.push(metadata.player?.playerId != null)
      break
    case 'keeper':
      checks.push(metadata.keeper?.playerId != null)
      break
    case 'devy':
      checks.push(metadata.devy?.playerId != null)
      break
    case 'draft_pick':
      checks.push(metadata.pick?.season != null, metadata.pick?.round != null)
      break
    case 'faab':
      checks.push(metadata.faab?.amount != null)
      break
    case 'salary':
      checks.push(metadata.salary?.amount != null)
      break
    case 'contract':
    case 'future_consideration':
    default:
      // Intrinsically light at resolution — ownership is the only hard requirement.
      break
  }
  const passed = checks.filter(Boolean).length
  return Math.round((passed / checks.length) * 100)
}

// ──────────────────────────────────────────────────────────────────────────
// Thin, pure adapters from the source asset graphs → the neutral staging input
//
// These take plain row objects (decoupled from Prisma) so the read-only loaders at the route seam stay
// the only IO. The canonical graph (`AfLeagueTradeItem`) is the real source; the redraft graph
// (`RedraftTradeAsset`) adapter exists for E.1 PARITY (prove identical resolution from either source).
// ──────────────────────────────────────────────────────────────────────────

export interface AfLeagueTradeItemRow {
  id: string
  itemType: string
  itemReference: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount: number | null
  metadata?: unknown
}

export interface RedraftTradeAssetRow {
  id: string
  assetType: string
  fromRosterId: string
  toRosterId: string
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
  metadata?: unknown
}

/** Canonical graph → staging input. `itemReference` carries the player id (playerish) or pick label. */
export function fromAfLeagueTradeItems(
  items: AfLeagueTradeItemRow[],
  origin: string | null = null,
): RawCanonicalAssetInput[] {
  return items.map((it) => {
    const meta = asRecord(it.metadata)
    const { type } = normalizeAssetType(it.itemType)
    const playerish = type === 'player' || type === 'keeper' || type === 'devy'
    const season = numOrNull(meta?.pickSeason ?? meta?.season)
    const round = numOrNull(meta?.pickRound ?? meta?.round)
    return {
      id: it.id,
      rawType: it.itemType,
      fromRosterId: it.fromRosterId,
      toRosterId: it.toRosterId,
      playerId: playerish ? (it.itemReference ?? strOrNull(meta?.playerId)) : strOrNull(meta?.playerId),
      playerName: strOrNull(meta?.playerName ?? meta?.name),
      position: strOrNull(meta?.position),
      team: strOrNull(meta?.team),
      pickSeason: season,
      pickRound: round,
      pickNumber: numOrNull(meta?.pickNumber),
      pickOriginalRosterId: strOrNull(meta?.originalRosterId),
      pickLabel: type === 'draft_pick' ? (it.itemReference ?? strOrNull(meta?.pickLabel) ?? buildPickLabel(season, round)) : null,
      faabAmount: it.faabAmount ?? numOrNull(meta?.faabAmount),
      origin,
      sourceModel: 'AfLeagueTradeItem',
    }
  })
}

/** Redraft graph → staging input (parity source). Explicit columns; metadata fills the soft fields. */
export function fromRedraftTradeAssets(assets: RedraftTradeAssetRow[]): RawCanonicalAssetInput[] {
  return assets.map((a) => {
    const meta = asRecord(a.metadata)
    return {
      id: a.id,
      rawType: a.assetType,
      fromRosterId: a.fromRosterId,
      toRosterId: a.toRosterId,
      playerId: a.playerId,
      playerName: a.playerName,
      position: strOrNull(meta?.position),
      team: strOrNull(meta?.team),
      pickSeason: a.pickSeason,
      pickRound: a.pickRound,
      pickNumber: a.pickNumber,
      pickOriginalRosterId: strOrNull(meta?.originalRosterId),
      pickLabel: strOrNull(meta?.pickLabel) ?? buildPickLabel(a.pickSeason, a.pickRound),
      faabAmount: numOrNull(meta?.faabAmount),
      origin: 'redraft',
      sourceModel: 'RedraftTradeAsset',
    }
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Small pure helpers
// ──────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function buildPickLabel(season: number | null, round: number | null): string | null {
  if (season == null && round == null) return null
  const s = season != null ? String(season) : '????'
  const r = round != null ? `R${round}` : 'R?'
  return `${s} ${r}`
}

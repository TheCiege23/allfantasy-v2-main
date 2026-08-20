/**
 * Decision OS — Phase E.4: the canonical `TradeWorld` shadow attempt.
 *
 * Runs the approved canonical pipeline BESIDE the existing redraft-native trade shadow:
 *
 *     CanonicalWorld → TradeWorldResolver → CanonicalTradeMemo → manager.trade.evaluate
 *
 * It is SHADOW-ONLY and PARITY-FIRST. The native (redraft) shadow path runs FIRST and is untouched;
 * this attempt runs alongside it for parity/telemetry. It NEVER throws, NEVER writes, NEVER persists,
 * NEVER warms a cache, and NEVER mutates a proposal/snapshot — the injected `resolveWorld` is read-only
 * (default `resolveCanonicalWorld`, whose default port is prisma find* only).
 *
 * When canonical inputs are unavailable it returns a STRUCTURED SKIP (never an error):
 *   • `canonical_trade_world_unavailable`      — no canonical world, or neither a direct id match nor the
 *                                                E.5 roster-identity join (teamId/managerUserId) could map
 *                                                BOTH participants to a canonical roster.
 *   • `canonical_asset_resolution_unavailable` — the trade assets could not be staged into canonical
 *                                                movements (no assets / resolution produced nothing).
 *   • `canonical_memo_unavailable`             — the two-sided canonical memo could not be produced
 *                                                (multi-team trade, or the engine threw).
 *
 * E.5 — read-only market enrichment is now wired: `resolveEnrichment` (default `resolveTradeEnrichment`)
 * feeds ADP (`AdpDataRecord`) + position (SportsPlayer cache) into `MarketContext`, lifting parity from the
 * E.4 honest-degraded floor toward meaningful parity. Projection still has NO canonical read-only source,
 * so it stays null and player values without an ADP signal still floor to 0 — the residual honest gap. The
 * attempt never fabricates a value or parity (P3); unsourced fields degrade to uncertainty, not invention.
 *
 * Telemetry: emits `decision.shadow_parity` with `source: 'canonical_trade_world'` and the completeness /
 * uncertainty / asset-count / participant-count / memo-source / valuation-source signals. The provider
 * name appears ONLY under `provenance` (debug/audit) — never in a decision-facing flag.
 */
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { fromAfLeagueTradeItems, resolveCanonicalAssets, type AfLeagueTradeItemRow } from '@/lib/decision-os/world/assets'
import { emitShadowParity } from '@/lib/decision-os/core/parity'
import { resolveTradeWorld } from './tradeWorld'
import {
  buildTradeMemo,
  compareTradeMemos,
  type CanonicalTradeMemo,
  type TradeMemoParityResult,
  type TradeMovement,
} from './canonicalMemo'
import { deriveParticipants, type TradeAssetSummary } from './dco'
import { resolveTradeEnrichment, type TradeEnrichmentResult } from './enrichmentPort'
import {
  resolveRosterIdentityJoin,
  type RosterIdentityResolver,
  type RosterIdentityMethod,
} from './rosterIdentity'

export type CanonicalTradeShadowSkipReason =
  | 'canonical_trade_world_unavailable'
  | 'canonical_asset_resolution_unavailable'
  | 'canonical_memo_unavailable'

/** Pure telemetry record for the canonical attempt — built whether it ran or skipped, then emitted. */
export interface CanonicalTradeShadowTelemetry {
  decision_type: 'manager.trade.evaluate'
  /** ALWAYS 'canonical_trade_world' here — distinguishes this attempt from the `redraft_native` path. */
  source: 'canonical_trade_world'
  ran: boolean
  reason?: CanonicalTradeShadowSkipReason
  asset_count: number
  participant_count: number
  memo_source?: 'canonical_world'
  valuation_source?: 'deterministic_engine'
  completeness?: number
  uncertainty_count?: number
  /** E.5 — which read-only market sources fed the enrichment (provenance/debug; no provider name). */
  enrichment_source?: string | null
  /** E.5 — counts of player ids that resolved a real ADP value / position from the read-only seam. */
  adp_resolved?: number
  position_resolved?: number
  /** E.5 — how each participant mapped to a canonical roster (direct/team/manager). Origin-blind. */
  identity_method?: { proposer: RosterIdentityMethod; receiver: RosterIdentityMethod }
  parity?: { passed: boolean; value_totals_match: boolean; grade_match: boolean; diffs: number }
  /** Provenance/debug ONLY — provider name never appears in a decision-facing field. */
  provenance?: { provider: string | null; asset_source_models: string[] }
}

export interface CanonicalTradeShadowResult {
  ran: boolean
  skipReason?: CanonicalTradeShadowSkipReason
  /** Present only when `ran` is true. */
  memo?: CanonicalTradeMemo
  parity?: TradeMemoParityResult
  telemetry: CanonicalTradeShadowTelemetry
}

export interface CanonicalTradeShadowArgs {
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  assets: TradeAssetSummary[]
  /** The persisted redraft snapshot the native path already parsed — the parity reference. */
  referenceSnapshot: TradeValueSnapshot
  proposalId: string
  /** Optional pick-discount season; the resolver defaults to the world's season when absent. */
  currentSeason?: number | null
}

export interface CanonicalTradeShadowDeps {
  /** READ-ONLY canonical world resolver. Default `resolveCanonicalWorld` (find* port only). */
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  /**
   * E.5 — READ-ONLY market-enrichment resolver (ADP + position). Default `resolveTradeEnrichment` (reads
   * the persisted `AdpDataRecord` + SportsPlayer caches; honest-empty when prisma is unavailable). Feeds
   * `MarketContext`; missing values stay null. Never writes, warms a cache, or calls a live provider API.
   */
  resolveEnrichment: (args: { sport: string; playerIds: string[]; season?: number | null; week?: number | null; scoringPresetId?: string | null }) => Promise<TradeEnrichmentResult>
  /**
   * E.5 — OPTIONAL read-only roster-identity resolver mapping proposal-space roster ids to canonical join
   * keys (teamId/managerUserId). Absent by default ⇒ direct-match only (production shadow behavior, E.4).
   * The DB-gated validation script injects a real one to exercise the redraft↔canonical join.
   */
  resolveRosterIdentity?: RosterIdentityResolver
}

const defaultDeps: Pick<CanonicalTradeShadowDeps, 'resolveWorld' | 'resolveEnrichment'> = {
  resolveWorld: (leagueId) => resolveCanonicalWorld(leagueId),
  resolveEnrichment: (args) => resolveTradeEnrichment(args),
}

/** Collect the canonical player ids carried by the movements (player/keeper/devy slots). */
function playerIdsFromMovements(movements: TradeMovement[]): string[] {
  const ids: string[] = []
  for (const m of movements) {
    const meta = m.asset.metadata
    const pid = meta.player?.playerId ?? meta.keeper?.playerId ?? meta.devy?.playerId ?? null
    if (pid) ids.push(pid)
  }
  return ids
}

/** Apply a proposal-space → canonical roster-id remap to the trade assets (1:1; identity when empty). */
function remapAssets(assets: TradeAssetSummary[], remap: Record<string, string>): TradeAssetSummary[] {
  if (Object.keys(remap).length === 0) return assets
  return assets.map((a) => ({
    ...a,
    fromRosterId: remap[a.fromRosterId] ?? a.fromRosterId,
    toRosterId: remap[a.toRosterId] ?? a.toRosterId,
  }))
}

/** Stage the redraft trade-asset summaries into canonical `AfLeagueTradeItem` rows (neutral graph). */
function toTradeItemRows(assets: TradeAssetSummary[]): AfLeagueTradeItemRow[] {
  return assets.map((a, i) => ({
    id: `mv_${i}`,
    itemType: a.assetType,
    // `fromAfLeagueTradeItems` reads `itemReference` as the player id for player-ish types.
    itemReference: a.playerId,
    fromRosterId: a.fromRosterId,
    toRosterId: a.toRosterId,
    faabAmount: a.faabAmount,
    metadata: a.playerName ? { playerName: a.playerName } : {},
  }))
}

/** Stage assets → canonical movements (`CanonicalAsset` + direction). Pure; order-preserving. */
function buildMovements(assets: TradeAssetSummary[], origin: string | null): TradeMovement[] {
  const rows = toTradeItemRows(assets)
  const inputs = fromAfLeagueTradeItems(rows, origin)
  const canonical = resolveCanonicalAssets(inputs)
  return canonical.map((asset, i) => ({ asset, fromRosterId: inputs[i].fromRosterId, toRosterId: inputs[i].toRosterId }))
}

/** Flatten the telemetry record into `emitShadowParity` flags (provider stays nested under provenance). */
function toShadowParityFlags(t: CanonicalTradeShadowTelemetry, proposalId: string): Record<string, unknown> {
  return {
    shadow: true,
    source: t.source,
    ran: t.ran,
    proposalId,
    ...(t.reason ? { reason: t.reason } : {}),
    asset_count: t.asset_count,
    participant_count: t.participant_count,
    ...(t.memo_source ? { memo_source: t.memo_source } : {}),
    ...(t.valuation_source ? { valuation_source: t.valuation_source } : {}),
    ...(t.completeness != null ? { completeness: t.completeness } : {}),
    ...(t.uncertainty_count != null ? { uncertainty_count: t.uncertainty_count } : {}),
    ...(t.enrichment_source != null ? { enrichment_source: t.enrichment_source } : {}),
    ...(t.adp_resolved != null ? { adp_resolved: t.adp_resolved } : {}),
    ...(t.position_resolved != null ? { position_resolved: t.position_resolved } : {}),
    ...(t.identity_method ? { identity_method: t.identity_method } : {}),
    ...(t.parity
      ? {
          parity_passed: t.parity.passed,
          value_totals_match: t.parity.value_totals_match,
          grade_match: t.parity.grade_match,
          parity_diffs: t.parity.diffs,
        }
      : {}),
    // Provider lives ONLY here — never in a decision-facing flag above.
    ...(t.provenance ? { provenance: t.provenance } : {}),
  }
}

function skip(
  reason: CanonicalTradeShadowSkipReason,
  args: CanonicalTradeShadowArgs,
  counts: { asset_count: number; participant_count: number },
): CanonicalTradeShadowResult {
  const telemetry: CanonicalTradeShadowTelemetry = {
    decision_type: 'manager.trade.evaluate',
    source: 'canonical_trade_world',
    ran: false,
    reason,
    asset_count: counts.asset_count,
    participant_count: counts.participant_count,
  }
  emitShadowParity('manager.trade.evaluate', toShadowParityFlags(telemetry, args.proposalId), args.proposalId)
  return { ran: false, skipReason: reason, telemetry }
}

/**
 * Attempt the canonical `TradeWorld` shadow for one proposal. Best-effort, read-only, never throws.
 * Returns `{ ran: true, memo, parity }` when the canonical pipeline produced a memo, else a structured
 * `{ ran: false, skipReason }`. Always emits exactly one `decision.shadow_parity` telemetry event.
 */
export async function runCanonicalTradeShadowAttempt(
  args: CanonicalTradeShadowArgs,
  deps: Partial<CanonicalTradeShadowDeps> = {},
): Promise<CanonicalTradeShadowResult> {
  const resolveWorld = deps.resolveWorld ?? defaultDeps.resolveWorld
  const resolveEnrichment = deps.resolveEnrichment ?? defaultDeps.resolveEnrichment
  const assetCount = args.assets.length
  const participantCount = deriveParticipants(args.assets).length
  const counts = { asset_count: assetCount, participant_count: participantCount }

  try {
    // 1. Canonical world (read-only).
    let world: CanonicalWorld | null = null
    try {
      world = await resolveWorld(args.leagueId)
    } catch {
      world = null
    }
    if (!world) return skip('canonical_trade_world_unavailable', args, counts)

    // 1b. Roster-identity join (E.5). Direct match (native id space) needs no resolver; for the redraft↔
    //     canonical id mismatch an OPTIONAL read-only resolver supplies teamId/managerUserId join keys.
    //     A participant that maps to no canonical roster ⇒ the world cannot describe THIS proposal (skip).
    let identities: Awaited<ReturnType<RosterIdentityResolver['resolve']>> = []
    if (deps.resolveRosterIdentity) {
      try {
        identities = await deps.resolveRosterIdentity.resolve(args.leagueId, [args.proposerRosterId, args.receiverRosterId])
      } catch {
        identities = []
      }
    }
    const join = resolveRosterIdentityJoin(world, args, identities)
    if (!join.resolved) return skip('canonical_trade_world_unavailable', args, counts)

    // 2. Assets → canonical movements (roster ids remapped to canonical space when the join was non-direct).
    let movements: TradeMovement[]
    try {
      movements = buildMovements(remapAssets(args.assets, join.remap), world.provenance.provider)
    } catch {
      return skip('canonical_asset_resolution_unavailable', args, counts)
    }
    if (movements.length === 0) return skip('canonical_asset_resolution_unavailable', args, counts)

    // The canonical memo is strictly two-sided (proposer → receiver). Multi-team trades are honestly
    // unsupported by it (the native DCO already flags them) — skip, never invent a multi-team valuation.
    if (participantCount !== 2) return skip('canonical_memo_unavailable', args, counts)

    // 3. Read-only market enrichment (E.5): ADP + position from persisted caches. Missing values stay null
    //    so the engine degrades honestly; this never fabricates a value (P3) and never affects the native path.
    let enrichmentResult: TradeEnrichmentResult
    try {
      enrichmentResult = await resolveEnrichment({
        sport: world.league.sport,
        playerIds: playerIdsFromMovements(movements),
        // F2.5 projection anchor — the canonical world's own season/week facts (provenance-safe).
        season: world.league.season,
        week: world.league.currentWeek,
        scoringPresetId: world.league.scoringPresetId,
      })
    } catch {
      enrichmentResult = { enrichment: {}, valuationSource: null, adpResolved: 0, positionResolved: 0, projectionResolved: 0, unresolvedIds: [], warnings: ['enrichment_unavailable'] }
    }

    // 4. TradeWorld → canonical memo, fed the read-only enrichment. Unsourced market fields degrade to
    //    honest uncertainty inside the resolver; player values still never get invented.
    let memo: CanonicalTradeMemo
    try {
      const tradeWorld = resolveTradeWorld({
        world,
        movements,
        proposerRosterId: join.proposerRosterId,
        receiverRosterId: join.receiverRosterId,
        currentSeason: args.currentSeason,
        enrichment: enrichmentResult.enrichment,
      })
      memo = buildTradeMemo(tradeWorld)
    } catch {
      return skip('canonical_memo_unavailable', args, counts)
    }
    if (!memo?.snapshot) return skip('canonical_memo_unavailable', args, counts)

    // 5. Parity vs the persisted redraft snapshot + telemetry. Differences are reported, never hidden.
    const parity = compareTradeMemos(memo.snapshot, args.referenceSnapshot)
    const telemetry: CanonicalTradeShadowTelemetry = {
      decision_type: 'manager.trade.evaluate',
      source: 'canonical_trade_world',
      ran: true,
      asset_count: assetCount,
      participant_count: participantCount,
      memo_source: memo.provenance.memoSource,
      valuation_source: memo.provenance.valuationSource,
      completeness: memo.completeness,
      uncertainty_count: memo.uncertainty.length,
      enrichment_source: enrichmentResult.valuationSource,
      adp_resolved: enrichmentResult.adpResolved,
      position_resolved: enrichmentResult.positionResolved,
      identity_method: { proposer: join.proposerMethod, receiver: join.receiverMethod },
      parity: { passed: parity.passed, value_totals_match: parity.valueTotalsMatch, grade_match: parity.gradeMatch, diffs: parity.diffs.length },
      provenance: { provider: memo.provenance.provider, asset_source_models: memo.provenance.assetSourceModels },
    }
    emitShadowParity('manager.trade.evaluate', toShadowParityFlags(telemetry, args.proposalId), args.proposalId)
    return { ran: true, memo, parity, telemetry }
  } catch {
    // Defensive belt-and-suspenders: the canonical attempt must NEVER affect the native shadow.
    return skip('canonical_memo_unavailable', args, counts)
  }
}

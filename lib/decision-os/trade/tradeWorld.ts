/**
 * Decision OS — Phase E.3: the `TradeWorldResolver` + the decision-specific `TradeWorld` contract.
 *
 * Trade now follows the SAME shape every other decision uses (ADR-DOS-003 §3.1):
 *
 *     Canonical World            ← origin-blind, purpose-blind FACTS only (it never knows "why")
 *             ↓
 *     TradeWorld                 ← decision-specific: trade direction + MARKET interpretation
 *             ↓
 *     Canonical Trade Memo       ← the deterministic engine, rehosted on TradeWorld
 *             ↓
 *     manager.trade.evaluate
 *
 * The memo consumes a `TradeWorld`, never a raw `CanonicalWorld`. This module is the resolver that projects
 * one into the other. It is PURE: no prisma, no writes, no persistence, no AI. The read-only ports that load
 * ADP/positions feed the injected enrichment at the seam (E.4/E.5); this resolver never reads them.
 *
 * Boundary rule (a corollary of P1 purpose-blindness): the Canonical World owns FACTS; the market
 * INTERPRETATION of those facts (scarcity, market value, injury/news impact) is decision-specific and lives
 * on {@link MarketContext}, owned by `TradeWorld` — never on the substrate. Unsourced market fields degrade
 * to honest-empty + uncertainty, never fabricated (P3).
 *
 * Byte-identity guarantee: `resolveTradeWorld` + `buildTradeMemo` reuse the EXACT leaf helpers the E.2
 * `buildCanonicalTradeMemo` path uses (`toEnrichedAsset`, `profileForRoster`, `computeMemoCompleteness`), so
 * wrapping inputs in `TradeWorld` is an architectural change, not a behavioral one. The acceptance test in
 * `__tests__/decision-os/trade-memo.test.ts` proves `buildTradeMemo(resolveTradeWorld(x))` is byte-identical
 * to `buildCanonicalTradeMemo(x)` for equivalent inputs.
 *
 * Coexistence note (pre-cutover): the legacy Slice-3 `./world.ts` ALSO defines a `TradeWorld` +
 * `resolveTradeWorld` — a different, two-sided trade-settings world feeding the existing
 * `runTradeEvaluateDecision` orchestrator. That legacy pipeline stays untouched and keeps the barrel
 * (`trade/index.ts`) export. To honor E.3's "read-only, no cutover", this canonical module is therefore
 * NOT added to the barrel's `export *` (it would collide). Consumers import it by path
 * (`@/lib/decision-os/trade/tradeWorld`). At the eventual cutover, the barrel flips to re-export THIS
 * world and the legacy one is retired.
 */
import type { CanonicalWorld, WorldProvenance } from '@/lib/decision-os/world/facts'
import { POSITION_SCARCITY } from '@/lib/trade-value/valueEngine'
import type { TeamProfile } from '@/lib/trade-value/types'
import {
  profileForRoster,
  type TradeMovement,
  type CanonicalMemoEnrichment,
  type BuildCanonicalTradeMemoInput,
} from './canonicalMemo'

/** One side of the trade, with its honest world-resolution state. Direction lives on the movements. */
export interface TradeParticipant {
  role: 'proposer' | 'receiver'
  rosterId: string
  teamId: string | null
  managerUserId: string | null
  /** Did we resolve a deterministic `TeamProfile` for this roster (i.e. a matching team exists)? */
  profileResolved: boolean
  /** Were roster positions available (depth analysis input)? Absent ⇒ honest degrade, never guessed. */
  positionsResolved: boolean
}

/** Decision-scoped league context — the resolved engine inputs + the surrounding settings. */
export interface TradeLeagueContext {
  sport: string
  season: number | null
  /** The engine's "current season" for pick discounting; defaults to `season`. */
  currentSeason: number | null
  leagueType: string
  scoring: string
  rosterFormat: string
  isDynasty: boolean
  currentWeek: number | null
  /** Deterministic capture stamp (the world's `assembledAt`, NOT wall-clock) — parity-safe. */
  capturedAt: string
}

/**
 * Market interpretation for the trade decision — OWNED BY `TradeWorld`, never by the Canonical World.
 * Every field is honest-optional: unsourced ⇒ empty/null + raised in `TradeWorld.uncertainty`, never faked.
 */
export interface MarketContext {
  /** ADP per player — from the provider-neutral `AdpDataRecord` seam. */
  adpByPlayerId: Record<string, number | null | undefined>
  /** Market value per player — Phase F enrichment; honest-empty today. */
  marketValueByPlayerId: Record<string, number | null | undefined>
  /** Rest-of-season projection per player — honest-empty today (no canonical projection source yet). */
  projectionByPlayerId: Record<string, number | null | undefined>
  /** Position per player — from the D.1 `resolvePlayerMetadata` seam. */
  positionByPlayerId: Record<string, string | null | undefined>
  /** Provenance/debug only — never a decision branch. */
  projectionSource: string | null
  /** The engine's positional scarcity table, surfaced for auditability (deterministic, not invented here). */
  positionalScarcity: Record<string, number>
  /** Scarcity relative to THIS league's roster needs — Phase F; honest-empty today. */
  leagueScarcity: Record<string, number>
  /** Injury market impact per player — Phase F; honest-empty today. */
  injuryMarketImpactByPlayerId: Record<string, number | null | undefined>
  /** News market impact per player — Phase F; honest-empty today. */
  newsImpactByPlayerId: Record<string, number | null | undefined>
  /** 0–100 share of player assets carrying a real market signal (ADP or projection). */
  confidence: number
}

/** Trade legality/constraint context resolved from league settings (read-only). */
export interface TradeConstraints {
  deadlineWeek: number | null
  reviewHours: number | null
  pickTradingAllowed: boolean | null
  currentWeek: number | null
}

/**
 * The decision-specific world the trade memo consumes. Carries everything the deterministic engine needs,
 * sourced from the Canonical World plus the (injected, read-only) market enrichment — and nothing it does
 * not. Origin survives ONLY in `provenance`.
 */
export interface TradeWorld {
  participants: TradeParticipant[]
  /** `CanonicalAsset` + direction. The asset stays purpose-blind in the world layer; direction lives here. */
  assets: TradeMovement[]
  /** rosterId → resolved deterministic profile. Absent key ⇒ no matching team (honest degrade). */
  teamProfiles: Record<string, TeamProfile>
  leagueContext: TradeLeagueContext
  marketContext: MarketContext
  constraints: TradeConstraints
  warnings: string[]
  /** Carried verbatim from the Canonical World — origin lives here and ONLY here. */
  provenance: WorldProvenance
  /** 0–100 honest completeness of the inputs feeding the engine. */
  completeness: number
  uncertainty: string[]
}

/** The resolver accepts exactly the E.2 memo inputs — that equivalence is the whole point of the contract. */
export type ResolveTradeWorldInput = BuildCanonicalTradeMemoInput

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

function participantFor(
  world: CanonicalWorld,
  rosterId: string,
  role: 'proposer' | 'receiver',
  enrich: CanonicalMemoEnrichment,
): { participant: TradeParticipant; profile: TeamProfile | undefined } {
  const roster = world.rosters.find((r) => r.rosterId === rosterId)
  const team = roster?.teamId ? world.teams.find((t) => t.teamId === roster.teamId) : undefined
  const { profile, positionsResolved } = profileForRoster(world, rosterId, enrich)
  return {
    participant: {
      role,
      rosterId,
      teamId: roster?.teamId ?? null,
      managerUserId: team?.managerUserId ?? null,
      profileResolved: profile != null,
      positionsResolved,
    },
    profile,
  }
}

function buildMarketContext(movements: TradeMovement[], enrich: CanonicalMemoEnrichment): MarketContext {
  // Confidence = share of PLAYER movements that carry a real market signal (ADP or projection).
  const playerMovements = movements.filter((m) => m.asset.assetType === 'player')
  const withSignal = playerMovements.filter((m) => {
    const pid = m.asset.metadata.player?.playerId ?? null
    if (!pid) return false
    return enrich.adpByPlayerId?.[pid] != null || enrich.projectionByPlayerId?.[pid] != null
  })
  const confidence = playerMovements.length === 0
    ? 100
    : Math.round((withSignal.length / playerMovements.length) * 100)

  return {
    adpByPlayerId: enrich.adpByPlayerId ?? {},
    marketValueByPlayerId: {},
    projectionByPlayerId: enrich.projectionByPlayerId ?? {},
    positionByPlayerId: enrich.positionByPlayerId ?? {},
    projectionSource: null,
    positionalScarcity: POSITION_SCARCITY,
    leagueScarcity: {},
    injuryMarketImpactByPlayerId: {},
    newsImpactByPlayerId: {},
    confidence,
  }
}

/**
 * Project a `CanonicalWorld` (+ injected, read-only market enrichment) into the decision-specific
 * `TradeWorld`. Pure, never throws. Mirrors the lineup `projectCanonicalLineupInput` shape: the resolver
 * carries the resolved facts; missing inputs degrade honestly into `marketContext`/`uncertainty`.
 */
export function resolveTradeWorld(input: ResolveTradeWorldInput): TradeWorld {
  const world = input.world
  const enrich = input.enrichment ?? {}

  const proposer = participantFor(world, input.proposerRosterId, 'proposer', enrich)
  const receiver = participantFor(world, input.receiverRosterId, 'receiver', enrich)

  const teamProfiles: Record<string, TeamProfile> = {}
  if (proposer.profile) teamProfiles[input.proposerRosterId] = proposer.profile
  if (receiver.profile) teamProfiles[input.receiverRosterId] = receiver.profile

  const leagueContext: TradeLeagueContext = {
    sport: input.context?.sport ?? world.league.sport,
    season: world.league.season,
    currentSeason: input.currentSeason ?? world.league.season ?? null,
    leagueType: input.context?.leagueType ?? (world.league.isDynasty ? 'dynasty' : 'redraft'),
    scoring: input.context?.scoring ?? (typeof world.league.scoringPresetId === 'string' ? world.league.scoringPresetId : 'unknown'),
    rosterFormat: input.context?.rosterFormat ?? 'unknown',
    isDynasty: world.league.isDynasty,
    currentWeek: world.league.currentWeek,
    capturedAt: input.context?.capturedAt ?? world.provenance.assembledAt,
  }

  const marketContext = buildMarketContext(input.movements, enrich)

  const constraints: TradeConstraints = {
    deadlineWeek: world.league.tradeSettings.deadlineWeek,
    reviewHours: world.league.tradeSettings.reviewHours,
    pickTradingAllowed: world.league.tradeSettings.pickTrading,
    currentWeek: world.league.currentWeek,
  }

  // World-level uncertainty: profile/position resolution gaps + the seed market gaps. The memo composes its
  // own (asset + adapter + profile) uncertainty on top; this is the resolver's honest accounting.
  const uncertainty = dedupe([
    ...(proposer.profile ? [] : [`Team profile unavailable for proposer roster ${input.proposerRosterId} — depth context degraded.`]),
    ...(receiver.profile ? [] : [`Team profile unavailable for receiver roster ${input.receiverRosterId} — depth context degraded.`]),
    ...(proposer.profile && !proposer.participant.positionsResolved ? [`Roster positions unavailable for ${input.proposerRosterId} — depth analysis degraded.`] : []),
    ...(receiver.profile && !receiver.participant.positionsResolved ? [`Roster positions unavailable for ${input.receiverRosterId} — depth analysis degraded.`] : []),
    ...(marketContext.confidence < 100 ? ['Market signal incomplete for one or more player assets (ADP/projection not yet sourced from the Canonical World).'] : []),
  ])

  // Completeness mirrors the memo's blend so the world and its memo report consistent honesty.
  const players = input.movements.filter((m) => m.asset.assetType === 'player')
  const assetRes = input.movements.length
    ? Math.round(input.movements.reduce((sum, m) => sum + m.asset.completeness.score, 0) / input.movements.length)
    : 0
  const profileScore = ((proposer.profile ? 100 : 0) + (receiver.profile ? 100 : 0)) / 2
  const completeness = Math.round(0.5 * assetRes + 0.25 * (players.length === 0 ? 100 : marketContext.confidence) + 0.25 * profileScore)

  return {
    participants: [proposer.participant, receiver.participant],
    assets: input.movements,
    teamProfiles,
    leagueContext,
    marketContext,
    constraints,
    warnings: [],
    provenance: world.provenance,
    completeness,
    uncertainty,
  }
}

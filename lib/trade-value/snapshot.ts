/**
 * T2 Trade Value Snapshot builder — assembles an immutable snapshot from assets enriched with their
 * captured value sources. Pure/deterministic; the route persists the result verbatim.
 */

import {
  TRADE_VALUE_SNAPSHOT_VERSION,
  type AssetValueSnapshot,
  type SideTotals,
  type TeamProfile,
  type TradeValueContext,
  type TradeValueSnapshot,
} from './types'
import {
  normalizedFaabValue,
  normalizedPickValue,
  normalizedPlayerValue,
  valueBasisFor,
  type ScoringContext,
} from './valueEngine'
import { gradeTrade } from './grader'
import { applyFormatFit } from './formats/applyFormat'

export interface EnrichedTradeAsset {
  kind: AssetValueSnapshot['kind']
  fromRosterId: string
  toRosterId: string
  playerId?: string | null
  playerName?: string | null
  position?: string | null
  team?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  pickLabel?: string | null
  faabAmount?: number | null
  /**
   * Player age, when the caller knows it. Dynasty and keeper format models read it; redraft ones
   * must not. Absent ⇒ any model needing it returns null rather than guessing.
   */
  age?: number | null
  /**
   * Years of NFL experience, when known. Taxi eligibility depends on it in leagues that have a
   * taxi squad — Four Horsemen caps it at 3.
   */
  experience?: number | null
  sources: AssetValueSnapshot['sources']
}

function internalValueFor(
  asset: EnrichedTradeAsset,
  currentSeason: number | null,
  scoring?: ScoringContext | null,
): number {
  switch (asset.kind) {
    case 'player':
      return normalizedPlayerValue({
        projection: asset.sources.projectionValue,
        adp: asset.sources.adpValue,
        position: asset.position,
        // Slice 14: the captured market value is finally consumed (fallback
        // basis only — see normalizedPlayerValue).
        marketValue: asset.sources.fantasyCalcValue,
        // The league's own price for a defender, which no market supplies.
        idpValue: asset.sources.idpValue,
        // Slice 16: real league scoring settings (superflex / TE premium / PPR).
        scoring,
      })
    case 'draft_pick':
      return normalizedPickValue({ round: asset.pickRound, pickSeason: asset.pickSeason, currentSeason })
    case 'faab':
      return normalizedFaabValue(asset.faabAmount)
    case 'future_consideration':
    default:
      return 0
  }
}

export function buildTradeValueSnapshot(input: {
  proposerRosterId: string
  receiverRosterId: string
  assets: EnrichedTradeAsset[]
  context: TradeValueContext
  currentSeason?: number | null
  profiles?: { a?: TeamProfile; b?: TeamProfile }
  /** Slice 16 — real league scoring settings. Omitted ⇒ standard 1-QB redraft. */
  scoring?: ScoringContext | null
  /**
   * The week being played, for anything deadline-aware. Omitted ⇒ no format model can judge
   * trade legality, and every one of them returns `ok: true` rather than assuming closed.
   */
  currentWeek?: number | null
  /**
   * Format-specific team state, keyed by roster id — Eliminator strikes, eviction status, throne.
   *
   * ⚠ Per ROSTER, because these are facts about a TEAM, not about the trade. A manager on three
   * Eliminator strikes wants a different kind of player from their trade partner who has none,
   * and a single shared blob could not express that.
   */
  teamStateByRosterId?: Record<string, unknown> | null
  /**
   * Per-ASSET format state, keyed by `playerId` — a keeper's cost round, a weapon's points.
   *
   * 🛑 KEYED ON THE PLAYER, NOT THE ROSTER, WHICH IS THE WHOLE REASON IT EXISTS. Keeper value is
   * the first fact in this engine that differs between two players on the same team: the same
   * receiver kept at a 2nd and at a 7th are different assets, and `teamStateByRosterId` has one
   * object for the whole roster and cannot say so.
   *
   * ⚠ Absent is fine and common — every model returns null rather than guessing when its state is
   * missing. What is NOT fine is declaring the channel and never wiring it, which is how
   * `rescoreKickerForLeague` sat with zero consumers under a comment claiming it ran.
   */
  assetStateByPlayerId?: Record<string, unknown> | null
}): TradeValueSnapshot {
  const currentSeason = input.currentSeason ?? null

  /*
   * The format's opinion, asked once per asset and stored BESIDE the price rather than inside it.
   *
   * ⚠ `internalValue` is computed exactly as before — `applyFormatFit` never touches it. A reader
   * comparing this snapshot to one written before format models existed will find identical
   * values, which is the property that makes the split safe to land.
   */
  const snapAssets: AssetValueSnapshot[] = input.assets.map((a) => ({
    kind: a.kind,
    fromRosterId: a.fromRosterId,
    toRosterId: a.toRosterId,
    playerId: a.playerId ?? null,
    playerName: a.playerName ?? null,
    position: a.position ?? null,
    team: a.team ?? null,
    pickSeason: a.pickSeason ?? null,
    pickRound: a.pickRound ?? null,
    pickLabel: a.pickLabel ?? null,
    faabAmount: a.faabAmount ?? null,
    sources: a.sources,
    internalValue: internalValueFor(a, currentSeason, input.scoring),
    /*
     * ⚠ ONLY A PLAYER HAS A BASIS. A pick is priced off the curve and FAAB off its face amount —
     * neither consults `sources`, so labelling them with a basis would name an input that had no
     * part in the number.
     */
    valuationBasis:
      a.kind === 'player'
        ? valueBasisFor({
            projection: a.sources.projectionValue,
            marketValue: a.sources.fantasyCalcValue,
            idpValue: a.sources.idpValue,
          })
        : null,
    formatFit:
      a.kind === 'player'
        ? applyFormatFit({
            formatId: input.context.leagueType,
            /*
             * 🛑 WITHOUT THESE, FOUR FORMATS CAN NEVER RESOLVE. `normalizeConcept.ts` flattens
             * pirate and king-of-the-hill onto `dynasty` and `redraft`, so `leagueType` alone
             * describes a pirate league as a dynasty one. The alias is the only surviving record
             * of what the league actually is.
             */
            aliasTags: input.context.aliasTags ?? null,
            isDynasty: input.context.isDynasty ?? null,
            keeperCount: input.context.keeperCount ?? null,
            base: internalValueFor(a, currentSeason, input.scoring),
            position: a.position,
            age: a.age ?? null,
            experience: a.experience ?? null,
            // The shape the scoring context already resolved — no second source of truth.
            shape: input.scoring?.shape ?? null,
            currentWeek: input.currentWeek ?? null,
            // The state of the roster GIVING the asset up.
            teamState: input.teamStateByRosterId?.[a.fromRosterId],
            // Per-asset, so it is keyed on the player rather than either roster.
            assetState: a.playerId ? input.assetStateByPlayerId?.[a.playerId] : undefined,
          })
        : null,
  }))

  const sideFor = (rosterId: string): SideTotals => {
    const assets = snapAssets.filter((x) => x.fromRosterId === rosterId)
    return { rosterId, total: assets.reduce((s, x) => s + x.internalValue, 0), assets }
  }

  const sideA = sideFor(input.proposerRosterId)
  const sideB = sideFor(input.receiverRosterId)
  const { grade, commissionerReview } = gradeTrade(sideA, sideB, input.profiles)

  return {
    version: TRADE_VALUE_SNAPSHOT_VERSION,
    context: input.context,
    sides: [sideA, sideB],
    grade,
    commissionerReview,
  }
}

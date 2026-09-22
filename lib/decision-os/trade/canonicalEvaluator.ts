import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import { detectQbFormat } from '@/lib/core-app/slotEligibility'
import type { TradeAssetSummary } from './dco'
import { buildMovements, playerIdsFromMovements } from './canonicalShadow'
import { pickMarketArgsFromWorld, resolveTradeEnrichment, type TradeEnrichmentResult } from './enrichmentPort'
import { resolveTradeWorld } from './tradeWorld'
import { buildTradeMemo, type CanonicalTradeMemo } from './canonicalMemo'
import { computeRosterImpact, type ImpactPlayer } from './rosterImpact'
import { LEAGUE_WEEK_UNIT, type LeagueWeekRosterImpact } from './rosterImpactSummary'
import {
  defaultLeagueWeekPricingDeps,
  isLeagueWeekRefusal,
  leagueWeekBasis,
  priceLeagueWeek,
  type LeagueWeekPricingDeps,
} from './leagueWeekPricing'

export type CanonicalTradeAction = 'accept' | 'counter' | 'decline' | 'review'

export interface CanonicalTradeEvaluation {
  decisionType: 'manager.trade.evaluate'
  proposalId: string
  evaluatedAt: string
  action: CanonicalTradeAction
  recommendation: string
  valueGiven: number | null
  valueReceived: number | null
  valueDelta: number | null
  grade: string | null
  fairnessScore: number | null
  confidenceScore: number
  coverageStatus: 'complete' | 'partial' | 'blocked'
  coveragePct: number
  memo: CanonicalTradeMemo
  /**
   * What the trade does to the viewer's LINEUP, as opposed to the ledger.
   *
   * 🛑 PRESENT ONLY WHEN ASKED FOR, AND THAT IS A COST DECISION. Computing it means enriching the
   * viewer's WHOLE ROSTER rather than the handful of traded players, so this — the production
   * entry point for every two-team trade surface — would otherwise pay ~15 extra player lookups on
   * every call. A surface that renders only the value verdict must not be charged for one it does
   * not show.
   *
   * ⚠ `unit` AND `week` ARE NOT DECORATION. The numbers are ONE WEEK's projection scored under the
   * league's own rules (`leagueWeekPricing.ts`) — not AllFantasy's per-game figure, which is full
   * PPR in every league and was this field's basis until 2026-09-17. A consumer that renders this
   * without reading the unit prints the wrong label on a right number.
   */
  rosterImpact?: LeagueWeekRosterImpact | null
}

export interface EvaluateCanonicalTradeArgs {
  leagueId: string
  proposalId: string
  proposerRosterId: string
  receiverRosterId: string
  viewerRosterId?: string | null
  assets: TradeAssetSummary[]
  currentSeason?: number | null
  evaluatedAt?: string
  /**
   * Compute `rosterImpact`. Off by default so no existing caller's cost changes.
   *
   * ⚠ OPT-IN RATHER THAN OPT-OUT DELIBERATELY. The alternative — compute always, let callers
   * ignore it — silently widens the enrichment for ~60 trade routes at once, and the one that
   * notices is whichever surface gets slow first.
   */
  includeRosterImpact?: boolean
}

export interface CanonicalTradeEvaluatorDeps {
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  resolveEnrichment: typeof resolveTradeEnrichment
  /** This week's league-scored lineup points — only read when `includeRosterImpact` is set. */
  leagueWeek: LeagueWeekPricingDeps
}

function recommendationFor(valueGiven: number, valueReceived: number, complete: boolean): {
  action: CanonicalTradeAction
  recommendation: string
} {
  if (!complete) return { action: 'review', recommendation: 'Review manually because one or more assets could not be valued safely.' }
  const ratio = valueGiven > 0 ? valueReceived / valueGiven : valueReceived > 0 ? Number.POSITIVE_INFINITY : 1
  if (ratio >= 1.08) return { action: 'accept', recommendation: 'Accept: the value received clears the value sent by the configured decision margin.' }
  if (ratio >= 0.92) return { action: 'counter', recommendation: 'Counter or accept for roster fit: market value is within a normal negotiation range.' }
  return { action: 'decline', recommendation: 'Decline or counter: the supported value received is materially below the value sent.' }
}

/** Production Decision OS entry point for every two-team trade surface. */
export async function evaluateCanonicalTrade(
  args: EvaluateCanonicalTradeArgs,
  deps: Partial<CanonicalTradeEvaluatorDeps> = {},
): Promise<CanonicalTradeEvaluation> {
  const resolveWorld = deps.resolveWorld ?? resolveCanonicalWorld
  const resolveEnrichment = deps.resolveEnrichment ?? resolveTradeEnrichment
  const leagueWeekDeps = deps.leagueWeek ?? defaultLeagueWeekPricingDeps
  const world = await resolveWorld(args.leagueId)
  if (!world) throw new Error('Canonical trade world unavailable')
  if (!world.rosters.some((r) => r.rosterId === args.proposerRosterId) || !world.rosters.some((r) => r.rosterId === args.receiverRosterId)) {
    throw new Error('Trade participants could not be mapped to canonical rosters')
  }
  const movements = buildMovements(args.assets, world.provenance.provider)
  if (movements.length === 0) throw new Error('Trade has no canonical assets')
  const tradedPlayerIds = playerIdsFromMovements(movements)
  const viewerRosterId = args.viewerRosterId ?? args.proposerRosterId
  const viewerRoster = world.rosters.find((r) => r.rosterId === viewerRosterId) ?? null

  /*
   * ⚠ THE ROSTER IDS RIDE THE SAME ENRICHMENT CALL RATHER THAN A SECOND ONE. Positions and
   * projections for the traded players are needed either way; asking for the roster separately
   * would double the round trips to answer one question. Deduped, because a traded player is
   * usually ON the roster and paying for him twice is the obvious version of this mistake.
   */
  const playerIds =
    args.includeRosterImpact && viewerRoster
      ? [...new Set([...tradedPlayerIds, ...viewerRoster.playerIds])]
      : tradedPlayerIds
  let enrichment: TradeEnrichmentResult
  try {
    enrichment = await resolveEnrichment({
      sport: world.league.sport,
      playerIds,
      season: world.league.season,
      week: world.league.currentWeek,
      scoringPresetId: world.league.scoringPresetId,
      idpLeague: {
        leagueId: world.league.leagueId,
        starterSlots: world.league.rosterSettings.starterSlots,
        numTeams: world.rosters.length,
        isDynasty: world.league.isDynasty,
      },
      valueFormat: {
        format: world.league.isDynasty ? 'DYNASTY' : 'REDRAFT',
        qbFormat: detectQbFormat(world.league.rosterSettings.starterSlots),
      },
      // Dynasty rookie-pick prices from the same market as the players (null otherwise).
      pickMarket: pickMarketArgsFromWorld(world),
    })
  } catch {
    enrichment = { enrichment: {}, valuationSource: null, adpResolved: 0, positionResolved: 0, projectionResolved: 0, idpValueResolved: 0, thinlyPricedIds: [], unresolvedIds: playerIds, warnings: ['enrichment_unavailable'] }
  }
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString()
  const memo = buildTradeMemo(resolveTradeWorld({
    world,
    movements,
    proposerRosterId: args.proposerRosterId,
    receiverRosterId: args.receiverRosterId,
    currentSeason: args.currentSeason,
    enrichment: enrichment.enrichment,
    context: { capturedAt: evaluatedAt },
  }))
  const viewer = viewerRosterId
  const given = memo.snapshot.sides.find((side) => side.rosterId === viewer)?.total ?? 0
  const received = memo.snapshot.sides.filter((side) => side.rosterId !== viewer).reduce((sum, side) => sum + side.total, 0)
  const coverage = memo.snapshot.coverage ?? { status: 'blocked' as const, coveragePct: 0 }
  const decision = recommendationFor(given, received, coverage.status === 'complete' && !memo.snapshot.grade.insufficientData)

  /*
   * ── ROSTER IMPACT ───────────────────────────────────────────────────────────────────────────
   *
   * ⚠ FAILURE-CONTAINED AND NULL RATHER THAN ABSENT ON FAILURE. `rosterImpact: null` says "asked
   * for, could not be produced", which a surface can render as such; leaving the key off says "not
   * asked for". Those are different facts and a renderer needs to tell them apart.
   */
  const rosterImpact = await (async (): Promise<CanonicalTradeEvaluation['rosterImpact']> => {
    if (!args.includeRosterImpact) return undefined
    if (!viewerRoster) return null
    const positions = enrichment.enrichment.positionByPlayerId ?? {}

    /*
     * ⚠ THE PLAYER ID IS NESTED AND THERE ARE THREE SLOTS FOR IT. `TradeMovement` carries no
     * `playerId` of its own — `playerIdsFromMovements` reads
     * `metadata.player ?? metadata.keeper ?? metadata.devy`, and a keeper or devy asset that only
     * checked `.player` would read as a pick and vanish from the lineup maths entirely. Same
     * accessor as that function on purpose; two spellings of one rule is the bug this repo keeps
     * paying for.
     */
    const movementPlayerId = (m: (typeof movements)[number]): string | null => {
      const meta = m.asset.metadata
      return meta.player?.playerId ?? meta.keeper?.playerId ?? meta.devy?.playerId ?? null
    }

    const incomingIds: string[] = []
    const outgoingPlayerIds: string[] = []
    for (const m of movements) {
      const pid = movementPlayerId(m)
      if (!pid) continue
      if (m.toRosterId === viewerRosterId) incomingIds.push(pid)
      else if (m.fromRosterId === viewerRosterId) outgoingPlayerIds.push(pid)
    }

    /*
     * 🛑 `starterSlots` IS NULLABLE AND A MISSING LINEUP IS NOT AN EMPTY ONE. With `[]` every
     * lineup scores zero, both sides, and the delta comes out a confident 0.0 — "this trade
     * changes nothing" about a league whose slots we simply do not know.
     */
    const slots = world.league.rosterSettings.starterSlots
    if (!slots || slots.length === 0) return null

    try {
      /*
       * 🛑 THIS WEEK, UNDER THIS LEAGUE'S RULES — NOT `perGameProjectionByPlayerId`. That map is
       * AllFantasy's per-game figure, written in full PPR for every league, so a half-PPR or
       * TE-premium league had its lineup delta priced under rules it does not use. A league this
       * cannot price is refused by name (user decision 2026-09-17).
       */
      const basis = await leagueWeekBasis(world.league, leagueWeekDeps)
      if (isLeagueWeekRefusal(basis)) {
        return {
          startingPointsBefore: null,
          startingPointsAfter: null,
          startingPointsDelta: null,
          blockedReason: basis.detail,
          unpricedExcluded: 0,
          depth: [],
          replacement: [],
          unit: LEAGUE_WEEK_UNIT,
          week: null,
        }
      }
      const ids = [...viewerRoster.playerIds, ...incomingIds]
      const priced = await priceLeagueWeek(
        basis,
        ids,
        new Map(ids.map((id) => [id, positions[id] ?? null])),
        leagueWeekDeps,
      )
      /*
       * ⚠ `?? null`, NOT `?? 0`, AT EVERY STEP. An absent projection is "not priced";
       * `computeRosterImpact` blocks on an unpriced TRADED asset for exactly this reason.
       */
      const toImpact = (id: string): ImpactPlayer =>
        priced.get(id) ?? { playerId: id, position: (positions[id] ?? '').toUpperCase(), projectedPoints: null }
      const impact = computeRosterImpact({
        roster: viewerRoster.playerIds.map(toImpact),
        slots,
        incoming: incomingIds.map(toImpact),
        outgoingPlayerIds,
      })
      const round2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100)
      return {
        ...impact,
        startingPointsBefore: round2(impact.startingPointsBefore),
        startingPointsAfter: round2(impact.startingPointsAfter),
        startingPointsDelta: round2(impact.startingPointsDelta),
        unit: LEAGUE_WEEK_UNIT,
        week: basis.week.week,
      }
    } catch {
      return null
    }
  })()

  return {
    decisionType: 'manager.trade.evaluate',
    proposalId: args.proposalId,
    evaluatedAt,
    ...decision,
    valueGiven: coverage.status === 'complete' ? given : null,
    valueReceived: coverage.status === 'complete' ? received : null,
    valueDelta: coverage.status === 'complete' ? received - given : null,
    grade: memo.snapshot.grade.grade,
    fairnessScore: memo.snapshot.grade.fairnessScore,
    confidenceScore: memo.snapshot.grade.confidenceScore,
    coverageStatus: coverage.status,
    coveragePct: coverage.coveragePct,
    memo,
    rosterImpact,
  }
}

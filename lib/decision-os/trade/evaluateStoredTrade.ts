import 'server-only'

import { resolveCanonicalWorld } from '@/lib/decision-os/world'
import type { CanonicalWorld } from '@/lib/decision-os/world/facts'
import { evaluateCanonicalTrade } from './canonicalEvaluator'
import type { TradeAssetSummary } from './dco'
import { evaluateTrade, type StoredTradeContext, type TradeEvaluationReceipt } from './evaluateTrade'
import { loadTrade, type LoadTradeDeps } from './loadTrade'
import { loadTeamBenefit } from './teamBenefitContext'
import type { TeamBenefitResult } from './teamBenefit'
import type { GradeInputs } from './tradeGradeInputs'
import type { LoadedTrade, LoadedTradeAsset, TradeRef, TradeRefusal, TradeSide } from './tradeRecord'

/**
 * Evaluate an EXISTING trade by reference: `loadTrade()` → `evaluateTrade()` → one saved receipt.
 * Design build-order step 2 (`docs/TRADE_EVALUATOR_DESIGN.md`, "Request flow").
 *
 * What this adds over calling the engine with a list of names:
 *   - the REAL rosters, so the canonical half computes lineup impact and confidence;
 *   - the design's roster rule for a pending trade — every player a side sends must still be on its
 *     roster, or the trade is refused (`asset_moved`) rather than graded as though he were;
 *   - freshness: an imported league's rosters older than 10 minutes are marked stale on the receipt
 *     (the design caps confidence at medium), and the receipt names the trade it was taken on.
 *
 * ⚠ A RE-EVALUATION IS A NEW RECEIPT. A native trade's proposal-time receipt keeps its `tradeId` row;
 * this writes a new row that REFERENCES the trade, and never rewrites that one.
 *
 * Perspective: the viewer's side when the viewer is in the trade (roster need is then priced for
 * them); otherwise side A, as a neutral read with no need priced. Who may evaluate a PENDING trade at
 * all is decided in `loadTrade`, before any asset is read.
 */

export const ROSTER_FRESHNESS_MS = 10 * 60_000

export type EvaluateStoredTradeResult =
  | {
      ok: true
      trade: LoadedTrade
      receipt: TradeEvaluationReceipt
      /** The side the grade is from. */
      perspectiveTeamId: string
      viewerInTrade: boolean
      /** The league world the evaluation used, for callers that need more of it (commissioner review). */
      world?: CanonicalWorld | null
    }
  | { ok: false; refusal: TradeRefusal }

export type EvaluateStoredTradeDeps = {
  now: () => Date
  loadDeps: Partial<LoadTradeDeps>
  resolveWorld: (leagueId: string) => Promise<CanonicalWorld | null>
  evaluate: typeof evaluateTrade
  /** The design's value engine (shadow). Default: `loadTeamBenefit`. */
  teamBenefit: (args: { world: CanonicalWorld; me: TradeSide; them: TradeSide }) => Promise<TeamBenefitResult>
}

export const defaultEvaluateStoredTradeDeps: EvaluateStoredTradeDeps = {
  now: () => new Date(),
  loadDeps: {},
  resolveWorld: (leagueId) => resolveCanonicalWorld(leagueId).catch(() => null),
  evaluate: evaluateTrade,
  teamBenefit: (args) =>
    loadTeamBenefit(args).catch((): TeamBenefitResult => ({ ok: false, reason: 'The team-benefit model could not run.', missingAssets: [] })),
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** The grader's input for what one side sends: players by NAME (see `./tradeGradeInputs.ts`). */
export function gradeInputsOf(assets: readonly LoadedTradeAsset[]): GradeInputs {
  return {
    assets: assets.map((a) =>
      a.kind === 'player'
        ? { kind: 'player' as const, name: a.name }
        : a.kind === 'pick'
          ? { kind: 'pick' as const, year: a.season, round: a.round, label: a.label }
          : { kind: 'faab' as const, amount: a.amount },
    ),
    unpriceable: [],
  }
}

/**
 * A Sleeper ledger trade names rosters by Sleeper `roster_id`. Map each side (and each pick's original
 * owner) onto the canonical `Roster.id` through the world's team source ids — the same join
 * `evaluatePendingProviderTrades` uses. Unmapped stays null; the grade does not need it.
 */
export function withCanonicalRosters(trade: LoadedTrade, world: CanonicalWorld | null): LoadedTrade {
  if (trade.origin.source !== 'provider' || !world) return trade
  const rosterFor = (externalId: string | null) => {
    if (!externalId) return null
    const team = world.teams.find((t) => t.source.sourceTeamId === externalId)
    return team ? world.rosters.find((r) => r.teamId === team.teamId)?.rosterId ?? null : null
  }
  const side = (s: TradeSide): TradeSide => ({
    ...s,
    rosterId: rosterFor(s.teamId),
    gives: s.gives.map((g) => (g.kind === 'pick' ? { ...g, originalTeamId: rosterFor(g.originalTeamId) ?? g.originalTeamId } : g)),
  })
  return { ...trade, sideA: side(trade.sideA), sideB: side(trade.sideB) }
}

/**
 * The design's rule for a PENDING trade: every player a side sends is still on that side's roster.
 * Picks and FAAB are not checked here (their ownership lives in other tables). A settled trade is not
 * checked — its players have already moved, by definition.
 */
export function checkRosters(
  trade: LoadedTrade,
  world: CanonicalWorld | null,
): { check: StoredTradeContext['rosterCheck']; moved: string[] } {
  if (trade.status !== 'proposed') return { check: 'not_applicable', moved: [] }
  if (!world || !trade.sideA.rosterId || !trade.sideB.rosterId) return { check: 'unverified', moved: [] }
  const moved: string[] = []
  for (const s of [trade.sideA, trade.sideB]) {
    const roster = world.rosters.find((r) => r.rosterId === s.rosterId)
    if (!roster) return { check: 'unverified', moved: [] }
    const held = new Set(roster.playerIds)
    for (const g of s.gives) if (g.kind === 'player' && !held.has(g.playerId)) moved.push(g.name)
  }
  return { check: moved.length ? 'unverified' : 'passed', moved }
}

export function rostersAreStale(trade: LoadedTrade, now: Date): boolean {
  if (trade.origin.platform === 'native') return false
  const t = trade.origin.rostersSyncedAt ? Date.parse(trade.origin.rostersSyncedAt) : NaN
  return !Number.isFinite(t) || now.getTime() - t > ROSTER_FRESHNESS_MS
}

/** The canonical evaluator's asset rows, from the perspective side's `Roster.id`s. */
export function canonicalAssets(from: TradeSide, to: TradeSide): TradeAssetSummary[] {
  return from.gives.map((g) => ({
    fromRosterId: from.rosterId!,
    toRosterId: to.rosterId!,
    assetType: g.kind === 'player' ? 'player' : g.kind === 'pick' ? 'draft_pick' : 'faab',
    itemReference: g.kind === 'player' ? g.playerId : g.kind === 'pick' ? g.label : null,
    playerId: g.kind === 'player' ? g.playerId : null,
    playerName: g.kind === 'player' ? g.name : null,
    position: g.kind === 'player' ? g.position : null,
    pickSeason: g.kind === 'pick' ? g.season : null,
    pickRound: g.kind === 'pick' ? g.round : null,
    pickOriginalRosterId: g.kind === 'pick' ? g.originalTeamId : null,
    pickLabel: g.kind === 'pick' ? g.label : null,
    faabAmount: g.kind === 'faab' ? g.amount : null,
  }))
}

const refRecord = (ref: TradeRef): Record<string, string> => ({ ...ref }) as Record<string, string>

// ── Entry point ─────────────────────────────────────────────────────────────

export async function evaluateStoredTrade(
  args: { leagueId: string; ref: TradeRef; userId: string; surface?: string; persist?: boolean },
  deps: Partial<EvaluateStoredTradeDeps> = {},
): Promise<EvaluateStoredTradeResult> {
  const d: EvaluateStoredTradeDeps = { ...defaultEvaluateStoredTradeDeps, ...deps }
  const loaded = await loadTrade({ leagueId: args.leagueId, ref: args.ref, userId: args.userId }, d.loadDeps)
  if (!loaded.ok) return loaded

  const world = await d.resolveWorld(args.leagueId).catch(() => null)
  const trade = withCanonicalRosters(loaded.trade, world)

  const roster = checkRosters(trade, world)
  if (roster.moved.length) {
    return {
      ok: false,
      refusal: {
        code: 'asset_moved',
        reason: `${roster.moved.slice(0, 3).join(', ')} ${roster.moved.length === 1 ? 'is' : 'are'} no longer on the roster sending ${roster.moved.length === 1 ? 'him' : 'them'}, so this offer can't be evaluated as it stands.`,
        missingAssets: roster.moved,
      },
    }
  }

  const viewerInTrade = loaded.viewer.side !== null
  const [me, them] = loaded.viewer.side === 'B' ? [trade.sideB, trade.sideA] : [trade.sideA, trade.sideB]

  const stored: StoredTradeContext = {
    ref: refRecord(args.ref),
    tradeId: trade.id,
    source: trade.origin.source,
    platform: trade.origin.platform,
    status: trade.status,
    rawStatus: trade.origin.rawStatus,
    deepLink: trade.origin.deepLink,
    rostersSyncedAt: trade.origin.rostersSyncedAt,
    rostersStale: rostersAreStale(trade, d.now()),
    rosterCheck: roster.check,
  }

  const canonical =
    world && me.rosterId && them.rosterId
      ? {
          proposerRosterId: me.rosterId,
          receiverRosterId: them.rosterId,
          participantRosterIds: [me.rosterId, them.rosterId],
          assets: [...canonicalAssets(me, them), ...canonicalAssets(them, me)],
          currentSeason: world.league.season ?? null,
          // Lineup impact means something only while the rosters are still "before".
          includeRosterImpact: trade.status === 'proposed',
        }
      : null

  /*
   * The design's value engine, SHADOWED beside the one grade: it rides on the receipt with the
   * comparison of the two letters, and changes nothing a manager is shown (Guap, 2026-09-27).
   */
  const teamBenefit = world && me.rosterId && them.rosterId
    ? await d.teamBenefit({ world, me, them }).catch((): TeamBenefitResult => ({ ok: false, reason: 'The team-benefit model could not run.', missingAssets: [] }))
    : null

  const receipt = await d.evaluate(
    {
      surface: args.surface ?? 'stored-trade',
      leagueId: trade.leagueId,
      userId: args.userId,
      give: gradeInputsOf(me.gives),
      get: gradeInputsOf(them.gives),
      viewerSide: viewerInTrade,
      canonical,
      stored,
      teamBenefit,
      persist: args.persist,
    },
    world ? { evaluateCanonical: (a) => evaluateCanonicalTrade(a, { resolveWorld: async () => world }) } : {},
  )
  return { ok: true, trade, receipt, perspectiveTeamId: me.teamId, viewerInTrade, world }
}

/**
 * Trade Learning Phase 8 — live capture, per
 * docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md.
 *
 * Wires real AfLeagueTrade proposals/completions into the existing
 * TradeOfferEvent/TradeOutcomeEvent calibration pipeline. Reuses the
 * existing, unmodified scoring model (computeTradeDrivers +
 * calibrateAcceptProbability — the same pipeline runCoreEngine() uses,
 * minus its AI-narrative/negotiation-toolkit layer, which calibration
 * doesn't need) and the existing event-logger writers. No new prediction
 * math; this file is the "asset-shape adapter" the ADR describes.
 *
 * Every exported function here fails safe: it never throws, and a failure
 * never blocks or reverts the real trade action that triggered it.
 */
import type { League } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { findPlayerBySleeperId, getPickValue, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { computeTradeDrivers, type TradeDriverData } from '@/lib/trade-engine/trade-engine'
import { getCalibratedWeights, calibrateAcceptProbability } from '@/lib/trade-engine/accept-calibration'
import { logTradeOfferEvent, logTradeOutcomeEvent, type TradeOutcomeStatus } from '@/lib/trade-engine/trade-event-logger'
import type { Asset } from '@/lib/trade-engine/types'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import { createLeagueTradeGrader, gradeDeal, loadNativePlayerNames, type LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradeInputsFromNativeItems } from '@/lib/decision-os/trade/tradeGradeInputs'

/**
 * Conservative flat fallback for any asset whose real value can't be
 * resolved (unmatched player, pick without season/round metadata, or a
 * specialty asset type with no established valuation). Matches the exact
 * fallback convention already used by lib/trade-learning.ts's
 * analyzeHistoricalTrade() (`fcPlayer?.value || 200`), not a new invention.
 */
const LIVE_CAPTURE_FALLBACK_VALUE = 200

export interface CaptureTradeItem {
  itemType: string
  itemReference?: string | null
  fromRosterId: string
  toRosterId: string
  faabAmount?: number | null
  metadata?: unknown
}

/**
 * Real, terminal-status mapping approved in
 * docs/TRADE_LEARNING_CAPTURE_ARCHITECTURE_ADR.md Decision 2. `expired` is
 * included for mapping completeness even though, per the same ADR and
 * docs/TRADE_LEARNING_DATA_CAPTURE_AUDIT.md, no live code path currently
 * transitions AfLeagueTrade.status to 'expired' — verified by repo-wide
 * grep. Non-terminal statuses (pending, awaiting_commissioner,
 * awaiting_votes, scheduled) intentionally have no mapping (no event).
 */
const AF_STATUS_TO_OUTCOME: Readonly<Record<string, TradeOutcomeStatus>> = {
  processed: 'ACCEPTED',
  rejected: 'REJECTED',
  countered: 'COUNTERED',
  expired: 'EXPIRED',
  vetoed: 'UNKNOWN',
  cancelled: 'UNKNOWN',
}

export function mapAfTradeStatusToOutcome(status: string): TradeOutcomeStatus | null {
  return AF_STATUS_TO_OUTCOME[status] ?? null
}

/**
 * Derives the format book used for the proposal-time snapshot from the
 * league itself. Superflex comes from canonical starter slots; redraft versus
 * dynasty/keeper and PPR weight come from the normalized League fields.
 * TE-premium detection remains a bounded gap and defaults false.
 */
type TradeScoringLeague = Pick<League, 'leagueType' | 'leagueVariant' | 'isDynasty' | 'scoring' | 'settings'>

export function resolveLeagueScoringContext(league: TradeScoringLeague): {
  isSuperFlex: boolean
  isTEP: boolean
  isDynasty: boolean
  ppr: 0 | 0.5 | 1
  scoringType: 'standard' | 'half_ppr' | 'ppr'
} {
  const leagueType = String(league.leagueType ?? league.leagueVariant ?? '').toLowerCase()
  const isDynasty = Boolean(league.isDynasty) || leagueType.includes('dynasty') || leagueType.includes('keeper')
  const scoring = String(league.scoring ?? '').toLowerCase()
  const scoringType = scoring.includes('half')
    ? 'half_ppr' as const
    : scoring.includes('ppr')
      ? 'ppr' as const
      : 'standard' as const
  const ppr = scoringType === 'ppr' ? 1 as const : scoringType === 'half_ppr' ? 0.5 as const : 0 as const
  try {
    const snap = parseSettingsSnapshot((league as { settings?: unknown }).settings ?? null)
    const starterSlots = (snap?.rosterSettings?.starterSlots ?? {}) as Record<string, unknown>
    const qbSlots = Number(starterSlots.QB ?? starterSlots.qb ?? 1)
    return { isSuperFlex: Number.isFinite(qbSlots) && qbSlots >= 2, isTEP: false, isDynasty, ppr, scoringType }
  } catch {
    return { isSuperFlex: false, isTEP: false, isDynasty, ppr, scoringType }
  }
}

export interface CurrentTradeMarketSnapshot {
  grade: GradeLetter | null
  valueGiven: number | null
  valueReceived: number | null
  pricedAt: string
  fullyPriced: boolean
  unresolvedAssets: string[]
}

interface ResolvedAssetValue {
  name: string
  value: number
  type: 'player' | 'pick' | 'faab' | string
  /** False when the numeric value is only a conservative fallback. */
  resolved: boolean
}

function resolveItemValue(
  item: CaptureTradeItem,
  fcPlayers: FantasyCalcPlayer[],
  isDynasty: boolean,
): ResolvedAssetValue {
  if (item.itemType === 'player') {
    const ref = item.itemReference ?? ''
    const fc = ref ? findPlayerBySleeperId(fcPlayers, ref) : null
    return {
      name: fc?.player.name ?? `Player ${ref || 'unknown'}`,
      value: fc?.value ?? LIVE_CAPTURE_FALLBACK_VALUE,
      type: 'player',
      resolved: Boolean(fc),
    }
  }

  if (item.itemType === 'rookie_pick' || item.itemType === 'devy_pick' || item.itemType === 'future_pick') {
    const meta = item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : {}
    const season = Number(meta.season)
    const round = Number(meta.round)
    const value =
      Number.isFinite(season) && Number.isFinite(round)
        ? getPickValue(season, round, isDynasty)
        : LIVE_CAPTURE_FALLBACK_VALUE
    return { name: `${item.itemType} pick`, value, type: 'pick', resolved: Number.isFinite(season) && Number.isFinite(round) }
  }

  if (item.itemType === 'faab') {
    return { name: 'FAAB', value: item.faabAmount ?? 0, type: 'faab', resolved: false }
  }

  // 'specialty_asset' and any future item type: conservative flat fallback,
  // documented limitation (see the ADR) — not silently invented math.
  return { name: item.itemType, value: LIVE_CAPTURE_FALLBACK_VALUE, type: item.itemType, resolved: false }
}

function toAsset(resolved: ResolvedAssetValue, id: string): Asset {
  return {
    id,
    type: resolved.type === 'player' ? 'PLAYER' : resolved.type === 'faab' ? 'FAAB' : 'PICK',
    value: resolved.value,
    name: resolved.name,
  }
}

/**
 * Reprice native trades on TODAY's league values — the separate "Now" view beside the immutable
 * proposal-time receipt.
 *
 * 🛑 THE LETTER IS THE ONE GRADE (2026-09-25). This used to fetch its own FantasyCalc book, price
 * players by Sleeper id with a flat 200 fallback, and grade the gap against what was GIVEN — a rule
 * of its own, beside the Trade Center's. It now asks the one grader
 * (`lib/decision-os/trade/leagueTradeGrader.ts`), from the proposer's side, so a trade's "Now" letter
 * is the letter the same deal would get in the Trade Center today.
 *
 * ⚠ NO ROSTER NEED. The trade has happened; both rosters already hold its result, so "does this fill
 * a hole" has no honest answer any more. Chart and scoring only.
 *
 * ⚠ A CONSUMED HISTORICAL PICK STAYS UNRESOLVED until the outcome ledger can map the pick to the
 * player selected with it — pricing it as an unspent pick would grade a pick that no longer exists.
 */
export async function priceTradesAtCurrentMarket(
  input: {
    leagueId: string
    league: TradeScoringLeague
    trades: Array<{
      id: string
      proposerRosterId: string
      items: CaptureTradeItem[]
    }>
  },
  deps: {
    createGrader?: (args: { leagueId: string }) => Promise<LeagueTradeGrader | null>
    loadNames?: typeof loadNativePlayerNames
  } = {},
): Promise<Map<string, CurrentTradeMarketSnapshot>> {
  const snapshots = new Map<string, CurrentTradeMarketSnapshot>()
  if (input.trades.length === 0) return snapshots

  try {
    const allItems = input.trades.flatMap((t) => t.items.map((i) => ({ ...i, itemReference: i.itemReference ?? null })))
    const [grader, nameForId] = await Promise.all([
      (deps.createGrader ?? ((a) => createLeagueTradeGrader(a)))({ leagueId: input.leagueId }).catch(() => null),
      (deps.loadNames ?? loadNativePlayerNames)(allItems),
    ])
    const currentYear = new Date().getUTCFullYear()
    const pricedAt = new Date().toISOString()

    for (const trade of input.trades) {
      const consumedPickLabels: string[] = []
      for (const item of trade.items) {
        if (!['rookie_pick', 'devy_pick', 'future_pick'].includes(item.itemType)) continue
        const meta = item.metadata && typeof item.metadata === 'object'
          ? item.metadata as Record<string, unknown>
          : {}
        const season = Number(meta.pickSeason ?? meta.season)
        if (Number.isFinite(season) && season < currentYear) consumedPickLabels.push(`${season} draft pick`)
      }
      if (consumedPickLabels.length > 0) {
        snapshots.set(trade.id, {
          grade: null,
          valueGiven: null,
          valueReceived: null,
          pricedAt,
          fullyPriced: false,
          unresolvedAssets: [...new Set(consumedPickLabels)],
        })
        continue
      }

      const items = trade.items.map((i) => ({ ...i, itemReference: i.itemReference ?? null, metadata: i.metadata ?? null }))
      const give = gradeInputsFromNativeItems(items.filter((i) => i.fromRosterId === trade.proposerRosterId), nameForId)
      const get = gradeInputsFromNativeItems(items.filter((i) => i.toRosterId === trade.proposerRosterId), nameForId)
      const grade = await gradeDeal(grader, { give, get, viewerSide: false })
      snapshots.set(trade.id, grade.graded
        ? {
            grade: grade.letter,
            valueGiven: grade.giveValue,
            valueReceived: grade.getValue,
            pricedAt,
            fullyPriced: true,
            unresolvedAssets: [],
          }
        : {
            grade: null,
            valueGiven: null,
            valueReceived: null,
            pricedAt,
            fullyPriced: false,
            // Named assets when we know which ones; otherwise the "Now" tile simply reads "—".
            unresolvedAssets: [...new Set([...give.unpriceable, ...get.unpriceable])],
          })
    }
  } catch (err) {
    console.error('[TradeLearningCapture] Failed to price current trade history (non-blocking):', err)
  }

  return snapshots
}

/**
 * Captures a real trade proposal's live acceptance-probability prediction.
 * Called once, at proposal creation. Idempotent by AfLeagueTrade.id — a
 * retried call returns the already-captured event's id rather than
 * creating a duplicate.
 */
export async function captureLiveTradeOffer(input: {
  tradeId: string
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  items: CaptureTradeItem[]
  league: League
  /**
   * The proposal's ONE grade (the receipt's proposer letter) — the only letter this event records,
   * so it cannot carry a different grade from the receipt beside it. Null records no letter.
   */
  oneGradeLetter?: string | null
}): Promise<string | null> {
  try {
    const { isSuperFlex, isTEP, isDynasty, ppr, scoringType } = resolveLeagueScoringContext(input.league)
    const rosterCount = await prisma.roster.count({ where: { leagueId: input.leagueId } })

    const fcPlayers = await getFantasyCalcValuesDbFirst({
      isDynasty,
      numQbs: isSuperFlex ? 2 : 1,
      numTeams: rosterCount > 0 ? rosterCount : 12,
      ppr,
    })

    const giveItems = input.items.filter((i) => i.fromRosterId === input.proposerRosterId)
    const receiveItems = input.items.filter((i) => i.toRosterId === input.proposerRosterId)
    if (giveItems.length === 0 && receiveItems.length === 0) return null

    const giveResolved = giveItems.map((item) => resolveItemValue(item, fcPlayers, isDynasty))
    const receiveResolved = receiveItems.map((item) => resolveItemValue(item, fcPlayers, isDynasty))
    const give: Asset[] = giveResolved.map((item, idx) => toAsset(item, `${input.tradeId}-give-${idx}`))
    const receive: Asset[] = receiveResolved.map((item, idx) => toAsset(item, `${input.tradeId}-recv-${idx}`))

    const calWeights = await getCalibratedWeights(undefined, { isSuperFlex, scoringType: undefined })
    const drivers: TradeDriverData = computeTradeDrivers(
      give,
      receive,
      null,
      null,
      isSuperFlex,
      isTEP,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      calWeights,
    )
    const { calibrated, isotonicApplied } = await calibrateAcceptProbability(drivers.acceptProbability)

    return await logTradeOfferEvent({
      leagueId: input.leagueId,
      // League.season always has a real value (@default(2026), never null) —
      // without this, every real capture's season would be null and
      // permanently invisible to computeShadowB0()'s season-scoped query,
      // discovered via real staging validation (Trade Learning Phase 9).
      season: input.league.season,
      assetsGiven: give.map((a) => ({ name: a.name ?? a.id, value: a.value, type: a.type })),
      assetsReceived: receive.map((a) => ({ name: a.name ?? a.id, value: a.value, type: a.type })),
      features: {
        lineupImpact: drivers.lineupImpactScore,
        vorp: drivers.vorpScore,
        market: drivers.marketScore,
        behavior: drivers.behaviorScore,
      },
      acceptProb: calibrated,
      rawAcceptProb: isotonicApplied ? drivers.acceptProbability : undefined,
      isotonicApplied,
      verdict: drivers.verdict,
      // THE grade (the receipt's proposer letter) — never a letter of this module's own.
      grade: input.oneGradeLetter ?? null,
      confidenceScore: drivers.confidenceScore,
      driverSet: drivers.acceptDrivers?.map((d) => ({
        id: d.id,
        evidence: typeof d.evidence === 'string' ? d.evidence : JSON.stringify(d.evidence),
      })),
      mode: 'LIVE_PROPOSAL',
      isSuperFlex,
      leagueFormat: isDynasty ? 'dynasty' : 'redraft',
      scoringType,
      afLeagueTradeId: input.tradeId,
    })
  } catch (err) {
    console.error('[TradeLearningCapture] Failed to capture live trade offer (non-blocking):', err)
    return null
  }
}

/**
 * Captures a real trade's terminal-status outcome, linked back to its own
 * offer event (looked up by afLeagueTradeId). No-ops cleanly for
 * non-terminal statuses or statuses with no approved mapping. Idempotent by
 * AfLeagueTrade.id.
 */
export async function captureLiveTradeOutcome(input: {
  tradeId: string
  leagueId: string
  status: string
  season?: number | null
  week?: number | null
}): Promise<string | null> {
  const outcome = mapAfTradeStatusToOutcome(input.status)
  if (!outcome) return null

  try {
    const offer = await prisma.tradeOfferEvent.findUnique({
      where: { afLeagueTradeId: input.tradeId },
      select: { id: true, season: true },
    })

    return await logTradeOutcomeEvent({
      offerEventId: offer?.id ?? null,
      leagueId: input.leagueId,
      // Inherit the season from this outcome's own linked offer event (which
      // now correctly carries League.season — see captureLiveTradeOffer())
      // rather than leaving it null, unless the caller explicitly overrides.
      season: input.season ?? offer?.season ?? null,
      week: input.week ?? null,
      outcome,
      afLeagueTradeId: input.tradeId,
    })
  } catch (err) {
    console.error('[TradeLearningCapture] Failed to capture live trade outcome (non-blocking):', err)
    return null
  }
}

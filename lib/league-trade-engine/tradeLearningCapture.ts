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
import { fetchFantasyCalcValues, findPlayerBySleeperId, getPickValue, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import { computeTradeDrivers, type TradeDriverData } from '@/lib/trade-engine/trade-engine'
import { getCalibratedWeights, calibrateAcceptProbability } from '@/lib/trade-engine/accept-calibration'
import { logTradeOfferEvent, logTradeOutcomeEvent, type TradeOutcomeStatus } from '@/lib/trade-engine/trade-event-logger'
import type { Asset } from '@/lib/trade-engine/types'

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
 * Derives isSuperFlex from the league's own canonical settings snapshot
 * (RosterSettingsSlice.starterSlots), not any provider-specific format —
 * satisfies the ADR's provider-independence requirement. TE-premium
 * detection is not implemented (defaults false) — a documented, bounded
 * simplification, not a correctness bug: it affects scoring precision for
 * TEP leagues only, never produces a wrong accept/reject direction.
 */
function resolveLeagueScoringContext(league: League): { isSuperFlex: boolean; isTEP: boolean } {
  try {
    const snap = parseSettingsSnapshot((league as { settings?: unknown }).settings ?? null)
    const starterSlots = (snap?.rosterSettings?.starterSlots ?? {}) as Record<string, unknown>
    const qbSlots = Number(starterSlots.QB ?? starterSlots.qb ?? 1)
    return { isSuperFlex: Number.isFinite(qbSlots) && qbSlots >= 2, isTEP: false }
  } catch {
    return { isSuperFlex: false, isTEP: false }
  }
}

interface ResolvedAssetValue {
  name: string
  value: number
  type: 'player' | 'pick' | 'faab' | string
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
    return { name: `${item.itemType} pick`, value, type: 'pick' }
  }

  if (item.itemType === 'faab') {
    return { name: 'FAAB', value: item.faabAmount ?? 0, type: 'faab' }
  }

  // 'specialty_asset' and any future item type: conservative flat fallback,
  // documented limitation (see the ADR) — not silently invented math.
  return { name: item.itemType, value: LIVE_CAPTURE_FALLBACK_VALUE, type: item.itemType }
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
}): Promise<string | null> {
  try {
    const { isSuperFlex, isTEP } = resolveLeagueScoringContext(input.league)
    const rosterCount = await prisma.roster.count({ where: { leagueId: input.leagueId } })

    const fcPlayers = await fetchFantasyCalcValues({
      isDynasty: true, // matches the existing hardcoded convention in every hypothetical-evaluation tool (see the ADR)
      numQbs: isSuperFlex ? 2 : 1,
      numTeams: rosterCount > 0 ? rosterCount : 12,
      ppr: 1,
    })

    const giveItems = input.items.filter((i) => i.fromRosterId === input.proposerRosterId)
    const receiveItems = input.items.filter((i) => i.toRosterId === input.proposerRosterId)
    if (giveItems.length === 0 && receiveItems.length === 0) return null

    const give: Asset[] = giveItems.map((item, idx) =>
      toAsset(resolveItemValue(item, fcPlayers, true), `${input.tradeId}-give-${idx}`),
    )
    const receive: Asset[] = receiveItems.map((item, idx) =>
      toAsset(resolveItemValue(item, fcPlayers, true), `${input.tradeId}-recv-${idx}`),
    )

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
      confidenceScore: drivers.confidenceScore,
      driverSet: drivers.acceptDrivers?.map((d) => ({
        id: d.id,
        evidence: typeof d.evidence === 'string' ? d.evidence : JSON.stringify(d.evidence),
      })),
      mode: 'LIVE_PROPOSAL',
      isSuperFlex,
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

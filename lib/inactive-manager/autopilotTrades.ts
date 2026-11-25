/**
 * CHIMMY AUTOPILOT — ANSWERING A TRADE OFFER (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 3).
 *
 * Whether a Chimmy team accepts or declines an offer made to it. Pure: it reads the value snapshot
 * every proposal already carries (lib/trade-value — the same numbers the trade screens show), weighs
 * each side the way this team's manager profile does, and answers. It never prices anything itself.
 *
 * The rules, in order:
 *   1. Only two-team trades. A multi-team trade is declined.
 *   2. No answer without a value: a trade the snapshot could not price, or one where a player Chimmy
 *      would GIVE has no value, is declined. An unpriced player Chimmy would GET counts as nothing.
 *   3. Never open a hole: it does not give up more starters than the players it gets back, and never
 *      more than `MAX_STARTERS_GIVEN` starters in one trade.
 *   4. Otherwise it accepts when what it gets, weighed its way, beats what it gives by its `fairness`
 *      margin. The weighing: a position it likes is worth more to it, a position it is happy to sell is
 *      worth less, and picks follow its horizon (a rebuilder likes them, a win-now team discounts them).
 *
 * A wrong "no" costs nothing — the offer can be made again. A wrong "yes" moves players. Every doubt
 * therefore declines.
 */
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'
import { positionBiasFor, type ManagerProfile } from './managerProfile'

/** Chimmy never gives up more than this many of its starters in one trade. */
export const MAX_STARTERS_GIVEN = 2

/** How far the horizon moves a draft pick's worth: +20% for a full rebuilder, −20% for win-now. */
export const PICK_HORIZON_WEIGHT = 0.2

/** Offers younger than this are left alone, so a misclick can be withdrawn before Chimmy answers. */
export const TRADE_ANSWER_DELAY_MS = 10 * 60_000

export type TradeAnswerCode =
  | 'accepted'
  | 'not_enough'
  | 'multi_team'
  | 'cannot_value'
  | 'lineup_hole'
  | 'too_many_starters'
  | 'nothing_offered'
  /** Set by the hourly run, not by `decideTradeOffer`: a team in the trade is out of the league. */
  | 'eliminated'

export type TradeAnswer = {
  decision: 'accept' | 'reject'
  code: TradeAnswerCode
  /** One plain line the other manager reads. */
  reason: string
  /** Both sides as this team weighs them (0 when the trade could not be valued). */
  give: number
  get: number
}

const REASONS: Record<TradeAnswerCode, string> = {
  accepted: 'Chimmy likes this deal for the team.',
  not_enough: 'Chimmy would need a bit more coming back to do this deal.',
  multi_team: 'Chimmy only does two-team trades.',
  cannot_value: 'Chimmy could not put a value on this deal, so it passed.',
  lineup_hole: 'This would leave the team short a starter, so Chimmy passed.',
  too_many_starters: 'That is too many starters to give up in one deal.',
  nothing_offered: 'Nothing was offered to the team.',
  eliminated: 'One of these teams is out of the league, so Chimmy passed.',
}

const answer = (decision: TradeAnswer['decision'], code: TradeAnswerCode, give = 0, get = 0): TradeAnswer => ({
  decision, code, reason: REASONS[code], give: Math.round(give), get: Math.round(get),
})

const isPick = (a: AssetValueSnapshot) => String(a.kind).includes('pick')
const isPlayer = (a: AssetValueSnapshot) => !isPick(a) && Boolean(a.playerId)
const priced = (a: AssetValueSnapshot) => a.valuationBasis !== 'none' && Number.isFinite(a.internalValue) && a.internalValue > 0

/** What one asset is worth to this manager: the snapshot's value, moved by position and horizon. */
export function weighedValue(asset: AssetValueSnapshot, profile: Pick<ManagerProfile, 'positionBias' | 'horizon'>): number {
  if (!priced(asset)) return 0
  const factor = isPick(asset) ? 1 + PICK_HORIZON_WEIGHT * profile.horizon : 1 + positionBiasFor(profile, asset.position)
  return asset.internalValue * Math.max(0, factor)
}

export function decideTradeOffer(args: {
  profile: ManagerProfile
  /** The proposal's value snapshot payload, or null when it has none. */
  snapshot: TradeValueSnapshot | null | undefined
  /** The Chimmy team's roster id in the trade (a redraft roster id, as the snapshot uses). */
  rosterId: string
  multiTeam: boolean
  /** Player ids the team currently starts. */
  starterIds: ReadonlyArray<string>
}): TradeAnswer {
  const { profile, snapshot, rosterId } = args
  if (args.multiTeam) return answer('reject', 'multi_team')
  if (!snapshot || snapshot.grade?.insufficientData || snapshot.coverage?.status === 'blocked') return answer('reject', 'cannot_value')

  const assets = (snapshot.sides ?? []).flatMap((s) => s.assets ?? [])
  const giving = assets.filter((a) => a.fromRosterId === rosterId)
  const getting = assets.filter((a) => a.toRosterId === rosterId)
  if (getting.length === 0) return answer('reject', 'nothing_offered')
  // A player or pick going out with no value on it could be worth anything: never guess.
  if (giving.some((a) => !priced(a))) return answer('reject', 'cannot_value')

  const give = giving.reduce((sum, a) => sum + weighedValue(a, profile), 0)
  const get = getting.reduce((sum, a) => sum + weighedValue(a, profile), 0)

  const starters = new Set(args.starterIds)
  const startersGiven = giving.filter((a) => isPlayer(a) && starters.has(String(a.playerId))).length
  if (startersGiven > MAX_STARTERS_GIVEN) return answer('reject', 'too_many_starters', give, get)
  if (startersGiven > getting.filter(isPlayer).length) return answer('reject', 'lineup_hole', give, get)

  if (get <= 0) return answer('reject', 'cannot_value', give, get)
  return get >= give * (1 + profile.fairness) ? answer('accept', 'accepted', give, get) : answer('reject', 'not_enough', give, get)
}

/**
 * COUNTER-OFFERS. When an offer is close but not enough, Chimmy says what would make it work instead
 * of only declining. Two shapes, tried in this order, and never more than one change:
 *
 *   add_on     the same deal plus ONE bench player from the other team. Chimmy never asks for a
 *              starter: a counter should be an easy yes, not a new negotiation.
 *   keep_back  the same deal with ONE of the players Chimmy was asked for left out.
 *
 * In both, the piece is the SMALLEST that closes the gap, and never one worth far more than the gap
 * (`COUNTER_OVERASK`) — Chimmy asks for what it needs, not for whatever it can get. An offer that is
 * not close (`COUNTER_GAP_LIMIT`) is simply declined.
 */
export const COUNTER_GAP_LIMIT = 0.35
export const COUNTER_OVERASK = 2.5

export type AskablePlayer = { playerId: string; playerName: string | null; position: string | null; value: number }

export type CounterPlan =
  | { kind: 'add_on'; add: AskablePlayer; reason: string }
  | { kind: 'keep_back'; keepPlayerId: string; keepPlayerName: string | null; reason: string }

export function planCounterOffer(args: {
  profile: ManagerProfile
  snapshot: TradeValueSnapshot | null | undefined
  rosterId: string
  /** The other team's bench players Chimmy may ask for, already priced on the snapshot's scale. */
  askable: ReadonlyArray<AskablePlayer>
}): CounterPlan | null {
  const { profile, snapshot, rosterId } = args
  if (!snapshot) return null
  const assets = (snapshot.sides ?? []).flatMap((s) => s.assets ?? [])
  const giving = assets.filter((a) => a.fromRosterId === rosterId)
  const getting = assets.filter((a) => a.toRosterId === rosterId)
  const give = giving.reduce((sum, a) => sum + weighedValue(a, profile), 0)
  const get = getting.reduce((sum, a) => sum + weighedValue(a, profile), 0)
  const need = give * (1 + profile.fairness) - get
  if (give <= 0 || get <= 0 || need <= 0 || need > give * COUNTER_GAP_LIMIT) return null

  const inDeal = new Set(assets.map((a) => String(a.playerId ?? '')))
  const addOn = args.askable
    .filter((p) => p.playerId && !inDeal.has(p.playerId))
    .map((p) => ({ p, worth: Math.max(0, p.value) * Math.max(0, 1 + positionBiasFor(profile, p.position)) }))
    .filter((x) => x.worth >= need && x.worth <= need * COUNTER_OVERASK)
    .sort((a, b) => a.worth - b.worth || a.p.playerId.localeCompare(b.p.playerId))[0]
  if (addOn) {
    const who = addOn.p.playerName?.trim() || 'one more player'
    return { kind: 'add_on', add: addOn.p, reason: `Chimmy would do this deal with ${who} added.` }
  }

  // Leaving out a player worth v needs: get >= (give - v) * (1 + fairness).
  const keepNeed = give - get / (1 + profile.fairness)
  const keep = giving.length > 1
    ? giving
        .filter(isPlayer)
        .map((a) => ({ a, worth: weighedValue(a, profile) }))
        .filter((x) => x.worth >= keepNeed && x.worth <= keepNeed * COUNTER_OVERASK)
        .sort((x, y) => x.worth - y.worth || String(x.a.playerId).localeCompare(String(y.a.playerId)))[0]
    : undefined
  if (keep) {
    const who = keep.a.playerName?.trim() || 'one of those players'
    return { kind: 'keep_back', keepPlayerId: String(keep.a.playerId), keepPlayerName: keep.a.playerName ?? null, reason: `Chimmy would do this deal if it keeps ${who}.` }
  }
  return null
}

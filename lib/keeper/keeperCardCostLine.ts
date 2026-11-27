/**
 * The player card's keeper line, as words. PURE, client-safe.
 *
 *   "Keeper cost: Round 5" — "Drafted Round 6 last season · league rule: 1 round earlier"
 *   "Market rank #14; a Round 5 keeper uses about the #54 pick — 40 picks of value."
 *
 * The round comes from ./keeperRules `keeperCostRound` (the league's own rule). The value is the keeper
 * value report's measure, ./missedDeadline `keeperValue` (market rank against the middle pick of the
 * cost round) — the number the same league's managers already see on the Keepers tab
 * (./keeperValueReport) and the one "AF keeps their best-value players" keeps by. Nothing here prices
 * anything new, so the card and the Keepers tab cannot disagree about one player.
 */

import type { KeeperRules } from './keeperRules'
import { keeperValue } from './missedDeadline'

export type PlayerKeeperCostBasis = 'drafted' | 'kept' | 'waiver'

export type PlayerKeeperCost = {
  /** Null when he cannot be kept (his cost lands above the league's round floor) or keeping is free. */
  costRound: number | null
  canKeep: boolean
  headline: string
  detail: string
  /** `keeperValue`: positive surplus = worth more than the pick he uses. */
  value: { marketRank: number; pickSlot: number; surplus: number; sentence: string } | null
}

const picks = (v: number) => `${v} pick${v === 1 ? '' : 's'}`

/** "same round" / "1 round earlier" / "2 rounds later", plus inflation. */
export function keeperRuleLabel(rules: Pick<KeeperRules, 'costSystem' | 'roundsEarlier' | 'inflationPerYear'>): string {
  const r = rules.roundsEarlier
  const base = r === 0 ? 'same round' : `${Math.abs(r)} round${Math.abs(r) === 1 ? '' : 's'} ${r > 0 ? 'earlier' : 'later'}`
  return rules.costSystem === 'inflation' && rules.inflationPerYear > 0
    ? `${base}, ${rules.inflationPerYear} more earlier for each year kept`
    : base
}

export function describeKeeperCardCost(input: {
  rules: KeeperRules
  cost: { ok: boolean; costRound: number }
  basis: PlayerKeeperCostBasis
  lastRound: number | null
  /** His market rank (1 = most valuable) and the league's team count; omitted when unpriced. */
  valuation?: { marketRank: number | null; teams: number | null } | null
}): PlayerKeeperCost {
  const { rules, cost, basis, lastRound } = input
  const rule =
    basis === 'waiver'
      ? `league rule: pickups cost ${rules.waiverCostRound != null ? `Round ${rules.waiverCostRound}` : 'the last round'}`
      : `league rule: ${keeperRuleLabel(rules)}`
  const history =
    basis === 'waiver' ? 'Not drafted last season' : basis === 'kept' ? `Kept at Round ${lastRound} last season` : `Drafted Round ${lastRound} last season`
  const detail = `${history} · ${rule}`

  if (!cost.ok) {
    return {
      costRound: null,
      canKeep: false,
      headline: `Can’t be kept: he would cost Round ${cost.costRound}`,
      detail: `${detail} · the league's earliest keeper round is Round ${rules.minCostRound}`,
      value: null,
    }
  }

  let value: PlayerKeeperCost['value'] = null
  const v = input.valuation
  const kv = v && v.teams ? keeperValue(cost.costRound, v.marketRank, v.teams) : null
  if (kv) {
    const head = `Market rank #${kv.marketRank}; a Round ${cost.costRound} keeper uses about the #${kv.pickSlot} pick`
    value = {
      ...kv,
      sentence:
        kv.surplus > 0
          ? `${head} — ${picks(kv.surplus)} of value.`
          : kv.surplus === 0
            ? `${head} — about even.`
            : `${head} — he costs ${picks(Math.abs(kv.surplus))} more than he is worth.`,
    }
  }
  return { costRound: cost.costRound, canKeep: true, headline: `Keeper cost: Round ${cost.costRound}`, detail, value }
}

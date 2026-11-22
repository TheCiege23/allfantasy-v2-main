/**
 * What happens to a team that never submits keepers by the deadline
 * (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §4.3, "non-submitter default (AF picks best value)").
 *
 *   auto_no_keepers   the team keeps nobody (the default, and what every league did before).
 *   auto_best_value   AF Commissioner: AF keeps, for that team, the eligible players whose market
 *                     value beats the pick they would cost by the most — up to the league's keeper
 *                     count, and only players who are worth more than their pick.
 *
 * "Worth more than their pick" is measured, not guessed: a player's market rank (FantasyCalc's
 * redraft overall rank, from the DB-first chart) against the overall pick his keeper round uses
 * (the middle of that round). A first-round talent costing a 9th is +large; a 9th-round talent
 * costing a 3rd is negative and is never kept. A player with no market rank is never auto-kept:
 * AF does not keep someone it cannot price.
 *
 * Pure.
 */

import { placeTeamKeepers, type KeeperRules } from './keeperRules'

export const MISSED_DEADLINE_RULES = ['auto_no_keepers', 'auto_best_value'] as const
export type MissedDeadlineRule = (typeof MISSED_DEADLINE_RULES)[number]

export function readMissedDeadlineRule(value: unknown): MissedDeadlineRule {
  return value === 'auto_best_value' ? 'auto_best_value' : 'auto_no_keepers'
}

export type BestValueCandidate = {
  playerId: string
  name: string
  /** The round he would cost; null = not priced by round, never auto-kept. */
  costRound: number | null
  /** Market overall rank (1 = most valuable); null = no market price. */
  marketRank: number | null
}

export type AutoKeeper = BestValueCandidate & { costRound: number; marketRank: number; surplus: number; pickRound: number }

/** The overall pick a keeper round uses: the middle of that round. */
export function pickSlotForRound(round: number, teams: number): number {
  return (round - 1) * teams + Math.ceil(teams / 2)
}

export type KeeperValue = { marketRank: number; pickSlot: number; surplus: number }

/**
 * One keeper's value against his cost (the keeper value report, spec §4.3): positive = worth more
 * than the pick he uses. Null when he isn't priced by round or has no market price.
 */
export function keeperValue(costRound: number | null, marketRank: number | null, teams: number): KeeperValue | null {
  if (costRound == null || marketRank == null) return null
  const pickSlot = pickSlotForRound(costRound, Math.max(1, teams))
  return { marketRank, pickSlot, surplus: pickSlot - marketRank }
}

export function chooseBestValueKeepers(input: {
  candidates: readonly BestValueCandidate[]
  maxKeepers: number
  teams: number
  rules: KeeperRules
  totalRounds: number
}): AutoKeeper[] {
  const teams = Math.max(1, input.teams)
  const ranked = input.candidates
    .flatMap((c) => (c.costRound != null && c.marketRank != null ? [{ ...c, costRound: c.costRound, marketRank: c.marketRank }] : []))
    .map((c) => ({ ...c, surplus: pickSlotForRound(c.costRound, teams) - c.marketRank }))
    .filter((c) => c.surplus > 0)
    // Most surplus first; a tie goes to the more valuable player, then the id for a stable answer.
    .sort((a, b) => b.surplus - a.surplus || a.marketRank - b.marketRank || a.playerId.localeCompare(b.playerId))

  const chosen: AutoKeeper[] = []
  for (const c of ranked) {
    if (chosen.length >= input.maxKeepers) break
    // Keep the set legal under the league's same-round rule: a candidate the placement would
    // refuse is skipped, never forced in.
    const trial = [...chosen, { ...c, pickRound: c.costRound }]
    const placement = placeTeamKeepers(input.rules, trial.map((t) => ({ playerId: t.playerId, costRound: t.costRound })), { totalRounds: input.totalRounds })
    if (placement.refused.length) continue
    const byId = new Map(placement.placed.map((p) => [p.playerId, p.round]))
    chosen.splice(0, chosen.length, ...trial.map((t) => ({ ...t, pickRound: byId.get(t.playerId) ?? t.costRound })))
  }
  return chosen
}

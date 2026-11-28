/**
 * Keeper cost rules: what round a keeper costs, and which pick each keeper actually uses.
 *
 * docs/AF_COMMISSIONER_SETTINGS_SPEC.md §1.2. "Up" = an earlier round (more expensive, R5 → R4),
 * "down" = a later round (cheaper, R5 → R6) — owner decision 2026-10-19.
 *
 *   cost rule        `League.keeperCostSystem` + `keeperRoundPenalty` (rounds EARLIER; 0 = same
 *                    round, negative = rounds later). `inflation` moves `keeperInflationRate`
 *                    rounds earlier for every season already kept.
 *   waiver pickups   cost `keeper_waiver_cost_round` (League.settings), else the last round. That
 *                    round IS the cost — no penalty on top. Owner's rule (2026-11-27): a team keeping
 *                    SEVERAL undrafted pickups stacks them — the first costs that round, the second the
 *                    round before, the third two before… (`stackWaiverKeeperCosts`), in the order the
 *                    manager listed them. `keeper_waiver_stack: false` turns stacking off.
 *   round floor      `keeper_min_cost_round`: a keeper whose cost lands earlier than this round
 *                    cannot be kept (2 = "first-rounders can't be kept").
 *   same round       `League.keeperConflictRule`: two keepers costing one round —
 *                      lose_round_before  the second takes the round before (owner default for the rule)
 *                      lose_round_after   the second takes the round after
 *                      player_chooses / reject_both  the existing behaviour: refused, manager picks
 *                    A pick the team traded away is treated the same way as a taken one.
 *
 * Pure. No prisma.
 */

type KeeperCostSystem = 'round_based' | 'inflation' | 'auction_value' | 'free'
export type KeeperSameRoundRule = 'lose_round_before' | 'lose_round_after' | 'player_chooses' | 'reject_both'

export type KeeperRules = {
  costSystem: KeeperCostSystem
  /** Rounds earlier than last season (negative = later). */
  roundsEarlier: number
  /** Extra rounds earlier per season already kept (inflation only). */
  inflationPerYear: number
  /** Round an undrafted pickup costs; null = the draft's last round. */
  waiverCostRound: number | null
  /** Earliest round a keeper may cost; null = no floor. */
  minCostRound: number | null
  sameRoundRule: KeeperSameRoundRule
}

const SAME_ROUND: readonly KeeperSameRoundRule[] = ['lose_round_before', 'lose_round_after', 'player_chooses', 'reject_both']
const COST: readonly KeeperCostSystem[] = ['round_based', 'inflation', 'auction_value', 'free']

/** The two same-round rules that move a keeper instead of refusing it. AF Commissioner. */
export const SAME_ROUND_RESOLVING_RULES: readonly KeeperSameRoundRule[] = ['lose_round_before', 'lose_round_after']

function intOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

export function resolveKeeperRules(league: {
  keeperCostSystem?: string | null
  keeperRoundPenalty?: number | null
  keeperInflationRate?: number | null
  keeperConflictRule?: string | null
  settings?: unknown
}): KeeperRules {
  const settings = league.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {}
  const waiver = intOrNull(settings.keeper_waiver_cost_round)
  const floor = intOrNull(settings.keeper_min_cost_round)
  return {
    costSystem: COST.includes(league.keeperCostSystem as KeeperCostSystem) ? (league.keeperCostSystem as KeeperCostSystem) : 'round_based',
    roundsEarlier: Number.isInteger(league.keeperRoundPenalty) ? (league.keeperRoundPenalty as number) : 1,
    inflationPerYear: Number.isInteger(league.keeperInflationRate) ? (league.keeperInflationRate as number) : 1,
    waiverCostRound: waiver != null && waiver >= 1 ? waiver : null,
    minCostRound: floor != null && floor >= 1 ? floor : null,
    sameRoundRule: SAME_ROUND.includes(league.keeperConflictRule as KeeperSameRoundRule)
      ? (league.keeperConflictRule as KeeperSameRoundRule)
      : 'player_chooses',
  }
}

type KeeperCostInput = {
  /** The round this player last cost: his keeper round if kept, else where he was drafted. Null = never drafted. */
  lastRound: number | null
  /** Seasons this player has already been kept. */
  yearsKept: number
  /** Rounds in the draft. */
  totalRounds: number
}

type KeeperCost =
  | { ok: true; costRound: number; label: string; basis: 'drafted' | 'waiver' }
  | { ok: false; reason: 'above_round_floor'; costRound: number; label: string }

export function roundLabel(round: number): string {
  return `Round ${round}`
}

/** Round-cost keepers only; `auction_value` and `free` are priced elsewhere. */
export function keeperCostRound(rules: KeeperRules, input: KeeperCostInput): KeeperCost {
  const last = Math.max(1, input.totalRounds)
  if (input.lastRound == null) {
    const round = Math.min(last, rules.waiverCostRound ?? last)
    return floorCheck(rules, round, 'waiver')
  }
  const earlier =
    rules.costSystem === 'inflation'
      ? rules.roundsEarlier + rules.inflationPerYear * Math.max(0, input.yearsKept)
      : rules.roundsEarlier
  // A first-rounder kept "one round up" still costs round 1 — there is nothing earlier. Leagues
  // that don't want that set the round floor instead.
  const round = Math.min(last, Math.max(1, input.lastRound - earlier))
  return floorCheck(rules, round, 'drafted')
}

function floorCheck(rules: KeeperRules, round: number, basis: 'drafted' | 'waiver'): KeeperCost {
  if (rules.minCostRound != null && round < rules.minCostRound) {
    return { ok: false, reason: 'above_round_floor', costRound: round, label: roundLabel(round) }
  }
  return { ok: true, costRound: round, label: basis === 'waiver' ? waiverCostLabel(round) : roundLabel(round), basis }
}

const WAIVER_NOTE = ' (not drafted)'

/** "Round 15 (not drafted)" — the eligibility label of an undrafted pickup, which is how a save tells him apart. */
export function waiverCostLabel(round: number): string {
  return `${roundLabel(round)}${WAIVER_NOTE}`
}

export function isWaiverCostLabel(label: string | null | undefined): boolean {
  return typeof label === 'string' && label.endsWith(WAIVER_NOTE)
}

/** `keeper_waiver_stack` (League.settings): stacking of several undrafted keepers; on unless set false. */
export function readWaiverStack(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return true
  return (settings as Record<string, unknown>).keeper_waiver_stack !== false
}

/**
 * ONE team's keepers with the undrafted pickups stacked (owner, 2026-11-27): in the order given (the
 * manager's list), the first pickup costs the waiver round (`costRound` as priced — the last round, or
 * the commissioner's fixed round), the second the round before it, and so on. A stacked pickup never
 * lands on a round a drafted keeper (or an earlier pickup) already costs: it walks to the next earlier
 * free round — the board's same-round default — and later only when nothing earlier is free. Drafted
 * keepers are returned unchanged. Never below Round 1.
 */
export function stackWaiverKeeperCosts<T extends { costRound: number; waiver: boolean }>(
  keepers: readonly T[],
  options: { totalRounds: number },
): T[] {
  const total = Math.max(1, options.totalRounds)
  const used = new Set(keepers.filter((k) => !k.waiver).map((k) => Math.min(Math.max(1, k.costRound), total)))
  let next: number | null = null
  return keepers.map((k) => {
    if (!k.waiver) return k
    const base = Math.min(Math.max(1, k.costRound), total)
    const want = next == null ? base : Math.min(base, next)
    let round: number | null = null
    for (let r = want; r >= 1; r--) if (!used.has(r)) { round = r; break }
    for (let r = want + 1; round == null && r <= total; r++) if (!used.has(r)) round = r
    if (round == null) round = want
    used.add(round)
    next = Math.max(1, round - 1)
    return { ...k, costRound: round }
  })
}

type KeeperToPlace = { playerId: string; costRound: number }

type PlacedKeeper = KeeperToPlace & {
  /** The pick this keeper uses. Differs from `costRound` when a same-round rule moved it. */
  round: number
  movedBecause: 'same_round' | 'pick_traded' | null
}

type KeeperPlacement = {
  placed: PlacedKeeper[]
  /** Keepers that could not be given a pick, with why. */
  refused: { playerId: string; costRound: number; reason: 'same_round' | 'no_pick_available' }[]
}

/**
 * Give each of ONE team's keepers a pick. Keepers are taken cheapest-pick-last: for
 * `lose_round_before` the earliest cost is placed first so a clash moves to an earlier open round;
 * for `lose_round_after` the latest cost is placed first so a clash moves later. Ties keep input
 * order (the manager's order of preference).
 *
 * `ownedRounds` is the rounds the team still holds a pick in; omitted = every round.
 */
export function placeTeamKeepers(
  rules: KeeperRules,
  keepers: readonly KeeperToPlace[],
  options: { totalRounds: number; ownedRounds?: readonly number[] },
): KeeperPlacement {
  const total = Math.max(1, options.totalRounds)
  const owned = new Set(options.ownedRounds ?? Array.from({ length: total }, (_, i) => i + 1))
  const used = new Set<number>()
  const resolving = SAME_ROUND_RESOLVING_RULES.includes(rules.sameRoundRule)
  const step = rules.sameRoundRule === 'lose_round_after' ? 1 : -1

  const order = keepers
    .map((k, i) => ({ k, i }))
    .sort((a, b) => (step === -1 ? a.k.costRound - b.k.costRound : b.k.costRound - a.k.costRound) || a.i - b.i)

  const placed: PlacedKeeper[] = []
  const refused: KeeperPlacement['refused'] = []
  for (const { k } of order) {
    const want = Math.min(Math.max(1, k.costRound), total)
    if (owned.has(want) && !used.has(want)) {
      used.add(want)
      placed.push({ ...k, round: want, movedBecause: null })
      continue
    }
    const clash = used.has(want)
    if (clash && !resolving) {
      refused.push({ playerId: k.playerId, costRound: k.costRound, reason: 'same_round' })
      continue
    }
    let round: number | null = null
    for (let r = want + step; r >= 1 && r <= total; r += step) {
      if (owned.has(r) && !used.has(r)) { round = r; break }
    }
    if (round == null) {
      refused.push({ playerId: k.playerId, costRound: k.costRound, reason: 'no_pick_available' })
      continue
    }
    used.add(round)
    placed.push({ ...k, round, movedBecause: clash ? 'same_round' : 'pick_traded' })
  }

  // With a refusing rule, a clash refuses EVERY keeper in that round, not only the second one:
  // which one stays is the manager's call (`player_chooses`) or neither does (`reject_both`).
  if (!resolving) {
    const clashed = new Set(refused.filter((r) => r.reason === 'same_round').map((r) => Math.min(Math.max(1, r.costRound), total)))
    for (let i = placed.length - 1; i >= 0; i--) {
      const p = placed[i]
      if (clashed.has(p.round) && p.movedBecause == null) {
        refused.push({ playerId: p.playerId, costRound: p.costRound, reason: 'same_round' })
        placed.splice(i, 1)
      }
    }
  }
  return { placed: placed.sort((a, b) => a.round - b.round), refused }
}

/** "Round 4 (moved from Round 5: two keepers cost Round 5)". */
export function placedKeeperLabel(p: PlacedKeeper): string {
  if (p.movedBecause == null || p.round === p.costRound) return roundLabel(p.round)
  const why = p.movedBecause === 'same_round' ? `two keepers cost ${roundLabel(p.costRound)}` : `${roundLabel(p.costRound)} pick was traded`
  return `${roundLabel(p.round)} (moved from ${roundLabel(p.costRound)}: ${why})`
}

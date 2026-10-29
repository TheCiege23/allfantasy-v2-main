/**
 * ANTI-TANKING PENALTIES — what a tanking case costs a team (owner decision 2026-10-26,
 * docs/AF_COMMISSIONER_SETTINGS_SPEC.md §5): a WARNING first, then LOSS OF A DRAFT PICK, with the
 * commissioner able to change both for their league.
 *
 * The tanking monitor (TankingDetectionEngine) opens a flag; that is a suspicion, and costs nothing
 * but a private warning to the manager. A STRIKE is a flag the commissioner CONFIRMED (escalated on
 * the integrity page). Detection is a heuristic, so a pick is never taken on a guess: the
 * commissioner's confirmation is what makes it a strike.
 *
 * What the penalty strike costs is the commissioner's choice (phase 6, 2026-10-27): the draft pick
 * (the default), worse odds in the next rookie-draft lottery, or part of the team's FAAB.
 *
 * Pure. Policy lives in `League.settings.integrity_tanking_penalties`.
 */

export const TANKING_PENALTIES_KEY = 'integrity_tanking_penalties'

/**
 * `forfeit_pick`: the team loses a draft pick.
 * `lottery_odds`: the team's chance in the next rookie-draft lottery is cut (100% = left out of the draw).
 * `faab`: the team loses a share of its season FAAB budget from what it has left.
 */
export const TANKING_PENALTY_KINDS = ['forfeit_pick', 'lottery_odds', 'faab'] as const
export type TankingPenaltyKind = (typeof TANKING_PENALTY_KINDS)[number]
export const LOTTERY_ODDS_CUTS = [25, 50, 75, 100] as const
export const FAAB_PENALTY_PERCENTS = [10, 25, 50, 100] as const

export type TankingPenaltyPolicy = {
  /** Off: flags are still raised and reviewed, but no warning is sent and nothing is taken. */
  enabled: boolean
  /** What the penalty strike costs. */
  penalty: TankingPenaltyKind
  /** The confirmed strike that costs the penalty. 2 = one warning, then the penalty. (Named before the penalty was a choice.) */
  pickAtStrike: number
  /** `forfeit_pick`: the team's own pick in this round, in the nearest season it still holds one. */
  pickRound: number
  /** `lottery_odds`: how much of the team's lottery weight is taken, in percent. */
  lotteryOddsCutPct: number
  /** `faab`: the share of the season FAAB budget taken, in percent. */
  faabPercent: number
}

export const DEFAULT_TANKING_PENALTY_POLICY: TankingPenaltyPolicy = {
  enabled: true,
  penalty: 'forfeit_pick',
  pickAtStrike: 2,
  pickRound: 1,
  lotteryOddsCutPct: 50,
  faabPercent: 25,
}

const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null
const oneOf = <T extends string | number>(v: unknown, allowed: readonly T[]): T | null => (allowed.includes(v as T) ? (v as T) : null)

export function readTankingPenaltyPolicy(settings: unknown): TankingPenaltyPolicy {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[TANKING_PENALTIES_KEY] : null
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    enabled: o.enabled === false ? false : DEFAULT_TANKING_PENALTY_POLICY.enabled,
    penalty: oneOf(o.penalty, TANKING_PENALTY_KINDS) ?? DEFAULT_TANKING_PENALTY_POLICY.penalty,
    pickAtStrike: intIn(o.pickAtStrike, 1, 10) ?? DEFAULT_TANKING_PENALTY_POLICY.pickAtStrike,
    pickRound: intIn(o.pickRound, 1, 10) ?? DEFAULT_TANKING_PENALTY_POLICY.pickRound,
    lotteryOddsCutPct: oneOf(o.lotteryOddsCutPct, LOTTERY_ODDS_CUTS) ?? DEFAULT_TANKING_PENALTY_POLICY.lotteryOddsCutPct,
    faabPercent: oneOf(o.faabPercent, FAAB_PENALTY_PERCENTS) ?? DEFAULT_TANKING_PENALTY_POLICY.faabPercent,
  }
}

/** Validates a commissioner's edit; unknown or out-of-range fields are rejected rather than guessed. */
export function parseTankingPenaltyPolicyPatch(input: unknown): Partial<TankingPenaltyPolicy> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const out: Partial<TankingPenaltyPolicy> = {}
  if ('enabled' in o) {
    if (typeof o.enabled !== 'boolean') return null
    out.enabled = o.enabled
  }
  if ('pickAtStrike' in o) {
    const v = intIn(o.pickAtStrike, 1, 10)
    if (v == null) return null
    out.pickAtStrike = v
  }
  if ('pickRound' in o) {
    const v = intIn(o.pickRound, 1, 10)
    if (v == null) return null
    out.pickRound = v
  }
  if ('penalty' in o) {
    const v = oneOf(o.penalty, TANKING_PENALTY_KINDS)
    if (v == null) return null
    out.penalty = v
  }
  if ('lotteryOddsCutPct' in o) {
    const v = oneOf(o.lotteryOddsCutPct, LOTTERY_ODDS_CUTS)
    if (v == null) return null
    out.lotteryOddsCutPct = v
  }
  if ('faabPercent' in o) {
    const v = oneOf(o.faabPercent, FAAB_PENALTY_PERCENTS)
    if (v == null) return null
    out.faabPercent = v
  }
  return Object.keys(out).length > 0 ? out : null
}

export type TankingStep =
  | { kind: 'none' }
  | { kind: 'warning'; strike: number; strikesLeft: number }
  | { kind: TankingPenaltyKind; strike: number }

/**
 * What the `confirmedStrikes`-th confirmed strike costs. Before the penalty strike it is a warning
 * (with how many remain); at or past it, the league's penalty. Every strike from that one on costs it.
 */
export function tankingStepForStrike(policy: TankingPenaltyPolicy, confirmedStrikes: number): TankingStep {
  if (!policy.enabled || confirmedStrikes < 1) return { kind: 'none' }
  if (confirmedStrikes >= policy.pickAtStrike) return { kind: policy.penalty, strike: confirmedStrikes }
  return { kind: 'warning', strike: confirmedStrikes, strikesLeft: policy.pickAtStrike - confirmedStrikes }
}

export type HeldPick = { season: number; round: number; ownerTeamId: string; originalTeamId: string }

/**
 * The pick a team loses: its OWN pick in `round`, in the nearest season it still holds one. If it has
 * traded all of those away, the nearest pick it holds in a later round (its own first, then any it
 * acquired). Null when it holds no pick at or after that round: the commissioner is told instead.
 */
export function choosePickToForfeit(picks: readonly HeldPick[], rosterId: string, round: number): HeldPick | null {
  const held = picks.filter((p) => p.ownerTeamId === rosterId && p.round >= round)
  const order = (a: HeldPick, b: HeldPick) => a.season - b.season || a.round - b.round
  const own = held.filter((p) => p.originalTeamId === rosterId)
  const exact = own.filter((p) => p.round === round).sort(order)[0]
  if (exact) return exact
  return [...own].sort(order)[0] ?? [...held].sort(order)[0] ?? null
}

export function describePick(p: { season: number; round: number }): string {
  const suffix = p.round === 1 ? 'st' : p.round === 2 ? 'nd' : p.round === 3 ? 'rd' : 'th'
  return `${p.season} ${p.round}${suffix}-round pick`
}

/** The penalty in words, for the warnings a manager gets: "a draft pick", "half its lottery odds", … */
export function describePenalty(policy: TankingPenaltyPolicy): string {
  if (policy.penalty === 'lottery_odds') {
    return policy.lotteryOddsCutPct >= 100 ? 'its place in the next rookie-draft lottery' : `${policy.lotteryOddsCutPct}% of its odds in the next rookie-draft lottery`
  }
  if (policy.penalty === 'faab') return `${policy.faabPercent}% of its FAAB budget`
  return 'a draft pick'
}

/** FAAB taken: the policy's share of the season budget, never more than the team has left. */
export function faabPenaltyAmount(budget: number | null | undefined, remaining: number | null | undefined, percent: number): number {
  const b = typeof budget === 'number' && budget > 0 ? budget : 0
  const left = typeof remaining === 'number' && remaining > 0 ? remaining : 0
  return Math.min(left, Math.round((b * percent) / 100))
}

/**
 * Lottery penalties, kept in `League.settings.integrity_tanking_lottery_penalties` until they are
 * spent. A penalty counts against the next rookie draft CREATED after it was imposed — that draft's
 * lottery is drawn at creation or later — and is spent once that draft is complete. A penalty
 * confirmed after this year's draft was set up therefore waits for next year's, rather than vanishing.
 */
export const TANKING_LOTTERY_PENALTIES_KEY = 'integrity_tanking_lottery_penalties'

export type LotteryOddsPenalty = { rosterId: string; cutPct: number; at: string; flagId: string }

export function readLotteryOddsPenalties(settings: unknown): LotteryOddsPenalty[] {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[TANKING_LOTTERY_PENALTIES_KEY] : null
  if (!Array.isArray(raw)) return []
  return raw.flatMap((r) => {
    const o = r && typeof r === 'object' ? (r as Record<string, unknown>) : {}
    const cutPct = typeof o.cutPct === 'number' && o.cutPct > 0 && o.cutPct <= 100 ? o.cutPct : null
    if (typeof o.rosterId !== 'string' || !o.rosterId || cutPct == null || typeof o.at !== 'string' || !Number.isFinite(Date.parse(o.at))) return []
    return [{ rosterId: o.rosterId, cutPct, at: o.at, flagId: typeof o.flagId === 'string' ? o.flagId : '' }]
  })
}

/** Penalties not yet spent: none of them predates a draft that was created after it and has finished. */
export function activeLotteryOddsPenalties(
  penalties: readonly LotteryOddsPenalty[],
  completedDrafts: ReadonlyArray<{ createdAt: Date }>,
): LotteryOddsPenalty[] {
  return penalties.filter((p) => {
    const at = Date.parse(p.at)
    return !completedDrafts.some((d) => d.createdAt.getTime() > at)
  })
}

/**
 * Each penalized team's lottery weight multiplied by what is left after its cuts (two 50% cuts leave
 * 25%). A team cut to nothing is left out of the draw, and is seated with the non-lottery teams.
 */
export function applyLotteryOddsPenalties<T extends { rosterId: string; weight: number }>(
  eligible: readonly T[],
  penalties: readonly LotteryOddsPenalty[],
): T[] {
  if (penalties.length === 0) return [...eligible]
  const factor = new Map<string, number>()
  for (const p of penalties) factor.set(p.rosterId, (factor.get(p.rosterId) ?? 1) * Math.max(0, 1 - p.cutPct / 100))
  return eligible
    .map((t) => (factor.has(t.rosterId) ? { ...t, weight: t.weight * factor.get(t.rosterId)! } : t))
    .filter((t) => t.weight > 0)
}

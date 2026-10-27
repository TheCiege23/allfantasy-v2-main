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
 * Pure. Policy lives in `League.settings.integrity_tanking_penalties`.
 */

export const TANKING_PENALTIES_KEY = 'integrity_tanking_penalties'

export type TankingPenaltyPolicy = {
  /** Off: flags are still raised and reviewed, but no warning is sent and no pick is taken. */
  enabled: boolean
  /** The confirmed strike that costs a pick. 2 = one warning, then the pick. */
  pickAtStrike: number
  /** The round of the pick taken: the team's own pick in this round, in the nearest season it still holds one. */
  pickRound: number
}

export const DEFAULT_TANKING_PENALTY_POLICY: TankingPenaltyPolicy = { enabled: true, pickAtStrike: 2, pickRound: 1 }

const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null

export function readTankingPenaltyPolicy(settings: unknown): TankingPenaltyPolicy {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[TANKING_PENALTIES_KEY] : null
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return {
    enabled: o.enabled === false ? false : DEFAULT_TANKING_PENALTY_POLICY.enabled,
    pickAtStrike: intIn(o.pickAtStrike, 1, 10) ?? DEFAULT_TANKING_PENALTY_POLICY.pickAtStrike,
    pickRound: intIn(o.pickRound, 1, 10) ?? DEFAULT_TANKING_PENALTY_POLICY.pickRound,
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
  return Object.keys(out).length > 0 ? out : null
}

export type TankingStep = { kind: 'none' } | { kind: 'warning'; strike: number; strikesLeft: number } | { kind: 'forfeit_pick'; strike: number }

/**
 * What the `confirmedStrikes`-th confirmed strike costs. Before the penalty strike it is a warning
 * (with how many remain); at or past it, a pick. Every strike from the penalty one on costs a pick.
 */
export function tankingStepForStrike(policy: TankingPenaltyPolicy, confirmedStrikes: number): TankingStep {
  if (!policy.enabled || confirmedStrikes < 1) return { kind: 'none' }
  if (confirmedStrikes >= policy.pickAtStrike) return { kind: 'forfeit_pick', strike: confirmedStrikes }
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

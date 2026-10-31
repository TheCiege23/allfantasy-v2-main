/**
 * Draft-day kit (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §3, idea 9) — the absent-manager rule.
 *
 * Auto-pick already covers an absent manager's PICK (queue → need/best available → skip, in
 * processExpiredDraftPicks). What it did not cover is the CLOCK: a manager who never showed up still
 * cost the room the full pick timer on every one of their picks, all draft long — 15 rounds × 90 s
 * is over 20 minutes of a live draft waiting on nobody, and on a slow draft it is days.
 *
 * The rule: once a team's last `missedPicks` decisions were all made by auto-pick, its clock drops to
 * `seconds` until the manager picks again. One manual pick resets it — the count reads the team's own
 * picks, so there is no state to clear and nothing to forget to clear.
 *
 * Pure. The pick engine calls `absentClockSeconds` with the board as it stands after a pick, for the
 * team that is now on the clock.
 */

export type AbsentManagerRule = {
  enabled: boolean
  /** Auto-picks in a row before the short clock applies. */
  missedPicks: number
  /** The short clock, in seconds. */
  seconds: number
}

export const ABSENT_MANAGER_RULE_KEY = 'draft_absent_manager_rule'

export const ABSENT_MANAGER_RULE_DEFAULT: AbsentManagerRule = { enabled: false, missedPicks: 2, seconds: 15 }

export const ABSENT_LIMITS = { missedPicks: { min: 1, max: 5 }, seconds: { min: 10, max: 120 } } as const

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

export function normalizeAbsentManagerRule(raw: unknown): AbsentManagerRule {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    enabled: r.enabled === true,
    missedPicks: clamp(num(r.missedPicks, ABSENT_MANAGER_RULE_DEFAULT.missedPicks), ABSENT_LIMITS.missedPicks.min, ABSENT_LIMITS.missedPicks.max),
    seconds: clamp(num(r.seconds, ABSENT_MANAGER_RULE_DEFAULT.seconds), ABSENT_LIMITS.seconds.min, ABSENT_LIMITS.seconds.max),
  }
}

export function readAbsentManagerRule(settings: unknown): AbsentManagerRule {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  return normalizeAbsentManagerRule(s[ABSENT_MANAGER_RULE_KEY])
}

export type BoardPick = { overall: number; rosterId: string; source?: string | null; playerName?: string | null }

/**
 * Auto-picks in a row at the end of this team's picks. Keeper picks are skipped: the board places a
 * keeper on its own, so it is neither a miss nor a sign the manager is back.
 */
export function trailingAutoPicks(picks: readonly BoardPick[], rosterId: string): number {
  const own = picks.filter((p) => p.rosterId === rosterId && String(p.playerName ?? '').trim() !== '').sort((a, b) => b.overall - a.overall)
  let n = 0
  for (const p of own) {
    if (p.source === 'keeper') continue
    if (p.source !== 'auto') break
    n++
  }
  return n
}

/** Timer modes the rule applies under. A soft timer never auto-picks, and "none" has no clock. */
const CLOCKED_MODES = new Set(['per_pick', 'overnight_pause'])

/**
 * Seconds to put on the clock for `nextRosterId`, or null to use the league's normal pick timer.
 * Never longer than the normal timer.
 */
export function absentClockSeconds(args: {
  rule: AbsentManagerRule
  timerMode: string | null | undefined
  timerSeconds: number
  picks: readonly BoardPick[]
  nextRosterId: string | null | undefined
}): number | null {
  const { rule, timerSeconds, nextRosterId } = args
  if (!rule.enabled || !nextRosterId) return null
  if (!CLOCKED_MODES.has(String(args.timerMode ?? 'per_pick'))) return null
  if (!(timerSeconds > rule.seconds)) return null
  return trailingAutoPicks(args.picks, nextRosterId) >= rule.missedPicks ? rule.seconds : null
}

/**
 * AUTO-HANDOVER — the commissioner's opt-in: "hand a team to AllFantasy after N days with no activity"
 * (phase 10, 2026-10-29).
 *
 * AllFantasy only SUGGESTS inactive teams (owner decision 2026-10-26); it never switches a team on by
 * itself. This is the commissioner choosing, once, that it should — off unless they turn it on. When a
 * team's owner has done nothing for the chosen number of days, the hourly run turns on lineup management
 * for it (`to: 'lineups'`, free) or Chimmy autopilot (`to: 'autopilot'`, AF Commissioner; lineups only
 * when the plan has lapsed). Both end the moment the owner saves a lineup, exactly as when the
 * commissioner switches them on by hand, and a team that changes hands ends them too.
 *
 * "No activity" is the owner's OWN actions — a lineup they saved (`AfRosterMoveHistory`,
 * `source = 'user_save'`) or a waiver claim — never the team's last-updated time, which AllFantasy's own
 * saves (filling an empty spot, benching a bye) also touch. And idle time never starts before the rule
 * was switched on, so turning it on does not hand anyone over that day.
 *
 * Stored as `League.settings.inactive_auto_handover`. Pure.
 */
import type { ManagedLineups } from './inactiveManagerMode'

export const AUTO_HANDOVER_KEY = 'inactive_auto_handover'
export const AUTO_HANDOVER_DAYS = [7, 14, 21] as const
export type AutoHandoverDays = (typeof AUTO_HANDOVER_DAYS)[number]
export type AutoHandoverTarget = 'lineups' | 'autopilot'
export type AutoHandoverRule = { days: AutoHandoverDays; to: AutoHandoverTarget; since: string; byUserId: string }

const DAY_MS = 86_400_000
const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

export function readAutoHandover(settings: unknown): AutoHandoverRule | null {
  const o = asRecord(asRecord(settings)?.[AUTO_HANDOVER_KEY])
  if (!o) return null
  if (!(AUTO_HANDOVER_DAYS as readonly number[]).includes(o.days as number)) return null
  if (o.to !== 'lineups' && o.to !== 'autopilot') return null
  if (typeof o.since !== 'string' || Number.isNaN(Date.parse(o.since)) || typeof o.byUserId !== 'string') return null
  return { days: o.days as AutoHandoverDays, to: o.to, since: o.since, byUserId: o.byUserId }
}

/** What a save stores: the rule switched on (stamped with when and by whom), or off (null). */
export function parseAutoHandover(input: unknown, byUserId: string, now: Date = new Date()): { ok: true; value: AutoHandoverRule | null } | { ok: false; error: string } {
  if (input === null || input === false) return { ok: true, value: null }
  const o = asRecord(input)
  if (!o || !(AUTO_HANDOVER_DAYS as readonly number[]).includes(o.days as number) || (o.to !== 'lineups' && o.to !== 'autopilot')) {
    return { ok: false, error: 'Send { days: 7, 14 or 21, to: "lineups" or "autopilot" }, or null to turn it off.' }
  }
  return { ok: true, value: { days: o.days as AutoHandoverDays, to: o.to as AutoHandoverTarget, since: now.toISOString(), byUserId } }
}

export type HandoverCandidate = { rosterId: string; lastOwnActionAt: Date | null }

/**
 * The teams to hand over now: not already managed, and idle — since the later of the owner's last own
 * action and the moment the rule was switched on — for at least the chosen number of days.
 */
export function teamsToHandOver(args: { rule: AutoHandoverRule; candidates: readonly HandoverCandidate[]; managed: ManagedLineups; now: Date }): string[] {
  const since = Date.parse(args.rule.since)
  return args.candidates
    .filter((c) => !args.managed[c.rosterId])
    .filter((c) => {
      const idleFrom = Math.max(since, c.lastOwnActionAt ? c.lastOwnActionAt.getTime() : 0)
      return args.now.getTime() - idleFrom >= args.rule.days * DAY_MS
    })
    .map((c) => c.rosterId)
}

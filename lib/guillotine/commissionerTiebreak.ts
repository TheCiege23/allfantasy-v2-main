/**
 * "Commissioner decides" — the Guilly tiebreak step that used to do nothing (2026-11-15).
 *
 * 🛑 THE STEP WAS OFFERED, DEFAULTED INTO EVERY LEAGUE'S ORDER, AND NEVER ONCE CONSULTED. `resolveTiebreak` reads a
 * commissioner's picks (`commissionerChoppedRosterIds`), but neither caller of `runElimination` ever passed any, so a
 * tie that reached the step always fell straight through to the next one. A commissioner who moved it to the top of the
 * order was promised a decision they were never asked for.
 *
 * Now, when a chop's tie reaches the step and the commissioner has not picked:
 *   1. the chop WAITS — nothing about the week is written — for up to COMMISSIONER_TIEBREAK_WINDOW_MS;
 *   2. the commissioner is asked once (high-severity commissioner alert: bell, push, email, text if they opted in),
 *      with a link to /league/<id>/guillotine-tiebreak, where they pick who goes;
 *   3. the next score sync (every five minutes) chops the team they picked, and the league log records it;
 *   4. if the window passes unanswered, the league's NEXT tiebreak step decides, exactly as before this existed.
 *
 * Stored in `League.settings.guillotine_commissioner_tiebreaks`, one entry per season and week, written with
 * `jsonb_set` so concurrent writers cannot clobber other settings. No migration.
 *
 * ⚠ WAITERS ALSO WAIT. The week's waivers run after its chop (lib/guillotine/chopBeforeWaivers.ts), so a held chop
 * holds that run too — at most the window, which is why the window is hours, not days.
 *
 * Pure (no I/O) — the store and notifier live in ./commissionerTiebreakStore.ts.
 */

export const COMMISSIONER_TIEBREAKS_KEY = 'guillotine_commissioner_tiebreaks'
export const COMMISSIONER_TIEBREAK_WINDOW_MS = 12 * 60 * 60 * 1000

export type CommissionerTiebreakEntry = {
  /** The teams tied at the "Commissioner decides" step (engine roster ids). */
  tiedRosterIds: string[]
  /** How many of them are chopped. */
  needed: number
  requestedAt: string
  notifiedAt?: string
  decidedRosterIds?: string[]
  decidedAt?: string
  decidedBy?: string
}

export type CommissionerTiebreakState = 'none' | 'waiting' | 'decided' | 'expired'

export function tiebreakKey(season: number | null | undefined, week: number): string {
  return `${season ?? 'unknown'}:${week}`
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

export function readCommissionerTiebreak(settings: unknown, key: string): CommissionerTiebreakEntry | null {
  const all = isRecord(settings) ? settings[COMMISSIONER_TIEBREAKS_KEY] : null
  const raw = isRecord(all) ? all[key] : null
  if (!isRecord(raw)) return null
  const tiedRosterIds = strings(raw.tiedRosterIds)
  const needed = typeof raw.needed === 'number' && Number.isInteger(raw.needed) && raw.needed > 0 ? raw.needed : 0
  const requestedAt = typeof raw.requestedAt === 'string' && Number.isFinite(Date.parse(raw.requestedAt)) ? raw.requestedAt : null
  if (!tiedRosterIds.length || !needed || !requestedAt) return null
  const decided = strings(raw.decidedRosterIds)
  return {
    tiedRosterIds,
    needed,
    requestedAt,
    ...(typeof raw.notifiedAt === 'string' ? { notifiedAt: raw.notifiedAt } : {}),
    ...(decided.length ? { decidedRosterIds: decided } : {}),
    ...(typeof raw.decidedAt === 'string' ? { decidedAt: raw.decidedAt } : {}),
    ...(typeof raw.decidedBy === 'string' ? { decidedBy: raw.decidedBy } : {}),
  }
}

export function tiebreakState(entry: CommissionerTiebreakEntry | null, now: Date): CommissionerTiebreakState {
  if (!entry) return 'none'
  if (entry.decidedRosterIds?.length) return 'decided'
  return now.getTime() - Date.parse(entry.requestedAt) < COMMISSIONER_TIEBREAK_WINDOW_MS ? 'waiting' : 'expired'
}

export function decisionDeadline(entry: CommissionerTiebreakEntry): Date {
  return new Date(Date.parse(entry.requestedAt) + COMMISSIONER_TIEBREAK_WINDOW_MS)
}

/**
 * What the chop engine does about this week's entry:
 *   overrides — the commissioner's picks, handed to `resolveTiebreak`;
 *   mayWait   — whether a tie that reaches the step should hold the chop (no decision yet, window not over).
 */
export function engineTiebreakInputs(entry: CommissionerTiebreakEntry | null, now: Date): { overrides: string[]; mayWait: boolean } {
  const state = tiebreakState(entry, now)
  if (state === 'decided') return { overrides: entry!.decidedRosterIds!, mayWait: false }
  return { overrides: [], mayWait: state === 'none' || state === 'waiting' }
}

/** A commissioner's pick, checked against the tie it answers. */
export function validateTiebreakDecision(
  entry: CommissionerTiebreakEntry | null,
  rosterIds: unknown,
  now: Date,
): { ok: true; rosterIds: string[] } | { ok: false; error: string; status: number } {
  const state = tiebreakState(entry, now)
  if (state === 'none') return { ok: false, error: 'There is no tie waiting for your decision.', status: 404 }
  if (state === 'decided') return { ok: false, error: 'This tie has already been decided.', status: 409 }
  if (state === 'expired') return { ok: false, error: 'The time to decide has passed, so the next tiebreak rule decided it.', status: 409 }
  const picked = [...new Set(strings(rosterIds))]
  if (picked.length !== entry!.needed) {
    return { ok: false, error: entry!.needed === 1 ? 'Pick one team.' : `Pick ${entry!.needed} teams.`, status: 400 }
  }
  if (picked.some((id) => !entry!.tiedRosterIds.includes(id))) {
    return { ok: false, error: 'You can only pick from the teams tied for the chop.', status: 400 }
  }
  return { ok: true, rosterIds: picked }
}

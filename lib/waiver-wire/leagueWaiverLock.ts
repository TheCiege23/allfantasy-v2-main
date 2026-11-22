/**
 * ONE LOCK FOR EVERYTHING THAT DECIDES WHO OWNS A FREE AGENT IN A LEAGUE.
 *
 * Holders — every path that reads "who is rostered" and then writes a roster from that read:
 *   - waiver runs: `processWaiverClaimsForLeague` (native WaiverClaim), `processWaiverWindow`
 *     (RedraftWaiverClaim, hourly), `processNflRedraftWaiverWindow` (commissioner, waiver runtime);
 *   - instant free-agent adds: `executeImmediateAddDrop` (the add/drop route every waiver screen uses)
 *     and `addNflRedraftFreeAgent` (`/api/redraft/waiver-runtime` action `add_free_agent`).
 * A new path that awards or adds a free agent must take it too.
 *
 * A waiver run and an instant free-agent add both read "who is rostered" and then write a roster. Run concurrently they can put one player on two
 * rosters: the run awards him from its read while an add takes him from its own. Both now hold
 * `waiver:process:{leagueId}` for the whole read-decide-write, so they take turns.
 *
 *   - Busy: wait briefly for the holder, then give up. The caller decides what giving up means — a run
 *     leaves its claims pending, an instant add is refused with "try again".
 *   - The lock itself cannot be read (infrastructure): run anyway, loudly. A broken lock table must not
 *     stop every league's waivers and adds; the roster compare-and-set in the run still refuses a lost update.
 */
import { randomUUID } from 'crypto'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'

/** Long enough for the slowest league run; a crashed holder frees the league after this. */
const LOCK_TTL_MS = 10 * 60_000
const WAIT_ATTEMPTS = 8
const WAIT_MS = 750

export const leagueWaiverLockKey = (leagueId: string) => `waiver:process:${leagueId}`

/** Refusal for an instant add while a waiver run (or another add) holds the league's lock past the short wait. */
export const WAIVER_RUN_IN_PROGRESS_MESSAGE = 'Waivers are processing for this league right now. Try the add again in a moment.'

export async function withLeagueWaiverLock<T>(
  leagueId: string,
  label: string,
  fn: () => Promise<T>,
): Promise<{ ran: true; value: T } | { ran: false }> {
  const lockKey = leagueWaiverLockKey(leagueId)
  const owner = `${label}:${randomUUID()}`
  const acquire = () => acquireAutomationLock(lockKey, { owner, ttlMs: LOCK_TTL_MS })
  const busy = (r: { ok: boolean; reason?: string }) => !r.ok && String(r.reason ?? '').startsWith('Lock held')
  let lock = await acquire()
  for (let i = 0; i < WAIT_ATTEMPTS && busy(lock); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
    lock = await acquire()
  }
  if (!lock.ok) {
    if (busy(lock)) return { ran: false }
    console.warn(`[waiver-lock] league ${leagueId} (${label}): lock unavailable (${lock.reason}); proceeding without it`)
    return { ran: true, value: await fn() }
  }
  try {
    return { ran: true, value: await fn() }
  } finally {
    await releaseAutomationLock(lockKey, owner).catch(() => undefined)
  }
}

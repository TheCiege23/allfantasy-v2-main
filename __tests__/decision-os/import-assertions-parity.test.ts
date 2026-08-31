import { describe, it, expect } from 'vitest'

import { verdictFrom, IMPORT_SCOPES } from '@/lib/decision-os/import/assertions'

/**
 * `unchecked` must never collapse into `matched`.
 *
 * D16 lets Chimmy refuse the facts that rest on non-conclusive data. That only works if
 * "we checked and it agrees" is distinguishable from "we never checked". A default of `matched`
 * would be invisible — the verdict looks identical whether it was earned or assumed — and every
 * league that was never parity-checked would silently be reported as trustworthy.
 *
 * Parity runs for espn/yahoo/fantrax. A Sleeper league has never been checked at all.
 */
describe('verdictFrom — an unearned "matched" is the failure mode', () => {
  it('🛑 returns `unchecked` when nothing was ever recorded', () => {
    expect(verdictFrom(null, 0)).toBe('unchecked')
    expect(verdictFrom(null, 0)).not.toBe('matched')
  })

  it('returns `unchecked` for a status it does not recognise, rather than guessing', () => {
    expect(verdictFrom('locked', 0)).toBe('unchecked')
    expect(verdictFrom('skipped', 0)).toBe('unchecked')
    // A new syncStatus value added upstream must degrade to "we do not know", not to "fine".
    expect(verdictFrom('some_future_status', 0)).toBe('unchecked')
  })

  it('only says `matched` for a completed run with no failures', () => {
    expect(verdictFrom('completed', 0)).toBe('matched')
  })

  it('lets failures override even a completed status', () => {
    // A run can report `completed` on its last scope and still be failing repeatedly.
    expect(verdictFrom('completed', 3)).toBe('failed')
  })

  it('treats partial and failed as divergence, not absence', () => {
    expect(verdictFrom('partial', 0)).toBe('diverged')
    expect(verdictFrom('failed', 0)).toBe('diverged')
  })

  it('pins the scope list the freshness assertion reports on', () => {
    // If a scope is added to the collector and not here, its freshness silently stops being
    // reported while the league still looks fully covered.
    expect([...IMPORT_SCOPES]).toEqual(['league_state', 'teams_rosters', 'traded_picks'])
  })
})

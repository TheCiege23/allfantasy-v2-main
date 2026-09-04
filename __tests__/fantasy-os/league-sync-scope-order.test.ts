import { describe, expect, it } from 'vitest'

import { LEAGUE_SYNC_SCOPES } from '@/lib/fantasy-os/sync/collector/types'

/**
 * Pins the ORDER of LEAGUE_SYNC_SCOPES, not just its membership.
 *
 * The order is the whole behaviour here. `runner.ts` checks the elapsed clock BEFORE each scope
 * and never aborts one mid-flight, so a scope that starts before the deadline always finishes and
 * the scopes still queued behind an overrun are the ones dropped. Whichever scope sits LAST is
 * therefore the permanent casualty on every slow league.
 *
 * `traded_picks` used to be last. Measured 2026-09-04: 70 of 1284 fantasy-os-sleeper-sync runs in
 * 24h crossed the 240s budget, and every `partial` in production read
 * `incompleteScopes: ["traded_picks"]` — dynasty pick ownership going stale systematically.
 *
 * ⚠ WITHOUT THIS TEST NOTHING WOULD CATCH A REVERT. The order carries no type information (the
 * union `LeagueSyncScope` is identical whichever way round it goes), no test asserted it before
 * this one, and every suite stays green with the scopes in any order — the regression would only
 * appear as dynasty picks quietly going stale again in production, which is exactly how it went
 * unnoticed the first time.
 *
 * If a scope is ever added, the question to ask is not "where does it read best" but "can this
 * league afford for it to be the one dropped when the run overruns" — cheapest first, most
 * expensive last, so the expensive one still STARTS before the deadline and runs to completion.
 */
describe('LEAGUE_SYNC_SCOPES order', () => {
  it('runs traded_picks before teams_rosters, so it is not the permanent timeout casualty', () => {
    const order = [...LEAGUE_SYNC_SCOPES]
    expect(order.indexOf('traded_picks')).toBeLessThan(order.indexOf('teams_rosters'))
  })

  it('keeps league_state first — it establishes the League row the other scopes hang off', () => {
    expect(LEAGUE_SYNC_SCOPES[0]).toBe('league_state')
  })

  it('pins the exact order, so a reorder is a deliberate edit rather than a silent one', () => {
    expect([...LEAGUE_SYNC_SCOPES]).toEqual(['league_state', 'traded_picks', 'teams_rosters'])
  })

  it('still covers exactly the three scopes, with none dropped or duplicated', () => {
    expect(new Set(LEAGUE_SYNC_SCOPES).size).toBe(LEAGUE_SYNC_SCOPES.length)
    expect([...LEAGUE_SYNC_SCOPES].sort()).toEqual(['league_state', 'teams_rosters', 'traded_picks'])
  })
})

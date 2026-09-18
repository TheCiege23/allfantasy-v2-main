import { describe, expect, it } from 'vitest'

import { buildLockAlerts, LOCK_WARN_WINDOW_MS, type LockAlertGame } from '@/lib/live/lockAlerts'

/*
 * The "kicks off in 12m" warning on the live screens.
 *
 * ⚠ WHY THIS SUITE EXISTS. Almost every line of `buildLockAlerts` is a REFUSAL to
 * warn — untimeable kickoff, kickoff already passed, game already live, nobody of
 * yours in it, too far out. A refusal produces no output, so from the outside a
 * broken predicate and a quiet slate are the same thing: an empty array. The only
 * way to know the guards work is to hand each one its own input and watch it
 * decline, which is what the `does not warn` cases below are for.
 *
 * The counterpart matters just as much: a suite of only-negative cases passes with
 * the function stubbed to `return []`, so the positive case is the control that
 * proves the negatives mean something.
 */

const NOW = new Date('2026-09-17T17:00:00Z').getTime()

function game(over: Partial<LockAlertGame> = {}): LockAlertGame {
  return {
    gameId: 'g1',
    isLive: false,
    completed: false,
    // 20 minutes out: comfortably inside the warning window.
    startTime: new Date(NOW + 20 * 60_000).toISOString(),
    home: { abbrev: 'BUF' },
    away: { abbrev: 'KC' },
    tieIns: [{ leagueId: 'L1', leagueName: 'Dynasty', isStarter: false }],
    ...over,
  }
}

describe('buildLockAlerts', () => {
  it('warns about a game of yours that is about to kick off', () => {
    const [alert, ...rest] = buildLockAlerts([game()], NOW)
    expect(rest).toHaveLength(0)
    expect(alert!.matchup).toBe('KC @ BUF')
    expect(alert!.bench).toBe(1)
    expect(alert!.starters).toBe(0)
    expect(alert!.leagues).toEqual([
      { leagueId: 'L1', leagueName: 'Dynasty', starters: 0, bench: 1 },
    ])
  })

  /*
   * ⚠ THE PAYLOAD CARRIES AN ABSOLUTE INSTANT, NEVER "IN 20 MINUTES". A relative
   * figure is minted once and then served to every later reader and every poll, so
   * it is wrong by however long it sat there. Asserted here because the type alone
   * does not stop someone "helpfully" pre-formatting it.
   */
  it('reports kickoff as an absolute instant, not a relative one', () => {
    const [alert] = buildLockAlerts([game()], NOW)
    expect(alert!.kickoffAt).toBe(new Date(NOW + 20 * 60_000).toISOString())
  })

  it('counts starters and bench separately, per league', () => {
    const [alert] = buildLockAlerts(
      [
        game({
          tieIns: [
            { leagueId: 'L1', leagueName: 'Dynasty', isStarter: true },
            { leagueId: 'L1', leagueName: 'Dynasty', isStarter: false },
            { leagueId: 'L2', leagueName: 'Redraft', isStarter: true },
          ],
        }),
      ],
      NOW,
    )
    expect(alert!.starters).toBe(2)
    expect(alert!.bench).toBe(1)
    // Bench-heaviest league first: that is the decision still open.
    expect(alert!.leagues.map((l) => l.leagueName)).toEqual(['Dynasty', 'Redraft'])
  })

  it('does not warn about a game that has already kicked off', () => {
    const kickedOff = game({ startTime: new Date(NOW - 60_000).toISOString() })
    expect(buildLockAlerts([kickedOff], NOW)).toEqual([])
  })

  /*
   * ⚠ THE REGRESSION THIS EXISTS FOR. The feed lags: a game can be minutes into
   * the first quarter while its status still reads scheduled, so `isLive` is false
   * and only the clock can tell. Without the `at <= now` guard this renders "kicks
   * off in 0m" — telling someone they still have time to fix a lineup that locked
   * before they opened the page.
   */
  it('does not warn about a past kickoff whose status still says scheduled', () => {
    const lagging = game({
      isLive: false,
      completed: false,
      startTime: new Date(NOW - 12 * 60_000).toISOString(),
    })
    expect(buildLockAlerts([lagging], NOW)).toEqual([])
  })

  it('does not warn about a game already in progress', () => {
    expect(buildLockAlerts([game({ isLive: true })], NOW)).toEqual([])
  })

  it('does not warn about a completed game', () => {
    expect(buildLockAlerts([game({ completed: true })], NOW)).toEqual([])
  })

  it('does not warn about a game holding none of your players', () => {
    expect(buildLockAlerts([game({ tieIns: [] })], NOW)).toEqual([])
  })

  /*
   * ⚠ AN UNTIMEABLE KICKOFF IS SKIPPED, NOT GUESSED AT. `new Date('nonsense')` is
   * NaN, and every comparison against NaN is false — so this would be skipped even
   * with the explicit guard deleted. Asserted anyway: the guard documents the
   * intent, and this pins the behaviour so a later refactor that reorders the
   * checks (say, to a `Math.max(0, at - now)`) cannot start warning about it.
   */
  it('does not warn about a game it cannot place in time', () => {
    expect(buildLockAlerts([game({ startTime: 'not a date' })], NOW)).toEqual([])
  })

  it('does not warn about a kickoff beyond the window', () => {
    const later = game({
      startTime: new Date(NOW + LOCK_WARN_WINDOW_MS + 60_000).toISOString(),
    })
    expect(buildLockAlerts([later], NOW)).toEqual([])
  })

  /* The boundary belongs to the window: exactly one hour out still warns. */
  it('warns at the far edge of the window', () => {
    const edge = game({ startTime: new Date(NOW + LOCK_WARN_WINDOW_MS).toISOString() })
    expect(buildLockAlerts([edge], NOW)).toHaveLength(1)
  })

  it('orders by soonest kickoff, regardless of input order', () => {
    const soon = game({
      gameId: 'soon',
      startTime: new Date(NOW + 5 * 60_000).toISOString(),
      away: { abbrev: 'NYJ' },
    })
    const later = game({
      gameId: 'later',
      startTime: new Date(NOW + 40 * 60_000).toISOString(),
      away: { abbrev: 'MIA' },
    })
    expect(buildLockAlerts([later, soon], NOW).map((a) => a.gameId)).toEqual(['soon', 'later'])
  })
})

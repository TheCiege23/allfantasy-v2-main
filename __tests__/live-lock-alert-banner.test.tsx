import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { LockAlertBanner } from '@/components/live/LiveScoresClient'
import type { LiveLockAlert } from '@/lib/live/lockAlerts'

/*
 * The lineup-lock banner on /live.
 *
 * ⚠ THIS SUITE COVERS THE CLAIMS THE BUILDER'S SUITE CANNOT. `buildLockAlerts`
 * decides WHICH games are worth warning about, once, on the server. Everything
 * here is about what happens to that list AFTERWARDS — as it ages in an open tab,
 * and before the browser has a clock at all. Those are the two states where a
 * warning turns into a lie, and neither is reachable from the builder.
 */

const NOW = new Date('2026-09-17T17:00:00Z').getTime()

function alert(over: Partial<LiveLockAlert> = {}): LiveLockAlert {
  return {
    gameId: 'g1',
    matchup: 'KC @ BUF',
    kickoffAt: new Date(NOW + 20 * 60_000).toISOString(),
    leagues: [{ leagueId: 'L1', leagueName: 'Dynasty', starters: 0, bench: 2 }],
    starters: 0,
    bench: 2,
    ...over,
  }
}

describe('LockAlertBanner', () => {
  it('states the countdown and the exposure', () => {
    const { container } = render(<LockAlertBanner alerts={[alert()]} now={NOW} />)
    expect(container.textContent).toContain('KC @ BUF')
    expect(container.textContent).toContain('kicks off in 20m')
    expect(container.textContent).toContain('2 benched')
    expect(container.textContent).toContain('Dynasty')
  })

  /*
   * ⚠ THE SECOND BELT, AND THE REASON IT IS NOT REDUNDANT. The builder applies the
   * same rule when the payload is BUILT. This applies it when the payload is READ.
   * A tab left open for half an hour is holding a list whose window expired, and
   * counting one of those down tells someone they still have time to change a
   * lineup that locked before they looked. Deleting this filter breaks nothing that
   * the builder's suite can see.
   */
  it('drops a kickoff that has passed since the payload was built', () => {
    const stale = alert({ kickoffAt: new Date(NOW - 60_000).toISOString() })
    const { container } = render(<LockAlertBanner alerts={[stale]} now={NOW} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing at all when every alert has expired', () => {
    const stale = alert({ kickoffAt: new Date(NOW - 1).toISOString() })
    const { container } = render(<LockAlertBanner alerts={[stale]} now={NOW} />)
    expect(container.querySelector('section')).toBeNull()
  })

  /* Before mount there is no clock, so there is no countdown to state. */
  it('makes no claim before the clock exists', () => {
    const { container } = render(<LockAlertBanner alerts={[alert()]} now={null} />)
    expect(container.textContent).toBe('')
  })

  it('makes no claim for an unparseable kickoff', () => {
    const { container } = render(
      <LockAlertBanner alerts={[alert({ kickoffAt: 'not a date' })]} now={NOW} />,
    )
    expect(container.textContent).toBe('')
  })

  /*
   * ⚠ THE WORDING IS LOAD-BEARING, NOT COPY POLISH. We know kickoff; we do NOT know
   * any league's lineup lock rule (`matchupLockAt` is null everywhere in this repo,
   * and `lineupLockRule` is frequently unset). A banner that said "locks in 20m"
   * would be stating a time we never measured, and would be flatly wrong for any
   * league on a weekly lock.
   */
  it('says "kicks off", never "locks", and warns that weekly leagues may be closed', () => {
    const { container } = render(<LockAlertBanner alerts={[alert()]} now={NOW} />)
    const text = container.textContent ?? ''
    expect(text).toContain('kicks off in')
    expect(text).not.toMatch(/locks in/)
    expect(text).toContain('lock weekly may already be closed')
  })

  /*
   * ⚠ AND IT MUST SAY WHERE TO GO. AllFantasy cannot write a lineup back to any
   * platform we import — Sleeper's API is read-only — so a warning without this
   * line tells someone to hurry and not where.
   */
  it('names the platform as the place to act', () => {
    const { container } = render(<LockAlertBanner alerts={[alert()]} now={NOW} />)
    expect(container.textContent).toContain('Change it on your platform')
    expect(container.textContent).toContain('cannot set your lineup for you')
  })

  it('pluralises the heading on more than one closing decision', () => {
    const { container } = render(
      <LockAlertBanner
        alerts={[alert(), alert({ gameId: 'g2', matchup: 'NYJ @ MIA' })]}
        now={NOW}
      />,
    )
    expect(container.textContent).toContain('2 lineup decisions closing')
  })

  /*
   * ⚠ REGRESSION. `lockAlerts` is a required field, so this is unreachable through
   * the type — and it was reached anyway, by two suites whose payload fixtures
   * predate it, taking the entire scoreboard down with `undefined.map`. Tests are
   * never typechecked in this repo, so nothing else can catch this shape.
   */
  it('survives a payload with no lockAlerts at all rather than unmounting the page', () => {
    const { container } = render(
      <LockAlertBanner alerts={undefined as unknown as LiveLockAlert[]} now={NOW} />,
    )
    expect(container.textContent).toBe('')
  })
})

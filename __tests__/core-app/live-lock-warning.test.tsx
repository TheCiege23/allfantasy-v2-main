import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { LockWarning } from '@/components/core-app/screens/LiveScores'
import type { LiveLockAlert } from '@/lib/live/lockAlerts'

/*
 * The lineup-lock warning on /core/live — the CANONICAL live surface.
 *
 * ⚠ THIS SUITE EXISTS BECAUSE THE FIRST PASS TESTED THE WRONG SCREEN. `/live` and
 * `/core/live` are parallel implementations that duplicate their presentation on
 * purpose (separate cards, separate empty states, separate CSS vocabularies), and
 * the banner was duplicated with them. Covering only `/live`'s copy left the screen
 * users actually open asserting nothing — so the two could drift apart, and the one
 * that drifted would be the one nobody was watching.
 *
 * The claims below are deliberately the SAME claims `live-lock-alert-banner.test.tsx`
 * makes about `/live`. That duplication is the point: it is what stops one surface
 * quietly losing the honesty constraints the other keeps.
 */

const NOW = new Date('2026-09-18T17:00:00Z').getTime()

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

describe('LockWarning on /core/live', () => {
  it('states the countdown and the exposure', () => {
    const { container } = render(<LockWarning alerts={[alert()]} now={NOW} />)
    expect(container.textContent).toContain('KC @ BUF')
    expect(container.textContent).toContain('kicks off in 20m')
    expect(container.textContent).toContain('2 benched')
    expect(container.textContent).toContain('Dynasty')
  })

  /*
   * ⚠ THE SECOND BELT, APPLIED WHEN THE PAYLOAD IS READ RATHER THAN BUILT. On this
   * screen the list is rebuilt from `scopedGames` on every tick, so this filter is
   * the thing that makes an alert expire on screen rather than counting a passed
   * kickoff down to "0m".
   */
  it('drops a kickoff that has passed', () => {
    const { container } = render(
      <LockWarning alerts={[alert({ kickoffAt: new Date(NOW - 60_000).toISOString() })]} now={NOW} />,
    )
    expect(container.textContent).toBe('')
  })

  it('makes no claim before the clock exists', () => {
    const { container } = render(<LockWarning alerts={[alert()]} now={null} />)
    expect(container.textContent).toBe('')
  })

  it('makes no claim for an unparseable kickoff', () => {
    const { container } = render(
      <LockWarning alerts={[alert({ kickoffAt: 'not a date' })]} now={NOW} />,
    )
    expect(container.textContent).toBe('')
  })

  /*
   * ⚠ THE WORDING IS LOAD-BEARING ON THIS SCREEN TOO. We know kickoff; we do not
   * know any league's lock rule. "locks in 20m" would state a time never measured
   * and would be flatly wrong for a weekly-lock league.
   */
  it('says "kicks off", never "locks", and warns that weekly leagues may be closed', () => {
    const { container } = render(<LockWarning alerts={[alert()]} now={NOW} />)
    const text = container.textContent ?? ''
    expect(text).toContain('kicks off in')
    expect(text).not.toMatch(/locks in/)
    expect(text).toContain('lock weekly may already be closed')
  })

  it('names the platform as the place to act', () => {
    const { container } = render(<LockWarning alerts={[alert()]} now={NOW} />)
    expect(container.textContent).toContain('Change it on your platform')
    expect(container.textContent).toContain('cannot set your lineup for you')
  })

  /*
   * ⚠ THE CLASS NAMES ARE THE CONTRACT WITH `af-live.css`. This screen styles by
   * class, not inline style, so a renamed class is a silently unstyled banner —
   * it still renders, still says the right words, and looks like plain text on the
   * page background. Nothing else in the suite would notice.
   */
  it('carries the af-live-lock hooks the stylesheet targets', () => {
    const { container } = render(<LockWarning alerts={[alert()]} now={NOW} />)
    expect(container.querySelector('.af-live-lock')).not.toBeNull()
    expect(container.querySelector('.af-live-lock-head')).not.toBeNull()
    expect(container.querySelector('.af-live-lock-row')).not.toBeNull()
    expect(container.querySelector('.af-live-lock-time')).not.toBeNull()
    expect(container.querySelector('.af-live-lock-foot')).not.toBeNull()
  })

  it('pluralises the heading on more than one closing decision', () => {
    const { container } = render(
      <LockWarning alerts={[alert(), alert({ gameId: 'g2', matchup: 'NYJ @ MIA' })]} now={NOW} />,
    )
    expect(container.textContent).toContain('2 lineup decisions closing')
  })
})

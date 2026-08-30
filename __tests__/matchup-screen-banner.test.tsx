import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData } from '@/lib/core-app/matchup'

/*
 * The head-to-head banner, over the state it is in for most of a fantasy week.
 *
 * ⚠ WHY THIS SUITE EXISTS. `sides` is unavailable until someone scores a point,
 * on purpose — a 0-0 row is a scheduled week, not a result. The banner used to
 * render from `sides` alone, so between the schedule landing and the first
 * kickoff this screen showed one grey sentence and no crests at all. Measured
 * 2026-08-30 on the account this was built against: 48 leagues with a fixture,
 * ZERO with a scored week, so that was every league on the account.
 *
 * The fix splits identity (`teams`) from score (`sides`). What must hold either
 * way: both crests are on screen, and a projected total is never rendered as
 * though it were a score.
 */

const CREST_YOU = 'https://sleepercdn.com/avatars/thumbs/aaa'
const CREST_THEM = 'https://sleepercdn.com/avatars/thumbs/bbb'

function data(over: Partial<MatchupData> = {}): MatchupData {
  return {
    league: {
      id: 'l1',
      name: '33 1/3% Active',
      platform: 'sleeper',
      logoUrl: null,
      sourceLink: null,
    },
    week: { available: true, data: { week: 1, season: 2026, isFinal: false } },
    teams: {
      available: true,
      data: {
        you: {
          teamName: 'TheCiege24',
          ownerName: 'ciege',
          record: '0-0',
          isYou: true,
          avatarUrl: CREST_YOU,
        },
        opponent: {
          teamName: 'Rookie Fever',
          ownerName: 'robertkks',
          record: '0-0',
          isYou: false,
          avatarUrl: CREST_THEM,
        },
      },
    },
    sides: {
      available: false,
      reason:
        'week 1 is on file but nothing has been scored — this is an unplayed week, not a 0-0 game',
    },
    lineups: { available: false, reason: 'no lineups' },
    identityNote: null,
    playerScoring: { available: false, reason: 'no per-player scoring' },
    winProbability: { available: false, reason: 'no probability' },
    projectedFinal: {
      available: true,
      data: { you: 224.5, opponent: 161.7, unprojected: { you: 0, opponent: 0 } },
    },
    yetToPlay: { available: false, reason: 'no game state' },
    ...over,
  }
}

/** Both manager crests, as `<img src>` — the thing that used to vanish. */
function crests(container: HTMLElement): string[] {
  return [...container.querySelectorAll('img.af-mu-crest--img')].map(
    (n) => n.getAttribute('src') ?? '',
  )
}

describe('Matchup banner — unplayed week', () => {
  it('still shows both manager crests when nothing has been scored', () => {
    const { container } = render(<Matchup data={data()} />)
    expect(crests(container)).toEqual([CREST_YOU, CREST_THEM])
    expect(screen.getByText('TheCiege24')).toBeTruthy()
    expect(screen.getByText('Rookie Fever')).toBeTruthy()
  })

  it('shows the projected finals, each labelled as a projection', () => {
    const { container } = render(<Matchup data={data()} />)
    const totals = [...container.querySelectorAll('.af-mu-score')]
    expect(totals.map((n) => n.textContent)).toEqual(['224.5', '161.7'])
    /*
     * ⚠ THE LABEL IS THE WHOLE POINT. A projection rendered identically to a
     * score is indistinguishable from one, and this banner is the largest type
     * on the screen.
     */
    for (const n of totals) expect(n.getAttribute('data-basis')).toBe('projected')
    expect(container.querySelectorAll('.af-mu-score-tag')).toHaveLength(2)
  })

  it('says the margin is projected, not a lead', () => {
    render(<Matchup data={data()} />)
    expect(screen.getByText(/Projected ahead by/)).toBeTruthy()
    expect(screen.queryByText(/^You lead by/)).toBeNull()
  })

  it('keeps the unscored-week reason on screen', () => {
    render(<Matchup data={data()} />)
    expect(screen.getByText(/this is an unplayed week, not a 0-0 game/)).toBeTruthy()
  })

  /*
   * Priced neither way: no scored total and nothing projectable. The banner must
   * say it has no number rather than printing 0.0, which would be a claim.
   */
  it('renders a dash, not a zero, when there is nothing to show either way', () => {
    const { container } = render(
      <Matchup data={data({ projectedFinal: { available: false, reason: 'nothing to project' } })} />,
    )
    expect([...container.querySelectorAll('.af-mu-score')].map((n) => n.textContent)).toEqual([
      '—',
      '—',
    ])
    expect(screen.getByText('No margin yet')).toBeTruthy()
    expect(container.querySelectorAll('.af-mu-score-tag')).toHaveLength(0)
  })
})

describe('Matchup banner — scored week', () => {
  const scored = data({
    week: { available: true, data: { week: 3, season: 2026, isFinal: true } },
    sides: {
      available: true,
      data: {
        you: {
          teamName: 'TheCiege24',
          ownerName: 'ciege',
          record: '2-0',
          points: 131.4,
          isYou: true,
          avatarUrl: CREST_YOU,
        },
        opponent: {
          teamName: 'Rookie Fever',
          ownerName: 'robertkks',
          record: '1-1',
          points: 118.2,
          isYou: false,
          avatarUrl: CREST_THEM,
        },
      },
    },
  })

  it('shows the scored totals with no projection label', () => {
    const { container } = render(<Matchup data={scored} />)
    const totals = [...container.querySelectorAll('.af-mu-score')]
    expect(totals.map((n) => n.textContent)).toEqual(['131.4', '118.2'])
    for (const n of totals) expect(n.getAttribute('data-basis')).toBe('scored')
    expect(container.querySelectorAll('.af-mu-score-tag')).toHaveLength(0)
  })

  /*
   * ⚠ THE SCORED MARGIN IS MEASURED OFF THE SCORES, NOT THE PROJECTIONS. Both
   * pairs are present here and they disagree about who is ahead — the fixture
   * projects 224.5–161.7 while the actual is 131.4–118.2 — so a banner reading
   * the wrong pair is visible rather than merely possible.
   */
  it('measures the margin off the scores while a projection is also on file', () => {
    render(<Matchup data={scored} />)
    expect(screen.getByText(/You lead by/)).toBeTruthy()
    expect(screen.getByText(/13\.2/)).toBeTruthy()
  })

  it('drops the unscored-week caption once there is a score', () => {
    const { container } = render(<Matchup data={scored} />)
    expect(container.querySelector('.af-mu-basis')).toBeNull()
  })
})

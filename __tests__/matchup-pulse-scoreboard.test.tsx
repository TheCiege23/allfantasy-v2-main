import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { MatchupPulseBoard } from '@/components/core-app/MatchupPulseBoard'
import type { MatchupPulse, PulseRow } from '@/lib/core-app/matchupPulse'

/*
 * 2026-10-02 visual pass on /core/matchup (no league). The week's headline — how many leagues you
 * are ahead in against how many you are behind in — was 11px text at the end of a rule. It is now
 * a scoreboard with a split bar, and every row carries a bar sized against the board's biggest
 * margin.
 */

function row(over: Partial<PulseRow> = {}): PulseRow {
  return {
    leagueId: 'l1', leagueName: 'Dynasty Warriors', platform: 'sleeper', logoUrl: null, leagueBadge: 'DW',
    opponentName: 'G', opponentLabel: 'G', opponentAvatarUrl: null, opponentInitials: 'G',
    margin: 10, basis: 'scored', season: 2026, week: 4, final: false, startersLeft: 6, coverage: null,
    href: '/core/matchup?league=l1', ...over,
  }
}

function pulse(over: Partial<MatchupPulse> = {}): MatchupPulse {
  return {
    leading: [], trailing: [], considered: 3, ranked: 3, basis: 'scored', allFinal: false,
    notRanked: { noSchedule: 0, noOpponent: 0, unpriceable: 0, uncomparable: 0, unidentifiedRoster: 0 },
    ...over,
  } as MatchupPulse
}

const board = (p: MatchupPulse) => render(<MatchupPulseBoard pulse={p} allHref="/core/matchup?all=1" totalLeagues={3} />)

describe('week scoreboard', () => {
  it('states leading against trailing, with the split drawn to scale', () => {
    const { container } = board(pulse({
      leading: [row({ leagueId: 'a', margin: 40 }), row({ leagueId: 'b', margin: 5 })],
      trailing: [row({ leagueId: 'c', margin: -20 })],
      leadingTotal: 21, trailingTotal: 7,
    }))
    expect([...container.querySelectorAll('.af-mp-score-n')].map((n) => n.textContent)).toEqual(['21', '7'])
    expect((container.querySelector('.af-mp-split-good') as HTMLElement).style.width).toBe('75%')
  })

  it('says won/lost once the whole week is final', () => {
    const { container } = board(pulse({ leading: [row()], trailing: [row({ leagueId: 'c', margin: -3 })], allFinal: true }))
    expect([...container.querySelectorAll('.af-mp-score-word')].map((n) => n.textContent)).toEqual(['won', 'lost'])
  })

  it('is absent when nothing is ranked', () => {
    const { container } = board(pulse({ ranked: 0 }))
    expect(container.querySelector('.af-mp-score')).toBeNull()
  })
})

describe('margin bars', () => {
  it('sizes each row against the biggest margin on the board, with a visible floor', () => {
    const { container } = board(pulse({
      leading: [row({ leagueId: 'a', margin: 40 }), row({ leagueId: 'b', margin: 0.2 })],
      trailing: [row({ leagueId: 'c', margin: -20, basis: 'projected' })],
    }))
    const widths = [...container.querySelectorAll('.af-mp-bar')].map((n) => (n as HTMLElement).style.width)
    expect(widths).toEqual(['100%', '4%', '50%'])
    const rows = [...container.querySelectorAll('a.af-mp-row')]
    expect(rows[2].getAttribute('data-basis')).toBe('projected')
    expect(rows[2].getAttribute('aria-label')).toMatch(/behind by 20\.0 \(projected\)/)
  })
})

/*
 * Ranked by win probability (matchupPulse.ts). The board must name the columns for what they now
 * measure, keep a margin's OWN sign when it disagrees with its column, and show the odds.
 */
describe('odds on the board', () => {
  const friday = () =>
    pulse({
      leading: [row({ leagueId: 'fav', margin: 4, basis: 'projected', pWin: 0.71, projectedMargin: 4 })],
      /* Up 30.9 on Friday, projected to lose: an underdog with a positive margin. */
      trailing: [row({ leagueId: 'dog', margin: 30.9, basis: 'scored', pWin: 0.2, projectedMargin: -37.5 })],
      closest: [row({ leagueId: 'flip', margin: -0.4, basis: 'projected', pWin: 0.49, projectedMargin: -0.4 })],
      leadingTotal: 1, trailingTotal: 1, ranked: 3, withOdds: 3, expectedWins: 1.4,
    } as Partial<MatchupPulse>)

  it('names the columns Favoured / Underdog when the board has odds', () => {
    const { container } = board(friday())
    expect([...container.querySelectorAll('.af-mp-col-head')].map((n) => n.textContent)).toEqual([
      'Favoured · top 5', 'Underdog · bottom 5', 'Closest games · worth watching',
    ])
  })

  it('🛑 keeps a +30.9 positive and green under Underdog, and says where it is heading', () => {
    const { container } = board(friday())
    const dog = container.querySelector('a[href="/core/matchup?league=l1"][data-tone="bad"]')!
    expect(dog.querySelector('.af-mp-diff')?.textContent).toBe('+30.9')
    expect(dog.querySelector('.af-mp-diff')?.getAttribute('data-tone')).toBe('good')
    expect(dog.querySelector('.af-mp-meta')?.textContent).toMatch(/proj final −37\.5/)
    expect(dog.querySelector('.af-mp-ring-n')?.textContent).toBe('20')
  })

  it('states the expected record', () => {
    const { container } = board(friday())
    expect(container.querySelector('.af-mp-expected-n')?.textContent).toBe('1.4–1.6')
  })

  it('lists the closest games under the columns', () => {
    const { container } = board(friday())
    expect(container.querySelectorAll('.af-mp-closest a.af-mp-row')).toHaveLength(1)
    expect(container.querySelector('.af-mp-closest .af-mp-diff')?.textContent).toBe('−0.4')
  })

  it('shows no ring on a finished row — it is a result, not odds', () => {
    const { container } = board(pulse({ leading: [row({ final: true, pWin: 1, projectedMargin: 12 })], withOdds: 1, expectedWins: 1 } as Partial<MatchupPulse>))
    expect(container.querySelector('.af-mp-ring')).toBeNull()
  })

  it('CONTROL: a board with no odds keeps the margin words', () => {
    const { container } = board(pulse({ leading: [row()], trailing: [row({ leagueId: 'c', margin: -3 })] }))
    expect(container.querySelector('.af-mp-col-head')?.textContent).toBe('Leading · top 5')
    expect(container.querySelector('.af-mp-expected')).toBeNull()
  })
})

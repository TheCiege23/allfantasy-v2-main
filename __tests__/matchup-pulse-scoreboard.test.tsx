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

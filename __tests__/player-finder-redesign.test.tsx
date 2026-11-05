/**
 * Player Finder redesign: a position chip on every match, chips that filter the matches by position,
 * and on a phone the open player as a sheet with a way back to the results.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>
      {children}
    </a>
  ),
}))

import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import { matchPositions } from '@/components/core-app/player-finder/MatchPositionFilter'
import type { PlayerDetail, PlayerMatch } from '@/lib/core-app/playerFinder'

const m = (externalId: string, name: string, position: string | null, team: string): PlayerMatch =>
  ({ externalId, sleeperId: null, name, position, team, imageUrl: null, number: null, rosteredIn: null, platforms: [], sport: 'NFL' }) as PlayerMatch

const MATCHES: PlayerMatch[] = [
  m('1', 'Josh Allen', 'QB', 'BUF'),
  m('2', 'Josh Jacobs', 'RB', 'GB'),
  m('3', 'Josh Downs', 'WR', 'IND'),
  m('4', 'Josh Palmer', 'wr', 'BUF'),
]

const DETAIL = {
  player: { ...MATCHES[1], rosteredIn: 1, platforms: ['sleeper'] },
  identityResolved: true,
  bio: { height: null, weight: null, age: 28, college: null },
  injury: { available: false, reason: 'none' },
  seasonStats: { available: false, reason: 'none' },
  leagues: { available: false, reason: 'none' },
  projection: { available: false, reason: 'none' },
  game: { available: false, reason: 'none' },
  kickoffs: {},
  scheduleWeek: null,
  kickoffsUnresolved: 0,
  snapShare: { available: false, reason: 'none' },
  positionRank: { available: false, reason: 'none' },
  impact: { available: false, reason: 'none' },
  recommendedMoves: { available: false, reason: 'none' },
  freshness: { label: '1m ago', stale: false },
  rosterCoverage: { unmatched: [] },
} as unknown as PlayerDetail

const NOW = '2026-11-07T15:00:00.000Z'

describe('matchPositions', () => {
  it('lists each position once, in the order the matches carry them', () => {
    expect(matchPositions([...MATCHES, m('5', 'No Pos', null, 'FA')])).toEqual(['QB', 'RB', 'WR'])
  })
})

describe('Player Finder · matches', () => {
  it('puts a position chip on every match', () => {
    const { container } = render(<PlayerFinder query="Josh" matches={MATCHES} detail={null} leagueCount={2} nowIso={NOW} />)
    const chips = [...container.querySelectorAll('.af-pf-match-list .af-pf-match-pos')]
    expect(chips.map((c) => c.textContent)).toEqual(['QB', 'RB', 'WR', 'wr'])
    // The sport-correct tone My team uses: an NFL running back is green.
    expect(chips[1]?.getAttribute('data-rd-pos')).toBe('green')
  })

  it('narrows the matches to one position, and All brings them back', () => {
    render(<PlayerFinder query="Josh" matches={MATCHES} detail={null} leagueCount={2} nowIso={NOW} />)
    const filter = screen.getByRole('group', { name: 'Filter the 4 matches by position' })
    const names = () => [...document.querySelectorAll('.af-pf-match-list .af-pf-match-name')].map((n) => n.textContent)

    fireEvent.click(within(filter).getByRole('button', { name: 'WR' }))
    expect(names()).toEqual(['Josh Downs', 'Josh Palmer'])
    expect(within(filter).getByRole('button', { name: 'WR' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(filter).getByRole('button', { name: 'All' }))
    expect(names()).toEqual(['Josh Allen', 'Josh Jacobs', 'Josh Downs', 'Josh Palmer'])
  })

  it('offers no filter when every match plays one position', () => {
    render(<PlayerFinder query="Josh" matches={MATCHES.slice(2)} detail={null} leagueCount={2} nowIso={NOW} />)
    expect(screen.queryByRole('group', { name: /by position/ })).toBeNull()
  })
})

describe('Player Finder · the phone sheet', () => {
  it('opens a signed-in player as a sheet with a way back to the results', () => {
    const { container } = render(<PlayerFinder query="Josh" matches={MATCHES} detail={DETAIL} leagueCount={2} nowIso={NOW} />)
    expect(container.querySelector('.af-pf')?.getAttribute('data-sheet')).toBe('true')
    expect(container.querySelector('.af-pf-psheet')?.getAttribute('data-open')).toBe('true')
    expect(screen.getByRole('link', { name: '← Back to results' })).toHaveAttribute('href', '/core/players?q=Josh')
    // The player and the decision column both ride in the sheet.
    expect(container.querySelector('.af-pf-psheet .af-pf-main')).not.toBeNull()
  })

  it('keeps the league in the way back', () => {
    render(<PlayerFinder query="Josh" matches={MATCHES} detail={DETAIL} leagueCount={2} selectedLeagueId="L1" nowIso={NOW} />)
    expect(screen.getByRole('link', { name: '← Back to results' })).toHaveAttribute('href', '/core/players?q=Josh&league=L1')
  })

  it('is no sheet on the public player page, which has nothing behind it', () => {
    const { container } = render(
      <PlayerFinder query="" matches={[]} detail={DETAIL} leagueCount={0} signedIn={false} nowIso={NOW} />,
    )
    expect(container.querySelector('.af-pf')?.hasAttribute('data-sheet')).toBe(false)
    expect(screen.queryByRole('link', { name: '← Back to results' })).toBeNull()
  })
})

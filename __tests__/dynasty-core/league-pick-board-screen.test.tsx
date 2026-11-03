/** The Dynasty Era pick ledger on the dynasty tab ("All Teams’ Picks"). */
import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const modal = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
vi.mock('@/app/league/[leagueId]/tabs/ProposeTradeModal', () => ({
  ProposeTradeModal: (props: Record<string, unknown>) => {
    modal.props = props
    return <div data-testid="propose-trade-modal-stub" />
  },
}))
const chimmy = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@/lib/dashboard/open-chimmy-with-prompt', () => ({ openChimmyWithPrompt: chimmy.open }))

import { LeaguePickBoard } from '@/components/dynasty/LeaguePickBoard'
import { buildLeaguePickBoard, type BoardPickInput } from '@/lib/dynasty-core/leaguePickBoard'

const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response
afterEach(() => {
  vi.unstubAllGlobals()
  chimmy.open.mockReset()
  modal.props = null
})

const own = (season: number, round: number, id: string): BoardPickInput => ({ season, round, ownerRosterId: id, originalRosterId: id })

function twoTeamBoard() {
  return buildLeaguePickBoard({
    teams: [{ rosterId: 'a', name: 'Aces' }, { rosterId: 'b', name: 'Bears' }],
    picks: [
      own(2027, 1, 'a'),
      { season: 2027, round: 1, ownerRosterId: 'a', originalRosterId: 'b' },
      own(2027, 2, 'b'),
    ],
    seasons: [2027],
    rounds: 2,
    coverage: 'complete',
    viewerRosterId: 'b',
  })
}

describe('LeaguePickBoard (pick ledger)', () => {
  it('shows each team’s picks as chips: gold first-rounders, where acquired picks came from, what was traded away', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ board: twoTeamBoard(), trade: { platform: 'manual', sport: 'NFL' } })))
    render(<LeaguePickBoard leagueId="L1" />)
    await screen.findByTestId('league-pick-board')
    expect(screen.getByRole('heading', { name: 'Pick ledger' })).toBeTruthy()

    const rows = screen.getAllByTestId('pick-ledger-row')
    // The viewer first, highlighted.
    expect(rows[0]!.getAttribute('data-viewer')).toBe('true')
    expect(within(rows[0]!).getByText('You')).toBeTruthy()
    expect(rows[1]!.getAttribute('data-viewer')).toBe('false')

    const aces = rows[1]!
    const chips = within(aces).getAllByRole('listitem')
    expect(chips.map((c) => c.getAttribute('data-round'))).toEqual(['1', '1'])
    expect(within(aces).getByText('via Bears')).toBeTruthy()
    expect(within(aces).getByTestId('pick-ledger-held').textContent).toContain('2 first-rounders')

    const bears = rows[0]!
    const traded = within(bears).getAllByRole('listitem').find((c) => c.getAttribute('data-traded') === 'true')!
    expect(traded.textContent).toContain('R1 → Aces')
    expect(within(bears).getByTestId('pick-ledger-held').textContent).toContain('0 first-rounders')
  })

  it('opens the league’s own trade builder with the league’s platform', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ board: twoTeamBoard(), trade: { platform: 'sleeper', sport: 'NFL' } })))
    render(<LeaguePickBoard leagueId="L1" />)
    fireEvent.click(await screen.findByTestId('pick-ledger-propose'))
    await screen.findByTestId('propose-trade-modal-stub')
    expect(modal.props).toMatchObject({ open: true, leagueId: 'L1', platform: 'sleeper', sport: 'NFL' })
  })

  it('says who has gathered the most firsts only when one team strictly leads, and offers Chimmy', async () => {
    const board = buildLeaguePickBoard({
      teams: [{ rosterId: 'a', name: 'Aces' }, { rosterId: 'b', name: 'Bears' }],
      picks: [own(2027, 1, 'a'), { season: 2027, round: 1, ownerRosterId: 'a', originalRosterId: 'b' }],
      seasons: [2027],
      rounds: 1,
      coverage: 'complete',
      viewerRosterId: 'a',
    })
    vi.stubGlobal('fetch', vi.fn(async () => json({ board })))
    render(<LeaguePickBoard leagueId="L1" />)
    const line = await screen.findByTestId('pick-ledger-insight')
    expect(line.textContent).toContain('Most first-rounders: Aces, with 2 across the next 1 drafts.')
    fireEvent.click(within(line).getByRole('button', { name: /Ask Chimmy/ }))
    expect(chimmy.open).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', source: 'trade' }))
  })

  it('says nothing when no team has gathered extra firsts', async () => {
    const even = buildLeaguePickBoard({
      teams: [{ rosterId: 'a', name: 'Aces' }, { rosterId: 'b', name: 'Bears' }],
      picks: [own(2027, 1, 'a'), own(2027, 1, 'b')],
      seasons: [2027],
      rounds: 1,
      coverage: 'complete',
      viewerRosterId: null,
    })
    vi.stubGlobal('fetch', vi.fn(async () => json({ board: even })))
    render(<LeaguePickBoard leagueId="L1" />)
    await screen.findByTestId('league-pick-board')
    expect(screen.queryByTestId('pick-ledger-insight')).toBeNull()
    // Not a team in this league: no trade entry.
    expect(screen.queryByTestId('pick-ledger-propose')).toBeNull()
  })

  it('shows only the next three drafts', async () => {
    const board = buildLeaguePickBoard({
      teams: [{ rosterId: 'a', name: 'Aces' }],
      picks: [own(2027, 1, 'a'), own(2028, 1, 'a'), own(2029, 1, 'a'), own(2030, 1, 'a')],
      seasons: [2027, 2028, 2029, 2030],
      rounds: 1,
      coverage: 'complete',
      viewerRosterId: 'a',
    })
    vi.stubGlobal('fetch', vi.fn(async () => json({ board })))
    render(<LeaguePickBoard leagueId="L1" />)
    const row = (await screen.findAllByTestId('pick-ledger-row'))[0]!
    expect(within(row).getAllByRole('listitem')).toHaveLength(3)
    expect(within(row).getByTestId('pick-ledger-held').textContent).toContain('3 first-rounders')
    expect(screen.queryByText('2030 draft')).toBeNull()
  })

  it('hides totals when only traded picks are known, and says why', async () => {
    const board = buildLeaguePickBoard({
      teams: [{ rosterId: 'a', name: 'Aces' }, { rosterId: 'b', name: 'Bears' }],
      picks: [{ season: 2028, round: 2, ownerRosterId: 'a', originalRosterId: 'b' }],
      seasons: [2028],
      rounds: null,
      coverage: 'traded_only',
      viewerRosterId: 'a',
    })
    vi.stubGlobal('fetch', vi.fn(async () => json({ board })))
    render(<LeaguePickBoard leagueId="L1" />)
    expect(await screen.findByTestId('pick-ledger-traded-only')).toBeTruthy()
    expect(screen.queryAllByTestId('pick-ledger-held')).toHaveLength(0)
    expect(screen.queryByTestId('pick-ledger-insight')).toBeNull()
  })

  it('says so when the league tracks no future picks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ board: null, reason: 'no_picks_tracked' })))
    render(<LeaguePickBoard leagueId="L1" />)
    expect(await screen.findByTestId('pick-board-none')).toBeTruthy()
  })
})

import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { WaiversBoardList, WaiversDueSoon } from '@/components/core-app/boards/WaiversBoardList'
import { WaiverLineupBoard } from '@/components/core-app/WaiverLineupBoard'

/**
 * The 2026-10-02 Waivers features, rendered: the cross-league board's sort / filter / show-all, and
 * the league screen's bid, roster-needs strip and rolling-priority line.
 */

describe('WaiversBoardList', () => {
  /* Gain order (Zebra, Middle, Alpha) is the REVERSE of name order, so a sort that does nothing fails. */
  const items = [
    { key: 'a', gain: 9, leagueName: 'Zebra League', position: 'WR', schedule: null },
    { key: 'b', gain: 3, leagueName: 'Alpha League', position: 'RB', schedule: null },
    { key: 'c', gain: 6, leagueName: 'Middle League', position: 'WR', schedule: null },
  ]
  const cards = Object.fromEntries(items.map((i) => [i.key, <article key={i.key}>{i.leagueName}</article>]))
  const order = () =>
    within(screen.getByTestId('waivers-board-list'))
      .getAllByRole('article')
      .map((a) => a.textContent)

  it('ranks by gain by default, and re-sorts by league name on request', () => {
    render(<WaiversBoardList items={items} cards={cards} />)
    expect(order()).toEqual(['Zebra League', 'Middle League', 'Alpha League'])
    fireEvent.change(screen.getByTestId('waivers-board-sort'), { target: { value: 'league' } })
    expect(order()).toEqual(['Alpha League', 'Middle League', 'Zebra League'])
    fireEvent.change(screen.getByTestId('waivers-board-sort'), { target: { value: 'gain' } })
    expect(order()).toEqual(['Zebra League', 'Middle League', 'Alpha League'])
  })

  it('filters to the position of the add', () => {
    render(<WaiversBoardList items={items} cards={cards} />)
    fireEvent.click(screen.getByRole('radio', { name: 'WR' }))
    expect(order()).toEqual(['Zebra League', 'Middle League'])
  })

  it('shows the first N and reveals the rest on request', () => {
    render(<WaiversBoardList items={items} cards={cards} initial={2} />)
    expect(order()).toHaveLength(2)
    fireEvent.click(screen.getByTestId('waivers-board-show-all'))
    expect(order()).toHaveLength(3)
  })

  it('does not offer a deadline sort when no league has a schedule on file', () => {
    render(<WaiversBoardList items={items} cards={cards} />)
    const options = within(screen.getByTestId('waivers-board-sort')).getAllByRole('option').map((o) => o.textContent)
    expect(options).not.toContain('Next waiver run')
  })
})

describe('WaiversDueSoon', () => {
  afterEach(() => vi.useRealTimers())

  it('lists only leagues whose waivers run within 24 hours, soonest first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    /* Wednesday 2026-09-30 06:00 UTC. */
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 6, 0)))
    render(
      <WaiversDueSoon
        leagues={[
          { key: 'far', leagueName: 'Runs Sunday', href: '/a', schedule: { dayOfWeek: 0, timeUtc: '09:00' } },
          { key: 'soon', leagueName: 'Runs in 3h', href: '/b', schedule: { dayOfWeek: 3, timeUtc: '09:00' } },
          { key: 'later', leagueName: 'Runs tomorrow', href: '/c', schedule: { dayOfWeek: 4, timeUtc: '02:00' } },
        ]}
      />,
    )
    const strip = await screen.findByTestId('waivers-due-soon')
    const names = within(strip).getAllByRole('link').map((a) => a.textContent)
    expect(names).toEqual(['Runs in 3h', 'Runs tomorrow'])
    expect(strip.textContent).toContain('in 3h 0m')
  })

  it('renders nothing when no league runs in the next 24 hours', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 30, 6, 0)))
    const { container } = render(
      <WaiversDueSoon leagues={[{ key: 'far', leagueName: 'Runs Sunday', href: '/a', schedule: { dayOfWeek: 0, timeUtc: '09:00' } }]} />,
    )
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})

describe('WaiverLineupBoard — bid, needs, priority', () => {
  afterEach(() => vi.unstubAllGlobals())

  const board = {
    state: 'ok', season: '2026', week: 5, currentLineupPoints: 110,
    candidates: [
      { sleeperId: '1', name: 'Top Add', position: 'RB', team: 'KC', projectedPoints: 14, gain: 6.1, displaces: null, basis: 'projection' },
      { sleeperId: '2', name: 'Next Add', position: 'WR', team: 'SF', projectedPoints: 12, gain: 5.8, displaces: null, basis: 'projection' },
    ],
    notes: [],
    needs: {
      week: 5,
      emptySlots: ['FLEX'],
      noBackup: [{ position: 'RB', rostered: 2, starting: 2 }],
      byes: [{ week: 6, players: [{ id: 'r1', name: 'Rb Starter', position: 'RB', team: 'BUF', starter: true }] }],
    },
  }
  const stubFetch = (intel: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (String(url).includes('waiver-intel') ? intel : board),
      })) as never,
    )

  it('prints the Waiver intelligence bid beside an add it can price, and says when it is over budget', async () => {
    stubFetch({ supported: true, intel: { bidQuotes: { '1': 30, '2': 8 } } })
    render(<WaiverLineupBoard leagueId="lg-bid" faab={{ remaining: 20 }} />)
    await waitFor(() => expect(screen.getByText(/bid ~\$8/)).toBeTruthy())
    expect(screen.getByText(/bid ~\$30 · over your \$20 left/)).toBeTruthy()
  })

  it('prints no bid at all on a league that is not FAAB, and never asks for one', async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => board }))
    vi.stubGlobal('fetch', f as never)
    render(<WaiverLineupBoard leagueId="lg-nofaab" />)
    await waitFor(() => expect(screen.getByTestId('waiver-lineup-board')).toBeTruthy())
    expect(screen.queryByText(/bid ~/)).toBeNull()
    expect(f.mock.calls.some((c) => String(c[0]).includes('waiver-intel'))).toBe(false)
  })

  it('shows what the roster needs: empty slots, no backup, a starter on bye', async () => {
    stubFetch({ supported: false, platform: 'espn' })
    render(<WaiverLineupBoard leagueId="lg-needs" />)
    const strip = await screen.findByTestId('waiver-roster-needs')
    expect(strip.textContent).toContain('FLEX')
    expect(strip.textContent).toContain('No RB backup')
    expect(strip.textContent).toContain('Bye wk 6')
    expect(strip.textContent).toContain('Rb Starter (RB)')
  })

  it('on rolling priority, states what a claim costs and the gap to the next-best add', async () => {
    stubFetch({ supported: false, platform: 'espn' })
    render(<WaiverLineupBoard leagueId="lg-roll" rollingPriority={{ priority: 2, leagueRosters: 12 }} />)
    const line = await screen.findByTestId('waiver-priority-cost')
    expect(line.textContent).toContain('#2 of 12')
    expect(line.textContent).toContain('sends you to #12')
    expect(line.textContent).toContain('0.3-point gap')
  })
})

/**
 * Swipe between players on the player card (2026-11-27).
 *
 * The list is read off the screen: the other `PlayerName` buttons in the tapped name's scope, in
 * on-screen order. Mounted here as a real roster of names under the real provider and sheet.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/core-app/highlights/PlayerRecentClips', () => ({ default: () => null }))
vi.mock('@/components/core-app/player-card/PlayerHighlights', () => ({ default: () => null }))
vi.mock('@/components/core-app/player-card/PlayerValueHistoryChart', () => ({ PlayerValueHistoryChart: () => null }))

import PlayerCardProvider from '@/components/core-app/player-card/PlayerCardProvider'
import PlayerName from '@/components/core-app/player-card/PlayerName'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

const NO = (reason: string) => ({ available: false as const, reason })
const ROSTER = [
  { id: '101', name: 'Ava Center' },
  { id: '102', name: 'Ben Wing' },
  { id: '103', name: 'Cal Defense' },
]

function card(id: string): PlayerCardData {
  const who = ROSTER.find((r) => r.id === id) ?? { id, name: `Player ${id}` }
  return {
    context: 'universal',
    player: { externalId: id, source: 'rolling_insights', sleeperId: null, sport: 'NHL', name: who.name, position: 'C', team: 'SEA', number: null, imageUrl: null },
    bio: { age: null, height: null, weight: null, yearsExp: null, college: null },
    market: NO('none'),
    // Two tabs (Outlook, News) so the tab-keeping rule has something to keep.
    ownership: { available: true, data: { ownPct: 0.5, startPct: null, leaguesCounted: 10 } },
    schedule: NO('none'),
    byeWeek: null,
    trades: NO('none'),
    comps: NO('none'),
    news: { available: true, data: [{ title: `${who.name} news`, source: 'espn', url: null, publishedAt: null }] },
    injury: NO('none'),
    injuryFeed: NO('none'),
    insight: null,
    league: null,
  } as unknown as PlayerCardData
}

let cardCalls: string[] = []

beforeEach(() => {
  cardCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://x')
      if (url.pathname === '/api/core/player-card') {
        const id = url.searchParams.get('externalId') ?? ''
        cardCalls.push(id)
        return new Response(JSON.stringify(card(id)), { status: 200 })
      }
      if (url.pathname === '/api/core/player-card/more') return new Response(JSON.stringify({ gameLog: [], career: [], depthChart: null }))
      if (url.pathname === '/api/players/game-log') return new Response(JSON.stringify({ supported: true, groups: [], seasons: [], season: null }))
      return new Response('{}')
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Screen({ extra }: { extra?: React.ReactNode }) {
  return (
    <PlayerCardProvider>
      <main>
        <ul>
          {ROSTER.map((p) => (
            <li key={p.id}>
              <PlayerName sport="NHL" externalId={p.id} name={p.name} />
            </li>
          ))}
        </ul>
        {extra}
      </main>
    </PlayerCardProvider>
  )
}

async function openName(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
  await screen.findByTestId('player-card')
}

const heading = () => screen.getByRole('heading', { level: 2 }).textContent

describe('swipe between players', () => {
  it('opens on the tapped player and steps through the screen in order with the arrows', async () => {
    render(<Screen />)
    await openName('Ben Wing')
    expect(screen.getByTestId('player-card-nav').textContent).toContain('2 of 3')

    fireEvent.click(screen.getByTestId('player-card-next'))
    await waitFor(() => expect(heading()).toBe('Cal Defense'))
    expect(cardCalls.at(-1)).toBe('103')
    expect(screen.getByTestId('player-card-nav').textContent).toContain('3 of 3')
    expect((screen.getByTestId('player-card-next') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByTestId('player-card-prev'))
    await waitFor(() => expect(heading()).toBe('Ben Wing'))
    expect(screen.getByLabelText('Previous player: Ava Center')).toBeTruthy()
  })

  it('moves with the arrow keys', async () => {
    render(<Screen />)
    await openName('Ava Center')
    fireEvent.keyDown(screen.getByTestId('player-card'), { key: 'ArrowRight' })
    await waitFor(() => expect(heading()).toBe('Ben Wing'))
    fireEvent.keyDown(screen.getByTestId('player-card'), { key: 'ArrowLeft' })
    await waitFor(() => expect(heading()).toBe('Ava Center'))
  })

  it('a horizontal swipe moves; a vertical drag does not', async () => {
    render(<Screen />)
    await openName('Ava Center')
    const panel = screen.getByTestId('player-card')

    fireEvent.touchStart(panel, { touches: [{ clientX: 200, clientY: 300 }] })
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 190, clientY: 120 }] })
    await act(async () => {})
    expect(heading()).toBe('Ava Center')

    fireEvent.touchStart(panel, { touches: [{ clientX: 300, clientY: 300 }] })
    fireEvent.touchEnd(panel, { changedTouches: [{ clientX: 120, clientY: 310 }] })
    await waitFor(() => expect(heading()).toBe('Ben Wing'))
  })

  it('keeps the tab you are on while swiping', async () => {
    render(<Screen />)
    await openName('Ava Center')
    const newsTab = await screen.findByRole('tab', { name: /news/i })
    fireEvent.click(newsTab)
    expect(newsTab.getAttribute('aria-selected')).toBe('true')

    fireEvent.click(screen.getByTestId('player-card-next'))
    await waitFor(() => expect(heading()).toBe('Ben Wing'))
    await waitFor(() => expect(screen.getByRole('tab', { name: /news/i }).getAttribute('aria-selected')).toBe('true'))
  })

  it('counts a player rendered twice once, and has no arrows for a lone name', async () => {
    const { unmount } = render(<Screen extra={<PlayerName sport="NHL" externalId="102" name="Ben Wing again" />} />)
    await openName('Ava Center')
    expect(screen.getByTestId('player-card-nav').textContent).toContain('1 of 3')
    unmount()

    render(
      <PlayerCardProvider>
        <main>
          <PlayerName sport="NHL" externalId="900" name="Solo Player" />
        </main>
      </PlayerCardProvider>,
    )
    await openName('Solo Player')
    expect(screen.queryByTestId('player-card-nav')).toBeNull()
  })

  it('a marked list scopes the swipe to itself', async () => {
    render(
      <PlayerCardProvider>
        <main>
          <section data-af-pc-list="">
            <PlayerName sport="NHL" externalId="101" name="Ava Center" />
            <PlayerName sport="NHL" externalId="102" name="Ben Wing" />
          </section>
          <aside>
            <PlayerName sport="NHL" externalId="777" name="Elsewhere Guy" />
          </aside>
        </main>
      </PlayerCardProvider>,
    )
    await openName('Ben Wing')
    expect(screen.getByTestId('player-card-nav').textContent).toContain('2 of 2')
  })
})

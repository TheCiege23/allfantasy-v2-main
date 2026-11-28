/**
 * The player card's Game log tab for the daily sports (2026-11-27).
 *
 * NHL / NBA / NCAAB / MLB / soccer show the per-game box log from /api/players/game-log. The card's
 * rule is "a tab is hidden, never empty", so the tab appears only once that read returns games —
 * and football keeps the points table fed by `more.gameLog`.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('@/components/core-app/highlights/PlayerRecentClips', () => ({ default: () => null }))
vi.mock('@/components/core-app/player-card/PlayerHighlights', () => ({ default: () => null }))
vi.mock('@/components/core-app/player-card/PlayerValueHistoryChart', () => ({ PlayerValueHistoryChart: () => null }))

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import { gameLogColumns } from '@/lib/player-game-log/gameLogColumns'

const NO = (reason: string) => ({ available: false as const, reason })

function card(player: Partial<PlayerCardData['player']>): PlayerCardData {
  return {
    context: 'universal',
    player: { externalId: '4321', source: 'rolling_insights', sleeperId: null, sport: 'NHL', name: 'Test Skater', position: 'C', team: 'SEA', number: 19, imageUrl: null, ...player },
    bio: { age: 26, height: null, weight: null, yearsExp: 5, college: null },
    market: NO('none'),
    ownership: NO('none'),
    schedule: NO('none'),
    byeWeek: null,
    trades: NO('none'),
    comps: NO('none'),
    news: NO('none'),
    injury: NO('none'),
    injuryFeed: NO('none'),
    insight: null,
    league: null,
  } as PlayerCardData
}

const withGames = {
  supported: true,
  resolved: true,
  season: 2026,
  seasons: [2026],
  groups: [{
    group: 'skaters',
    label: 'Skater',
    columns: gameLogColumns('NHL', 'skaters'),
    rows: [{
      gameId: 'g1:skaters', date: '2026-11-26', opponent: 'DAL', home: true, teamScore: 4, oppScore: 2, result: 'W',
      postseason: false, played: true, ratioInputs: {},
      values: { toi: 18.5, g: 1, a: 0, pts: 1, plusminus: 1, sog: 3, ppp: 0, shp: 0, hits: 2, blks: 1, pim: 0, fow: 7 },
    }],
  }],
}

function stub(gameLog: unknown) {
  const fetchMock = vi.fn(async (url: string) => {
    const body = String(url).startsWith('/api/players/game-log') ? gameLog : { gameLog: [], career: [], depthChart: null }
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function mount(data: PlayerCardData) {
  return render(
    <PlayerCardSheet subject={{ sport: data.player.sport, externalId: data.player.externalId, name: data.player.name }} data={data} status="ready" more={{ gameLog: [], career: [], depthChart: null }} onClose={() => {}} onOpen={() => {}} />,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('player card Game log tab — daily sports', () => {
  it('shows the tab once the box log has games, with the final score and time on ice', async () => {
    const fetchMock = stub(withGames)
    mount(card({}))
    const tab = await screen.findByRole('tab', { name: /game log/i })
    fireEvent.click(tab)
    expect(await screen.findByText(/4-2/)).toBeTruthy()
    expect(screen.getAllByText('18:30').length).toBeGreaterThan(0)
    // One request for the log: the card's prefetch is handed to the table, not repeated.
    const logCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('/api/players/game-log'))
    expect(logCalls).toHaveLength(1)
    expect(String(logCalls[0][0])).toContain('externalId=4321')
    expect(String(logCalls[0][0])).toContain('source=rolling_insights')
  })

  it('hides the tab when the player has no games stored', async () => {
    const fetchMock = stub({ ...withGames, groups: [] })
    mount(card({}))
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/players/game-log'))).toBe(true))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('tab', { name: /game log/i })).toBeNull()
  })

  it('does not ask for a box log for a football player', async () => {
    const fetchMock = stub(withGames)
    mount(card({ sport: 'NFL', sleeperId: '4046', source: 'sleeper' }))
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/players/game-log'))).toBe(false)
  })
})

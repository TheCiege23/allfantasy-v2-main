/**
 * The draft room's player card shows the box-score game log for NHL / NBA / MLB / soccer, scored
 * on the draft's league (Yahoo 2026: "No more game logs … I had a separate window open to Fantrax
 * to see Game Logs or Ice Times").
 */
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/app/draft-room/PlayerAvatar', () => ({ PlayerAvatar: () => null }))

import { PlayerDetailModal } from '@/components/app/draft-room/PlayerDetailModal'

const calls: string[] = []
beforeEach(() => {
  calls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string) => {
      calls.push(String(u))
      return { ok: true, json: async () => ({ supported: true, resolved: true, season: 2026, seasons: [2026], groups: [] }) }
    }),
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const card = (sport: string, id: string, position = 'C') => (
  <PlayerDetailModal open onClose={() => {}} player={{ id, name: 'Example Player', position, team: 'COL' }} sport={sport} scoringLeagueId="lg-9" />
)

describe('draft player card: box-score game log', () => {
  it('NHL: asks for the Rolling Insights player, scored on the draft league, with his position', async () => {
    render(card('NHL', '41234'))
    expect(screen.getByTestId('draft-player-box-log')).toBeTruthy()
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/players/game-log'))).toBe(true))
    const u = calls.find((c) => c.startsWith('/api/players/game-log'))!
    expect(u).toContain('sport=NHL')
    expect(u).toContain('externalId=41234')
    expect(u).toContain('source=rolling_insights')
    expect(u).toContain('leagueId=lg-9')
    expect(u).toContain('position=C')
  })

  it('NFL keeps its own weekly log, and an id that is not a provider id asks for nothing', () => {
    render(card('NFL', '4046', 'QB'))
    expect(screen.queryByTestId('draft-player-box-log')).toBeNull()
    cleanup()
    render(card('NHL', 'name:Example Player:C:COL'))
    expect(screen.queryByTestId('draft-player-box-log')).toBeNull()
  })
})

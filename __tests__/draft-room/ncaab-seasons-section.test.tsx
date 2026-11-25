// @vitest-environment jsdom
/**
 * The college basketball seasons and game log on the player card (NcaabSeasonsSection): what a
 * manager reads in place of "Game logs for NCAAB coming soon."
 */
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NcaabSeasonsSection, NcaabSeasonsView, formatNcaabGameDate, ncaabGamesNote } from '@/components/app/draft-room/NcaabSeasonsSection'
import type { NcaabGameLine, NcaabPlayerSeasons, NcaabSeasonSummary } from '@/lib/players/ncaabPlayerSeasons'

const game = (over: Partial<NcaabGameLine> = {}): NcaabGameLine => ({
  season: 2026, date: '2026-11-20', team: 'UCF', opponent: 'VAN', postseason: false, minutes: 36, points: 30, rebounds: 7,
  assists: 4, steals: 2, blocks: 1, turnovers: 3, threesMade: 4, threesAttempted: 9, fieldGoalsMade: 10, fieldGoalsAttempted: 19,
  freeThrowsMade: 6, freeThrowsAttempted: 7, ...over,
})
const season = (over: Partial<NcaabSeasonSummary> = {}): NcaabSeasonSummary => ({
  season: 2026, label: '2026–27', games: 6, postseasonGames: 0, team: 'UCF',
  perGame: { minutes: 35, points: 29, rebounds: 4.2, assists: 3.5, steals: 1.5, blocks: 0.3, turnovers: 2.8, threesMade: 3.2 },
  fieldGoalPct: 0.512, threePointPct: 0.4, freeThrowPct: null, ...over,
})
const data: NcaabPlayerSeasons = {
  seasons: [season(), season({ season: 2025, label: '2025–26', games: 34, postseasonGames: 3, team: 'BEL', perGame: { ...season().perGame, points: 14.5 } })],
  games: [
    game(),
    game({ date: '2026-11-17', opponent: 'MSST', points: 26 }),
    game({ season: 2025, date: '2026-03-20', team: 'BEL', opponent: 'DUKE', points: 11, postseason: true }),
  ],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('NcaabSeasonsView', () => {
  it('opens on the newest season: its per-game line, its games, and how many games it covers', () => {
    render(<NcaabSeasonsView data={data} />)

    expect(screen.getByTestId('ncaab-season-tab-2026').getAttribute('aria-pressed')).toBe('true')
    const summary = screen.getByTestId('ncaab-season-summary')
    expect(summary.textContent).toContain('Per game for UCF · 6 games')
    expect(within(summary).getByText('29.0')).toBeTruthy()
    expect(within(summary).getByText('51.2%')).toBeTruthy()
    // No free throw attempts: a dash, never 0%.
    expect(within(summary).getByText('FT%').parentElement!.textContent).toBe('FT%—')
    expect(within(summary).getByText('3P%').parentElement!.textContent).toBe('3P%40.0%')

    const rows = within(screen.getByTestId('ncaab-game-log')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Nov 20VAN3630'),
      expect.stringContaining('Nov 17MSST3626'),
    ])
    expect(rows[0]!.textContent).toContain('10-19')
    expect(rows[0]!.textContent).toContain('6-7')
  })

  it('switches to last season, with its own team, postseason count and games', () => {
    render(<NcaabSeasonsView data={data} />)

    fireEvent.click(screen.getByTestId('ncaab-season-tab-2025'))

    expect(screen.getByTestId('ncaab-season-tab-2025').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('ncaab-season-summary').textContent).toContain('Per game for BEL · 34 games, 3 in the postseason')
    const rows = within(screen.getByTestId('ncaab-game-log')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('Mar 20')
    expect(rows[0]!.textContent).toContain('DUKE')
    expect(rows[0]!.textContent).toContain('Postseason')
  })

  it('shows a dash for minutes the vendor never recorded, not a zero', () => {
    render(<NcaabSeasonsView data={{
      seasons: [season({ perGame: { ...season().perGame, minutes: null } })],
      games: [game({ minutes: 0, points: 9 })],
    }} />)

    expect(within(screen.getByTestId('ncaab-season-summary')).getByText('MIN').parentElement!.textContent).toBe('MIN—')
    const cells = within(screen.getByTestId('ncaab-game-log')).getAllByRole('row')[1]!.querySelectorAll('td')
    expect(cells[2]!.textContent).toBe('—')
    expect(cells[3]!.textContent).toBe('9')
  })

  it('says so when no games are stored, instead of an empty table', () => {
    render(<NcaabSeasonsView data={{ seasons: [], games: [] }} />)

    expect(screen.getByTestId('ncaab-seasons-empty').textContent).toBe('No games are stored for this player yet.')
    expect(screen.queryByTestId('ncaab-game-log')).toBeNull()
  })
})

describe('NcaabSeasonsSection', () => {
  it('loads the player by id and shows his seasons', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => data }))
    vi.stubGlobal('fetch', fetchMock)

    render(<NcaabSeasonsSection playerId="11119" open />)

    expect(screen.getByTestId('ncaab-seasons-loading')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('ncaab-seasons')).toBeTruthy())
    expect(fetchMock).toHaveBeenCalledWith('/api/players/ncaab-seasons?playerId=11119')
  })

  it('says the stats could not be loaded when the read fails, rather than "no games"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'x' }) })))

    render(<NcaabSeasonsSection playerId="11119" open />)

    await waitFor(() => expect(screen.getByTestId('ncaab-seasons-error')).toBeTruthy())
    expect(screen.queryByTestId('ncaab-seasons-empty')).toBeNull()
  })

  it('asks for nothing without an id the store can look up', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    render(<NcaabSeasonsSection playerId={null} open />)

    expect(screen.getByTestId('ncaab-seasons-empty')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('labels', () => {
  it('formats a game date without shifting the day', () => {
    expect(formatNcaabGameDate('2026-11-01')).toBe('Nov 1')
    expect(formatNcaabGameDate('2026-03-31')).toBe('Mar 31')
    expect(formatNcaabGameDate(null)).toBe('—')
    expect(formatNcaabGameDate('garbage')).toBe('—')
  })

  it('counts games in words', () => {
    expect(ncaabGamesNote({ games: 1, postseasonGames: 0 })).toBe('1 game')
    expect(ncaabGamesNote({ games: 6, postseasonGames: 0 })).toBe('6 games')
    expect(ncaabGamesNote({ games: 34, postseasonGames: 3 })).toBe('34 games, 3 in the postseason')
  })
})

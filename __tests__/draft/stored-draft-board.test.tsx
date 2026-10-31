import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HistoricalDraftBoard } from '@/components/league/HistoricalDraftBoard'
import { MockDraftSessionBoard } from '@/components/mock-draft/MockDraftSessionBoard'
import LegacyRoom from '@/app/af-legacy/components/mock-draft/DraftRoom'

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('stored and legacy board coverage', () => {
  it('shows stored mock session picks on the canonical board', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ draft: {
      id: 'session', status: 'completed', updatedAt: '',
      settings: { sport: 'NHL', draftType: 'linear', numTeams: 2, rounds: 2, timerSeconds: 30 },
      slotConfig: [{ slot: 1, displayName: 'Alpha', type: 'human' }, { slot: 2, displayName: 'Beta', type: 'cpu' }],
      results: [{ overall: 3, round: 2, pick: 1, slot: 1, manager: 'Alpha', playerName: 'Example Center', position: 'C' }],
    } }))))
    render(<MockDraftSessionBoard draftId="session" />)
    const cell = await screen.findByTestId('draft-board-cell-3')
    expect(cell).toHaveTextContent('Example Center')
    expect(cell).toHaveAttribute('data-owner-roster', '1')
    expect(screen.getByTestId('draft-board-round-2-direction')).toHaveAttribute('data-direction', 'forward')
    const recentPick = screen.getByTestId('mock-draft-session-pick-0')
    expect(recentPick.querySelector('[data-draft-player-card]')?.parentElement?.tagName).toBe('UL')
  })

  it('keeps unqualified historical provider IDs as text without inventing a headshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ seasons: [{ year: 2025, picks: [
      { draftId: 'history', season: 2025, round: 1, pickNumber: 1, playerId: 'provider-123', managerId: 'owner' },
    ] }] }))))
    render(<HistoricalDraftBoard leagueId="history" season={2025} />)
    const cell = await screen.findByTestId('draft-board-cell-1')
    expect(cell).toHaveTextContent('provider-123')
    expect(cell.querySelector('img')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Pick 1' })).toBeTruthy()
  })

  it('resumes forward in round four of a 3RR legacy mock on both responsive boards', () => {
    const noop = () => {}
    const now = Date.now()
    const managers = [{ id: 'one', displayName: 'Alpha', draftSlot: 1 }, { id: 'two', displayName: 'Beta', draftSlot: 2 }]
    render(<LegacyRoom leagueName="Legacy" username="Alpha" leagues={[]} selectedLeagueId="league"
      onLeagueChange={noop} draftType="both" onDraftTypeChange={noop} draftRounds={4} onDraftRoundsChange={noop}
      secondsPerPick={60} onSecondsPerPickChange={noop} draftFormat="snake" onDraftFormatChange={noop}
      enable3RR onEnable3RRChange={noop} draftStartedAt={now} onStartDraft={noop} onResetDraft={noop}
      timerNow={now} managers={managers} onRandomizeOrder={noop} onMakePick={noop} availablePlayers={[]}
      nflPoolLoading={false} draftPicks={[1, 2, 3, 4, 5, 6].map(overall => ({ overall, round: Math.ceil(overall / 2),
        slot: [1, 2, 2, 1, 2, 1][overall - 1]!, manager: [1, 4, 6].includes(overall) ? 'Alpha' : 'Beta',
        playerName: `Player ${overall}`, position: 'RB', pickedAt: new Date(now).toISOString() }))} />)
    expect(screen.getAllByTestId('draft-board-cell-7')).toHaveLength(2)
    for (const cell of screen.getAllByTestId('draft-board-cell-7')) {
      expect(cell).toHaveAttribute('data-current', 'true')
      expect(cell).toHaveAttribute('data-owner-roster', 'one')
    }
  })
})

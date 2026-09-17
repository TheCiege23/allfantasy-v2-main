import React from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import SeasonOutlookLeague from '@/components/core-app/screens/SeasonOutlookLeague'
import SeasonOutlook from '@/components/core-app/screens/SeasonOutlook'
import { slimOutlookForBoard } from '@/lib/core-app/outlookCopy'
import type { OutlookLeague, OutlookTeam, SeasonOutlook as Board, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import type { OutlookFocus } from '@/lib/core-app/seasonOutlookFocus'

function team(id: string, over: Partial<OutlookTeam> = {}): OutlookTeam {
  return {
    rosterId: id,
    name: `Team ${id}`,
    isYou: false,
    wins: 2,
    losses: 1,
    pointsFor: 330,
    seed: Number(id),
    playoffPct: 50,
    byePct: 12,
    titlePct: 10,
    missPct: 50,
    range: { playoff: { lo: 40, hi: 61 }, bye: { lo: 8, hi: 16 }, title: { lo: 7, hi: 13 } },
    status: null,
    modelled: true,
    weeksFitted: 30,
    weeklyMean: 110,
    expectedWins: 1.8,
    schedule: {
      pastOpponentMu: 112,
      remainingOpponentMu: 108,
      pastRank: 2,
      remainingRank: 4,
      leagueMu: 110,
      pastGames: 3,
      remainingGames: 5,
    },
    ...over,
  }
}

const you = team('3', { isYou: true, playoffPct: 63.4, titlePct: 14.2, byePct: 21, missPct: 36.6 })

const focus: OutlookFocus = {
  scenario: {
    leagueId: 'L1',
    basisWeek: { season: '2026', week: 4 },
    refusal: null,
    slots: ['QB', 'RB'],
    teams: [
      { rosterId: '3', name: 'Team 3', isYou: true, players: [] },
      { rosterId: '1', name: 'Team 1', isYou: false, players: [] },
    ],
    freeAgents: [],
    sim: {
      teams: ['1', '2', '3', '4'].map((id) => ({ rosterId: id, wins: 2, losses: 1, pointsFor: 330, profile: { mu: 110, sigma: 20, n: 30 } })),
      remaining: [
        { week: 4, a: '3', b: '1' },
        { week: 4, a: '2', b: '4' },
      ],
      playoffTeams: 2,
      byeTeams: 0,
    },
    seed: 3,
    weeks: [4],
    youRosterId: '3',
  },
  drivers: [
    { key: 'schedule', label: 'Remaining schedule', detail: '4th hardest of 4.', impact: -6.2, spread: false },
    { key: 'swing', label: 'Week 4 vs Team 1', detail: 'Win and you are at 80%.', impact: 12, spread: true },
    { key: 'strength', label: 'Your scoring', detail: 'Above average.', impact: 3.1, spread: false },
    { key: 'byes', label: 'Bye weeks', detail: 'Week 7.', impact: -1.4, spread: false },
  ],
  moves: [
    {
      key: 'lineup-4',
      kind: 'lineup',
      title: 'Set your best lineup for week 4',
      detail: 'Start A over B.',
      week: 4,
      pointsPerWeek: 3.5,
      playoffDelta: 2.4,
      titleDelta: 0.6,
      href: '/core/my-team?league=L1',
    },
  ],
  durability: null,
  branchIterations: 2000,
  notes: [],
}

const swing: SwingMatchup = {
  leagueId: 'L1',
  leagueName: 'Test League',
  week: 4,
  opponentName: 'Team 1',
  ifWin: 80,
  ifLose: 44,
  swing: 36,
  clinchOnWin: false,
  helpIfLose: [],
}

function league(over: Partial<OutlookLeague> = {}): OutlookLeague {
  return {
    leagueId: 'L1',
    leagueName: 'Test League',
    platform: 'sleeper',
    season: 2026,
    weeksRemaining: 5,
    playoffTeams: 4,
    byeTeams: 2,
    you,
    teams: [team('1'), team('2'), you, team('4', { modelled: false })],
    whatDecidesIt: 'Get to 6 wins — 4 of your last 5 — and you are in nine times in ten.',
    href: '/core?league=L1',
    milestones: {
      totalGames: 8,
      winsForLikely: 5,
      winsForSafe: 6,
      cutWinsMedian: 5,
      cutWinsLow: 4,
      cutWinsHigh: 6,
      cutPointsMedian: 880,
      cutPointsLow: 820,
      cutPointsHigh: 940,
      projectedWins: 5,
      projectedPoints: 890,
      oddsByWins: [null, null, 0, 5, 30, 62, 93, 100, null],
      currentWins: 2,
      maxWins: 7,
    },
    assumptions: {
      iterations: 10000,
      rangeBatches: 10,
      rangeRunsPerBatch: 500,
      seasonsFitted: [2024, 2025, 2026],
      weeksFitted: { min: 28, median: 30, max: 31 },
      teams: 4,
      modelledTeams: 3,
      remainingGames: 10,
      regularSeasonEndWeek: 8,
      playoffTeams: { value: 4, source: 'league' },
      byes: { value: 2, source: 'standard' },
      tiebreak: 'Wins, then points for.',
      computedAt: '2026-09-17T12:00:00Z',
      reused: true,
      missing: ['Divisions and head-to-head tiebreaks are not modelled: seeding is wins, then points for.'],
    },
    focus,
    ...over,
  }
}

describe('SeasonOutlookLeague', () => {
  it('leads with the forecast: odds with ranges, the next action and the top three drivers', () => {
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="10,000 simulations" />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('63%')
    expect(text).toContain('range 40–61%')
    expect(text).toContain('First-round bye')
    expect(text).toContain('Miss the playoffs')
    expect(text).toContain('Set your best lineup for week 4')
    expect(text).toContain('+2.4 playoff pts')
    // Top three by size: swing ±12, schedule −6, strength +3. Byes (−1.4) is not in the hero.
    const hero = document.querySelector('.af-olk-hero')!.textContent ?? ''
    expect(hero).toContain('±12 pts')
    expect(hero).toContain('−6 pts')
    expect(hero).toContain('+3 pts')
    expect(hero).not.toContain('Bye weeks')
  })

  it('shows the milestones first and switches tabs, keeping every tab pointed at a real panel', () => {
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="10,000 simulations" />)
    expect(screen.getByRole('tabpanel').textContent).toContain('6–2')
    fireEvent.click(screen.getByRole('tab', { name: 'Assumptions' }))
    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toContain('10 re-fits')
    expect(panel.textContent).toContain('standard bracket')
    expect(panel.textContent).toContain('reused')
    for (const tab of screen.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe('so-panel')
    fireEvent.click(screen.getByRole('tab', { name: 'Standings' }))
    // An unmodelled team shows a dash, never 0%.
    expect(screen.getByRole('tabpanel').textContent).toContain('Too few completed weeks to model')
  })

  it('runs a what-if in the browser and reports the change against its own baseline', async () => {
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="10,000 simulations" />)
    fireEvent.click(screen.getByRole('tab', { name: 'What-if' }))
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: '4|3|1' } })
    fireEvent.click(screen.getByRole('button', { name: 'You win' }))
    expect(await screen.findByText(/Wk 4: You beat Team 1/)).toBeTruthy()
    const delta = await screen.findAllByText(/^\+[0-9.]+ pts$/, {}, { timeout: 3000 })
    expect(delta.length).toBeGreaterThan(0)
  })

  it('says it cannot identify you rather than showing odds about nobody', () => {
    render(<SeasonOutlookLeague league={league({ you: null })} swing={null} basis="x" />)
    expect(document.body.textContent).toContain('We cannot tell which team is yours')
    expect(document.querySelector('.af-olk-hero')).toBeNull()
  })
})

describe('SeasonOutlook (cross-league)', () => {
  const board: Board = {
    leagues: [league()],
    summary: { makingPlayoffs: 1, clinched: 0, onTheBubble: 1, onByePace: 0, bestTitle: { pct: 14.2, leagueName: 'Test League' } },
    weekThatMatters: swing,
    swingByLeague: { L1: swing },
    priorities: [{ leagueName: 'Test League', reason: 'On the bubble at 63%.', href: '/core?league=L1' }],
    basis: '10,000 simulations per league.',
    withheld: [{ leagueName: 'Old League', reason: 'No matchups have been synced for this league.' }],
    firstKickoffAt: null,
    generatedAt: '2026-09-17T12:00:00Z',
    runs: { reused: 1, computed: 0 },
  }

  it('leads with odds, the next action and the swing games, then the table', () => {
    render(<SeasonOutlook data={slimOutlookForBoard(board)} />)
    const text = document.body.textContent ?? ''
    expect(text).toContain('on pace for a bye')
    expect(text).toContain('On the bubble at 63%.')
    expect(text).toContain('Test League · week 4')
    expect(text).toContain('±18 pts')
    expect(text).toContain('40–61%')
    expect(text).toContain('4th hardest schedule left')
    expect(text).toContain('1 of 1 league runs were reused')
    expect(text).toContain('Old League')
  })

  it('links each league to its own outlook', () => {
    render(<SeasonOutlook data={slimOutlookForBoard(board)} />)
    const link = screen.getByRole('link', { name: 'Test League' })
    expect(link.getAttribute('href')).toBe('/core/season-outlook?league=L1')
  })

  it('🛑 the slimmed board carries no other team rows or focus block', () => {
    const slim = slimOutlookForBoard(board)
    expect(slim.leagues[0].teams).toEqual([])
    expect(slim.leagues[0].focus).toBeNull()
    expect(slim.leagues[0].you).toEqual(board.leagues[0].you)
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(board).length / 2)
  })
})

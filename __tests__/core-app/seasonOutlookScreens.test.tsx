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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Likely in: 63% to make the playoffs')
    expect(text).toContain('range 40–61%')
    expect(text).toContain('First-round bye')
    // 2026-11-14: no "Miss the playoffs" tile — it was 100 minus the playoffs tile.
    expect(text).not.toContain('Miss the playoffs')
    expect(text).toContain('Set your best lineup for week 4')
    expect(text).toContain('+2.4% playoff odds')
    // Top three by size: swing ±12, schedule −6, strength +3. Byes (−1.4) is not in the hero.
    const hero = document.querySelector('.af-olk-hero')!.textContent ?? ''
    expect(hero).toContain('±12%')
    expect(hero).toContain('−6%')
    expect(hero).toContain('+3%')
    expect(hero).not.toContain(' pts')
    expect(hero).not.toContain('Bye weeks')
  })

  it('draws each headline odds card with its own glyph, in the board order, the bye only when the league has one', () => {
    const { unmount } = render(<SeasonOutlookLeague league={league()} swing={swing} basis="10,000 simulations" />)
    const icons = () =>
      Array.from(document.querySelectorAll('.af-olk-hero .af-olk-odds')).map((el) => el.getAttribute('data-icon'))
    expect(icons()).toEqual(['playoffs', 'bye', 'title'])
    expect(document.querySelectorAll('.af-olk-hero .af-olk-odds-ic svg path')).toHaveLength(3)
    unmount()
    render(<SeasonOutlookLeague league={league({ byeTeams: 0 })} swing={swing} basis="10,000 simulations" />)
    expect(icons()).toEqual(['playoffs', 'title'])
  })

  it('shows the milestones first and switches tabs, keeping every tab pointed at a real panel', () => {
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="10,000 simulations" />)
    expect(screen.getByRole('tabpanel').textContent).toContain('6–2')
    // 2026-11-14: four tabs; the assumptions are a fold under the panel, whatever tab is open.
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Path to playoffs', 'What-if', 'Moves', 'All teams'])
    const fold = screen.getByTestId('olk-how-worked-out')
    expect(fold.tagName).toBe('DETAILS')
    expect(fold.textContent).toContain('10 re-fits')
    expect(fold.textContent).toContain('standard bracket')
    expect(fold.textContent).toContain('reused')
    for (const tab of screen.getAllByRole('tab')) expect(tab.getAttribute('aria-controls')).toBe('so-panel')
    fireEvent.click(screen.getByRole('tab', { name: 'Moves' }))
    expect(screen.getByTestId('olk-roster-risk')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'All teams' }))
    expect(screen.getByTestId('olk-schedule-strength')).toBeTruthy()
    // An unmodelled team shows a dash, never 0%.
    expect(screen.getByRole('tabpanel').textContent).toContain('Too few completed weeks to model')
  })

  it('Standings tab draws this week’s AF/API lineups under the odds, and nothing without them', () => {
    const lineups = {
      season: 2026,
      week: 4,
      rows: [{ rosterId: '3', name: 'Mine', isYou: true, af: 120.5, afFrom: 7, api: 118.9, apiFrom: 9, starterCount: 9 }],
    }
    const { unmount } = render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" lineups={lineups} />)
    fireEvent.click(screen.getByRole('tab', { name: 'All teams' }))
    const section = document.querySelector('.af-st-lineups')!
    expect(section.textContent).toContain('week 4')
    expect(section.textContent).toContain('simulated without AF')
    expect(section.querySelector('tbody tr')!.textContent).toBe('Mine · you120.5 7/9118.9')
    unmount()
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" />)
    fireEvent.click(screen.getByRole('tab', { name: 'All teams' }))
    expect(document.querySelector('.af-st-lineups')).toBeNull()
  })

  it('runs a what-if in the browser and reports the change against its own baseline', async () => {
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="10,000 simulations" />)
    fireEvent.click(screen.getByRole('tab', { name: 'What-if' }))
    fireEvent.change(screen.getByLabelText('Game'), { target: { value: '4|3|1' } })
    fireEvent.click(screen.getByRole('button', { name: 'You win' }))
    expect(await screen.findByText(/Wk 4: You beat Team 1/)).toBeTruthy()
    const delta = await screen.findAllByText(/^\+[0-9.]+%$/, {}, { timeout: 3000 })
    expect(delta.length).toBeGreaterThan(0)
  })

  it('says it cannot identify you rather than showing odds about nobody', () => {
    render(<SeasonOutlookLeague league={league({ you: null })} swing={null} basis="x" />)
    expect(document.body.textContent).toContain('We cannot tell which team is yours')
    expect(document.querySelector('.af-olk-hero')).toBeNull()
  })

  it('draws the odds-history chart under the forecast when two or more weeks are stored', () => {
    const history = [
      { week: 3, playoffPct: 41, titlePct: 6 },
      { week: 4, playoffPct: 55, titlePct: 9 },
      { week: 5, playoffPct: 63.4, titlePct: 14.2 },
    ]
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" history={history} />)
    const chart = document.querySelector('.af-olk-hero [data-testid="outlook-odds-history"]')!
    expect(chart).toBeTruthy()
    expect(chart.textContent).toContain('How your odds moved')
    expect(chart.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('draws no chart and no empty box without history, or with a single week', () => {
    const { unmount } = render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" />)
    expect(document.querySelector('[data-testid="outlook-odds-history"]')).toBeNull()
    expect(document.querySelector('.af-olk-hist')).toBeNull()
    unmount()
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" history={[{ week: 5, playoffPct: 63, titlePct: 14 }]} />)
    expect(document.querySelector('.af-olk-hist')).toBeNull()
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
    expect(text).toContain('±18%')
    expect(text).toContain('40–61%')
    expect(text).toContain('4th hardest schedule left')
    expect(text).toContain('1 of 1 league runs were reused')
    expect(text).toContain('Old League')
  })

  it('puts elimination and not-started leagues IN the table, with a survival pill — only unread data stays in the footer', () => {
    const withRows: Board = {
      ...board,
      withheld: [
        ...board.withheld,
        {
          leagueName: 'Chop Shop',
          leagueId: 'G1',
          kind: 'elimination',
          format: 'guillotine',
          survival: { status: 'alive', remaining: 9, field: 18 },
          reason: 'Guillotine — you are still alive, 9 of 18 teams left.',
        },
        {
          leagueName: 'Axed',
          leagueId: 'G2',
          kind: 'elimination',
          format: 'survivor',
          survival: { status: 'eliminated', remaining: 9, field: 20 },
          reason: 'Survivor — you have been eliminated (9 of 20 teams left).',
        },
        { leagueName: 'Draft Day', leagueId: 'P1', kind: 'not-started', reason: 'Pre-draft — odds start once the draft is done and the schedule is set.' },
      ],
    }
    render(<SeasonOutlook data={slimOutlookForBoard(withRows)} />)
    const rows = [...document.querySelectorAll('.af-so-table tbody tr.af-so-statusrow')]
    expect(rows.map((r) => r.querySelector('.af-so-league')?.textContent)).toEqual(['Chop Shop', 'Axed', 'Draft Day'])
    expect(rows.map((r) => r.querySelector('.af-olk-pill')?.getAttribute('data-status'))).toEqual(['alive', 'eliminated', 'waiting'])
    expect(rows[0]!.textContent).toContain('you are still alive, 9 of 18 teams left')
    expect(screen.getByRole('link', { name: 'Chop Shop' }).getAttribute('href')).toBe('/core?league=G1')
    // The footer keeps only the league whose data could not be read.
    const footer = document.querySelector('.af-so-withheld')!
    expect(footer.textContent).toContain('1 league is not on this page')
    expect(footer.textContent).toContain('Old League')
    expect(footer.textContent).not.toContain('Chop Shop')
  })

  it('still draws the table when every league is a status row and none simulates', () => {
    const onlyRows: Board = {
      ...board,
      leagues: [],
      swingByLeague: {},
      priorities: [],
      withheld: [{ leagueName: 'Draft Day', leagueId: 'P1', kind: 'not-started', reason: 'Draft in progress — odds start once the schedule is set.' }],
    }
    render(<SeasonOutlook data={slimOutlookForBoard(onlyRows)} />)
    expect(document.querySelectorAll('.af-so-statusrow')).toHaveLength(1)
    expect(document.querySelector('.af-so-empty')).toBeNull()
  })

  it('keeps its odds tiles glyph-free: the icons belong to the league screen only', () => {
    render(<SeasonOutlook data={slimOutlookForBoard(board)} />)
    expect(document.querySelectorAll('.af-olk-odds-ic')).toHaveLength(0)
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

/* ── 2026-11-14: the answer first, each number once ───────────────────────────────────────────────── */
import { seasonOutlookLeagueMessages } from '@/lib/core-app/messages/seasonOutlookLeague'

describe('Season Outlook — simpler (2026-11-14)', () => {
  const longShot = () =>
    league({
      you: { ...you, playoffPct: 0.3, titlePct: 0, byePct: 0, missPct: 99.7, range: { playoff: { lo: 0.1, hi: 0.4 }, bye: { lo: 0, hi: 0 }, title: { lo: 0, hi: 0 } } },
      whatDecidesIt: 'A long-shot forecast; a nonzero probability is not mathematical elimination.',
      milestones: { ...league().milestones!, winsForSafe: null, winsForLikely: null },
    })

  it('says the answer in the headline, in words a person would use', () => {
    const h = seasonOutlookLeagueMessages.en.headline
    expect(h('clinched', 100)).toBe('You’re in the playoffs')
    expect(h('eliminated', 0)).toBe('You’re out of the playoff race')
    expect(h(null, 99.8)).toBe('Very likely in: over 99% to make the playoffs')
    expect(h(null, 72)).toBe('Likely in: 72% to make the playoffs')
    expect(h(null, 52)).toBe('A coin flip: 52% to make the playoffs')
    expect(h(null, 18)).toBe('An outside chance: 18% to make the playoffs')
    expect(h(null, 0.3)).toBe('A long shot: under 1% to make the playoffs')
    const es = seasonOutlookLeagueMessages.es!.headline!
    expect(es(null, 0.3)).toBe('Muy difícil: menos del 1% de llegar a los playoffs')
    expect(es(null, 52)).toBe('A cara o cruz: un 52% de llegar a los playoffs')
  })

  it('a long shot: the headline says it once — no jargon sentence, no repeated range, no bare dashes, no swing tile', () => {
    render(<SeasonOutlookLeague league={longShot()} swing={{ ...swing, ifWin: 1, ifLose: 0, swing: 1 }} basis="x" />)
    // ⚠ The tab lives in the URL and an earlier test may have left one there: open Path explicitly.
    fireEvent.click(screen.getByRole('tab', { name: 'Path to playoffs' }))
    const text = document.body.textContent ?? ''
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('A long shot: under 1% to make the playoffs')
    expect(text).not.toContain('nonzero probability')
    // <1% with a range that rounds to <1% too: the range is not drawn.
    expect(text).not.toContain('range <1%')
    expect(text).not.toContain('range 0%')
    expect(screen.queryByTestId('olk-mile-safe')).toBeNull()
    expect(screen.queryByTestId('olk-mile-likely')).toBeNull()
    // Two branches — win and lose — and no third "Swing" tile restating their difference.
    expect([...document.querySelectorAll('.af-sol-branch')].map((b) => b.getAttribute('data-tone'))).toEqual(['good', 'bad'])
    expect(text).toContain('If you win')
  })

  it('keeps the "what decides it" sentence and the goal tiles where they say something', () => {
    render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Path to playoffs' }))
    expect(document.querySelector('.af-olk-decides')?.textContent).toBe('Get to 6 wins — 4 of your last 5 — and you are in nine times in ten.')
    expect(screen.getByTestId('olk-mile-safe').textContent).toContain('6–2')
    expect(screen.getByTestId('olk-mile-likely').textContent).toContain('5–3')
    // The seed's win range reads "4 to 6", never "4–6", which beside "6–2" reads as a record.
    const panel = screen.getByRole('tabpanel').textContent ?? ''
    expect(panel).toContain('4 to 6wins for the 4th seed')
    expect(panel).not.toContain('4–6')
  })

  it('draws the odds chart only once the odds have moved', () => {
    const flat = [
      { week: 9, playoffPct: 0.4, titlePct: 0 },
      { week: 10, playoffPct: 0.3, titlePct: 0 },
    ]
    render(<SeasonOutlookLeague league={longShot()} swing={swing} basis="x" history={flat} />)
    expect(document.querySelector('[data-testid="outlook-odds-history"]')).toBeNull()
  })

  it('a link saved to an old tab lands on the tab that now holds it', () => {
    const before = window.location.href
    window.history.replaceState(null, '', '/core/season-outlook?league=L1&so_tab=roster')
    try {
      render(<SeasonOutlookLeague league={league()} swing={swing} basis="x" />)
      expect(screen.getByRole('tab', { name: 'Moves' }).getAttribute('aria-selected')).toBe('true')
    } finally {
      window.history.replaceState(null, '', before)
    }
  })
})

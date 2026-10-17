import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import { Standings } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import type { OutlookLeague, SwingMatchup } from '@/lib/core-app/seasonOutlook'
import { formatOdds, toStandingsOdds, type StandingsOdds } from '@/lib/core-app/standingsOdds'
import {
  advanceWeek,
  buildStandingsBoard,
  type StandingsRules,
  type TeamMeta,
  type WeekRow,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'

/*
 * Playoff odds, schedule strength, magic numbers and the week's stakes on the standings screen.
 *
 * The odds are Season Outlook's; the magic numbers are this table's own arithmetic. These tests pin
 * that each is printed from where it belongs, and that the table draws no odds columns at all when the
 * simulation is absent rather than a column of dashes that reads as "zero chance".
 */

const RULES: StandingsRules = {
  playoffTeams: 2,
  playoffTeamsSource: 'league',
  byes: 0,
  regularSeasonEnd: null,
  tiebreakers: ['points_for', 'head_to_head'],
  tiebreakerSource: 'platform',
  rankIsOfficial: false,
  platformLabel: 'Sleeper',
}

const IDS = ['1', '2', '3', '4']

function row(week: number, m: number, id: string, pf: number, pa: number): WeekRow {
  return { week, rosterId: id, matchupId: m, pointsFor: pf, pointsAgainst: pa }
}

/** 1 beats 2 every week; 3 and 4 trade wins. After four weeks: 1 4-0, 3 2-2, 4 2-2, 2 0-4 (you). */
function snapshots(weeks: number): WeekSnapshot[] {
  const out: WeekSnapshot[] = []
  for (let w = 1; w <= weeks; w += 1) {
    const rows = [
      row(w, 1, '1', 150, 120 + w),
      row(w, 1, '2', 120 + w, 150),
      row(w, 2, '3', w % 2 ? 110 : 100, w % 2 ? 100 : 110),
      row(w, 2, '4', w % 2 ? 100 : 110, w % 2 ? 110 : 100),
    ]
    out.push(advanceWeek(out[w - 2] ?? null, 2026, w, rows, IDS, `s${w}`))
  }
  return out
}

function teams(): TeamMeta[] {
  return IDS.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '2', division: null, reported: null }))
}

function board() {
  return buildStandingsBoard({
    season: 2026,
    snapshots: snapshots(4),
    unplayed: [
      { week: 5, a: '1', b: '3' },
      { week: 5, a: '2', b: '4' },
      { week: 6, a: '1', b: '4' },
      { week: 6, a: '2', b: '3' },
    ],
    teams: teams(),
    rules: RULES,
  })
}

const ODDS: StandingsOdds = {
  byRoster: {
    '1': { playoffPct: 97.4, byePct: 0, modelled: true, sosRank: 4, sosOpponentMu: 104 },
    '2': { playoffPct: 0.3, byePct: 0, modelled: true, sosRank: 3, sosOpponentMu: 105 },
    '3': { playoffPct: 55.2, byePct: 0, modelled: false, sosRank: 1, sosOpponentMu: 140 },
    '4': { playoffPct: 47.1, byePct: 0, modelled: true, sosRank: 2, sosOpponentMu: 138 },
  },
  sosRanked: 4,
  leagueMu: 121,
  iterations: 10_000,
  you: { rosterId: '2', playoffPct: 0.3, whatDecidesIt: 'Out in every simulated run.' },
  stakes: {
    week: 5,
    opponentName: 'Team 4',
    ifWin: 4.2,
    ifLose: 0,
    clinchOnWin: false,
    helpIfLose: [],
    rooting: [{ a: { id: '1', name: 'Team 1' }, b: { id: '3', name: 'Team 3' }, ifA: 6.1, ifB: 0.4, rootFor: '1' }],
  },
  basis: '10,000 simulations per league.',
  href: '/core/season-outlook?league=L1',
}

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(cleanup)

/** The league table's own headings — the head-to-head grid below it is a second table — without sort marks. */
const leagueTable = (c: HTMLElement) => c.querySelector('[aria-label="League table"]')!
const headers = (c: HTMLElement) =>
  [...leagueTable(c).querySelectorAll('thead th')].map((th) => th.textContent?.replace(/[▲▼↕]/g, '').trim() ?? '')

describe('formatOdds', () => {
  it('keeps the ends honest and leaves In/Out to the arithmetic', () => {
    expect(formatOdds(47.6)).toBe('48%')
    expect(formatOdds(99.6)).toBe('>99%')
    expect(formatOdds(100)).toBe('>99%')
    expect(formatOdds(0)).toBe('<1%')
    expect(formatOdds(0.4)).toBe('<1%')
    expect(formatOdds(100, 'clinched')).toBe('In')
    expect(formatOdds(3, 'eliminated')).toBe('Out')
  })
})

describe('toStandingsOdds', () => {
  const league = {
    leagueId: 'L1',
    you: { rosterId: '2', playoffPct: 12 },
    whatDecidesIt: 'Get to 6 wins.',
    assumptions: { iterations: 10_000 },
    teams: [
      { rosterId: '1', playoffPct: 90, byePct: 40, modelled: true, schedule: { remainingRank: 2, remainingOpponentMu: 110, leagueMu: 105 } },
      { rosterId: '2', playoffPct: 12, byePct: 0, modelled: true, schedule: { remainingRank: 1, remainingOpponentMu: 120, leagueMu: 105 } },
      { rosterId: '3', playoffPct: 50, byePct: 5, modelled: false, schedule: null },
    ],
  } as unknown as OutlookLeague
  const swing = {
    leagueId: 'L1',
    week: 7,
    opponentName: 'Team 1',
    ifWin: 30,
    ifLose: 5,
    swing: 25,
    clinchOnWin: false,
    helpIfLose: ['Team 3'],
    rooting: [{ week: 7, a: '3', b: '4', aName: 'Team 3', bName: null, ifA: 9, ifB: 15, rootFor: '4' }],
  } as SwingMatchup

  it('carries percentages, the schedule rank and its denominator per team', () => {
    const o = toStandingsOdds(league, swing, 'basis.')
    expect(o.byRoster['2']).toEqual({ playoffPct: 12, byePct: 0, modelled: true, sosRank: 1, sosOpponentMu: 120 })
    expect(o.byRoster['3'].sosRank).toBeNull()
    expect(o.sosRanked).toBe(2)
    expect(o.leagueMu).toBe(105)
    expect(o.you).toEqual({ rosterId: '2', playoffPct: 12, whatDecidesIt: 'Get to 6 wins.' })
    expect(o.href).toBe('/core/season-outlook?league=L1')
  })

  it('maps the rooting guide, and keeps a board that predates it distinct from one with nothing to root for', () => {
    expect(toStandingsOdds(league, swing, '').stakes?.rooting).toEqual([
      { a: { id: '3', name: 'Team 3' }, b: { id: '4', name: null }, ifA: 9, ifB: 15, rootFor: '4' },
    ])
    const { rooting: _omit, ...older } = swing
    expect(toStandingsOdds(league, older as SwingMatchup, '').stakes?.rooting).toBeNull()
    expect(toStandingsOdds(league, { ...swing, rooting: [] }, '').stakes?.rooting).toEqual([])
  })

  it("never attaches another league's swing game", () => {
    expect(toStandingsOdds(league, { ...swing, leagueId: 'L2' }, '').stakes).toBeNull()
    expect(toStandingsOdds(league, null, '').stakes).toBeNull()
  })
})

describe('StandingsBoardView — odds, schedule and magic numbers', () => {
  it('draws the magic number and next game from the table alone, and no odds columns without a simulation', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} />)
    const h = headers(container)
    expect(h).toContain('Magic #')
    expect(h).toContain('Next')
    expect(h).not.toContain('Playoff %')
    expect(h).not.toContain('SOS left')
    // You (0-4, two left): winning out still needs help, so there is no clinch number — left out, not
    // dashed — and one more loss ends it.
    const you = container.querySelector('tr[data-you="true"]')!
    expect(you.querySelector('.af-stb-path [data-k="clinch"]')).toBeNull()
    expect(you.querySelector('.af-stb-path [data-k="elim"] .af-num')?.textContent).toBe('1')
    expect(within(you as HTMLElement).getByText('Team 4', { selector: '.af-stb-nextname, .af-stb-nextname *' })).toBeTruthy()
  })

  it('prints the simulation’s odds and schedule rank when it has them', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} odds={ODDS} />)
    const h = headers(container)
    expect(h).toContain('Playoff %')
    expect(h).toContain('SOS left')
    // By the team cell: a row's "Next" column names another team, so the row's whole text will not do.
    const rowOf = (name: string) =>
      [...container.querySelectorAll('.af-stb-table tbody tr[data-zone]')].find(
        (tr) => tr.querySelector('.af-stb-teamname')?.textContent === name,
      )!
    expect(rowOf('Team 2').querySelector('.af-stb-odds')?.textContent).toBe('<1%')
    expect(rowOf('Team 3').querySelector('.af-stb-odds')?.textContent).toBe('55%*')
    expect(rowOf('Team 3').querySelector('.af-stb-sos')?.getAttribute('data-tone')).toBe('hard')
    expect(rowOf('Team 1').querySelector('.af-stb-sos')?.getAttribute('data-tone')).toBe('easy')
    const note = [...container.querySelectorAll('.af-stb-notes p')].find((p) => p.textContent?.includes('Season Outlook'))
    expect(note?.querySelector('a')?.getAttribute('href')).toBe('/core/season-outlook?league=L1')
  })

  it('prints "In" only where the table itself has clinched, never off a simulated 100%', () => {
    const b = board()
    const certain = { ...ODDS, byRoster: Object.fromEntries(IDS.map((id) => [id, { ...ODDS.byRoster[id], playoffPct: 100 }])) }
    const { container } = render(<StandingsBoardView board={b} initial={DEFAULT_STANDINGS_VIEW} odds={certain} />)
    // The unmodelled marker is not part of the verdict.
    const texts = [...container.querySelectorAll('.af-stb-table .af-stb-odds')].map((e) => e.textContent?.replace('*', ''))
    const clinched = b.teams.filter((t) => t.clinched).length
    expect(texts.filter((t) => t === 'In')).toHaveLength(clinched)
    expect(texts.filter((t) => t === '>99%')).toHaveLength(IDS.length - clinched - b.teams.filter((t) => t.zone === 'eliminated').length)
  })

  it('leaves the magic-number column and its note out early in the season', () => {
    const early = buildStandingsBoard({
      season: 2026,
      snapshots: snapshots(2),
      unplayed: [5, 6, 7, 8].flatMap((w) => [
        { week: w, a: '1', b: '3' },
        { week: w, a: '2', b: '4' },
      ]),
      teams: teams(),
      rules: RULES,
    })
    expect(early.showPaths).toBe(false)
    const { container } = render(<StandingsBoardView board={early} initial={DEFAULT_STANDINGS_VIEW} odds={ODDS} />)
    expect(headers(container)).not.toContain('Magic #')
    expect(headers(container)).toContain('Playoff %')
    expect(container.querySelector('.af-stb-path')).toBeNull()
    expect([...container.querySelectorAll('.af-stb-notes p')].some((p) => p.textContent?.startsWith('Magic numbers'))).toBe(false)
    // The playoff line still spans the table without the column.
    const columns = leagueTable(container).querySelectorAll('thead th').length
    expect(container.querySelector('tr.af-stb-line td')?.getAttribute('colspan')).toBe(String(columns))
  })

  it('runs the playoff line across every column', () => {
    for (const odds of [null, ODDS]) {
      const { container, unmount } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} odds={odds} />)
      const columns = leagueTable(container).querySelectorAll('thead th').length
      expect(container.querySelector('tr.af-stb-line td')?.getAttribute('colspan')).toBe(String(columns))
      unmount()
    }
  })

  it('keeps every new column on the card layout', () => {
    window.localStorage.setItem('af-standings-layout', 'cards')
    const { container } = render(<StandingsBoardView board={board()} initial={DEFAULT_STANDINGS_VIEW} odds={ODDS} />)
    const you = container.querySelector('.af-stb-card[data-you="true"]')!
    const terms = [...you.querySelectorAll('dt')].map((d) => d.textContent)
    expect(terms).toEqual(expect.arrayContaining(['Magic number', 'Playoff odds', 'Next', 'Schedule left']))
  })
})

describe('Standings — what is at stake', () => {
  function data(): LeagueStandingsResult {
    return {
      available: true,
      league: { id: 'L1', name: 'Test League', platform: 'sleeper' },
      season: 2026,
      week: 5,
      seasonComplete: false,
      teams: [],
      you: null,
      trend: [],
      recent: [],
      projection: { available: false, reason: 'Not enough weeks.' },
      scoredWeeks: 4,
      history: [],
      board: board(),
    } as unknown as LeagueStandingsResult
  }

  it('states the magic numbers about you, with no simulation needed', () => {
    const { container } = render(<Standings data={data()} />)
    const panel = container.querySelector('.af-st-stakes')!
    expect(panel.querySelector('.af-st-stakes-path')?.textContent).toBe(
      'Winning out does not guarantee a spot on its own yet — you need results elsewhere too; lose 1 more and you are out.',
    )
    expect(panel.querySelector('.af-st-stakes-odds')).toBeNull()
    expect(panel.querySelector('.af-st-stakes-root')).toBeNull()
  })

  it('adds your odds, your game’s swing and who to root for from the simulation', () => {
    const { container } = render(<Standings data={data()} odds={ODDS} />)
    const panel = container.querySelector('.af-st-stakes')!
    expect(panel.querySelector('.af-st-stakes-pct')?.textContent).toBe('<1%')
    expect(panel.querySelector('.af-st-stakes-game h3')?.textContent).toBe('Your game · week 5 vs Team 4')
    expect([...panel.querySelectorAll('.af-st-stakes-branches .af-num')].map((e) => e.textContent)).toEqual(['4%', '<1%'])
    const pick = panel.querySelector('.af-st-stakes-root li')!
    expect(pick.querySelector('strong')?.textContent).toBe('Team 1')
    expect(pick.textContent).toMatch(/Team 1 #1 over Team 3 #\d/)
  })

  it('says so when no other game moves your odds, and draws nothing for a board that predates the guide', () => {
    const quiet = { ...ODDS, stakes: { ...ODDS.stakes!, rooting: [] } }
    const { container, unmount } = render(<Standings data={data()} odds={quiet} />)
    expect(container.querySelector('.af-st-stakes-root')?.textContent).toMatch(/No other game that week moves your odds/)
    unmount()
    const older = { ...ODDS, stakes: { ...ODDS.stakes!, rooting: null } }
    const { container: c2 } = render(<Standings data={data()} odds={older} />)
    expect(c2.querySelector('.af-st-stakes-root')).toBeNull()
    expect(c2.querySelector('.af-st-stakes-game')).not.toBeNull()
  })

  it('drops the magic-number sentence early in the season, and the panel too when there are no odds', () => {
    const early = {
      ...(data() as object),
      board: buildStandingsBoard({
        season: 2026,
        snapshots: snapshots(2),
        unplayed: [5, 6, 7, 8].flatMap((w) => [
          { week: w, a: '1', b: '3' },
          { week: w, a: '2', b: '4' },
        ]),
        teams: teams(),
        rules: RULES,
      }),
    } as unknown as LeagueStandingsResult
    const { container, unmount } = render(<Standings data={early} odds={ODDS} />)
    expect(container.querySelector('.af-st-stakes-path')).toBeNull()
    expect(container.querySelector('.af-st-stakes-pct')?.textContent).toBe('<1%')
    unmount()
    const { container: bare } = render(<Standings data={early} />)
    expect(bare.querySelector('.af-st-stakes')).toBeNull()
  })

  it("ignores odds that are not about your team", () => {
    const stranger = { ...ODDS, you: { ...ODDS.you!, rosterId: '3' } }
    const { container } = render(<Standings data={data()} odds={stranger} />)
    expect(container.querySelector('.af-st-stakes-odds')).toBeNull()
    expect(container.querySelector('.af-st-stakes-game')).toBeNull()
  })
})

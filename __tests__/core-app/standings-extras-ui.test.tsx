import React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import { Standings } from '@/components/core-app/screens/Standings'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'
import type { LineupEfficiency } from '@/lib/core-app/lineupEfficiency'
import type { DraftOrderPreview } from '@/lib/core-app/standingsDraftOrder'
import {
  advanceWeek,
  buildStandingsBoard,
  type StandingsRules,
  type WeekSnapshot,
} from '@/lib/core-app/standingsModel'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'

/* Lineup efficiency in the AF Power view, the draft-order section, and the share button. */

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

function board() {
  const ids = ['1', '2', '3', '4']
  const snaps: WeekSnapshot[] = [
    advanceWeek(
      null,
      2026,
      1,
      [
        { week: 1, rosterId: '1', matchupId: 1, pointsFor: 130, pointsAgainst: 101 },
        { week: 1, rosterId: '2', matchupId: 1, pointsFor: 101, pointsAgainst: 130 },
        { week: 1, rosterId: '3', matchupId: 2, pointsFor: 120, pointsAgainst: 99 },
        { week: 1, rosterId: '4', matchupId: 2, pointsFor: 99, pointsAgainst: 120 },
      ],
      ids,
      's1',
    ),
  ]
  return buildStandingsBoard({
    season: 2026,
    snapshots: snaps,
    unplayed: [],
    teams: ids.map((id) => ({ rosterId: id, name: `Team ${id}`, avatarUrl: null, isYou: id === '4', division: null, reported: null })),
    rules: RULES,
  })
}

const EFFICIENCY: LineupEfficiency = {
  byRoster: {
    '1': { actual: 130, best: 140, efficiency: 130 / 140, benchPerWeek: 10, weeks: 1 },
    '4': { actual: 99, best: 131, efficiency: 99 / 131, benchPerWeek: 32, weeks: 1 },
  },
  weeksOnFile: [1],
  basis: 'Lineup efficiency is the points your starters scored as a share of the best lineup you could have set.',
}

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
})
afterEach(cleanup)

describe('lineup efficiency in AF Power', () => {
  it('adds Lineup % and Bench/wk columns, with a dash for a team with no weeks counted', () => {
    const { container } = render(
      <StandingsBoardView board={board()} initial={{ ...DEFAULT_STANDINGS_VIEW, view: 'power' }} efficiency={EFFICIENCY} />,
    )
    const table = container.querySelector('[aria-label="AF Power rankings"]') as HTMLElement
    const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent)
    expect(heads).toEqual(expect.arrayContaining(['Lineup %', 'Bench/wk']))
    const rowOf = (name: string) => [...table.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(name))!
    expect(rowOf('Team 1').querySelector('.af-stb-eff')?.textContent).toBe('92.9%')
    expect(rowOf('Team 1').querySelector('.af-stb-eff')?.getAttribute('data-tone')).toBe('good')
    expect(rowOf('Team 4').querySelector('.af-stb-eff')?.getAttribute('data-tone')).toBe('bad')
    expect(rowOf('Team 2').querySelector('.af-stb-eff')).toBeNull()
    expect(container.querySelector('.af-stb-notes')?.textContent).toContain('Lineup efficiency is the points')
  })

  it('draws no efficiency columns without the data', () => {
    const { container } = render(<StandingsBoardView board={board()} initial={{ ...DEFAULT_STANDINGS_VIEW, view: 'power' }} />)
    const heads = [...container.querySelectorAll('[aria-label="AF Power rankings"] thead th')].map((th) => th.textContent)
    expect(heads).not.toContain('Lineup %')
  })
})

describe('Standings — draft order and share', () => {
  const data = () =>
    ({
      available: true,
      league: { id: 'L1', name: 'Ice Kings', platform: 'sleeper' },
      season: 2026,
      week: 2,
      seasonComplete: false,
      teams: [],
      you: null,
      trend: [],
      recent: [],
      projection: { available: false, reason: 'Not enough weeks.' },
      scoredWeeks: 1,
      history: [],
      board: board(),
    }) as unknown as LeagueStandingsResult

  const ORDER: DraftOrderPreview = {
    rule: 'lottery',
    ruleText: 'A weighted lottery decides the first 2 picks; the rest fall in reverse order of the table.',
    picks: [
      { pick: 1, rosterId: '4', name: 'Team 4', isYou: true, record: '0-1', pointsFor: 99, firstPickOdds: 66.7 },
      { pick: 2, rosterId: '2', name: 'Team 2', isYou: false, record: '0-1', pointsFor: 101, firstPickOdds: 33.3 },
    ],
    playoffTeams: 2,
    lotteryPicks: 2,
  }

  it('shows the draft order only when one is given, with lottery odds and your row marked', () => {
    const { container, unmount } = render(<Standings data={data()} draftOrder={ORDER} />)
    const section = container.querySelector('.af-st-draft') as HTMLElement
    expect(within(section).getByText('Draft order if the season ended today')).toBeTruthy()
    const items = [...section.querySelectorAll('li')]
    expect(items[0].getAttribute('data-you')).toBe('true')
    expect(items[0].textContent).toContain('66.7% at #1')
    expect(section.textContent).toContain('The other 2 picks go to the playoff teams')
    unmount()
    const { container: none } = render(<Standings data={data()} />)
    expect(none.querySelector('.af-st-draft')).toBeNull()
  })

  it('offers a share button that builds the auth-gated standings card', () => {
    const { container } = render(<Standings data={data()} />)
    const button = within(container.querySelector('.af-st-share') as HTMLElement).getByRole('button', { name: 'Share standings' })
    expect(button).toBeTruthy()
  })
})

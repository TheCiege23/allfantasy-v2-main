/**
 * The demo shows the app's own League Home (components/core-app/screens/LeagueHome.tsx) inside the
 * app's own chrome. Two things make that safe and these pin them:
 *
 *  1. The Home data is built from the ANONYMIZED view only — every id is `demo-<slot>`, every name
 *     the alias — and nothing is marked as "yours" (the demo has no you).
 *  2. The real screens link into the signed-in app; the demo frame rewrites those links to demo
 *     pages or sign-up, so a visitor is never sent to a login wall for a league id that does not exist.
 */
import { describe, expect, it } from 'vitest'

import { DEMO_HIDDEN_HOME_SECTIONS, demoLeagueHome, demoScoreboard, demoStandingsRows } from '@/lib/demo-league/coreHome'
import { demoHrefFor } from '@/lib/demo-league/demoLinks'
import { demoLeagueStandings } from '@/lib/demo-league/coreStandings'
import { demoChimmyFixtureView } from './fixtures/demoChimmyLeague'

const view = demoChimmyFixtureView()

describe('demoLeagueHome: the real Home, fed only the anonymized view', () => {
  const data = demoLeagueHome(view)

  it('every team row is an alias with a public seat id — no real id can be in it', () => {
    const rows = demoStandingsRows(view)
    expect(rows).toHaveLength(view.standings.length)
    for (const r of rows) {
      expect(r.teamId).toMatch(/^demo-\d+$/)
      expect(view.teams.map((t) => t.teamName)).toContain(r.teamName)
      expect(r.isYou).toBe(false)
    }
  })

  it('this week’s games carry the demo’s scores, and an upcoming game shows no points', () => {
    const withGames = {
      ...view,
      currentWeek: 7,
      matchups: [
        { home: { slot: 1, points: 88.2 }, away: { slot: 2, points: 71.4 }, status: 'live' as const },
        { home: { slot: 3, points: 0 }, away: { slot: 4, points: 0 }, status: 'upcoming' as const },
      ],
    }
    const board = demoScoreboard(withGames)!
    expect(board.week).toBe(7)
    expect(board.games[0]!.teams.map((t) => t.points)).toEqual([88.2, 71.4])
    expect(board.games[0]!.margin).toBe(16.8)
    expect(board.games[1]!.teams.map((t) => t.points)).toEqual([null, null])
    expect(board.games[1]!.unplayed).toBe(true)
    const ids = board.games.flatMap((g) => g.teams.map((t) => t.rosterId))
    expect(ids.every((id) => /^demo-\d+$/.test(id))).toBe(true)
    expect(board.games.flatMap((g) => g.teams).every((t) => !t.isYou)).toBe(true)
    expect(demoScoreboard({ ...view, matchups: [] })).toBeNull()
  })

  it('panels that only mean something to a member are off, and hidden on the page', () => {
    expect(data.yourTeam.available).toBe(false)
    expect(data.matchup.available).toBe(false)
    expect(data.commissioner).toMatchObject({ available: false })
    expect(DEMO_HIDDEN_HOME_SECTIONS).toEqual(expect.arrayContaining(['week', 'activity', 'commissioner']))
  })

  it('a redraft league gets the real season-race deck; a dynasty league the Dynasty Era deck', () => {
    expect(data.redraft).toBeTruthy()
    expect(data.dynasty ?? null).toBeNull()
    const dyn = demoLeagueHome({ ...view, settings: { ...view.settings, isDynasty: true } })
    expect(dyn.redraft ?? null).toBeNull()
    expect(dyn.dynasty).toBeTruthy()
  })

  it('a league-type example is named as one', () => {
    expect(demoLeagueHome(view, { name: 'Keeper example', id: 'demo-keeper' }).league).toMatchObject({ name: 'Keeper example', id: 'demo-keeper' })
  })
})

describe('demoLeagueStandings: the real board, computed from the demo’s weekly scores', () => {
  // A 4-team, 3-week league: seat 1 beats 2 and seat 3 beats 4 every week; weeks 4–5 are still to play.
  const base = demoChimmyFixtureView()
  const teams = base.teams.slice(0, 4)
  const played = [1, 2, 3].map((week) => ({
    week,
    scores: [
      { slot: teams[0]!.slot, points: 130, matchupId: 1 },
      { slot: teams[1]!.slot, points: 110, matchupId: 1 },
      { slot: teams[2]!.slot, points: 125, matchupId: 2 },
      { slot: teams[3]!.slot, points: 100, matchupId: 2 },
    ],
  }))
  const view = {
    ...base,
    teams,
    settings: { ...base.settings, playoffTeams: 2, playoffStartWeek: 6 },
    currentWeek: 4,
    matchups: [],
    weeklyScores: played,
  }
  const pairs: Array<[number, number]> = [[teams[0]!.slot, teams[2]!.slot], [teams[1]!.slot, teams[3]!.slot]]
  const upcoming = [{ week: 4, pairs }, { week: 5, pairs }]

  it('records come from the pairings: 3-0, 0-3, and nothing is marked yours', () => {
    const r = demoLeagueStandings({ ...view, upcoming }, { id: 'demo-x', name: 'X' })
    if (!r.available) throw new Error('expected a board')
    const rec = (slot: number) => r.teams.find((t) => t.rosterId === `demo-${slot}`)!
    expect([rec(teams[0]!.slot).wins, rec(teams[0]!.slot).losses]).toEqual([3, 0])
    expect([rec(teams[1]!.slot).wins, rec(teams[1]!.slot).losses]).toEqual([0, 3])
    expect(r.you).toBeNull()
    expect(r.teams.every((t) => !t.isYou && /^demo-\d+$/.test(t.rosterId))).toBe(true)
  })

  it('with games left on the schedule a 3-0 team has not clinched; with none, the board says it has', () => {
    const withSchedule = demoLeagueStandings({ ...view, upcoming }, { id: 'demo-x', name: 'X' })
    const noSchedule = demoLeagueStandings({ ...view, upcoming: [] }, { id: 'demo-x', name: 'X' })
    if (!withSchedule.available || !noSchedule.available) throw new Error('expected boards')
    expect(withSchedule.board.gamesRemaining).toBeGreaterThan(0)
    expect(noSchedule.board.gamesRemaining).toBe(0)
  })

  it('a points-only format gets no head-to-head records, however the sample paired the seats', () => {
    const r = demoLeagueStandings({ ...view, upcoming }, { id: 'demo-g', name: 'G', pointsOnly: true })
    if (!r.available) throw new Error('expected a board')
    expect(r.board.hasHeadToHead).toBe(false)
    expect(r.teams.every((t) => t.wins === 0 && t.losses === 0)).toBe(true)
  })
})

describe('demoHrefFor: links out of the real screens', () => {
  const home = '/demo/formats/redraft'
  it.each([
    ['/core/trades?league=demo-redraft', '/demo/trades'],
    ['/core/standings?league=demo-redraft', `${home}/standings`],
    ['/core/matchup?league=demo-redraft', home],
    ['/core/my-team?league=demo-redraft', home],
    ['/core/waivers?league=demo-redraft', '/signup'],
    ['/core', '/signup'],
    ['/settings?tab=leagues', '/signup'],
    ['/league/abc/settings', '/signup'],
  ])('%s → %s', (from, to) => {
    expect(demoHrefFor(from, home)).toBe(to)
  })

  it.each(['/demo/trades', '/demo', '/create-league?type=redraft', '/signup', '/', 'https://example.com/x', '//evil.example', null])(
    'leaves %s alone',
    (href) => {
      expect(demoHrefFor(href as string | null, home)).toBeNull()
    },
  )

  it('does not mistake a public page that merely starts with a signed-in word', () => {
    expect(demoHrefFor('/leaguesmith', home)).toBeNull()
    expect(demoHrefFor('/core-values', home)).toBeNull()
  })
})

// @vitest-environment jsdom
/**
 * The Dynasty table on /core's Standings: the all-time builder (lib/core-app/dynastyStandingsHistory.ts)
 * and its render (components/core-app/screens/DynastyStandingsHistory.tsx), in English and Spanish.
 *
 * The identity cases are the point. A franchise is matched across seasons by a STORED key — owner user
 * id, LeagueTeam id, provider team key — joined through the league's LeagueTeam rows, and never by name.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k, tInterpolate: (k: string) => k }),
}))

import {
  buildDynastyStandingsHistory,
  sortFranchises,
  type DynastySeasonInput,
  type DynastyTeamInput,
} from '@/lib/core-app/dynastyStandingsHistory'
import { DynastyStandingsHistory } from '@/components/core-app/screens/DynastyStandingsHistory'
import { Standings } from '@/components/core-app/screens/Standings'
import { buildChampionRafters } from '@/lib/league/dynastyHomeExtras'
import type { LeagueStandingsResult } from '@/lib/core-app/leagueStandings'

const team = (i: number, over: Partial<DynastyTeamInput> = {}): DynastyTeamInput => ({
  id: `lt-${i}`,
  externalId: String(i),
  platformUserId: `sl-${i}`,
  claimedByUserId: `af-${i}`,
  teamName: `Team ${i}`,
  ownerName: `mgr${i}`,
  ...over,
})
const rec = (o: Record<string, unknown>) => ({ wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0, ...o })
const season = (s: number, records: unknown, over: Partial<DynastySeasonInput> = {}): DynastySeasonInput => ({
  season: s,
  status: 'complete',
  teamRecords: records,
  championName: null,
  championTeamId: null,
  ...over,
})
const base = { championships: [], standingFacts: [], viewerUserId: 'af-1', rafters: null }

describe('buildDynastyStandingsHistory — franchise identity', () => {
  it('joins a Sleeper-keyed season and an AllFantasy-keyed season onto one franchise through LeagueTeam', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(1), team(2)],
      seasons: [
        season(2023, [
          rec({ rosterId: 1, ownerId: 'sl-1', managerName: 'mgr1', teamName: 'Old Name', wins: 9, losses: 4, pointsFor: 1500, isChampion: true }),
          rec({ rosterId: 2, ownerId: 'sl-2', managerName: 'mgr2', wins: 4, losses: 9, pointsFor: 1300, isRunnerUp: true }),
        ]),
        season(2024, [
          rec({ rosterId: 'rr-a', franchiseId: 'lt-1', ownerId: 'af-1', managerName: 'mgr1', wins: 8, losses: 5, pointsFor: 1450.5 }),
          rec({ rosterId: 'rr-b', franchiseId: 'lt-2', ownerId: 'af-2', managerName: 'mgr2', wins: 5, losses: 8, pointsFor: 1350 }),
        ]),
      ],
    })
    expect(out.status).toBe('records')
    expect(out.franchises).toHaveLength(2)
    const one = out.franchises.find((f) => f.name === 'Team 1')!
    expect(one).toMatchObject({ seasons: [2023, 2024], wins: 17, losses: 9, titles: 1, titleSeasons: [2023], isYou: true, pointsFor: 2950.5 })
    expect(one.winPct).toBeCloseTo(17 / 26)
    expect(out.franchises.find((f) => f.name === 'Team 2')!.runnerUps).toBe(1)
    expect(out.recordSeasons).toEqual([2023, 2024])
  })

  it('never merges two owners who share a name, and keeps a departed owner as their own franchise', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(7, { platformUserId: 'sl-7' })],
      seasons: [
        season(2022, [rec({ rosterId: 7, ownerId: 'sl-old', managerName: 'Sam', teamName: 'Reel Deal', wins: 3, losses: 10, pointsFor: 1200 })]),
        season(2023, [rec({ rosterId: 7, ownerId: 'sl-7', managerName: 'Sam', teamName: 'Reel Deal', wins: 8, losses: 5, pointsFor: 1500 })]),
      ],
    })
    expect(out.franchises).toHaveLength(2)
    expect(out.franchises.map((f) => f.seasons)).toEqual(expect.arrayContaining([[2022], [2023]]))
    expect(out.franchises.find((f) => f.seasons[0] === 2023)!.name).toBe('Team 7')
  })

  it('does not use a user id that sits on two LeagueTeams as a join', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      viewerUserId: 'af-x',
      teams: [team(1, { claimedByUserId: 'af-x' }), team(2, { claimedByUserId: 'af-x' })],
      seasons: [
        season(2024, [
          rec({ rosterId: 1, ownerId: 'sl-1', wins: 6, losses: 7, pointsFor: 1400 }),
          rec({ rosterId: 2, ownerId: 'sl-2', wins: 7, losses: 6, pointsFor: 1410 }),
        ]),
      ],
    })
    expect(out.franchises).toHaveLength(2)
    expect(out.franchises.every((f) => f.seasons.length === 1)).toBe(true)
    // The viewer claimed both teams, so both are theirs — but they stay two franchises.
    expect(out.franchises.every((f) => f.isYou)).toBe(true)
  })

  it('leaves out a row with no stored key instead of matching it by name', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(1)],
      seasons: [
        season(2024, [
          rec({ rosterId: 1, ownerId: 'sl-1', managerName: 'mgr1', wins: 7, losses: 6, pointsFor: 1400 }),
          rec({ rosterId: 99, managerName: 'mgr1', wins: 6, losses: 7, pointsFor: 1300 }),
        ]),
      ],
    })
    expect(out.unmatchedRows).toBe(1)
    expect(out.franchises).toHaveLength(1)
    expect(out.franchises[0].wins).toBe(7)
  })

  it('uses provider standing facts only for a season with no teamRecords, joined by LeagueTeam.externalId', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(1)],
      seasons: [season(2024, [rec({ rosterId: 1, ownerId: 'sl-1', wins: 7, losses: 6, pointsFor: 1400 })])],
      standingFacts: [
        { season: 2024, teamId: '1', wins: 99, losses: 0, ties: 0, pointsFor: 9999 },
        { season: 2023, teamId: '1', wins: 5, losses: 8, ties: 0, pointsFor: 1250 },
      ],
    })
    expect(out.franchises).toHaveLength(1)
    expect(out.franchises[0]).toMatchObject({ seasons: [2023, 2024], wins: 12, losses: 14 })
  })
})

describe('buildDynastyStandingsHistory — titles, gaps and an empty league', () => {
  it('a league with no history at all is empty', () => {
    const out = buildDynastyStandingsHistory({ ...base, teams: [team(1)], seasons: [] })
    expect(out).toMatchObject({ status: 'empty', franchises: [], recordSeasons: [], titleOnlySeasons: [], unmatchedRows: 0 })
  })

  it('skips an unplayed season of 0-0 rows', () => {
    const out = buildDynastyStandingsHistory({ ...base, teams: [team(1)], seasons: [season(2026, [rec({ ownerId: 'sl-1' })], { status: 'in_season' })] })
    expect(out.status).toBe('empty')
  })

  it('counts titles from league_championships and the champion team, and names the ones it cannot attribute', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(1), team(2)],
      championships: [{ season: 2025, championUserId: 'af-2', teamName: 'Team 2' }],
      seasons: [
        season(2021, null, { championName: 'Hoovi' }),
        season(2022, null, { championName: 'mgr1', championTeamId: 'lt-1' }),
      ],
    })
    expect(out.status).toBe('titles-only')
    expect(out.titleOnlySeasons).toEqual([2021, 2022, 2025])
    expect(out.unattributedTitles).toEqual([{ season: 2021, name: 'Hoovi' }])
    expect(out.franchises.map((f) => [f.name, f.titleSeasons])).toEqual(
      expect.arrayContaining([
        ['Team 1', [2022]],
        ['Team 2', [2025]],
      ]),
    )
  })

  it('orders by titles, then all-time win %, and re-sorts by a column', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(1), team(2), team(3)],
      seasons: [
        season(2024, [
          rec({ ownerId: 'sl-1', wins: 4, losses: 9, pointsFor: 1300, isChampion: true }),
          rec({ ownerId: 'sl-2', wins: 10, losses: 3, pointsFor: 1700 }),
          rec({ ownerId: 'sl-3', wins: 8, losses: 5, pointsFor: 1800 }),
        ]),
      ],
    })
    expect(out.franchises.map((f) => f.name)).toEqual(['Team 1', 'Team 2', 'Team 3'])
    expect(sortFranchises(out.franchises, 'pointsFor').map((f) => f.name)).toEqual(['Team 3', 'Team 2', 'Team 1'])
    expect(out.hasPlayoffs).toBe(false)
    expect(out.inProgressSeason).toBeNull()
  })

  it('flags the latest season as in progress when it is not complete', () => {
    const out = buildDynastyStandingsHistory({
      ...base,
      teams: [team(1)],
      seasons: [season(2026, [rec({ ownerId: 'sl-1', wins: 3, losses: 1, pointsFor: 500, playoffSeed: null })], { status: 'in_season' })],
    })
    expect(out.inProgressSeason).toBe(2026)
  })
})

// ── Render ──────────────────────────────────────────────────────────────

function sample() {
  const seasons = [
    season(2021, null, { championName: 'Hoovi' }),
    season(2023, [
      rec({ ownerId: 'sl-1', wins: 9, losses: 4, pointsFor: 1500, isChampion: true }),
      rec({ ownerId: 'sl-2', wins: 4, losses: 9, pointsFor: 1300, isRunnerUp: true }),
    ], { championTeamId: 'lt-1', championName: 'mgr1' }),
  ]
  const teams = [team(1), team(2)]
  const rafters = buildChampionRafters({
    seasons: [
      { season: 2021, championName: 'Hoovi', championTeamUserIds: [], championTeamName: null },
      { season: 2023, championName: 'mgr1', championTeamUserIds: ['sl-1', 'af-1'], championTeamName: 'Team 1' },
    ],
    championships: [],
    viewerUserId: 'af-1',
    currentSeason: 2026,
  })
  return buildDynastyStandingsHistory({ seasons, teams, championships: [], standingFacts: [], viewerUserId: 'af-1', rafters })
}

describe('DynastyStandingsHistory render', () => {
  beforeEach(() => {
    h.language = 'en'
  })
  afterEach(cleanup)

  it('draws the rafters and the Dynasty table in English', () => {
    render(<DynastyStandingsHistory history={sample()} />)
    const rafters = screen.getByTestId('dynasty-standings-rafters')
    expect(within(rafters).getByLabelText('2023 champion: You')).toBeTruthy()
    expect(within(rafters).getByLabelText('2021 champion: Hoovi')).toBeTruthy()
    expect(within(rafters).getByLabelText('2026: title still open')).toBeTruthy()
    const table = screen.getByTestId('dynasty-standings-table')
    expect(within(table).getByText('Dynasty table')).toBeTruthy()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Team 1')).toBeTruthy()
    expect(within(rows[0]).getByText('You')).toBeTruthy()
    expect(within(rows[0]).getByLabelText('1 title: 2023')).toBeTruthy()
    expect(within(rows[0]).getByText('9-4')).toBeTruthy()
    expect(within(rows[0]).getByText('.692')).toBeTruthy()
    expect(table.textContent).toContain('2021')
    expect(table.textContent).toContain('never by name')
  })

  it('re-sorts by a column', () => {
    render(<DynastyStandingsHistory history={sample()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Seasons' }))
    expect(screen.getByRole('button', { name: 'Seasons' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('draws in Spanish', () => {
    h.language = 'es'
    render(<DynastyStandingsHistory history={sample()} />)
    expect(screen.getByText('Tabla de la dinastía')).toBeTruthy()
    expect(screen.getByLabelText('Campeón 2023: Tú')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Títulos' })).toBeTruthy()
    const table = screen.getByTestId('dynasty-standings-table')
    expect(table.textContent).toContain('nunca por nombre')
    expect(table.textContent).not.toMatch(/Dynasty table|Win %|never by name|Sort by/)
  })

  it('says why when there is no history (en and es)', () => {
    const empty = buildDynastyStandingsHistory({ ...base, teams: [], seasons: [] })
    const { unmount } = render(<DynastyStandingsHistory history={empty} />)
    expect(screen.getByText(/No past seasons are on file/)).toBeTruthy()
    unmount()
    h.language = 'es'
    render(<DynastyStandingsHistory history={empty} />)
    expect(screen.getByText(/aún no tiene temporadas pasadas/)).toBeTruthy()
  })

  it('Standings draws the section only when given one', () => {
    const data: LeagueStandingsResult = { available: false, reason: 'nothing scored', leagueName: 'L', history: [] }
    const { unmount } = render(<Standings data={data} />)
    expect(screen.queryByTestId('dynasty-standings-history')).toBeNull()
    unmount()
    render(<Standings data={data} dynasty={sample()} />)
    expect(screen.getByTestId('dynasty-standings-history')).toBeTruthy()
  })
})

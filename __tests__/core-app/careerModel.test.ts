import { describe, expect, it } from 'vitest'
import {
  BEST_SEASON_MIN_GAMES,
  buildCareerData,
  careerHref,
  NO_CAREER_FILTER,
  parseCareerFilter,
  rankBestSeasons,
  type CareerRow,
  type CareerSource,
} from '@/lib/core-app/careerModel'
import { row } from './careerFixtures'

function source(rows: CareerRow[], over: Partial<CareerSource> = {}): CareerSource {
  return {
    identity: { handle: 'guap', avatarUrl: null, xpTotal: 43_908 },
    rows,
    platforms: [...new Set(rows.map((r) => r.platform))],
    rosterless: 0,
    ...over,
  }
}

describe('parseCareerFilter', () => {
  it('folds case once and keeps the league filter off `league`', () => {
    const f = parseCareerFilter({ platform: 'Sleeper', sport: 'nfl', lg: 'Dynasty Dragons', league: 'L1' })
    expect(f).toEqual({ platform: 'sleeper', sport: 'NFL', league: 'dynasty dragons', fromSeason: null, toSeason: null })
  })

  it('swaps a reversed era and drops a season that is not a year', () => {
    expect(parseCareerFilter({ from: '2024', to: '2021' })).toMatchObject({ fromSeason: 2021, toSeason: 2024 })
    expect(parseCareerFilter({ from: '24', to: 'nope' })).toMatchObject({ fromSeason: null, toSeason: null })
  })

  it('builds links that keep the filter and never emit `league=`', () => {
    const href = careerHref({ ...NO_CAREER_FILTER, league: 'dynasty dragons', fromSeason: 2021 }, { view: 'records' })
    expect(href).toBe('/core/career?view=records&lg=dynasty+dragons&from=2021')
    expect(href).not.toMatch(/[?&]league=/)
    expect(careerHref(NO_CAREER_FILTER)).toBe('/core/career')
  })
})

describe('buildCareerData', () => {
  const rows = [
    row({ season: 2021, wins: 10, losses: 3, isChampion: true, madePlayoffs: true }),
    row({ season: 2022, wins: 4, losses: 10 }),
    row({ season: 2022, leagueName: 'Espn Pals', platform: 'espn', source: 'import', wins: 9, losses: 5, playoffKnown: true, madePlayoffs: true, sport: 'NFL' }),
    row({ season: 2023, leagueName: 'Hoops', sport: 'NBA', wins: 12, losses: 2 }),
    row({ season: 2024, status: 'in_season', counted: false, wins: 1, losses: 0 }),
  ]

  it('leads with accomplishments and names finals as not recorded rather than zero', () => {
    const d = buildCareerData(source(rows))
    expect(d.accomplishments.championships).toBe(1)
    expect(d.accomplishments.finals).toBeNull()
    expect(d.accomplishments.finalsNote).toMatch(/runner|lost the final/i)
    expect(d.accomplishments.playoffAppearances).toBe(2)
    expect(d.accomplishments.playoffKnown).toBe(4)
    expect(d.accomplishments.record).toBe('35-20')
  })

  it('ranks a title season above a better record, and needs a real schedule', () => {
    const best = rankBestSeasons([
      row({ season: 2020, wins: 13, losses: 1 }),
      row({ season: 2019, wins: 8, losses: 6, isChampion: true }),
      row({ season: 2018, wins: 3, losses: 0 }),
    ])
    expect(best.map((b) => b.season)).toEqual([2019, 2020])
    expect(BEST_SEASON_MIN_GAMES).toBeGreaterThan(3)
  })

  it('keeps live seasons out of every total but in the open slot', () => {
    const d = buildCareerData(source(rows))
    expect(d.seasons.map((s) => s.season)).toEqual([2021, 2022, 2023])
    expect(d.activeLeagues).toHaveLength(1)
    expect(d.leaguesPlayed).toBe(4)
  })

  it('carries a running title count and points per game per season', () => {
    const d = buildCareerData(source(rows))
    expect(d.seasons.map((s) => s.titlesToDate)).toEqual([1, 1, 1])
    const s2022 = d.seasons.find((s) => s.season === 2022)!
    expect(s2022.pointsGames).toBe(28)
    expect(s2022.pointsPerGame).toBeCloseTo(3000 / 28)
    expect(s2022.best?.leagueName).toBe('Espn Pals')
  })

  it('a season with no recorded points has null points per game, not zero', () => {
    const d = buildCareerData(source([row({ pointsFor: null })]))
    expect(d.seasons[0].pointsFor).toBeNull()
    expect(d.seasons[0].pointsPerGame).toBeNull()
  })

  it('filters by league, platform, sport and era — and options still list everything', () => {
    const byLeague = buildCareerData(source(rows), { ...NO_CAREER_FILTER, league: 'dynasty dragons' })
    expect(byLeague.seasons.map((s) => s.season)).toEqual([2021, 2022])
    expect(byLeague.filterOptions.leagues.map((l) => l.key).sort()).toEqual(['dynasty dragons', 'espn pals', 'hoops'])

    const espn = buildCareerData(source(rows), { ...NO_CAREER_FILTER, platform: 'espn' })
    expect(espn.leaguesPlayed).toBe(1)
    expect(espn.platforms).toEqual(['espn', 'sleeper'])

    const nba = buildCareerData(source(rows), { ...NO_CAREER_FILTER, sport: 'NBA' })
    expect(nba.wins).toBe(12)

    const era = buildCareerData(source(rows), { ...NO_CAREER_FILTER, fromSeason: 2022, toSeason: 2022 })
    expect(era.seasons.map((s) => s.season)).toEqual([2022])
    expect(era.filterOptions.seasons).toEqual([2021, 2022, 2023, 2024])
  })

  it('tells an empty filter apart from an empty account', () => {
    const none = buildCareerData(source(rows), { ...NO_CAREER_FILTER, fromSeason: 2030 })
    expect(none.isEmpty).toBe(true)
    expect(none.accountIsEmpty).toBe(false)

    const fresh = buildCareerData(source([row({ counted: false, status: 'in_season' })]))
    expect(fresh.isEmpty).toBe(true)
    expect(fresh.accountIsEmpty).toBe(true)
  })

  it('picks a best year only with enough games behind it', () => {
    const d = buildCareerData(source([row({ season: 2020, wins: 5, losses: 0 }), row({ season: 2021, wins: 9, losses: 4 })]))
    expect(d.accomplishments.bestYear?.season).toBe(2021)
  })

  it('reports coverage per season, including what is missing', () => {
    const d = buildCareerData(
      source(
        [
          row({ season: 2022, pointsFor: null }),
          row({ season: 2022, source: 'standing', playoffKnown: false, playoffTeams: null, inRollup: false }),
          row({ season: 2023, counted: false, status: 'in_season', wins: 0, losses: 0 }),
        ],
        { rosterless: 3 },
      ),
    )
    const c2022 = d.coverage.seasons.find((s) => s.season === 2022)!
    expect(c2022).toMatchObject({ onFile: 2, counted: 2, withRecord: 2, withPoints: 1, withPlayoffCut: 1, withChampionFlag: 1 })
    expect(d.coverage.seasons.find((s) => s.season === 2023)).toMatchObject({ inProgress: 1, withRecord: 0 })
    expect(d.coverage.missingPoints).toBe(1)
    expect(d.coverage.missingPlayoffs).toBe(1)
    expect(d.coverage.rosterless).toBe(3)
  })

  it('keeps identity and the ladder position', () => {
    const d = buildCareerData(source(rows))
    expect(d.handle).toBe('guap')
    expect(d.level).toBe(14)
    expect(d.xp?.toNext).toBe(55_000 - 43_908)
  })
})

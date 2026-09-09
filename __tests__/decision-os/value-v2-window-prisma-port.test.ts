import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  allPlayAsOfWeek, createWindowFactsPrismaPort, forecastForTeam, INJURY_BASIS,
} from '@/lib/decision-os/value-v2/windowFactsPrismaPort'
import { assembleWindowFacts, MIN_INJURY_COVERAGE } from '@/lib/decision-os/value-v2/windowFacts'
import { resolveWindowDecision } from '@/lib/decision-os/value-v2/windowDecision'

/**
 * Repository-shaped fixtures. The fake applies the same filters the real client
 * would, so a port that forgets a `where` clause fails here rather than passing
 * against a stub that returns whatever it is asked for.
 */
type MatchupRow = { leagueId: string; seasonYear: number; rosterId: string; week: number; pointsFor: number; pointsAgainst: number; win: number | null }
type TeamRow = { leagueId: string; externalId: string; teamName: string | null; ownerName: string | null }
type ForecastRow = { leagueId: string; season: number; week: number; teamForecasts: unknown; generatedAt: Date }
type DynastyRow = {
  leagueId: string; teamId: string; season: number
  projectedStrength3Years: number; projectedStrengthNextYear: number
  windowStartYear: number | null; windowEndYear: number | null
  confidenceScore: number | null; generatedAt: Date
}

interface Fixtures { matchups: MatchupRow[]; teams: TeamRow[]; forecasts: ForecastRow[]; dynasty: DynastyRow[] }

function fakePrisma(f: Fixtures): PrismaClient {
  return {
    leagueTeam: {
      findFirst: async ({ where }: any) => f.teams.find(t =>
        t.leagueId === where.leagueId && t.externalId === where.externalId) ?? null,
    },
    weeklyMatchup: {
      findMany: async ({ where }: any) => f.matchups
        .filter(m => m.leagueId === where.leagueId && m.seasonYear === where.seasonYear && m.week <= where.week.lte)
        .sort((a, b) => a.week - b.week),
    },
    seasonForecastSnapshot: {
      findFirst: async ({ where }: any) => f.forecasts
        .filter(r => r.leagueId === where.leagueId && r.season === where.season && r.week <= where.week.lte)
        .sort((a, b) => b.week - a.week)[0] ?? null,
    },
    dynastyProjectionSnapshot: {
      findFirst: async ({ where }: any) => f.dynasty.find(r =>
        r.leagueId === where.leagueId && r.teamId === where.teamId && r.season === where.season) ?? null,
    },
  } as unknown as PrismaClient
}

const LEAGUE = 'af-league-1'
const PLATFORM = 'sleeper-999'
const SEASON = 2026

/** Four teams, six scored weeks. Team "1" wins a lot; team "4" loses a lot. */
function matchups(): MatchupRow[] {
  const rows: MatchupRow[] = []
  const points: Record<string, number> = { '1': 130, '2': 110, '3': 95, '4': 70 }
  for (let week = 1; week <= 6; week += 1) {
    for (const rosterId of ['1', '2', '3', '4']) {
      const pf = points[rosterId]
      const opponent = rosterId === '1' ? '4' : rosterId === '4' ? '1' : rosterId === '2' ? '3' : '2'
      rows.push({
        leagueId: PLATFORM, seasonYear: SEASON, rosterId, week,
        pointsFor: pf, pointsAgainst: points[opponent],
        win: pf > points[opponent] ? 1 : 0,
      })
    }
  }
  return rows
}

const teamForecasts = (probByTeam: Record<string, number>) =>
  Object.entries(probByTeam).map(([teamId, playoffProbability]) => ({ teamId, playoffProbability }))

function fixtures(over: Partial<Fixtures> = {}): Fixtures {
  return {
    matchups: matchups(),
    teams: [
      { leagueId: LEAGUE, externalId: '1', teamName: 'Anvil Chorus', ownerName: 'Rae' },
      { leagueId: LEAGUE, externalId: '4', teamName: 'Ditchwater', ownerName: 'Sam' },
    ],
    forecasts: [4, 5, 6].map(week => ({
      leagueId: LEAGUE, season: SEASON, week,
      teamForecasts: teamForecasts({ '1': 94.5, '4': 2.5 }),
      generatedAt: new Date(`2026-10-0${week}T12:00:00.000Z`),
    })),
    dynasty: [
      { leagueId: LEAGUE, teamId: '1', season: SEASON, projectedStrength3Years: 88, projectedStrengthNextYear: 84, windowStartYear: 2026, windowEndYear: 2029, confidenceScore: 76, generatedAt: new Date('2026-10-06T12:00:00.000Z') },
      { leagueId: LEAGUE, teamId: '4', season: SEASON, projectedStrength3Years: 19, projectedStrengthNextYear: 22, windowStartYear: null, windowEndYear: null, confidenceScore: 61, generatedAt: new Date('2026-10-06T12:00:00.000Z') },
    ],
    ...over,
  }
}

const availability = (byId: Record<string, string>) =>
  async (_sport: string, ids: string[]) => new Map(ids.filter(i => byId[i]).map(i => [i, byId[i]]))

const healthyRoster = ['p1', 'p2', 'p3', 'p4']
const healthy = availability({ p1: 'available', p2: 'available', p3: 'available', p4: 'available' })

const makePort = (f: Fixtures, over: Partial<Parameters<typeof createWindowFactsPrismaPort>[0]> = {}) =>
  createWindowFactsPrismaPort({
    prisma: fakePrisma(f), platformLeagueId: PLATFORM, sport: 'nfl',
    rosterPlayerIds: healthyRoster, loadAvailability: healthy, ...over,
  })

const scope = (teamId: string, week = 6) => ({ leagueId: LEAGUE, teamId, season: SEASON, week })

describe('all-play as of a week', () => {
  it('reconstructs a prior week rather than always reporting the latest', () => {
    const rows = matchups()
    const w3 = allPlayAsOfWeek(rows, '1', 3)!
    const w6 = allPlayAsOfWeek(rows, '1', 6)!
    expect(w3.weeksCounted).toBe(3)
    expect(w6.weeksCounted).toBe(6)
    expect(w3.wins).toBe(3)
    expect(w6.wins).toBe(6)
  })

  it('measures luck against the whole league, not the opponent', () => {
    // Team 1 outscores everyone every week, so its schedule earned it nothing.
    expect(allPlayAsOfWeek(matchups(), '1', 6)!.luckWins).toBe(0)
    // Team 3 beats team 2 never and loses to everyone above it.
    const t3 = allPlayAsOfWeek(matchups(), '3', 6)!
    expect(t3.wins).toBe(0)
    expect(t3.luckWins).toBeLessThanOrEqual(0)
  })

  it('does not count a week nobody scored', () => {
    const rows = [...matchups(), ...['1', '2', '3', '4'].map(rosterId => ({
      leagueId: PLATFORM, seasonYear: SEASON, rosterId, week: 7, pointsFor: 0, pointsAgainst: 0, win: null,
    }))]
    expect(allPlayAsOfWeek(rows, '1', 7)!.weeksCounted).toBe(6)
  })

  it('returns null when no week has been played', () => {
    expect(allPlayAsOfWeek(matchups(), '1', 0)).toBeNull()
  })
})

describe('forecast payload extraction', () => {
  it('finds the requested team inside the stored array', () => {
    expect(forecastForTeam(teamForecasts({ '1': 94.5, '4': 2.5 }), '4')).toBe(2.5)
  })

  it('returns null for a team absent from the payload, never zero', () => {
    expect(forecastForTeam(teamForecasts({ '1': 94.5 }), '9')).toBeNull()
  })

  it('returns null for a malformed payload', () => {
    expect(forecastForTeam(null, '1')).toBeNull()
    expect(forecastForTeam({ notAnArray: true }, '1')).toBeNull()
  })
})

describe('prisma port mapping', () => {
  it('maps every stored field onto the fact contract', async () => {
    const result = await assembleWindowFacts(scope('1'), makePort(fixtures()))
    expect(result.gaps).toEqual([])
    expect(result.facts).toMatchObject({
      leagueId: LEAGUE, teamId: '1', season: SEASON, week: 6,
      wins: 6, losses: 0, ties: 0,
      pickTreatment: 'included-in-roster-strength', futurePickCapital: null,
    })
    expect(result.facts!.playoffProbability).toBeCloseTo(0.945, 10)
    expect(result.facts!.rosterStrength3Year).toBeCloseTo(0.88, 10)
  })

  it('resolves team and manager identity', async () => {
    const { evidence } = await assembleWindowFacts(scope('1'), makePort(fixtures()))
    expect(evidence.identity).toMatchObject({ teamId: '1', teamName: 'Anvil Chorus', managerName: 'Rae' })
  })

  it('refuses a team that is not in the league', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope('7'), makePort(fixtures()))
    expect(facts).toBeNull()
    expect(gaps).toContain('team_identity_missing')
  })

  it('carries the producers timestamps and the real forecast week', async () => {
    const { evidence } = await assembleWindowFacts(scope('1'), makePort(fixtures()))
    expect(evidence.forecast!.generatedAt).toBe('2026-10-06T12:00:00.000Z')
    expect(evidence.dynasty!.generatedAt).toBe('2026-10-06T12:00:00.000Z')
    expect(evidence.forecast!.week).toBe(6)
  })

  it('carries the timeline and short-term strength the dynasty engine recorded', async () => {
    const { evidence } = await assembleWindowFacts(scope('1'), makePort(fixtures()))
    expect(evidence.dynasty).toMatchObject({
      projectedStrengthNextYearPct: 84, windowStartYear: 2026, windowEndYear: 2029, confidencePct: 76,
    })
  })
})

describe('league and season isolation', () => {
  it('does not read another leagues matchups', async () => {
    const f = fixtures()
    const port = createWindowFactsPrismaPort({
      prisma: fakePrisma(f), platformLeagueId: 'sleeper-OTHER', sport: 'nfl',
      rosterPlayerIds: healthyRoster, loadAvailability: healthy,
    })
    const { facts, gaps } = await assembleWindowFacts(scope('1'), port)
    expect(facts).toBeNull()
    expect(gaps).toContain('all_play_record_missing')
  })

  it('does not read another seasons forecast or projection', async () => {
    const { facts, gaps } = await assembleWindowFacts({ ...scope('1'), season: 2025 }, makePort(fixtures()))
    expect(facts).toBeNull()
    expect(gaps).toEqual(expect.arrayContaining(['season_forecast_missing', 'dynasty_projection_missing']))
  })

  it('refuses when the platform league id is absent rather than guessing it', async () => {
    const port = makePort(fixtures(), { platformLeagueId: null })
    const { gaps } = await assembleWindowFacts(scope('1'), port)
    expect(gaps).toContain('all_play_record_missing')
  })
})

describe('stale and missing facts', () => {
  it('refuses when the newest forecast is more than one week behind', async () => {
    const f = fixtures({ forecasts: [{
      leagueId: LEAGUE, season: SEASON, week: 2,
      teamForecasts: teamForecasts({ '1': 94.5 }), generatedAt: new Date('2026-09-08T12:00:00.000Z'),
    }] })
    const { facts, gaps } = await assembleWindowFacts(scope('1'), makePort(f))
    expect(facts).toBeNull()
    expect(gaps).toContain('season_forecast_stale')
  })

  it('accepts a forecast exactly one week behind', async () => {
    const f = fixtures({ forecasts: [{
      leagueId: LEAGUE, season: SEASON, week: 5,
      teamForecasts: teamForecasts({ '1': 94.5 }), generatedAt: new Date('2026-10-01T12:00:00.000Z'),
    }] })
    const { gaps } = await assembleWindowFacts(scope('1'), makePort(f))
    expect(gaps).toEqual([])
  })

  it('refuses when the dynasty projection is absent', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope('1'), makePort(fixtures({ dynasty: [] })))
    expect(facts).toBeNull()
    expect(gaps).toContain('dynasty_projection_missing')
  })
})

describe('injury load', () => {
  it('states the basis it actually used rather than implying a value weighting', async () => {
    const { evidence } = await assembleWindowFacts(scope('1'), makePort(fixtures()))
    expect(evidence.injuries!.basis).toBe(INJURY_BASIS)
    expect(evidence.injuries!.treatment).toBe('excluded')
  })

  it('counts only players categorised unavailable', async () => {
    const port = makePort(fixtures(), {
      loadAvailability: availability({ p1: 'unavailable', p2: 'questionable', p3: 'available', p4: 'available' }),
    })
    const { evidence } = await assembleWindowFacts(scope('1'), port)
    expect(evidence.injuries!.unavailableShare).toBeCloseTo(0.25, 10)
    expect(evidence.injuries!.coverage).toBeCloseTo(1, 10)
  })

  it('excludes unknown players from the denominator and reports the coverage', async () => {
    const port = makePort(fixtures(), {
      loadAvailability: availability({ p1: 'unavailable', p2: 'available' }),
    })
    const { evidence, gaps } = await assembleWindowFacts(scope('1'), port)
    expect(evidence.injuries!.coverage).toBeCloseTo(0.5, 10)
    expect(evidence.injuries!.unavailableShare).toBeCloseTo(0.5, 10)
    expect(gaps).toEqual([])
    expect(MIN_INJURY_COVERAGE).toBe(0.5)
  })

  it('refuses when coverage is below the floor instead of reporting a share of nothing', async () => {
    const port = makePort(fixtures(), { loadAvailability: availability({ p1: 'available' }) })
    const { facts, gaps } = await assembleWindowFacts(scope('1'), port)
    expect(facts).toBeNull()
    expect(gaps).toContain('injury_coverage_below_floor')
  })

  it('refuses when no player resolved at all, never assuming healthy', async () => {
    const port = makePort(fixtures(), { loadAvailability: availability({}) })
    const { facts, gaps } = await assembleWindowFacts(scope('1'), port)
    expect(facts).toBeNull()
    expect(gaps).toContain('injury_load_missing')
  })

  it('refuses when the roster is empty', async () => {
    const port = makePort(fixtures(), { rosterPlayerIds: [] })
    const { gaps } = await assembleWindowFacts(scope('1'), port)
    expect(gaps).toContain('injury_load_missing')
  })
})

describe('integration: fixtures to a window decision', () => {
  it('drives a contender all the way from stored rows', async () => {
    const decision = await resolveWindowDecision(scope('1'), makePort(fixtures()))
    expect(decision.state).toBe('evidenced')
    expect(decision.status).toBe('contender')
    expect(decision.identity).toMatchObject({ teamId: '1', teamName: 'Anvil Chorus', managerName: 'Rae' })
    expect(decision.teamFit.winNowWeight).toBeGreaterThan(1)
    expect(decision.teamFit.longTermWeight).toBeLessThan(1)
    expect(decision.sourceConfidence).toBeCloseTo(0.76, 10)
    expect(decision.timestamps.forecastWeek).toBe(6)
  })

  it('drives a rebuilder to the opposite weighting from the same fixtures', async () => {
    const decision = await resolveWindowDecision(scope('4'), makePort(fixtures()))
    expect(decision.status).toBe('rebuilding')
    expect(decision.teamFit.longTermWeight).toBeGreaterThan(1)
    expect(decision.teamFit.winNowWeight).toBeLessThan(1)
  })

  it('refuses, and does not fall back to competitive, when evidence is missing', async () => {
    const decision = await resolveWindowDecision(scope('1'), makePort(fixtures({ dynasty: [] })))
    expect(decision.state).toBe('refused')
    expect(decision.status).toBeNull()
    expect(decision.teamFit).toEqual({ winNowWeight: 1, longTermWeight: 1, basis: 'unresolved' })
    expect(decision.gaps).toContain('dynasty_projection_missing')
  })
})

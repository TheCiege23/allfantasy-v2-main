/**
 * Conference leagues play through the tournament's bracket weeks, and the tournament scores
 * bracket rounds from the right league weeks.
 *
 * Before: a conference league was created with the sport default season (NFL: 18 weeks, league
 * playoffs from week 15), so from week 15 only the league's playoff teams had a matchup — most
 * bracket entrants had no score in bracket weeks — and the tournament's standings were copied
 * from the league table, which kept counting bracket weeks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn(), create: vi.fn(async ({ data }: { data: unknown }) => data) },
  redraftMatchup: { count: vi.fn(async () => 0), createMany: vi.fn(async () => ({ count: 0 })), findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  isGuillotine: vi.fn(async () => false),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: m.league, redraftSeason: m.redraftSeason, redraftMatchup: m.redraftMatchup, redraftRoster: m.redraftRoster } }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ isGuillotineLeague: m.isGuillotine, getGuillotineConfig: vi.fn(async () => null) }))

const { ensureRedraftSeason, ensureScheduleForNewSeason } = await import('@/lib/redraft/finalizeDraftToRedraftSeason')
const { resolveCreatedSeasonWeeks } = await import('@/lib/redraft/createdSeasonLength')
const { buildConferenceSeasonPlan, readConferenceSeasonPlan, CONFERENCE_SEASON_PLAN_KEY } = await import('@/lib/tournament/divisions/conferenceSeasonPlan')
const { defaultFormatSettings, divisionsCalendar } = await import('@/lib/tournament/divisions/engine')
const { readWeekScores, readSeasonSummaries } = await import('@/lib/tournament/divisions/weekScores')

const nflPlan = buildConferenceSeasonPlan('t1', defaultFormatSettings('NFL'))
const conferenceLeague = (settings: Record<string, unknown>, sport = 'NFL') => ({
  id: 'L1', sport, season: 2026, medianGame: false, playoffStartWeek: 15, playoffTeams: 6, playoffWeeksPerRound: 1,
  dynastyConfig: null, bbContestId: null, bestBallMode: false, settings,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.redraftSeason.findFirst.mockResolvedValue(null)
})

describe('the conference season plan follows the tournament calendar', () => {
  it('NFL: regular season 1-10, bracket weeks 11-17, league plays through 17', () => {
    const cal = divisionsCalendar(defaultFormatSettings('NFL'))
    expect(nflPlan).toMatchObject({ regularSeasonEnd: 10, bracketStartWeek: 11, lastWeek: 17 })
    expect(nflPlan.bracketWeeks).toEqual([11, 12, 13, 14, 15, 16, 17])
    expect(nflPlan.bracketWeeks).toEqual(cal.weeks.map(w => w.week))
  })

  it('NBA: the league plays through the engine calendar’s last week', () => {
    const nba = buildConferenceSeasonPlan('t1', defaultFormatSettings('NBA'))
    expect(nba.lastWeek).toBe(divisionsCalendar(defaultFormatSettings('NBA')).lastWeek)
    expect(nba.lastWeek).toBe(24)
  })

  it('round-trips through league settings and rejects a malformed plan', () => {
    expect(readConferenceSeasonPlan({ [CONFERENCE_SEASON_PLAN_KEY]: nflPlan })).toEqual(nflPlan)
    expect(readConferenceSeasonPlan({ [CONFERENCE_SEASON_PLAN_KEY]: { ...nflPlan, lastWeek: 9 } })).toBeNull()
    expect(readConferenceSeasonPlan({ [CONFERENCE_SEASON_PLAN_KEY]: { ...nflPlan, bracketWeeks: [11, 13] } })).toBeNull()
    expect(readConferenceSeasonPlan({})).toBeNull()
  })
})

describe('a created conference league’s season and schedule', () => {
  it('season length is the tournament’s last week, not the sport default', () => {
    expect(resolveCreatedSeasonWeeks({ settings: { [CONFERENCE_SEASON_PLAN_KEY]: nflPlan } }, 18)).toBe(17)
  })

  it('the first season runs weeks 1-17 with no league playoffs', async () => {
    m.league.findUnique.mockResolvedValue(conferenceLeague({ [CONFERENCE_SEASON_PLAN_KEY]: nflPlan }))
    await ensureRedraftSeason('L1')
    expect(m.redraftSeason.create.mock.calls[0]![0].data).toMatchObject({ totalWeeks: 17, playoffStartWeek: 18 })
  })

  it('control: an ordinary league keeps its playoffs', async () => {
    m.league.findUnique.mockResolvedValue(conferenceLeague({}))
    await ensureRedraftSeason('L1')
    const data = m.redraftSeason.create.mock.calls[0]![0].data as { totalWeeks: number; playoffStartWeek: number }
    expect(data.playoffStartWeek).toBe(15)
  })

  it('every team has a head-to-head matchup in every week through 17, bracket weeks included', async () => {
    m.league.findUnique.mockResolvedValue({ survivorMode: false })
    m.redraftRoster.findMany.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}` })))
    await ensureScheduleForNewSeason({ seasonId: 's1', leagueId: 'L1', sport: 'NFL', totalWeeks: 17, playoffStartWeek: 18, medianGame: false })
    const rows = (m.redraftMatchup.createMany.mock.calls[0] as unknown as [{ data: Array<{ week: number; homeRosterId: string; awayRosterId: string | null }> }])[0].data
    for (let week = 1; week <= 17; week++) {
      const inWeek = rows.filter(r => r.week === week)
      const teams = new Set(inWeek.flatMap(r => [r.homeRosterId, r.awayRosterId]))
      expect(inWeek.every(r => r.awayRosterId), `week ${week} has a bye`).toBe(true)
      expect(teams.size, `week ${week}`).toBe(12)
    }
    expect(Math.max(...rows.map(r => r.week))).toBe(17)
  })
})

describe('tournament scoring reads the right league weeks', () => {
  // Two entrants in one league, playing each other every week; A wins weeks 1-10, B wins the bracket weeks.
  const rows = Array.from({ length: 17 }, (_, i) => {
    const week = i + 1
    return { week, homeRosterId: 'rA', awayRosterId: 'rB', homeScore: week <= 10 ? 120 : 80, awayScore: week <= 10 ? 90 : 130, status: 'final' }
  })
  const leagues = [{ leagueId: 'L1', participants: [{ id: 'A', redraftRosterId: 'rA' }, { id: 'B', redraftRosterId: 'rB' }] }]
  beforeEach(() => {
    m.redraftSeason.findFirst.mockResolvedValue({ id: 's1' })
    m.redraftMatchup.findMany.mockImplementation(async ({ where }: { where: { week: { gte: number; lte: number } } }) => rows.filter(r => r.week >= where.week.gte && r.week <= where.week.lte))
  })

  it('bracket round r is scored from calendar week bracketWeeks[r-1]', async () => {
    for (const [round, week] of nflPlan.bracketWeeks.entries()) {
      m.redraftMatchup.findMany.mockClear()
      const scores = await readWeekScores(leagues, week)
      expect(m.redraftMatchup.findMany.mock.calls[0]![0].where.week, `round ${round + 1}`).toEqual({ gte: week, lte: week })
      expect(scores.get('A')).toEqual({ points: 80, final: true })
      expect(scores.get('B')).toEqual({ points: 130, final: true })
    }
  })

  it('seeding records count the tournament regular season only, never bracket weeks', async () => {
    const summaries = await readSeasonSummaries(leagues, nflPlan.regularSeasonEnd)
    expect(summaries.get('A')).toMatchObject({ wins: 10, losses: 0, ties: 0, points: 1200, bestWeek: 120 })
    expect(summaries.get('B')).toMatchObject({ wins: 0, losses: 10, points: 900 })
  })
})

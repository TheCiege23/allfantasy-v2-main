/**
 * Every standard weekly league advances its weeks, plays its league median, and is reached by
 * score-sync.
 *
 * Measured on 637ecd5ab:
 *   - the schedule and playoff runtimes accepted only NFL redraft, so every NFL keeper, dynasty and
 *     best-ball league — and every NHL/NCAAB league — was refused by the hourly roller and sat on
 *     week 1: no standings past it, no bracket, no champion, no keeper window;
 *   - `League.medianGame` was offered and stored, and nothing computed it;
 *   - score-sync took the first 50 seasons with no order, so the 51st onward were never scored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findFirstRedraftSeason: vi.fn(),
  findManyLeagueTeam: vi.fn(),
  buildCanonicalScheduleRuntimeState: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: h.findFirstRedraftSeason },
    leagueTeam: { findMany: h.findManyLeagueTeam },
  },
}))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules: vi.fn() }))
vi.mock('@/lib/roster-runtime/resolveNflRedraftRosterRuntime', () => ({ resolveNflRedraftRosterRuntime: vi.fn() }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn() }))
vi.mock('@/lib/playoff-runtime', () => ({ generateNflRedraftPlayoffRuntimeBracket: vi.fn() }))
vi.mock('@/lib/schedule-runtime/canonicalScheduleRuntime', () => ({
  buildCanonicalScheduleRuntimeState: h.buildCanonicalScheduleRuntimeState,
  buildScheduleGeneratedEvents: vi.fn(),
  buildScheduleRuntimeEvent: vi.fn((e: unknown) => e),
  generateCanonicalRegularSeasonSchedule: vi.fn(),
  planCanonicalScheduleWeekTransition: vi.fn(),
}))

import { resolveNflRedraftScheduleRuntime } from '@/lib/schedule-runtime/resolveNflRedraftScheduleRuntime'
import { runsStandardWeeklySeason, seasonSportToLeagueSport } from '@/lib/season-week/standardSeasonScope'
import { computeWeeklyMedianResults } from '@/lib/redraft/medianGame'
import { rotatingBatch } from '@/lib/redraft/scoreSyncBatch'

beforeEach(() => {
  vi.clearAllMocks()
  h.findFirstRedraftSeason.mockResolvedValue({
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 3,
    status: 'active',
    totalWeeks: 17,
    playoffStartWeek: 15,
    rosters: [{ id: 'r1' }, { id: 'r2' }],
    schedule: [],
  })
  h.findManyLeagueTeam.mockResolvedValue([])
  h.buildCanonicalScheduleRuntimeState.mockReturnValue({ teams: [], weeks: [], validationIssues: [] })
})

const rules = (sport: string, format: string) => ({ general: { sport, format } }) as never

describe('which leagues the weekly season covers', () => {
  it.each([
    ['NFL', 'redraft', true],
    ['NFL', 'keeper', true],
    ['NFL', 'dynasty', true],
    ['NFL', 'best_ball', true],
    ['NFL', 'devy', true],
    ['NHL', 'redraft', true],
    ['NCAAB', 'dynasty', true],
    ['NFL', 'guillotine', false],
    ['NFL', 'survivor', false],
    ['NFL', 'zombie', false],
    ['MLB', 'redraft', false],
    ['SOCCER', 'redraft', false],
  ])('%s %s → %s', (sport, format, expected) => {
    expect(runsStandardWeeklySeason(sport, format)).toBe(expected)
  })

  it('reads the season row’s config keys as sports', () => {
    expect(seasonSportToLeagueSport('NCAAFB')).toBe('NCAAF')
    expect(seasonSportToLeagueSport('nhl')).toBe('NHL')
  })

  it.each([
    ['NFL', 'keeper'],
    ['NFL', 'dynasty'],
    ['NFL', 'best_ball'],
    ['NHL', 'redraft'],
  ])('the schedule runtime resolves a %s %s season (it refused all of these)', async (sport, format) => {
    const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: 'season-1' }, { loadRules: async () => rules(sport, format) })
    expect(resolved.ok).toBe(true)
  })

  it('still refuses a format with its own engine', async () => {
    const resolved = await resolveNflRedraftScheduleRuntime({ seasonId: 'season-1' }, { loadRules: async () => rules('NFL', 'guillotine') })
    expect(resolved).toEqual({ ok: false, reason: 'not_nfl_redraft' })
  })
})

describe('league median', () => {
  const game = (week: number, home: string, away: string | null, hs: number, as: number, status = 'final') => ({
    week, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, status,
  })

  it('wins above the week’s median and loses below it', () => {
    const [week] = computeWeeklyMedianResults([game(1, 'a', 'b', 120, 90), game(1, 'c', 'd', 100, 80)])
    // Scores 120, 100, 90, 80 → median 95.
    expect(week.median).toBe(95)
    expect(Object.fromEntries(week.outcomes)).toEqual({ a: 'W', c: 'W', b: 'L', d: 'L' })
  })

  it('does not judge a week until every game in it is final', () => {
    expect(computeWeeklyMedianResults([game(1, 'a', 'b', 120, 90), game(1, 'c', 'd', 100, 80, 'in_progress')])).toEqual([])
  })

  it('an odd league: the team on a bye plays the median once its score is in', () => {
    const [week] = computeWeeklyMedianResults([game(1, 'a', 'b', 120, 90), game(1, 'c', null, 100, 0)])
    expect(week.median).toBe(100)
    expect(Object.fromEntries(week.outcomes)).toEqual({ a: 'W', b: 'L', c: 'T' })
  })

  it('an unscored bye sits the median out instead of losing on a zero', () => {
    const [week] = computeWeeklyMedianResults([game(1, 'a', 'b', 120, 90), game(1, 'c', null, 0, 0, 'scheduled')])
    expect([...week.outcomes.keys()].sort()).toEqual(['a', 'b'])
  })
})

describe('score-sync reaches every season', () => {
  const ids = Array.from({ length: 120 }, (_, i) => i)
  const tick = 5 * 60 * 1000

  it('covers all seasons within ceil(count / 50) ticks', () => {
    const seen = new Set<number>()
    for (let t = 0; t < 3; t++) for (const id of rotatingBatch(ids, 50, t * tick)) seen.add(id)
    expect(seen.size).toBe(120)
  })

  it('takes everything when there are 50 or fewer', () => {
    expect(rotatingBatch(ids.slice(0, 30), 50, 12345)).toHaveLength(30)
  })
})

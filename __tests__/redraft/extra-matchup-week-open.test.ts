import { describe, it, expect, vi, beforeEach } from 'vitest'

/*
 * The extra matchup's pick is fixed when a week opens, from the same hook the weekly waiver reset
 * uses (`advanceNflRedraftScheduleWeek`). A failed pick never fails the advance.
 */

const { assignExtraMatchupForWeek, applyWeeklyWaiverPriorityReset } = vi.hoisted(() => ({
  assignExtraMatchupForWeek: vi.fn(),
  applyWeeklyWaiverPriorityReset: vi.fn(),
}))
vi.mock('@/lib/redraft/oddTeamExtraMatchup', () => ({ assignExtraMatchupForWeek }))
vi.mock('@/lib/waiver-wire/weekly-priority-reset', () => ({ applyWeeklyWaiverPriorityReset }))
vi.mock('@/lib/redraft/fantraxNativePresentation', () => ({ loadFantraxNativePresentation: vi.fn().mockResolvedValue(null) }))

const {
  findFirstRedraftSeason,
  updateRedraftSeason,
  findManyLeagueTeam,
  resolveCanonicalLeagueRules,
  resolveNflRedraftRosterRuntime,
  updateStandings,
  generateNflRedraftPlayoffRuntimeBracket,
  buildCanonicalScheduleRuntimeState,
  planCanonicalScheduleWeekTransition,
} = vi.hoisted(() => ({
  findFirstRedraftSeason: vi.fn(),
  updateRedraftSeason: vi.fn(),
  findManyLeagueTeam: vi.fn(),
  resolveCanonicalLeagueRules: vi.fn(),
  resolveNflRedraftRosterRuntime: vi.fn(),
  updateStandings: vi.fn(),
  generateNflRedraftPlayoffRuntimeBracket: vi.fn(),
  buildCanonicalScheduleRuntimeState: vi.fn(),
  planCanonicalScheduleWeekTransition: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: findFirstRedraftSeason, update: updateRedraftSeason },
    leagueTeam: { findMany: findManyLeagueTeam },
  },
}))
vi.mock('@/lib/league-runtime', () => ({ resolveCanonicalLeagueRules }))
vi.mock('@/lib/roster-runtime/resolveNflRedraftRosterRuntime', () => ({ resolveNflRedraftRosterRuntime }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings }))
vi.mock('@/lib/playoff-runtime', () => ({ generateNflRedraftPlayoffRuntimeBracket }))
// A DIFFERENT module from the one under test — safe to mock in full without
// touching `advanceNflRedraftScheduleWeek`/`resolveNflRedraftScheduleRuntime`
// themselves, which live in this file's subject module.
vi.mock('@/lib/schedule-runtime/canonicalScheduleRuntime', () => ({
  buildCanonicalScheduleRuntimeState,
  buildScheduleGeneratedEvents: vi.fn(),
  buildScheduleRuntimeEvent: vi.fn((e: unknown) => e),
  generateCanonicalRegularSeasonSchedule: vi.fn(),
  planCanonicalScheduleWeekTransition,
}))

import { advanceNflRedraftScheduleWeek } from '@/lib/schedule-runtime/resolveNflRedraftScheduleRuntime'

beforeEach(() => {
  vi.clearAllMocks()
  findFirstRedraftSeason.mockResolvedValue({
    id: 'season-1', leagueId: 'league-1', currentWeek: 3, status: 'active', totalWeeks: 17, playoffStartWeek: 15,
    rosters: [{ id: 'roster-1', ownerId: 'user-1', ownerName: 'Owner', teamName: 'Team' }], schedule: [],
  })
  findManyLeagueTeam.mockResolvedValue([])
  resolveCanonicalLeagueRules.mockResolvedValue({ general: { sport: 'NFL', format: 'redraft' } })
  resolveNflRedraftRosterRuntime.mockResolvedValue({ ok: true, coverage: { teamsWithPlayers: 1, teams: 1 } })
  updateStandings.mockResolvedValue(undefined)
  applyWeeklyWaiverPriorityReset.mockResolvedValue(undefined)
  assignExtraMatchupForWeek.mockResolvedValue({ status: 'assigned' })
  buildCanonicalScheduleRuntimeState.mockReturnValue({
    leagueId: 'league-1', status: 'active', currentWeek: 3, regularSeasonWeeks: 14, teams: [], weeks: [], validationIssues: [],
  })
})

function advanceTo(week: number) {
  planCanonicalScheduleWeekTransition.mockReturnValue({ ok: true, action: 'advance_week', nextStatus: 'active', currentWeek: week, lockedWeeks: [], events: [] })
}

describe('the extra matchup is fixed when the week opens', () => {
  it('advancing into week 4 fixes week 4\'s pick, after the standings are recomputed', async () => {
    advanceTo(4)
    const result = await advanceNflRedraftScheduleWeek({ seasonId: 'season-1', action: 'advance_week', week: 3 })
    expect(result.ok).toBe(true)
    expect(assignExtraMatchupForWeek).toHaveBeenCalledWith({ seasonId: 'season-1', week: 4 })
    expect(updateStandings.mock.invocationCallOrder[0]!).toBeLessThan(assignExtraMatchupForWeek.mock.invocationCallOrder[0]!)
  })

  it('a re-run that opens no new week does not ask again', async () => {
    advanceTo(3)
    await advanceNflRedraftScheduleWeek({ seasonId: 'season-1', action: 'complete_week', week: 3 })
    expect(assignExtraMatchupForWeek).not.toHaveBeenCalled()
  })

  it('a failed pick never fails the advance', async () => {
    advanceTo(4)
    assignExtraMatchupForWeek.mockRejectedValueOnce(new Error('db down'))
    const result = await advanceNflRedraftScheduleWeek({ seasonId: 'season-1', action: 'advance_week', week: 3 })
    expect(result.ok).toBe(true)
  })
})

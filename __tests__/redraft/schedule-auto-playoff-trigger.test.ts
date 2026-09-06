import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 `regular_season_complete` WAS AN UNREAD SIGNAL.
 *
 * The playoff bracket engine (`generateNflRedraftPlayoffRuntimeBracket`) was
 * fully built and correctly reads league settings for team count/start week —
 * but nothing ever called it automatically. A season could sit at
 * `RedraftSeason.status = 'regular_season_complete'` indefinitely until a
 * commissioner remembered the separate manual "Generate bracket" action.
 *
 * Decision: auto-generate on the transition, not leave it manual. Week
 * advancement itself is already a commissioner-gated action
 * (`assertLeagueCommissioner`) that already refuses to fire while any
 * non-bye matchup is incomplete — so by the time `regular_season_complete` is
 * reached, a human has already made the "the season is over" call and the
 * data is already trustworthy. Auto-generating just removes the second,
 * redundant click. The bracket is not locked by default, so a commissioner
 * can still `regenerate_bracket` before playoffs begin if something needs
 * correcting.
 *
 * These tests pin: the trigger fires exactly on the transition edge (not on
 * every subsequent call once already complete), never fires for an ordinary
 * mid-season advance, and a failure in bracket generation does not fail the
 * week-advance action itself.
 */

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
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 17,
    status: 'active',
    totalWeeks: 17,
    playoffStartWeek: 15,
    rosters: [{ id: 'roster-1', ownerId: 'user-1', ownerName: 'Owner', teamName: 'Team' }],
    schedule: [],
  })
  findManyLeagueTeam.mockResolvedValue([])
  resolveCanonicalLeagueRules.mockResolvedValue({ general: { sport: 'NFL', format: 'redraft' } })
  resolveNflRedraftRosterRuntime.mockResolvedValue({ ok: true, coverage: { teamsWithPlayers: 1, teams: 1 } })
  updateStandings.mockResolvedValue(undefined)
  generateNflRedraftPlayoffRuntimeBracket.mockResolvedValue({ ok: true })
})

function mockState(status: string) {
  buildCanonicalScheduleRuntimeState.mockReturnValue({
    leagueId: 'league-1',
    status,
    currentWeek: 17,
    regularSeasonWeeks: 17,
    teams: [],
    weeks: [],
    validationIssues: [],
  })
}

describe('advanceNflRedraftScheduleWeek — auto playoff bracket trigger', () => {
  it('generates the bracket exactly on the transition into regular_season_complete', async () => {
    mockState('active')
    planCanonicalScheduleWeekTransition.mockReturnValue({
      ok: true,
      action: 'advance_week',
      nextStatus: 'regular_season_complete',
      currentWeek: 17,
      lockedWeeks: [],
      events: [],
    })

    const result = await advanceNflRedraftScheduleWeek({
      seasonId: 'season-1',
      action: 'advance_week',
      week: 17,
      actorUserId: 'commish-1',
    })

    expect(result.ok).toBe(true)
    expect(generateNflRedraftPlayoffRuntimeBracket).toHaveBeenCalledTimes(1)
    expect(generateNflRedraftPlayoffRuntimeBracket).toHaveBeenCalledWith({
      seasonId: 'season-1',
      actorUserId: 'commish-1',
    })
  })

  it('does not generate a bracket for an ordinary mid-season advance', async () => {
    mockState('active')
    planCanonicalScheduleWeekTransition.mockReturnValue({
      ok: true,
      action: 'advance_week',
      nextStatus: 'active',
      currentWeek: 4,
      lockedWeeks: [],
      events: [],
    })

    await advanceNflRedraftScheduleWeek({ seasonId: 'season-1', action: 'advance_week', week: 3 })

    expect(generateNflRedraftPlayoffRuntimeBracket).not.toHaveBeenCalled()
  })

  it('does not re-generate when the season was already regular_season_complete (idempotent repeat)', async () => {
    mockState('regular_season_complete')
    planCanonicalScheduleWeekTransition.mockReturnValue({
      ok: true,
      action: 'advance_week',
      nextStatus: 'regular_season_complete',
      currentWeek: 17,
      lockedWeeks: [],
      events: [],
    })

    await advanceNflRedraftScheduleWeek({ seasonId: 'season-1', action: 'advance_week', week: 17 })

    expect(generateNflRedraftPlayoffRuntimeBracket).not.toHaveBeenCalled()
  })

  it('still reports the week-advance as successful when bracket generation throws', async () => {
    mockState('active')
    planCanonicalScheduleWeekTransition.mockReturnValue({
      ok: true,
      action: 'advance_week',
      nextStatus: 'regular_season_complete',
      currentWeek: 17,
      lockedWeeks: [],
      events: [],
    })
    generateNflRedraftPlayoffRuntimeBracket.mockRejectedValueOnce(new Error('boom'))

    const result = await advanceNflRedraftScheduleWeek({ seasonId: 'season-1', action: 'advance_week', week: 17 })

    expect(result.ok).toBe(true)
    expect(updateRedraftSeason).toHaveBeenCalledWith({
      where: { id: 'season-1' },
      data: { status: 'regular_season_complete', currentWeek: 17 },
    })
  })
})

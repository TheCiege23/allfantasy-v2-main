import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The week roller starts a dynasty league's next season at kickoff BEFORE it reads the running
 * seasons, so a season started this tick is rolled in the same pass — and a failure there never
 * stops the roller.
 */

const m = vi.hoisted(() => ({
  order: [] as string[],
  findMany: vi.fn(),
  kickoff: vi.fn(),
  rookieOpen: vi.fn(),
  resolveWeek: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { redraftSeason: { findMany: m.findMany } } }))
vi.mock('@/lib/season-week/activateImportedMlbSeasons', () => ({ activateImportedMlbSeasons: vi.fn(async () => {}) }))
vi.mock('@/lib/redraft/offseason/startDynastyNewSeason', () => ({ activateDynastyNewSeasonsAtKickoff: m.kickoff }))
vi.mock('@/lib/redraft/offseason/openRookieDraftsOnCalendar', () => ({ openDynastyRookieDraftsOnCalendar: m.rookieOpen }))
vi.mock('@/lib/season-week/seasonWeekService', () => ({ resolveSeasonWeekForRedraftSeason: m.resolveWeek }))
vi.mock('@/lib/schedule-runtime', () => ({ advanceNflRedraftScheduleWeek: vi.fn() }))
vi.mock('@/lib/playoff-runtime', () => ({
  generateNflRedraftPlayoffRuntimeBracket: vi.fn(),
  advanceNflRedraftPlayoffRuntimeRound: vi.fn(),
}))
vi.mock('@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason', () => ({ finalizeSeasonAndEnterOffseason: vi.fn() }))

import { rollSeasonWeeks, WEEK_ROLLER_ACTOR } from '@/lib/season-week/rollSeasonWeek'

beforeEach(() => {
  vi.clearAllMocks()
  m.order = []
  m.findMany.mockImplementation(async () => {
    m.order.push('read-running-seasons')
    return []
  })
  m.kickoff.mockImplementation(async () => {
    m.order.push('kickoff')
    return [{ seasonId: 'y2', leagueId: 'L', action: 'activated', detail: 'kickoff' }]
  })
  m.rookieOpen.mockImplementation(async () => {
    m.order.push('rookie-open')
    return [{ seasonId: 'y3', leagueId: 'L3', action: 'opened', detail: 'sport_default', sessionId: 'D' }]
  })
})

describe('rollSeasonWeeks — dynasty kickoff activation', () => {
  it('starts waiting dynasty seasons before reading the running ones, and reports them', async () => {
    const now = new Date('2026-09-11T00:00:00Z')
    const out = await rollSeasonWeeks({ now })
    expect(m.order).toEqual(['kickoff', 'rookie-open', 'read-running-seasons'])
    expect(out.dynastyKickoff).toEqual([{ seasonId: 'y2', leagueId: 'L', action: 'activated', detail: 'kickoff' }])
    const args = m.kickoff.mock.calls[0][0]
    expect(args.actorUserId).toBe(WEEK_ROLLER_ACTOR)
    expect(args.now).toBe(now)

    // The kickoff signal is the roller's own resolver: preseason holds, anything else starts.
    m.resolveWeek.mockResolvedValueOnce({ ok: true, phase: 'preseason' })
    expect(await args.resolveWeek('y2')).toEqual({ ok: true, phase: 'preseason' })
    m.resolveWeek.mockResolvedValueOnce({ ok: false, reason: 'NO_SCHEDULE_ROWS' })
    expect(await args.resolveWeek('y2')).toEqual({ ok: false, reason: 'NO_SCHEDULE_ROWS' })
  })

  it('does not write in a dry run', async () => {
    await rollSeasonWeeks({ dryRun: true })
    expect(m.kickoff).not.toHaveBeenCalled()
    expect(m.rookieOpen).not.toHaveBeenCalled()
  })

  it('opens calendar rookie drafts AFTER kickoff (a season started this tick is no longer a candidate), and reports them', async () => {
    const now = new Date('2027-05-01T13:00:00Z')
    const out = await rollSeasonWeeks({ now })
    expect(out.rookieDraftsOpened).toEqual([{ seasonId: 'y3', leagueId: 'L3', action: 'opened', detail: 'sport_default', sessionId: 'D' }])
    const args = m.rookieOpen.mock.calls[0][0]
    expect(args).toMatchObject({ now, actorUserId: WEEK_ROLLER_ACTOR })
    m.resolveWeek.mockResolvedValueOnce({ ok: true, phase: 'preseason' })
    expect(await args.resolveWeek('y3')).toEqual({ ok: true, phase: 'preseason' })
  })

  it('an auto-open failure does not stop the roller', async () => {
    m.rookieOpen.mockRejectedValue(new Error('boom'))
    const out = await rollSeasonWeeks()
    expect(out.rookieDraftsOpened).toEqual([])
    expect(m.findMany).toHaveBeenCalled()
  })

  it('a kickoff failure does not stop the roller', async () => {
    m.kickoff.mockRejectedValue(new Error('boom'))
    const out = await rollSeasonWeeks()
    expect(out.dynastyKickoff).toEqual([])
    expect(m.findMany).toHaveBeenCalled()
  })
})

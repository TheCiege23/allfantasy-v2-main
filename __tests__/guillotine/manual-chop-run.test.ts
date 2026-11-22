/** @vitest-environment node */
/**
 * 🛑 THE COMMISSIONER'S MANUAL RUN COULD NEVER CHOP. It called the elimination engine with no period
 * end time, and the week evaluator reads a missing end time as "before the stat correction cutoff".
 * Every manual run answered "no chop", however long ago the week ended. Only the score sync chopped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  imported: false,
  season: { id: 'S' } as { id: string } | null,
  resolved: { ok: true, phase: 'regular', fantasyWeek: 4, sportWeekComplete: false } as Record<string, unknown>,
  run: { seasonId: 'S', outcome: 'chopped', week: 3 } as Record<string, unknown>,
  states: [{ rosterId: 'roster-z' }] as Array<{ rosterId: string }>,
  driver: vi.fn(),
  elimination: vi.fn(),
  sync: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: vi.fn(async () => h.season) },
    guillotineRosterState: { findMany: vi.fn(async () => h.states) },
  },
}))
vi.mock('@/lib/guillotine/importedLeagueGuard', () => ({ IMPORTED_CHOP_REASON: 'imported league: its chops are decided by the provider', isImportedLeague: vi.fn(async () => h.imported) }))
vi.mock('@/lib/guillotine/GuillotineEliminationEngine', () => ({ runElimination: (...a: unknown[]) => h.elimination(...a) }))
vi.mock('@/lib/guillotine/nativeGuillotineWeek', () => ({ runNativeGuillotineWeek: (...a: unknown[]) => h.driver(...a) }))
vi.mock('@/lib/redraft/playerWeeklyScoreService', () => ({ syncPlayerWeeklyScoresForRedraftSeason: (...a: unknown[]) => h.sync(...a) }))
vi.mock('@/lib/season-week', () => ({ resolveSeasonWeekForRedraftSeason: vi.fn(async () => h.resolved) }))

import { describeGuillotineWait, runGuillotineHandler } from '@/lib/specialty-automation/handlers/guillotineHandler'

const ctx = (over: Record<string, unknown> = {}) => ({ leagueId: 'L', season: 2026, week: 3, trigger: 'onManualRun', conceptKey: 'guillotine', conceptRules: null, league: {}, ...over }) as never

beforeEach(() => {
  h.imported = false
  h.season = { id: 'S' }
  h.resolved = { ok: true, phase: 'regular', fantasyWeek: 4, sportWeekComplete: false }
  h.run = { seasonId: 'S', outcome: 'chopped', week: 3 }
  h.states = [{ rosterId: 'roster-z' }]
  h.driver.mockReset().mockImplementation(async () => h.run)
  h.elimination.mockReset().mockResolvedValue({ leagueId: 'L', weekOrPeriod: 3, choppedRosterIds: [], reason: 'before stat correction cutoff' })
  h.sync.mockReset()
})

describe('the commissioner’s manual chop, for a league hosted here', () => {
  it('🛑 runs the score sync’s own driver with the live week, and reports the chop it made', async () => {
    const out = await runGuillotineHandler(ctx())
    expect(h.driver).toHaveBeenCalledTimes(1)
    expect(h.driver.mock.calls[0][0]).toEqual({ seasonId: 'S', currentFantasyWeek: 4, currentWeekComplete: false })
    // The engine is not called a second time with no end time: that call is the one that never chopped.
    expect(h.elimination).not.toHaveBeenCalled()
    expect(out.summary).toBe('Guilly: 1 chop(s) in week 3.')
    expect(out.actions).toEqual([expect.objectContaining({ actionType: 'eliminate_roster', targetType: 'roster', targetId: 'roster-z' })])
    expect(out.events[0]).toMatchObject({ eventType: 'guillotine_chop', payload: { weekOrPeriod: 3, choppedRosterIds: ['roster-z'] } })
    expect(out.skipped).toBeUndefined()
  })

  it('the driver can refill a week’s stats, the way the scheduled run does', async () => {
    await runGuillotineHandler(ctx())
    const deps = h.driver.mock.calls[0][1] as { syncWeekStats: (a: { seasonId: string; week: number }) => Promise<void> }
    await deps.syncWeekStats({ seasonId: 'S', week: 3 })
    expect(h.sync).toHaveBeenCalledWith({ seasonId: 'S', week: 3, actorId: 'system:guillotine-manual-run' })
  })

  it('a week not ready says why in words, and chops nothing', async () => {
    h.run = { seasonId: 'S', outcome: 'waiting', week: 4, reason: 'stat_correction_window' }
    const out = await runGuillotineHandler(ctx())
    expect(out).toMatchObject({ skipped: true, skipReason: 'stat_correction_window', actions: [], events: [] })
    expect(out.summary).toBe('Guilly: no chop yet. Week 4 is over. The chop waits for the stat correction window to close, so nobody is chopped on a score that changes.')
  })

  it('a week already chopped says so, and is not a skip', async () => {
    h.run = { seasonId: 'S', outcome: 'already_chopped', week: 3 }
    const out = await runGuillotineHandler(ctx())
    expect(out.summary).toBe('Guilly: week 3 has already been chopped.')
    expect(out.skipped).toBe(false)
    expect(out.actions).toEqual([])
  })

  it('before the season starts there is no week to chop, and the driver is not started', async () => {
    h.resolved = { ok: true, phase: 'preseason', fantasyWeek: 0 }
    const out = await runGuillotineHandler(ctx())
    expect(h.driver).not.toHaveBeenCalled()
    expect(out).toMatchObject({ skipped: true, skipReason: 'season_not_started' })
  })
})

describe('leagues the driver is not for', () => {
  it('[control] an imported league never starts the driver: its provider chops it', async () => {
    h.imported = true
    h.elimination.mockResolvedValue({ leagueId: 'L', weekOrPeriod: 3, choppedRosterIds: [], reason: 'imported league: its chops are decided by the provider' })
    const out = await runGuillotineHandler(ctx())
    expect(h.driver).not.toHaveBeenCalled()
    expect(out).toMatchObject({ skipped: true, skipReason: 'imported_league' })
  })

  it('[control] a league with no season keeps the older call', async () => {
    h.season = null
    await runGuillotineHandler(ctx())
    expect(h.driver).not.toHaveBeenCalled()
    expect(h.elimination).toHaveBeenCalledTimes(1)
  })

  it('[control] a season that turns out not to be guillotine falls through to the older call', async () => {
    h.run = { seasonId: 'S', outcome: 'not_guillotine' }
    await runGuillotineHandler(ctx())
    expect(h.elimination).toHaveBeenCalledTimes(1)
  })
})

describe('describeGuillotineWait', () => {
  it('names each reason the driver gives', () => {
    expect(describeGuillotineWait('week_in_progress', 5)).toContain('Week 5 is still being played')
    expect(describeGuillotineWait('games_not_final', 5)).toBe('Week 5 still has a game that is not final.')
    expect(describeGuillotineWait('game_stats_missing', 5)).toContain('missing player stats')
    expect(describeGuillotineWait('some_new_reason', 5)).toBe('Week 5 is not ready to chop (some new reason).')
    expect(describeGuillotineWait(undefined, undefined)).toBe('The week is not ready to chop.')
  })
})

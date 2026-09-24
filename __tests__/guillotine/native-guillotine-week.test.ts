import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NATIVE GUILLOTINE LEAGUE NEVER CHOPPED ANYONE. Nothing scheduled the engine, nothing gave it
 * a period end (so the stat-correction cutoff never passed), and it read a score table nothing
 * wrote. `runNativeGuillotineWeek` seals each finished week, scores every survivor from the sealed
 * stats, and hands the engine its own inputs — once per week, never twice.
 */

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { updateMany: vi.fn() },
  guillotineRosterState: { findFirst: vi.fn(), findMany: vi.fn() },
  guillotinePeriodScore: { findMany: vi.fn() },
  guillotineSeason: { updateMany: vi.fn() },
  roster: { findMany: vi.fn() },
}))
const m = vi.hoisted(() => ({
  isGuillotineLeague: vi.fn(),
  getGuillotineConfig: vi.fn(),
  savePeriodScores: vi.fn(),
  runElimination: vi.fn(),
  ensureGuillotineSeason: vi.fn(),
  finalizeRedraftWeek: vi.fn(),
  readWeekSlate: vi.fn(),
  scoreRosterForWeek: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({
  isGuillotineLeague: m.isGuillotineLeague,
  getGuillotineConfig: m.getGuillotineConfig,
}))
vi.mock('@/lib/guillotine/GuillotineWeekEvaluator', async (orig) => ({
  ...(await orig<typeof import('@/lib/guillotine/GuillotineWeekEvaluator')>()),
  savePeriodScores: m.savePeriodScores,
}))
vi.mock('@/lib/guillotine/GuillotineEliminationEngine', () => ({ runElimination: m.runElimination }))
vi.mock('@/lib/guillotine/ensureGuillotineSeason', () => ({ ensureGuillotineSeason: m.ensureGuillotineSeason }))
vi.mock('@/lib/redraft/weekFinalizer', () => ({
  finalizeRedraftWeek: m.finalizeRedraftWeek,
  readWeekSlate: m.readWeekSlate,
  WEEK_KEYED_SPORTS: ['NFL', 'NCAAF'],
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ scoreRosterForWeek: m.scoreRosterForWeek }))
vi.mock('@/lib/automation/locks', () => ({ acquireAutomationLock: m.acquire, releaseAutomationLock: m.release }))

import { runNativeGuillotineWeek } from '@/lib/guillotine/nativeGuillotineWeek'
import { isPastCorrectionCutoff } from '@/lib/guillotine/GuillotineWeekEvaluator'

const LAST_KICKOFF = '2026-09-29T00:15:00.000Z' // Monday night game, week 3
const NOW = new Date('2026-10-01T12:00:00.000Z') // well past a 24h correction window

// Three survivors. Roster ids live in the ENGINE's space; the season rosters are redraft rows.
const SEASON_ROSTERS = [
  { id: 'rr-a', ownerId: 'user-a' },
  { id: 'rr-b', ownerId: 'user-b' },
  { id: 'rr-c', ownerId: 'roster:R-c' }, // an unclaimed team
]
const LEAGUE_ROSTERS = [
  { id: 'R-a', platformUserId: 'user-a', redraftRosterId: 'rr-a' },
  { id: 'R-b', platformUserId: 'user-b', redraftRosterId: null }, // linked by owner only
  { id: 'R-c', platformUserId: 'open-slot-3', redraftRosterId: null }, // linked by roster:<id>
  { id: 'R-gone', platformUserId: 'user-gone', redraftRosterId: 'rr-gone' }, // chopped week 2
]
const POINTS: Record<string, number> = { 'rr-a': 110, 'rr-b': 72.5, 'rr-c': 95 }

function arrange(overrides: { lastChopWeek?: number | null; active?: typeof SEASON_ROSTERS; rosters?: typeof LEAGUE_ROSTERS } = {}) {
  m.isGuillotineLeague.mockResolvedValue(true)
  m.getGuillotineConfig.mockResolvedValue({
    eliminationStartWeek: 1,
    eliminationEndWeek: 17,
    teamsPerChop: 1,
    correctionWindow: 'after_stat_corrections',
    statCorrectionHours: 24,
    customCutoffDayOfWeek: null,
    customCutoffTimeUtc: null,
  })
  db.redraftSeason.findFirst.mockResolvedValue({
    id: 's1', leagueId: 'L1', sport: 'NFL', season: 2026, status: 'active', currentWeek: 1, totalWeeks: 17,
  })
  db.redraftSeason.update.mockResolvedValue({})
  db.redraftSeason.updateMany.mockResolvedValue({ count: 1 })
  m.ensureGuillotineSeason.mockResolvedValue({ ok: true, created: false, seasonId: 'g1' })
  db.redraftRoster.findMany.mockResolvedValue(overrides.active ?? SEASON_ROSTERS)
  const last = overrides.lastChopWeek === undefined ? 2 : overrides.lastChopWeek
  db.guillotineRosterState.findFirst.mockImplementation(async ({ where }: { where: { choppedInPeriod: unknown } }) => {
    if (typeof where.choppedInPeriod === 'number') return null // "already chopped this week?"
    return last == null ? null : { choppedInPeriod: last }
  })
  db.guillotineRosterState.findMany.mockResolvedValue(last == null ? [] : [{ rosterId: 'R-gone' }])
  db.guillotinePeriodScore.findMany.mockResolvedValue([
    { rosterId: 'R-a', periodPoints: 100 },
    { rosterId: 'R-b', periodPoints: 90 },
  ])
  db.roster.findMany.mockResolvedValue(overrides.rosters ?? LEAGUE_ROSTERS)
  db.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 16 })
  db.guillotineSeason.updateMany.mockResolvedValue({ count: 1 })
  m.finalizeRedraftWeek.mockResolvedValue({ refusal: null, finalized: true, slate: { lastStartTime: LAST_KICKOFF } })
  m.scoreRosterForWeek.mockImplementation(async ({ rosterId }: { rosterId: string }) => ({ points: POINTS[rosterId] }))
  m.acquire.mockResolvedValue({ ok: true, backend: 'postgres' })
  m.release.mockResolvedValue(undefined)
  m.savePeriodScores.mockResolvedValue(undefined)
  m.runElimination.mockResolvedValue({
    leagueId: 'L1', weekOrPeriod: 3, choppedRosterIds: ['R-b'], tiebreakStepUsed: null, reason: 'lowest score',
    eliminationFlagged: { marked: ['rr-b'], unresolved: [] },
  })
}

const run = (currentFantasyWeek = 4, deps = {}) =>
  runNativeGuillotineWeek({ seasonId: 's1', currentFantasyWeek }, { now: () => NOW, ...deps })

beforeEach(() => vi.clearAllMocks())

describe('runNativeGuillotineWeek', () => {
  it('chops the lowest survivor of the next finished week, in the engine’s own id space', async () => {
    arrange()

    const r = await run()

    expect(r).toMatchObject({ outcome: 'chopped', week: 3, choppedRedraftRosterIds: ['rr-b'] })
    expect(m.finalizeRedraftWeek).toHaveBeenCalledWith({ seasonId: 's1', week: 3 })
    const scores = m.savePeriodScores.mock.calls[0]![0]
    expect(scores).toMatchObject({ leagueId: 'L1', weekOrPeriod: 3, season: 2026 })
    expect(scores.scores).toEqual([
      { rosterId: 'R-a', periodPoints: 110, seasonPointsCumul: 210 },
      { rosterId: 'R-b', periodPoints: 72.5, seasonPointsCumul: 162.5 },
      { rosterId: 'R-c', periodPoints: 95, seasonPointsCumul: 95 },
    ])
    const call = m.runElimination.mock.calls[0]![0]
    expect(call).toMatchObject({ leagueId: 'L1', weekOrPeriod: 3, season: 2026, skipChat: true })
    expect(call.periodEndedAt.toISOString()).toBe(LAST_KICKOFF)
    expect(call.periodScores).toEqual(scores.scores)
    // The chopped team's players go to waivers.
    expect(db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({
      where: { rosterId: { in: ['rr-b'] }, droppedAt: null },
      data: { droppedAt: NOW },
    })
    // The week pointer follows the calendar (the hourly roll skips guillotine).
    expect(db.redraftSeason.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { currentWeek: 4 } })
    expect(m.release).toHaveBeenCalled()
  })

  it('does nothing for a league that is not guillotine', async () => {
    arrange()
    m.isGuillotineLeague.mockResolvedValue(false)
    expect((await run()).outcome).toBe('not_guillotine')
    expect(m.finalizeRedraftWeek).not.toHaveBeenCalled()
    expect(db.redraftSeason.update).not.toHaveBeenCalled()
  })

  it('waits while the next chop week is still being played', async () => {
    arrange()
    const r = await run(3)
    expect(r).toMatchObject({ outcome: 'waiting', week: 3, reason: 'week_in_progress' })
    expect(m.finalizeRedraftWeek).not.toHaveBeenCalled()
  })

  it('waits while the finalizer refuses the week, and chops nobody', async () => {
    arrange()
    m.finalizeRedraftWeek.mockResolvedValue({ refusal: 'games_not_final', slate: null })
    expect(await run()).toMatchObject({ outcome: 'waiting', reason: 'games_not_final' })
    expect(m.runElimination).not.toHaveBeenCalled()
    expect(m.scoreRosterForWeek).not.toHaveBeenCalled()
  })

  it('refills a past week’s stats once when the finalizer refuses for coverage', async () => {
    arrange()
    m.finalizeRedraftWeek
      .mockResolvedValueOnce({ refusal: 'stat_coverage_below_floor', slate: null })
      .mockResolvedValueOnce({ refusal: null, finalized: true, slate: { lastStartTime: LAST_KICKOFF } })
    const syncWeekStats = vi.fn(async () => undefined)
    expect((await run(4, { syncWeekStats })).outcome).toBe('chopped')
    expect(syncWeekStats).toHaveBeenCalledWith({ seasonId: 's1', week: 3 })
  })

  it('waits inside the stat-correction window', async () => {
    arrange()
    const early = new Date(new Date(LAST_KICKOFF).getTime() + 10 * 3600 * 1000)
    const r = await runNativeGuillotineWeek({ seasonId: 's1', currentFantasyWeek: 4 }, { now: () => early })
    expect(r).toMatchObject({ outcome: 'waiting', reason: 'stat_correction_window' })
    expect(m.runElimination).not.toHaveBeenCalled()
  })

  it('never chops the same week twice', async () => {
    arrange()
    db.guillotineRosterState.findFirst.mockImplementation(async ({ where }: { where: { choppedInPeriod: unknown } }) =>
      typeof where.choppedInPeriod === 'number' ? { rosterId: 'R-b' } : { choppedInPeriod: 2 },
    )
    expect((await run()).outcome).toBe('already_chopped')
    expect(m.runElimination).not.toHaveBeenCalled()
    expect(m.savePeriodScores).not.toHaveBeenCalled()
  })

  it('refuses rather than let an unplaceable team escape the chop', async () => {
    arrange({ rosters: LEAGUE_ROSTERS.filter((r) => r.id !== 'R-c') })
    const r = await run()
    expect(r).toMatchObject({ outcome: 'refused', reason: 'roster_mapping_incomplete' })
    expect(m.runElimination).not.toHaveBeenCalled()
  })

  it('does no work while another run holds the week', async () => {
    arrange()
    m.acquire.mockResolvedValue({ ok: false, reason: 'Lock held (postgres)' })
    expect((await run()).outcome).toBe('locked')
    expect(m.scoreRosterForWeek).not.toHaveBeenCalled()
  })

  it('completes the season when one team is left', async () => {
    arrange({ active: [SEASON_ROSTERS[0]!] })
    expect((await run()).outcome).toBe('season_complete')
    expect(db.redraftSeason.updateMany).toHaveBeenCalledWith({
      where: { id: 's1', status: { not: 'complete' } },
      data: { status: 'complete' },
    })
    expect(m.runElimination).not.toHaveBeenCalled()
  })
})

describe('isPastCorrectionCutoff — custom cutoff', () => {
  // Cutoff: Wednesday (3) at 12:00 UTC, after a period that ended Tuesday 00:15 UTC.
  const base = {
    correctionWindow: 'custom_cutoff',
    periodEndedAt: new Date(LAST_KICKOFF),
    statCorrectionHours: null,
    customCutoffDayOfWeek: 3,
    customCutoffTimeUtc: '12:00',
  }
  it('is not past before the first cutoff after the period ended', () => {
    expect(isPastCorrectionCutoff({ ...base, now: new Date('2026-09-30T11:59:00Z') })).toBe(false)
  })
  it('is past once that cutoff arrives (it used to count from now, so it never could)', () => {
    expect(isPastCorrectionCutoff({ ...base, now: new Date('2026-09-30T12:00:00Z') })).toBe(true)
    expect(isPastCorrectionCutoff({ ...base, now: new Date('2026-10-02T12:00:00Z') })).toBe(true)
  })
})

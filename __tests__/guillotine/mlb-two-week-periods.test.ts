import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MLB two-week Guilly elimination periods (lib/guillotine/eliminationPeriods.ts). A period is keyed by its
 * last week, both weeks' scores are added, and one chop lands at the end of each pair. A league without
 * the setting must behave exactly as before.
 */

const db = vi.hoisted(() => ({
  redraftSeason: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { updateMany: vi.fn() },
  guillotineRosterState: { findFirst: vi.fn(), findMany: vi.fn() },
  guillotinePeriodScore: { findMany: vi.fn() },
  guillotineSeason: { updateMany: vi.fn(), findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  league: { findUnique: vi.fn() },
  guillotineLeagueConfig: { updateMany: vi.fn() },
}))
const m = vi.hoisted(() => ({
  isGuillotineLeague: vi.fn(),
  getGuillotineConfig: vi.fn(),
  savePeriodScores: vi.fn(),
  runElimination: vi.fn(),
  ensureGuillotineSeason: vi.fn(),
  finalChampion: vi.fn(),
  resumeRelease: vi.fn(),
  finalizeRedraftWeek: vi.fn(),
  readWeekSlate: vi.fn(),
  scoreRosterForWeek: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  finish: vi.fn(),
  recordReleases: vi.fn(),
  recordBaseline: vi.fn(),
}))
vi.mock('@/lib/guillotine/finishGuillotineSeason', async (orig) => ({
  ...(await orig<typeof import('@/lib/guillotine/finishGuillotineSeason')>()),
  finishGuillotineSeason: m.finish,
}))
vi.mock('@/lib/guillotine/resumeAuditedRosterRelease', () => ({ resumeAuditedRosterRelease: m.resumeRelease }))
vi.mock('@/lib/guillotine/endgameEngine', () => ({ determineFinalChampion: m.finalChampion }))
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
vi.mock('@/lib/guillotine/choppedReleases', () => ({ recordChoppedReleases: m.recordReleases }))
vi.mock('@/lib/guillotine/statCorrectionHandler', () => ({ recordGuillotineCorrectionBaseline: m.recordBaseline }))

import { runNativeGuillotineWeek } from '@/lib/guillotine/nativeGuillotineWeek'
import {
  isPeriodEndWeek,
  periodEndWeek,
  previousPeriodEnd,
  readPeriodWeeks,
  supportsTwoWeekPeriods,
  weeksInPeriod,
} from '@/lib/guillotine/eliminationPeriods'
import { guillotineCalendarFit, planGuillotineChopSchedule } from '@/lib/guillotine/calendarFit'
import { chopPendingVerdict } from '@/lib/guillotine/chopBeforeWaivers'
import { resolveCumulativeFinalWinner } from '@/lib/guillotine/endgameRules'
import { normalizeGuillotineRulesPatch } from '@/lib/guillotine/guillotineRules'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

const NO_ADV = { steps: [], overrides: {}, immunity: 'off' as const }

describe('the period model (pure)', () => {
  it('reads two weeks only from an explicit 2; anything else is the old one-week league', () => {
    expect(readPeriodWeeks({ guillotine_period_weeks: 2 })).toBe(2)
    for (const s of [{}, null, undefined, { guillotine_period_weeks: 3 }, { guillotine_period_weeks: '2' }]) expect(readPeriodWeeks(s)).toBe(1)
    expect(supportsTwoWeekPeriods('MLB')).toBe(true)
    for (const sport of ['NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']) expect(supportsTwoWeekPeriods(sport)).toBe(false)
  })

  it('pairs weeks from the first chop week and keys each period by its last week', () => {
    expect([1, 2, 3, 4, 5].map((w) => periodEndWeek(w, 1, 2))).toEqual([2, 2, 4, 4, 6])
    expect([3, 4, 5].map((w) => periodEndWeek(w, 3, 2))).toEqual([4, 4, 6])
    expect([1, 2, 3].map((w) => periodEndWeek(w, 1, 1))).toEqual([1, 2, 3])
    expect(isPeriodEndWeek(2, 1, 2)).toBe(true)
    expect(isPeriodEndWeek(3, 1, 2)).toBe(false)
    expect(weeksInPeriod(4, 2)).toEqual([3, 4])
    expect(weeksInPeriod(4, 1)).toEqual([4])
    expect(previousPeriodEnd(4, 2)).toBe(2)
    expect(previousPeriodEnd(4, 1)).toBe(3)
  })
})

describe('calendar fit (lib/guillotine/calendarFit.ts)', () => {
  const mlb = { startWeek: 1, endWeek: 26, baseChops: 1, threshold: 1, finalPeriods: 0 }

  it('chops only at the end of each two-week period', () => {
    const fit = guillotineCalendarFit({ ...mlb, teamCount: 10, advanced: NO_ADV, periodWeeks: 2 })
    expect(fit).toMatchObject({ fits: true, lastChopWeek: 18, finishWeek: 18 })
    // The same league on one-week periods is unchanged: week 9.
    expect(guillotineCalendarFit({ ...mlb, teamCount: 10, advanced: NO_ADV })).toMatchObject({ fits: true, lastChopWeek: 9 })
  })

  it('13 periods fit 14 teams; a 15th needs a double chop, which the planner finds', () => {
    expect(guillotineCalendarFit({ ...mlb, teamCount: 14, advanced: NO_ADV, periodWeeks: 2 })).toMatchObject({ fits: true, lastChopWeek: 26 })
    const short = guillotineCalendarFit({ ...mlb, teamCount: 15, advanced: NO_ADV, periodWeeks: 2 })
    expect(short).toMatchObject({ fits: false, survivorsAtEnd: 2 })
    const planned = planGuillotineChopSchedule({ ...mlb, teamCount: 15, periodWeeks: 2 })
    expect(planned).not.toBeNull()
    expect(guillotineCalendarFit({ ...mlb, teamCount: 15, advanced: planned!, periodWeeks: 2 }).fits).toBe(true)
  })

  it('an odd last week cannot chop: a period that ends after the window never happens', () => {
    expect(guillotineCalendarFit({ ...mlb, endWeek: 25, teamCount: 14, advanced: NO_ADV, periodWeeks: 2 })).toMatchObject({ fits: false, survivorsAtEnd: 2 })
  })

  it('a Final N plays three two-week periods after the last chop', () => {
    const fit = guillotineCalendarFit({ ...mlb, teamCount: 8, threshold: 4, finalPeriods: 3, advanced: NO_ADV, periodWeeks: 2 })
    expect(fit).toMatchObject({ fits: true, lastChopWeek: 8, finishWeek: 14 })
  })
})

describe('waivers wait for the chop (lib/guillotine/chopBeforeWaivers.ts)', () => {
  const base = { lastChoppedWeek: 2, currentScoringPeriod: 2, eliminationStartWeek: 1, eliminationEndWeek: 26, chopsInWeek: () => 1 }

  it('the first week of a period finishing holds nothing; the second week does', () => {
    expect(chopPendingVerdict({ ...base, fantasyWeek: 3, currentWeekComplete: true, periodWeeks: 2 })).toEqual({ hold: false, week: 4, reason: 'week_in_progress' })
    expect(chopPendingVerdict({ ...base, fantasyWeek: 4, currentWeekComplete: true, periodWeeks: 2 })).toEqual({ hold: true, week: 4 })
    // One-week league: week 3 finishing holds.
    expect(chopPendingVerdict({ ...base, fantasyWeek: 3, currentWeekComplete: true })).toEqual({ hold: true, week: 3 })
  })
})

describe('the cumulative final (lib/guillotine/endgameRules.ts)', () => {
  const rows = (start: number, step: number) =>
    ['A', 'B'].flatMap((rosterId, i) => [0, 1, 2].map((k) => ({ rosterId, weekOrPeriod: start + k * step, periodPoints: i === 0 ? 100 : 90 })))

  it('finds the three final periods two weeks apart, and waits for the third', () => {
    expect(resolveCumulativeFinalWinner(['A', 'B'], 10, 14, 3, rows(10, 2), undefined, 2)).toBe('A')
    expect(resolveCumulativeFinalWinner(['A', 'B'], 10, 12, 3, rows(10, 2), undefined, 2)).toBeNull()
    // Unchanged for one-week periods.
    expect(resolveCumulativeFinalWinner(['A', 'B'], 10, 12, 3, rows(10, 1))).toBe('A')
  })
})

describe('the League rules page and creation refuse what the engine cannot run', () => {
  it('a period is one week or two', () => {
    expect(normalizeGuillotineRulesPatch({ periodWeeks: 2 }, { startWeek: 1, seasonWeeks: 26 })).toEqual({ ok: true, value: { periodWeeks: 2 } })
    expect(normalizeGuillotineRulesPatch({ periodWeeks: 3 }, { startWeek: 1, seasonWeeks: 26 }).ok).toBe(false)
  })

  const create = { teamCount: 10, draftType: 'snake', leagueName: 'Two-week Guilly', concept: 'guillotine' }
  const mlb = { ...create, sport: 'MLB', scoringPreset: 'mlb_points' }
  const nfl = { ...create, sport: 'NFL', scoringPreset: 'fb_ppr' }
  const refusedOnPeriod = (r: ReturnType<typeof validateCreatePayload>) => !r.ok && JSON.stringify(r).includes('conceptSetup.guillotinePeriodWeeks')
  it('creation takes two-week periods for an MLB Guilly league only', () => {
    // Controls: both bodies are valid without the setting, so a refusal below is the setting's.
    expect(validateCreatePayload(mlb).ok).toBe(true)
    expect(validateCreatePayload(nfl).ok).toBe(true)
    expect(validateCreatePayload({ ...mlb, conceptSetup: { guillotinePeriodWeeks: 2 } }).ok).toBe(true)
    expect(refusedOnPeriod(validateCreatePayload({ ...nfl, conceptSetup: { guillotinePeriodWeeks: 2 } }))).toBe(true)
    expect(refusedOnPeriod(validateCreatePayload({ ...mlb, concept: 'redraft', conceptSetup: { guillotinePeriodWeeks: 2 } }))).toBe(true)
    expect(refusedOnPeriod(validateCreatePayload({ ...mlb, conceptSetup: { guillotinePeriodWeeks: 3 } }))).toBe(true)
  })
})

// ── the chop runner ────────────────────────────────────────────────────────────────────────────────

const LAST_KICKOFF = '2026-05-17T23:00:00.000Z'
const NOW = new Date('2026-05-21T12:00:00.000Z')
const SEASON_ROSTERS = [
  { id: 'rr-a', ownerId: 'user-a' },
  { id: 'rr-b', ownerId: 'user-b' },
]
const LEAGUE_ROSTERS = [
  { id: 'R-a', platformUserId: 'user-a', redraftRosterId: 'rr-a' },
  { id: 'R-b', platformUserId: 'user-b', redraftRosterId: 'rr-b' },
  { id: 'R-gone', platformUserId: 'user-gone', redraftRosterId: 'rr-gone' },
]
// Week 3 and week 4 differ, so a sum is distinguishable from either week alone.
const POINTS: Record<string, Record<number, number>> = { 'rr-a': { 3: 40, 4: 30 }, 'rr-b': { 3: 10, 4: 50 } }

function arrange(settings: Record<string, unknown>) {
  m.isGuillotineLeague.mockResolvedValue(true)
  db.league.findUnique.mockResolvedValue({ userId: 'owner-1', settings })
  m.getGuillotineConfig.mockResolvedValue({
    eliminationStartWeek: 1, eliminationEndWeek: 26, teamsPerChop: 1,
    correctionWindow: 'immediate', statCorrectionHours: 0, customCutoffDayOfWeek: null, customCutoffTimeUtc: null,
  })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', leagueId: 'L1', sport: 'MLB', season: 2026, status: 'active', currentWeek: 5, totalWeeks: 26 })
  m.finalChampion.mockResolvedValue(null)
  db.redraftSeason.update.mockResolvedValue({})
  m.ensureGuillotineSeason.mockResolvedValue({ ok: true, created: false, seasonId: 'g1' })
  db.redraftRoster.findMany.mockResolvedValue(SEASON_ROSTERS)
  db.guillotineSeason.findUnique.mockResolvedValue({ currentScoringPeriod: 2, status: 'active' })
  db.guillotineRosterState.findFirst.mockImplementation(async ({ where }: { where: { choppedInPeriod: unknown } }) =>
    typeof where.choppedInPeriod === 'number' ? null : { choppedInPeriod: 2 })
  db.guillotineRosterState.findMany.mockResolvedValue([{ rosterId: 'R-gone' }])
  // Period 1 (weeks 1-2) is keyed 2: the "previous period" of the period keyed 4.
  db.guillotinePeriodScore.findMany.mockResolvedValue([
    { rosterId: 'R-a', periodPoints: 70, weekOrPeriod: 2 },
    { rosterId: 'R-b', periodPoints: 60, weekOrPeriod: 2 },
  ])
  db.roster.findMany.mockResolvedValue(LEAGUE_ROSTERS)
  db.redraftRosterPlayer.updateMany.mockResolvedValue({ count: 20 })
  db.guillotineSeason.updateMany.mockResolvedValue({ count: 1 })
  m.finalizeRedraftWeek.mockResolvedValue({ refusal: null, finalized: true, slate: { lastStartTime: LAST_KICKOFF } })
  m.scoreRosterForWeek.mockImplementation(async ({ rosterId, week }: { rosterId: string; week: number }) => ({
    points: POINTS[rosterId]?.[week] ?? 0,
    benchPoints: 1,
    playerPoints: [{ playerId: `${rosterId.slice(3)}-${week}`, points: POINTS[rosterId]?.[week] ?? 0, isStarter: true }],
  }))
  m.acquire.mockResolvedValue({ ok: true })
  m.release.mockResolvedValue(undefined)
  m.savePeriodScores.mockResolvedValue(undefined)
  m.recordReleases.mockResolvedValue(20)
  m.finish.mockResolvedValue({ archived: true })
  m.runElimination.mockImplementation(async ({ weekOrPeriod }: { weekOrPeriod: number }) => ({
    leagueId: 'L1', weekOrPeriod, choppedRosterIds: ['R-a'], tiebreakStepUsed: null, reason: 'lowest score',
    eliminationFlagged: { marked: ['rr-a'], unresolved: [] },
  }))
}

const run = (currentFantasyWeek: number, currentWeekComplete = false) =>
  runNativeGuillotineWeek({ seasonId: 's1', currentFantasyWeek, currentWeekComplete }, { now: () => NOW })

beforeEach(() => vi.clearAllMocks())

describe('runNativeGuillotineWeek with two-week periods', () => {
  it('after week 3 of a 3-4 period, nothing chops: it waits for week 4', async () => {
    arrange({ guillotine_period_weeks: 2 })
    const r = await run(4)
    expect(r).toMatchObject({ outcome: 'waiting', week: 4, reason: 'week_in_progress' })
    expect(m.runElimination).not.toHaveBeenCalled()
    expect(m.finalizeRedraftWeek).not.toHaveBeenCalled()
  })

  it('after week 4: seals both weeks, adds both scores, and chops once keyed by week 4', async () => {
    arrange({ guillotine_period_weeks: 2 })
    const r = await run(5)
    expect(r).toMatchObject({ outcome: 'chopped', week: 4 })
    expect(m.finalizeRedraftWeek.mock.calls.map(([a]) => a.week)).toEqual([3, 4])
    expect(m.scoreRosterForWeek.mock.calls.map(([a]) => `${a.rosterId}:${a.week}`)).toEqual(['rr-a:3', 'rr-a:4', 'rr-b:3', 'rr-b:4'])
    const saved = m.savePeriodScores.mock.calls[0]![0]
    expect(saved.weekOrPeriod).toBe(4)
    expect(saved.scores).toEqual([
      // A: 40 + 30 = 70, B: 10 + 50 = 60. Either week alone would have chopped someone else.
      { rosterId: 'R-a', periodPoints: 70, seasonPointsCumul: 140, benchPoints: 2, previousPeriodPoints: 70 },
      { rosterId: 'R-b', periodPoints: 60, seasonPointsCumul: 120, benchPoints: 2, previousPeriodPoints: 60 },
    ])
    expect(m.runElimination).toHaveBeenCalledTimes(1)
    expect(m.runElimination.mock.calls[0]![0].weekOrPeriod).toBe(4)
    // The stat-correction baseline is keyed by week 4 and keeps each week's players separately.
    expect(m.recordBaseline).toHaveBeenCalledTimes(1)
    const baseline = m.recordBaseline.mock.calls[0]![0]
    expect(baseline.week).toBe(4)
    expect(baseline.teams.map((t: { recordedPoints: number }) => t.recordedPoints)).toEqual([70, 60])
    expect(baseline.teams[0].weekPlayerPoints).toEqual([
      { week: 3, playerPoints: [{ playerId: 'a-3', points: 40, isStarter: true }] },
      { week: 4, playerPoints: [{ playerId: 'a-4', points: 30, isStarter: true }] },
    ])
    expect(m.scoreRosterForWeek.mock.calls.every(([a]) => a.collectPlayerPoints === true)).toBe(true)
  })

  it('a league without the setting is unchanged: week 3 is its own period', async () => {
    arrange({})
    const r = await run(4)
    expect(r).toMatchObject({ outcome: 'chopped', week: 3 })
    expect(m.finalizeRedraftWeek.mock.calls.map(([a]) => a.week)).toEqual([3])
    expect(m.scoreRosterForWeek.mock.calls.map(([a]) => a.week)).toEqual([3, 3])
    expect(m.savePeriodScores.mock.calls[0]![0].scores[0]).toMatchObject({ rosterId: 'R-a', periodPoints: 40, previousPeriodPoints: 70 })
    expect(m.recordBaseline).toHaveBeenCalledTimes(1)
    // A one-week baseline is exactly what it was: no per-week block.
    expect(m.recordBaseline.mock.calls[0]![0].teams[0]).not.toHaveProperty('weekPlayerPoints')
  })
})

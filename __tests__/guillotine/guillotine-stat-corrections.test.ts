/**
 * Stat corrections after a Guilly chop (lib/guillotine/statCorrectionHandler.ts).
 *
 * The published policy: a correction after the week is final updates that week's scores, the running
 * totals the standings read, and the survival history — but NEVER reverses a chop or a champion. When
 * the corrected scores would have chopped someone else, that is recorded on the Guilly event log and
 * the commissioner's league log. Every check is retry-safe: corrections are detected over and over.
 *
 * The fake database is in memory and answers from each WHERE clause, so the assertions read state, not
 * call counts — "the period score is 100 after two runs" is what idempotence means.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, any>
const state = vi.hoisted(() => ({
  cache: new Map<string, any>(),
  league: {} as Row,
  weekly: [] as Row[],
  periods: [] as Row[],
  survival: [] as Row[],
  rosterStates: [] as Row[],
  events: [] as Row[],
  audit: [] as Row[],
  rosterPlayers: [] as Row[],
  guillotineSeasons: [] as Row[],
  forbidden: [] as string[],
  /** The league's CURRENT best ball seats; null = the one-QB default below. */
  slots: null as null | Array<{ slot: string; eligible: string[]; count: number; slotOrder?: number }>,
}))
;(globalThis as any).__guillyForbidden = state.forbidden

const forbid = vi.hoisted(() => (name: string) => async () => {
  // Read through the module-level state lazily; vi.fn is wrapped around this below.
  ;(globalThis as any).__guillyForbidden?.push(name)
  throw new Error(`${name} must never be written by a correction`)
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: Row) => (state.cache.has(where.cacheKey) ? { data: structuredClone(state.cache.get(where.cacheKey)) } : null)),
      findMany: vi.fn(async ({ where }: Row) =>
        [...state.cache.entries()].filter(([k]) => k.startsWith(where.cacheKey.startsWith)).map(([, data]) => ({ data: structuredClone(data) })),
      ),
      upsert: vi.fn(async ({ where, update }: Row) => {
        state.cache.set(where.cacheKey, structuredClone(update.data))
        return {}
      }),
    },
    league: { findUnique: vi.fn(async () => state.league) },
    playerWeeklyScore: {
      findMany: vi.fn(async ({ where }: Row) =>
        state.weekly.filter((r) => r.week === where.week && r.season === where.season && where.sport.in.includes(r.sport) && where.playerId.in.includes(r.playerId)),
      ),
    },
    guillotinePeriodScore: {
      findMany: vi.fn(async ({ where }: Row) =>
        state.periods
          .filter((r) => r.leagueId === where.leagueId)
          .filter((r) => where.weekOrPeriod == null || r.weekOrPeriod === where.weekOrPeriod)
          .filter((r) => where.season == null || r.season === where.season)
          .filter((r) => where.rosterId.in.includes(r.rosterId))
          .sort((a, b) => a.weekOrPeriod - b.weekOrPeriod)
          .map((r) => ({ ...r })),
      ),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = state.periods.filter((r) => r.leagueId === where.leagueId && r.rosterId === where.rosterId && r.weekOrPeriod === where.weekOrPeriod)
        rows.forEach((r) => Object.assign(r, data))
        return { count: rows.length }
      }),
    },
    guillotineSurvivalLog: {
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = state.survival.filter((r) => r.leagueId === where.leagueId && r.rosterId === where.rosterId && r.scoringPeriod === where.scoringPeriod)
        rows.forEach((r) => Object.assign(r, data))
        return { count: rows.length }
      }),
    },
    guillotineRosterState: {
      findMany: vi.fn(async ({ where }: Row) => state.rosterStates.filter((r) => r.leagueId === where.leagueId && r.choppedInPeriod === where.choppedInPeriod)),
      update: forbid('guillotineRosterState.update'),
      updateMany: forbid('guillotineRosterState.updateMany'),
      upsert: forbid('guillotineRosterState.upsert'),
    },
    guillotineElimination: { create: forbid('guillotineElimination.create'), deleteMany: forbid('guillotineElimination.deleteMany'), updateMany: forbid('guillotineElimination.updateMany') },
    redraftRosterPlayer: {
      findMany: vi.fn(async ({ where }: Row) =>
        state.rosterPlayers.filter((r) => where.rosterId.in.includes(r.rosterId) && where.playerId.in.includes(r.playerId)),
      ),
      updateMany: forbid('redraftRosterPlayer.updateMany'),
    },
    guillotineSeason: { findFirst: vi.fn(async ({ where }: Row) => state.guillotineSeasons.find((g) => g.id === where.id) ?? null), update: forbid('guillotineSeason.update'), updateMany: forbid('guillotineSeason.updateMany') },
    redraftSeason: { update: forbid('redraftSeason.update'), updateMany: forbid('redraftSeason.updateMany') },
    guillotineEventLog: {
      findFirst: vi.fn(async ({ where }: Row) =>
        state.events.find((e) => e.leagueId === where.leagueId && e.eventType === where.eventType && e.metadata?.[where.metadata.path[0]] === where.metadata.equals) ?? null,
      ),
      create: vi.fn(async ({ data }: Row) => {
        state.events.push(structuredClone(data))
        return {}
      }),
    },
    leagueAuditLog: {
      create: vi.fn(async ({ data }: Row) => {
        state.audit.push(structuredClone(data))
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async () => ({ ok: true })),
  releaseAutomationLock: vi.fn(async () => undefined),
}))
// One QB seat, so a best ball lineup is easy to reason about.
vi.mock('@/lib/redraft/scoringEngine', async (orig) => ({
  ...(await orig<typeof import('@/lib/redraft/scoringEngine')>()),
  buildBestBallSlots: () => state.slots ?? [{ slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 }],
}))

import {
  applyGuillotineStatCorrectionsForWeek,
  checkGuillotineStatCorrectionsForSeason,
  guillotineCorrectionKey,
  handleStatCorrection,
  recordGuillotineCorrectionBaseline,
  GUILLOTINE_STAT_CORRECTION_ACTION,
} from '@/lib/guillotine/statCorrectionHandler'

const CHOPPED_AT = new Date('2026-10-01T12:00:00.000Z')
const NOW = new Date('2026-10-02T12:00:00.000Z')

/** Week 3: A 110, B 72.5 (chopped), C 95. B's bench QB scored 10. */
async function arrange(opts: { bestBall?: boolean } = {}) {
  state.cache.clear()
  state.forbidden.length = 0
  state.slots = null
  state.league = { sport: 'NFL', settings: {}, bestBallMode: opts.bestBall === true, leagueVariant: 'guillotine', leagueType: 'redraft', guillotineMode: true, userId: 'owner-1' }
  state.rosterPlayers = [
    { rosterId: 'rr-a', playerId: 'a1', sport: 'NFL', position: 'QB' },
    { rosterId: 'rr-b', playerId: 'b1', sport: 'NFL', position: 'QB' },
    { rosterId: 'rr-b', playerId: 'b2', sport: 'NFL', position: 'QB' },
    { rosterId: 'rr-c', playerId: 'c1', sport: 'NFL', position: 'QB' },
  ]
  state.weekly = [
    { playerId: 'a1', sport: 'NFL', week: 3, season: 2026, stats: { pts: 110 } },
    { playerId: 'b1', sport: 'NFL', week: 3, season: 2026, stats: { pts: 72.5 } },
    { playerId: 'b2', sport: 'NFL', week: 3, season: 2026, stats: { pts: 10 } },
    { playerId: 'c1', sport: 'NFL', week: 3, season: 2026, stats: { pts: 95 } },
  ]
  state.periods = [
    { leagueId: 'L1', rosterId: 'R-a', weekOrPeriod: 2, season: 2026, periodPoints: 100, seasonPointsCumul: 100 },
    { leagueId: 'L1', rosterId: 'R-b', weekOrPeriod: 2, season: 2026, periodPoints: 90, seasonPointsCumul: 90 },
    { leagueId: 'L1', rosterId: 'R-a', weekOrPeriod: 3, season: 2026, periodPoints: 110, seasonPointsCumul: 210 },
    { leagueId: 'L1', rosterId: 'R-b', weekOrPeriod: 3, season: 2026, periodPoints: 72.5, seasonPointsCumul: 162.5 },
    { leagueId: 'L1', rosterId: 'R-c', weekOrPeriod: 3, season: 2026, periodPoints: 95, seasonPointsCumul: 95 },
    { leagueId: 'L1', rosterId: 'R-a', weekOrPeriod: 4, season: 2026, periodPoints: 80, seasonPointsCumul: 290 },
    { leagueId: 'L1', rosterId: 'R-c', weekOrPeriod: 4, season: 2026, periodPoints: 90, seasonPointsCumul: 185 },
  ]
  state.survival = ['rr-a', 'rr-b', 'rr-c'].map((rosterId, i) => ({ leagueId: 'L1', rosterId, scoringPeriod: 3, totalScore: [110, 72.5, 95][i] }))
  state.rosterStates = [{ leagueId: 'L1', rosterId: 'R-b', choppedInPeriod: 3 }]
  state.events = []
  state.audit = []
  state.guillotineSeasons = [{ id: 'g1', redraftSeasonId: 's1' }]
  await recordGuillotineCorrectionBaseline({
    seasonId: 's1',
    leagueId: 'L1',
    season: 2026,
    week: 3,
    capturedAt: CHOPPED_AT,
    teams: [
      { redraftRosterId: 'rr-a', engineRosterId: 'R-a', recordedPoints: 110, playerPoints: [{ playerId: 'a1', points: 110, isStarter: true }] },
      {
        redraftRosterId: 'rr-b',
        engineRosterId: 'R-b',
        recordedPoints: 72.5,
        playerPoints: [
          { playerId: 'b1', points: 72.5, isStarter: true },
          { playerId: 'b2', points: 10, isStarter: false },
        ],
      },
      { redraftRosterId: 'rr-c', engineRosterId: 'R-c', recordedPoints: 95, playerPoints: [{ playerId: 'c1', points: 95, isStarter: true }] },
    ],
  })
}

const correct = (playerId: string, pts: number) => {
  state.weekly.find((r) => r.playerId === playerId)!.stats = { pts }
}
const period = (rosterId: string, week: number) => state.periods.find((r) => r.rosterId === rosterId && r.weekOrPeriod === week)
const sealed = vi.fn(async () => ({ refusal: null }))
const deps = (extra: Record<string, unknown> = {}) => ({
  now: () => NOW,
  syncWeekStats: vi.fn(async () => undefined),
  finalizeWeek: sealed as any,
  scorePlayer: async ({ stats }: { stats: Record<string, number> }) => stats.pts ?? 0,
  ...extra,
})

beforeEach(() => vi.clearAllMocks())

describe('a stat correction after the chop', () => {
  it('updates the week, the running totals and the survival history — and the chop stands', async () => {
    await arrange()
    correct('b1', 100) // the chopped team would now have outscored C

    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())

    expect(r.outcome).toBe('applied')
    expect(r.changes).toEqual([{ redraftRosterId: 'rr-b', engineRosterId: 'R-b', before: 72.5, after: 100 }])
    expect(period('R-b', 3)).toMatchObject({ periodPoints: 100, seasonPointsCumul: 190 })
    // Untouched teams and weeks keep their numbers.
    expect(period('R-a', 3)).toMatchObject({ periodPoints: 110, seasonPointsCumul: 210 })
    expect(period('R-c', 4)).toMatchObject({ periodPoints: 90, seasonPointsCumul: 185 })
    expect(state.survival.find((s) => s.rosterId === 'rr-b')?.totalScore).toBe(100)

    // Never reversed: nothing about the chop, the roster or the season was written.
    expect(state.forbidden).toEqual([])
    expect(r.choppedRosterIds).toEqual(['R-b'])
    expect(r.wouldHaveChoppedRosterIds).toEqual(['R-c'])
    expect(r.chopDisputed).toBe(true)

    // Recorded on the Guilly event log and the commissioner's league log.
    expect(state.events).toHaveLength(1)
    expect(state.events[0]).toMatchObject({
      leagueId: 'L1',
      eventType: 'stat_correction',
      metadata: { week: 3, chopDisputed: true, chopStands: true, choppedRosterIds: ['R-b'], wouldHaveChoppedRosterIds: ['R-c'] },
    })
    expect(state.audit).toHaveLength(1)
    expect(state.audit[0]).toMatchObject({
      leagueId: 'L1',
      userId: null,
      actionType: GUILLOTINE_STAT_CORRECTION_ACTION,
      entityId: 's1:3',
      afterState: { choppedRedraftRosterIds: ['rr-b'], wouldHaveChoppedRedraftRosterIds: ['rr-c'], chopStands: true },
      metadata: { week: 3, changed: 1, chopDisputed: true },
    })
  })

  it('a later week\'s running total moves with the corrected week', async () => {
    await arrange()
    correct('a1', 120)
    await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    expect(period('R-a', 3)).toMatchObject({ periodPoints: 120, seasonPointsCumul: 220 })
    expect(period('R-a', 4)).toMatchObject({ periodPoints: 80, seasonPointsCumul: 300 })
    // A correction that leaves the chop line alone is logged as undisputed.
    expect(state.events[0]?.metadata).toMatchObject({ chopDisputed: false, wouldHaveChoppedRosterIds: ['R-b'] })
  })

  it('🛑 is idempotent: detected again and again, it lands the same numbers and logs once', async () => {
    await arrange()
    correct('b1', 100)
    await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())
    const again = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())
    await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())

    expect(again.outcome).toBe('no_change')
    expect(period('R-b', 3)).toMatchObject({ periodPoints: 100, seasonPointsCumul: 190 })
    expect(state.events).toHaveLength(1)
    expect(state.audit).toHaveLength(1)
  })

  it('a run that wrote the scores and died before logging logs on the retry — once', async () => {
    await arrange()
    correct('b1', 100)
    // Simulate the crash: the scores are already corrected, nothing logged, nothing stamped.
    period('R-b', 3)!.periodPoints = 100
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())
    expect(r.outcome).toBe('no_change')
    expect(state.events).toHaveLength(1)
    expect(state.events[0]?.metadata.chopDisputed).toBe(true)
    await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())
    expect(state.events).toHaveLength(1)
  })

  it('a second, different correction updates again and logs again', async () => {
    await arrange()
    correct('b1', 100)
    await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())
    correct('b1', 80)
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3, force: true }, deps())
    expect(r.outcome).toBe('applied')
    expect(period('R-b', 3)?.periodPoints).toBe(80)
    expect(state.events).toHaveLength(2)
  })

  it('measures against the chop-time baseline, so a released roster is not read as a 0', async () => {
    await arrange()
    // The chopped team's players are gone from every roster since the chop; nothing was corrected.
    state.rosterPlayers = state.rosterPlayers.filter((p) => p.rosterId !== 'rr-b')
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    expect(r.outcome).toBe('no_change')
    expect(period('R-b', 3)?.periodPoints).toBe(72.5)
    expect(state.events).toHaveLength(0)
  })

  it('never treats unavailable data as zero: a player whose row is gone keeps his chop-time points', async () => {
    await arrange()
    state.weekly = state.weekly.filter((r) => r.playerId !== 'a1')
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    expect(r.outcome).toBe('no_change')
    expect(period('R-a', 3)?.periodPoints).toBe(110)
  })

  it('applies nothing while the re-seal refuses (a missing box score), and nothing when the refresh fails', async () => {
    await arrange()
    correct('b1', 100)
    const refused = await applyGuillotineStatCorrectionsForWeek(
      { seasonId: 's1', week: 3, force: true },
      deps({ finalizeWeek: vi.fn(async () => ({ refusal: 'game_stats_missing' })) }),
    )
    expect(refused).toMatchObject({ outcome: 'waiting', reason: 'game_stats_missing' })
    const failed = await applyGuillotineStatCorrectionsForWeek(
      { seasonId: 's1', week: 3, force: true },
      deps({ syncWeekStats: vi.fn(async () => { throw new Error('provider down') }) }),
    )
    expect(failed.outcome).toBe('provider_failed')
    expect(period('R-b', 3)?.periodPoints).toBe(72.5)
    expect(state.events).toHaveLength(0)
  })

  it('best ball re-solves the lineup: a corrected bench player can enter it', async () => {
    await arrange({ bestBall: true })
    correct('b2', 80) // the bench QB now outscores the starter
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    expect(r.changes).toEqual([{ redraftRosterId: 'rr-b', engineRosterId: 'R-b', before: 72.5, after: 80 }])
  })

  /*
   * Audit 2026-11-06 ("Rule/settings version stored with a result"): the correction re-solved the lineup
   * over the league's CURRENT seats, so a commissioner who added a second QB seat after the chop moved a
   * closed week's scores by the whole bench QB. The baseline now keeps the chop's own slots.
   */
  it("best ball re-solves over the CHOP's slots, not seats the commissioner changed afterwards", async () => {
    await arrange({ bestBall: true })
    const baseline = state.cache.get(guillotineCorrectionKey('s1', 3))
    expect(baseline.bestBallRules.slots).toEqual([{ slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 }])
    expect(typeof baseline.bestBallRules.algorithm).toBe('string')

    state.slots = [{ slot: 'QB', eligible: ['QB'], count: 2, slotOrder: 0 }]
    correct('b2', 80)
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    // One QB seat: 72.5 + (80 - 72.5). Two seats would have read 72.5 + (152.5 - 82.5) = 142.5.
    expect(r.changes).toEqual([{ redraftRosterId: 'rr-b', engineRosterId: 'R-b', before: 72.5, after: 80 }])
  })

  it('a baseline recorded before the slots were kept reads the current seats, as before', async () => {
    await arrange({ bestBall: true })
    const key = guillotineCorrectionKey('s1', 3)
    const { bestBallRules: _dropped, ...legacy } = state.cache.get(key)
    state.cache.set(key, legacy)
    state.slots = [{ slot: 'QB', eligible: ['QB'], count: 2, slotOrder: 0 }]
    correct('b2', 80)
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    expect(r.changes).toEqual([{ redraftRosterId: 'rr-b', engineRosterId: 'R-b', before: 72.5, after: 142.5 }])
  })

  it("a lineup league's baseline keeps no best ball rules", async () => {
    await arrange()
    expect(state.cache.get(guillotineCorrectionKey('s1', 3)).bestBallRules).toBeUndefined()
  })

  it('a lineup league counts starters only: a corrected bench player changes nothing', async () => {
    await arrange()
    correct('b2', 80)
    const r = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps())
    expect(r.outcome).toBe('no_change')
  })

  it('is checked hourly and only inside the window', async () => {
    await arrange()
    correct('b1', 100)
    const sync = vi.fn(async () => undefined)
    await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps({ syncWeekStats: sync }))
    const throttled = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps({ syncWeekStats: sync, now: () => new Date(NOW.getTime() + 10 * 60 * 1000) }))
    expect(throttled.outcome).toBe('throttled')
    const late = await applyGuillotineStatCorrectionsForWeek({ seasonId: 's1', week: 3 }, deps({ syncWeekStats: sync, now: () => new Date(CHOPPED_AT.getTime() + 7 * 24 * 3600 * 1000) }))
    expect(late.outcome).toBe('outside_window')
    expect(sync).toHaveBeenCalledOnce()
  })

  it('score-sync\'s entry finds the season\'s baselines; a week without one is never guessed at', async () => {
    await arrange()
    correct('b1', 100)
    expect((await checkGuillotineStatCorrectionsForSeason('s1', deps())).outcome).toBe('applied')
    expect((await checkGuillotineStatCorrectionsForSeason('other-season', deps())).outcome).toBe('no_baseline')
    expect(state.cache.get(guillotineCorrectionKey('s1', 3))?.lastFingerprint).toEqual(expect.any(String))
  })

  it('the cron route\'s handler runs the same pass for the Guilly season and never reverses', async () => {
    await arrange()
    correct('b1', 100)
    const r = await handleStatCorrection('g1', 3, ['b1'], deps())
    expect(r.reversed).toBe(false)
    expect(r.newEliminatedRosterId).toBe('R-c')
    expect(r.summary).toContain('The chop stands')
    expect(period('R-b', 3)?.periodPoints).toBe(100)
    expect(state.forbidden).toEqual([])
  })
})

describe('the correction as the commissioner reads it', () => {
  it('names who would have gone, says the chop stands, and is hidden from members', async () => {
    const { describeLogEntry, rosterIdsNamedBy } = await import('@/lib/league-log/leagueLog')
    const row = {
      id: 'log-2',
      actionType: GUILLOTINE_STAT_CORRECTION_ACTION,
      entityId: 's1:3',
      userId: null,
      beforeState: null,
      afterState: { changes: [{}], chopDisputed: true, choppedRedraftRosterIds: ['rr-b'], wouldHaveChoppedRedraftRosterIds: ['rr-c'] },
      metadata: { week: 3, changed: 1, chopDisputed: true },
      createdAt: '2026-10-02T12:00:00.000Z',
    }
    expect(rosterIdsNamedBy([row]).sort()).toEqual(['rr-b', 'rr-c'])
    const names = { users: {}, teams: { 'rr-b': 'Bravo', 'rr-c': 'Charlie' } }
    expect(describeLogEntry(row, { lang: 'en', names, forCommissioner: false })).toBeNull()
    const entry = describeLogEntry(row, { lang: 'en', names, forCommissioner: true })
    expect(entry?.title).toBe('Stat corrections updated 1 team score in week 3')
    expect(entry?.detail).toBe('With the corrected scores Charlie would have been chopped instead of Bravo. The chop stands.')
  })
})

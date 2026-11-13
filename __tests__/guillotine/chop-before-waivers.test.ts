// @vitest-environment node
/**
 * A Guilly league's waiver run must not settle a period whose chop is due and not yet applied
 * (lib/guillotine/chopBeforeWaivers.ts). The chop and the run are separate crons; the calendar puts
 * the chop first, but a held week (missing box scores, the correction window) can push it past the run.
 *
 * The process-engine block shows what a run that fires first actually does — the doomed team wins
 * its claim, and a bid on one of its players fails for good — and that the gate leaves every claim
 * pending instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  gate: vi.fn(async (): Promise<{ hold: false } | { hold: true; week: number; message: string }> => ({ hold: false })),
  league: {} as Record<string, unknown>,
  rosters: new Map<string, { id: string; platformUserId: string; playerData: string[]; faabRemaining: number; waiverPriority: number }>(),
  claims: [] as Array<Record<string, unknown>>,
  claimUpdates: [] as Array<Record<string, unknown>>,
  runsCreated: 0,
  config: null as null | Record<string, unknown>,
  gSeason: null as null | { currentScoringPeriod: number; status: string },
  lastChop: null as null | { choppedInPeriod: number },
  season: { id: 's1' } as null | { id: string },
  groupBy: [] as Array<{ leagueId: string; _count: { _all: number } }>,
  waiverType: 'faab',
}))

vi.mock('@/lib/guillotine/chopBeforeWaivers', async (orig) => ({
  ...(await orig<typeof import('@/lib/guillotine/chopBeforeWaivers')>()),
  guillotineChopPendingForWaivers: h.gate,
}))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(async () => h.config) }))
vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async () => ({ ok: true, backend: 'postgres' })),
  releaseAutomationLock: vi.fn(async () => undefined),
}))

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async () => h.league },
  waiverClaim: {
    findMany: async () => h.claims.map((c) => ({ ...c, roster: clone(h.rosters.get(c.rosterId as string)) })),
    update: vi.fn(async (args: Record<string, unknown>) => { h.claimUpdates.push(args); return {} }),
    groupBy: async () => h.groupBy,
    count: async () => 0,
  },
  roster: {
    findMany: async () => [...h.rosters.values()].map(clone),
    findUnique: async ({ where }: { where: { id: string } }) => clone(h.rosters.get(where.id) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = h.rosters.get(where.id)!
      Object.assign(row, data)
      return row
    }),
  },
  leagueTeam: { findMany: async () => [] },
  waiverRun: { create: async () => { h.runsCreated += 1; return { id: 'run' } }, update: async () => ({}), findFirst: async () => null, findMany: async () => [] },
  waiverTransaction: { create: vi.fn(async () => ({})) },
  waiverResult: { createMany: vi.fn(async () => ({})) },
  guillotineRosterState: { findFirst: async () => h.lastChop },
  guillotineSeason: { findFirst: async () => h.gSeason },
  redraftSeason: { findFirst: async () => h.season },
  $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
} }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: h.waiverType, waiverType: h.waiverType, waiverEngineConfig: {}, allowZeroFaabBid: true, faabMinBid: 0 }),
}))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null, upsertLeagueWaiverStateAfterRun: async () => {} }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: async () => {} }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: async () => {} }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NFL' }))
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({ planRedraftRosterMoveWrites: async () => [] }))
vi.mock('@/lib/league/faabMirror', () => ({ copyGenericFaabToRedraft: async () => {} }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverRunPhaseGate: async () => () => null }))
vi.mock('@/lib/guillotine/blindWaiverCutoff', async (orig) => ({
  ...(await orig<typeof import('@/lib/guillotine/blindWaiverCutoff')>()),
  guillotineClaimsCutoff: async () => null,
}))
vi.mock('@/lib/redraft/tradeMoveLock', async (orig) => ({
  ...(await orig<typeof import('@/lib/redraft/tradeMoveLock')>()),
  isRedraftLeagueMovesLocked: async () => false,
}))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { discoverDueWaiverLeagues } from '@/lib/automation/jobs/waivers/discoverDueWaiverLeagues'
import { chopPendingVerdict } from '@/lib/guillotine/chopBeforeWaivers'

const actual = () => vi.importActual<typeof import('@/lib/guillotine/chopBeforeWaivers')>('@/lib/guillotine/chopBeforeWaivers')

const GUILLY = { id: 'L', rosterSize: 20, sport: 'NFL', platform: 'allfantasy', leagueType: 'guillotine', guillotineMode: true, leagueVariant: 'guillotine', settings: {} }
const roster = (id: string, players: string[]) => ({ id, platformUserId: '', playerData: players, faabRemaining: 100, waiverPriority: 1 })
const claim = (id: string, rosterId: string, addPlayerId: string, faabBid: number) => ({
  id, leagueId: 'L', rosterId, addPlayerId, dropPlayerId: null, faabBid, priorityOrder: 1, status: 'pending', metadata: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
})
const base = { lastChoppedWeek: 4, currentScoringPeriod: 0, eliminationStartWeek: 1, eliminationEndWeek: 17, chopsInWeek: () => 1 }

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockImplementation(async () => ({ hold: false }))
  h.league = { ...GUILLY }
  // R1 is this week's lowest scorer, about to be chopped; d1 is one of its players.
  h.rosters = new Map([['R1', roster('R1', ['d1'])], ['R2', roster('R2', ['own'])]])
  h.claims = [claim('c-doomed', 'R1', 'fa1', 30), claim('c-on-chopped', 'R2', 'd1', 25)]
  h.claimUpdates = []
  h.runsCreated = 0
  h.config = { eliminationStartWeek: 1, eliminationEndWeek: 17, teamsPerChop: 1 }
  h.gSeason = { currentScoringPeriod: 0, status: 'active' }
  h.lastChop = { choppedInPeriod: 4 }
  h.season = { id: 's1' }
  h.groupBy = []
  h.waiverType = 'faab'
})

describe('chopPendingVerdict (pure)', () => {
  it('holds once the week after the last chop has finished and is not chopped', () => {
    expect(chopPendingVerdict({ ...base, fantasyWeek: 6, currentWeekComplete: false })).toEqual({ hold: true, week: 5 })
    expect(chopPendingVerdict({ ...base, fantasyWeek: 5, currentWeekComplete: true })).toEqual({ hold: true, week: 5 })
  })

  it('does not hold while that week is still being played', () => {
    expect(chopPendingVerdict({ ...base, fantasyWeek: 5, currentWeekComplete: false })).toMatchObject({ hold: false, reason: 'week_in_progress' })
  })

  it('does not hold for a no-chop week, past the elimination window, or once the chop landed', () => {
    expect(chopPendingVerdict({ ...base, fantasyWeek: 6, currentWeekComplete: false, chopsInWeek: (w) => (w === 5 ? 0 : 1) })).toMatchObject({ hold: false, reason: 'no_chop_week' })
    expect(chopPendingVerdict({ ...base, lastChoppedWeek: 17, fantasyWeek: 18, currentWeekComplete: true })).toMatchObject({ hold: false, reason: 'elimination_window_ended' })
    expect(chopPendingVerdict({ ...base, lastChoppedWeek: 5, fantasyWeek: 6, currentWeekComplete: false })).toMatchObject({ hold: false, reason: 'week_in_progress' })
  })

  it('stops holding once the chop is more than a week overdue (stuck, not late)', () => {
    expect(chopPendingVerdict({ ...base, fantasyWeek: 7, currentWeekComplete: false })).toMatchObject({ hold: false, week: 5, reason: 'chop_overdue' })
  })

  it('a later scoring period (a no-chop week already closed) moves the next chop week on', () => {
    expect(chopPendingVerdict({ ...base, currentScoringPeriod: 5, fantasyWeek: 6, currentWeekComplete: false })).toMatchObject({ hold: false, week: 6 })
  })
})

describe('guillotineChopPendingForWaivers (reads)', () => {
  const week = (fantasyWeek: number, sportWeekComplete = false) => vi.fn(async () => ({ ok: true, fantasyWeek, sportWeekComplete }) as never)

  it('holds a native Guilly league whose finished week is unchopped', async () => {
    const { guillotineChopPendingForWaivers } = await actual()
    await expect(guillotineChopPendingForWaivers('L', GUILLY, { resolveWeek: week(6) })).resolves.toMatchObject({ hold: true, week: 5 })
  })

  it('does not hold a non-Guilly league, an imported Guilly league, or a complete Guilly season', async () => {
    const { guillotineChopPendingForWaivers } = await actual()
    const resolveWeek = week(6)
    await expect(guillotineChopPendingForWaivers('L', { ...GUILLY, guillotineMode: false, leagueType: 'redraft', leagueVariant: 'redraft' }, { resolveWeek })).resolves.toEqual({ hold: false })
    await expect(guillotineChopPendingForWaivers('L', { ...GUILLY, platform: 'sleeper' }, { resolveWeek })).resolves.toEqual({ hold: false })
    h.gSeason = { currentScoringPeriod: 0, status: 'complete' }
    await expect(guillotineChopPendingForWaivers('L', GUILLY, { resolveWeek })).resolves.toEqual({ hold: false })
    expect(resolveWeek).not.toHaveBeenCalled()
  })

  it('an unreadable week or chop state holds nothing', async () => {
    const { guillotineChopPendingForWaivers } = await actual()
    await expect(guillotineChopPendingForWaivers('L', GUILLY, { resolveWeek: vi.fn(async () => ({ ok: false, reason: 'NO_WEEK_SIGNAL' }) as never) })).resolves.toEqual({ hold: false })
    await expect(guillotineChopPendingForWaivers('L', GUILLY, { resolveWeek: vi.fn(async () => { throw new Error('db down') }) })).resolves.toEqual({ hold: false })
  })
})

describe('the native waiver run against a chop that has not landed', () => {
  it('WITHOUT the gate (what used to happen): the doomed team wins its claim and the bid on its player fails for good', async () => {
    const results = await processWaiverClaimsForLeague('L')
    expect(results.find((r) => r.claimId === 'c-doomed')).toMatchObject({ success: true })
    expect(results.find((r) => r.claimId === 'c-on-chopped')).toMatchObject({ success: false })
    expect(h.rosters.get('R1')!.playerData).toContain('fa1')
  })

  it('with the chop pending: the run settles nothing, every claim stays pending, and says why', async () => {
    h.gate.mockImplementation(async () => ({ hold: true, week: 5, message: 'x' }))
    const onSkip = vi.fn()
    const results = await processWaiverClaimsForLeague('L', { onSkip })
    expect(results).toEqual([])
    expect(onSkip).toHaveBeenCalledWith('guillotine_chop_pending')
    expect(h.claimUpdates).toHaveLength(0)
    expect(h.runsCreated).toBe(0)
    expect(h.rosters.get('R1')!.playerData).toEqual(['d1'])
  })

  it("a commissioner's manual run is not held (like every other hold here)", async () => {
    h.gate.mockImplementation(async () => ({ hold: true, week: 5, message: 'x' }))
    const results = await processWaiverClaimsForLeague('L', { runType: 'manual' })
    expect(results.length).toBeGreaterThan(0)
    expect(h.gate).not.toHaveBeenCalled()
  })
})

describe('the cron still picks up a deferred FCFS Guilly league', () => {
  it('an FCFS native Guilly league with pending claims is due; an FCFS ordinary league is not', async () => {
    h.waiverType = 'fcfs'
    h.groupBy = [{ leagueId: 'L', _count: { _all: 2 } }]
    h.league = { sport: 'NCAAF', guillotineMode: true, leagueVariant: 'guillotine', leagueType: 'guillotine', platform: 'allfantasy' }
    expect((await discoverDueWaiverLeagues()).map((d) => d.leagueId)).toEqual(['L'])
    h.league = { sport: 'NCAAF', guillotineMode: false, leagueVariant: 'redraft', leagueType: 'redraft', platform: 'allfantasy' }
    expect(await discoverDueWaiverLeagues()).toEqual([])
  })
})

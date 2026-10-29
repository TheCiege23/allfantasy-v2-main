// @vitest-environment node
/**
 * The Guilly blind FAAB auction in the NATIVE waiver engine (lib/waiver-wire/process-engine.ts) and the
 * waiver cron's discovery. The native league's waiver screen files `WaiverClaim` rows, which this
 * engine settles; the hold used to exist only in lib/redraft/waiverEngine.ts, so a chopped roster's
 * players went out in claim order. Window times: NBA run Thursday 12:00 UTC, window opens Wednesday
 * 00:00 UTC (__tests__/guillotine/blind-waiver-window.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: { id: 'L', rosterSize: 20, sport: 'NBA', guillotineMode: true, leagueVariant: 'guillotine' } as Record<string, unknown>,
  claims: [] as Array<Record<string, unknown>>,
  runCreate: vi.fn(async () => ({ id: 'run' })),
  claimCount: vi.fn(),
  groupBy: vi.fn(),
  settings: { normalizedWaiverType: 'faab', waiverType: 'faab', waiverEngineConfig: {} } as Record<string, unknown>,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async () => h.league },
  waiverClaim: { findMany: async () => h.claims, update: vi.fn(() => ({})), count: h.claimCount, groupBy: h.groupBy },
  roster: { findMany: async () => [], update: vi.fn(), findUnique: async () => null },
  leagueTeam: { findMany: async () => [] },
  waiverRun: { create: h.runCreate, update: vi.fn(async () => ({})), findFirst: async () => null, findMany: async () => [] },
  waiverTransaction: { create: vi.fn() },
  waiverResult: { createMany: vi.fn() },
  guillotineRosterState: { findFirst: async () => null },
  $transaction: vi.fn(async () => []),
} }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: async () => h.settings }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null, upsertLeagueWaiverStateAfterRun: async () => {} }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: async () => {} }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: async () => {} }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NBA' }))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { discoverDueWaiverLeagues } from '@/lib/automation/jobs/waivers/discoverDueWaiverLeagues'
import { blindWaiverCutoff } from '@/lib/guillotine/blindWaiverCutoff'

const INSIDE = new Date('2026-10-28T03:00:00Z') // window opened 2026-10-28T00:00Z
const OUTSIDE = new Date('2026-10-27T15:00:00Z')
const claim = (id: string, createdAt: string, faabBid: number) => ({
  id, leagueId: 'L', rosterId: `R-${id}`, addPlayerId: `p-${id}`, dropPlayerId: null, faabBid, priorityOrder: 1, status: 'pending', metadata: null,
  createdAt: new Date(createdAt), roster: { id: `R-${id}`, platformUserId: '', playerData: [], faabRemaining: 100, waiverPriority: 1 },
})
const settledIds = (results: Array<{ claimId: string }>) => results.map((r) => r.claimId).sort()

describe('blindWaiverCutoff', () => {
  it('holds only for an NBA/NFL Guilly league, from when the window opened', () => {
    const guilly = { sport: 'NBA', guillotineMode: true, leagueVariant: null }
    expect(blindWaiverCutoff(guilly, null, INSIDE)?.toISOString()).toBe('2026-10-28T00:00:00.000Z')
    expect(blindWaiverCutoff(guilly, null, OUTSIDE)).toBeNull()
    expect(blindWaiverCutoff({ sport: 'NBA', guillotineMode: false, leagueVariant: 'redraft' }, null, INSIDE)).toBeNull()
    expect(blindWaiverCutoff({ sport: 'MLB', guillotineMode: true, leagueVariant: 'guillotine' }, null, INSIDE)).toBeNull()
  })
})

describe('native waiver engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.claims = [claim('early', '2026-10-27T20:00:00Z', 5), claim('blind', '2026-10-28T01:00:00Z', 40)]
  })
  afterEach(() => vi.useRealTimers())

  it('inside the window, claims made since it opened wait for the run', async () => {
    vi.useFakeTimers({ now: INSIDE, toFake: ['Date'] })
    expect(settledIds(await processWaiverClaimsForLeague('L'))).toEqual(['early'])
  })

  it('a window that holds every claim settles nothing and opens no run', async () => {
    vi.useFakeTimers({ now: INSIDE, toFake: ['Date'] })
    h.claims = [claim('blind', '2026-10-28T01:00:00Z', 40)]
    expect(await processWaiverClaimsForLeague('L', { runType: 'fcfs_immediate' })).toEqual([])
    expect(h.runCreate).not.toHaveBeenCalled()
  })

  it('outside the window everything settles, and a commissioner\'s manual run is never held', async () => {
    vi.useFakeTimers({ now: OUTSIDE, toFake: ['Date'] })
    expect(settledIds(await processWaiverClaimsForLeague('L'))).toEqual(['blind', 'early'])
    vi.setSystemTime(INSIDE)
    expect(settledIds(await processWaiverClaimsForLeague('L', { runType: 'manual' }))).toEqual(['blind', 'early'])
  })
})

describe('waiver cron discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.groupBy.mockResolvedValue([{ leagueId: 'L', _count: { _all: 2 } }])
    h.settings = { normalizedWaiverType: 'faab', waiverType: 'faab', waiverEngineConfig: {} }
  })

  it('a Guilly league whose every claim is held is not due (the run would spend the day)', async () => {
    h.claimCount.mockResolvedValue(0)
    expect(await discoverDueWaiverLeagues({ now: INSIDE })).toEqual([])
    expect(h.claimCount).toHaveBeenCalledWith({ where: { leagueId: 'L', status: 'pending', createdAt: { lt: new Date('2026-10-28T00:00:00Z') } } })
  })

  it('it is due once a claim is old enough, or the window has closed', async () => {
    h.claimCount.mockResolvedValue(1)
    expect((await discoverDueWaiverLeagues({ now: INSIDE })).map((d) => d.leagueId)).toEqual(['L'])
    expect((await discoverDueWaiverLeagues({ now: OUTSIDE })).map((d) => d.leagueId)).toEqual(['L'])
  })

  it('an FCFS Guilly league is still picked up, so claims held at claim time settle; plain FCFS is not', async () => {
    h.settings = { normalizedWaiverType: 'fcfs', waiverType: 'fcfs', waiverEngineConfig: {} }
    expect((await discoverDueWaiverLeagues({ now: OUTSIDE })).map((d) => d.leagueId)).toEqual(['L'])
    h.league = { ...h.league, guillotineMode: false, leagueVariant: 'redraft' }
    expect(await discoverDueWaiverLeagues({ now: OUTSIDE })).toEqual([])
    h.league = { ...h.league, guillotineMode: true, leagueVariant: 'guillotine' }
  })
})

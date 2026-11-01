// @vitest-environment node
/**
 * The commissioner's "Lock all roster moves" (`League.lockAllMoves`) at waiver PROCESSING time.
 *
 * A claim filed before the lock went on must not settle while it is on. The engine
 * (lib/waiver-wire/process-engine.ts) re-reads the lock with the helper the claim routes use
 * (`isRedraftLeagueMovesLocked`), touches nothing and reports the skip; the cron skips the league
 * before its automation job, and a job that still meets the lock ends SKIPPED, not completed, so the
 * day's idempotency key is not spent. Once the lock is lifted, the next run settles the same claims.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: { id: 'L', rosterSize: 20, sport: 'NBA', guillotineMode: false, leagueVariant: null, lockAllMoves: true } as Record<string, unknown>,
  claims: [] as Array<Record<string, unknown>>,
  runCreate: vi.fn(async () => ({ id: 'run' })),
  claimUpdate: vi.fn(async () => ({})),
  leagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: h.leagueFindUnique },
  waiverClaim: { findMany: async () => h.claims, update: h.claimUpdate, count: vi.fn(), groupBy: vi.fn() },
  roster: { findMany: async () => [], update: vi.fn(), findUnique: async () => null },
  leagueTeam: { findMany: async () => [] },
  waiverRun: { create: h.runCreate, update: vi.fn(async () => ({})), findFirst: async () => null, findMany: async () => [] },
  waiverTransaction: { create: vi.fn() },
  waiverResult: { createMany: vi.fn() },
  guillotineRosterState: { findFirst: async () => null },
  $transaction: vi.fn(async () => []),
} }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: 'faab', waiverType: 'faab', waiverEngineConfig: {} }),
}))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null, upsertLeagueWaiverStateAfterRun: async () => {} }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: async () => {} }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: async () => {} }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NBA' }))

// The automation envelope, kept honest about the one thing under test: the status the handler returns.
const audit = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/automation/audit', () => ({ writeAutomationAuditLog: audit }))
vi.mock('@/lib/automation/realtime', () => ({ publishRealtimeEvent: vi.fn(async () => undefined) }))
const chat = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/automation/notifications', () => ({ enqueueLeagueChatNotification: chat }))
vi.mock('@/lib/automation/locks', () => ({
  withAutomationLock: async (_k: string, _o: unknown, fn: () => Promise<unknown>) => ({ ok: true, value: await fn() }),
}))
vi.mock('@/lib/automation/engine', () => ({
  runAutomationJob: async (_ctx: unknown, handler: (c: { jobId: string }) => Promise<Record<string, unknown>>) => ({
    ...(await handler({ jobId: 'job' })),
    jobId: 'job',
    runId: 'run',
  }),
}))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
import { processLeagueWaiversJob } from '@/lib/automation/jobs/waivers/processLeagueWaiversJob'

const claim = (id: string, faabBid: number) => ({
  id, leagueId: 'L', rosterId: `R-${id}`, addPlayerId: `p-${id}`, dropPlayerId: null, faabBid, priorityOrder: 1, status: 'pending', metadata: null,
  createdAt: new Date('2026-10-20T12:00:00Z'), roster: { id: `R-${id}`, platformUserId: '', playerData: [], faabRemaining: 100, waiverPriority: 1 },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.league = { ...h.league, lockAllMoves: true }
  h.claims = [claim('a', 5), claim('b', 10)]
  h.leagueFindUnique.mockImplementation(async () => h.league)
})

describe('waiver engine under "Lock all roster moves"', () => {
  it('a scheduled run settles nothing: no run row, no claim write, the skip is reported', async () => {
    const onSkip = vi.fn()
    expect(await processWaiverClaimsForLeague('L', { runType: 'scheduled', onSkip })).toEqual([])
    expect(onSkip).toHaveBeenCalledWith('league_moves_locked')
    expect(h.runCreate).not.toHaveBeenCalled()
    expect(h.claimUpdate).not.toHaveBeenCalled()
    // The lock is read with the helper the claim routes use, not a copy of it.
    expect(h.leagueFindUnique).toHaveBeenCalledWith({ where: { id: 'L' }, select: { lockAllMoves: true } })
  })

  it('every automated run type is held: queue, FCFS-immediate and a run with no type', async () => {
    for (const runType of ['queue', 'fcfs_immediate', undefined]) {
      expect(await processWaiverClaimsForLeague('L', { runType })).toEqual([])
    }
    expect(h.runCreate).not.toHaveBeenCalled()
    expect(h.claimUpdate).not.toHaveBeenCalled()
  })

  it('once the lock is lifted, the next run settles the same pending claims', async () => {
    expect(await processWaiverClaimsForLeague('L', { runType: 'scheduled' })).toEqual([])
    h.league = { ...h.league, lockAllMoves: false }
    const onSkip = vi.fn()
    const results = await processWaiverClaimsForLeague('L', { runType: 'scheduled', onSkip })
    expect(results.map((r) => r.claimId).sort()).toEqual(['a', 'b'])
    expect(onSkip).not.toHaveBeenCalled()
    expect(h.runCreate).toHaveBeenCalledTimes(1)
  })

  it("a commissioner's manual run is not held, like commissionerOverride in the waiver runtime", async () => {
    const results = await processWaiverClaimsForLeague('L', { runType: 'manual' })
    expect(results.map((r) => r.claimId).sort()).toEqual(['a', 'b'])
  })
})

describe('the cron job under the lock', () => {
  afterEach(() => vi.useRealTimers())

  it('ends SKIPPED with a "skipped as locked" summary, and posts no "Waivers processed" message', async () => {
    const out = await processLeagueWaiversJob({ leagueId: 'L', trigger: 'cron', scheduledFor: new Date('2026-10-25T10:00:00Z') })
    expect(out.ok).toBe(true)
    expect(out.rawResults).toEqual([])
    expect(out.message).toMatch(/skipped: the commissioner has locked all roster moves/i)
    expect(out.summary.message).toMatch(/Pending claims stay pending/)
    expect(out.summary.metadata).toMatchObject({ skippedReason: 'league_moves_locked' })
    expect(chat).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'waivers.skipped', leagueId: 'L' }))
    expect(h.claimUpdate).not.toHaveBeenCalled()
  })

  it('unlocked, the same job processes the claims and reports them', async () => {
    h.league = { ...h.league, lockAllMoves: false }
    const out = await processLeagueWaiversJob({ leagueId: 'L', trigger: 'cron', scheduledFor: new Date('2026-10-25T10:00:00Z') })
    expect(out.ok).toBe(true)
    expect(out.rawResults.map((r) => r.claimId).sort()).toEqual(['a', 'b'])
    expect(out.summary.processedClaims).toBe(2)
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ title: 'Waivers processed' }))
  })
})

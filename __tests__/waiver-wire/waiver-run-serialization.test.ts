// @vitest-environment node
/**
 * Waiver runs for one league must not overlap, and one run must not overwrite itself.
 *
 *   1. Only the cron took a lock; the commissioner's process button, the manual route, FCFS-immediate
 *      processing and the workers called the processor directly. Every run now serializes on
 *      `waiver:process:{leagueId}` inside `processWaiverClaimsForLeague`.
 *   2. A team winning two claims in one run had the second award written from a stale copy of its
 *      roster: the first player vanished and the second bid was charged against the original balance.
 *   3. The roster write is a compare-and-set, so a write by anything else in between leaves the claim
 *      pending instead of being silently overwritten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type RosterRow = { id: string; platformUserId: string; playerData: string[]; faabRemaining: number | null; waiverPriority: number }

const h = vi.hoisted(() => ({
  rosters: new Map<string, { id: string; platformUserId: string; playerData: string[]; faabRemaining: number | null; waiverPriority: number }>(),
  claims: [] as Array<Record<string, unknown>>,
  rosterUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  /** Simulates another writer touching a roster between the run's read and its write. */
  interfere: null as null | ((rosterId: string) => void),
  locks: new Map<string, string>(),
  lockError: false,
}))

vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async (key: string, { owner }: { owner: string }) => {
    if (h.lockError) return { ok: false, reason: 'Postgres lock error: table missing' }
    const held = h.locks.get(key)
    if (held && held !== owner) return { ok: false, reason: 'Lock held (postgres)' }
    h.locks.set(key, owner)
    return { ok: true, backend: 'postgres' }
  }),
  releaseAutomationLock: vi.fn(async (key: string, owner: string) => {
    if (h.locks.get(key) === owner) h.locks.delete(key)
  }),
}))

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async () => ({ id: 'L', rosterSize: 20, sport: 'NFL', guillotineMode: false, leagueVariant: 'redraft', settings: {}, platform: 'manual' }) },
  waiverClaim: {
    // Each claim arrives with its OWN copy of its roster, as Prisma's `include` returns it.
    findMany: async () => h.claims.map((c) => ({ ...c, roster: clone(h.rosters.get(c.rosterId as string)) })),
    update: vi.fn(async () => ({})),
  },
  roster: {
    findMany: async () => [...h.rosters.values()].map(clone),
    findUnique: async ({ where }: { where: { id: string } }) => clone(h.rosters.get(where.id) ?? null),
    update: vi.fn(({ where, data }: { where: Record<string, any>; data: Record<string, unknown> }) => {
      h.rosterUpdates.push({ where, data })
      h.interfere?.(where.id)
      const row = h.rosters.get(where.id)!
      // Behaves like Postgres: a `where` that names no snapshot writes unconditionally, so this test
      // fails if the engine ever stops sending one.
      const sameData = !('playerData' in where) || JSON.stringify(row.playerData) === JSON.stringify(where.playerData?.equals)
      const sameFaab = !('faabRemaining' in where) || row.faabRemaining === where.faabRemaining
      if (!sameData || !sameFaab) {
        return Promise.reject(Object.assign(new Error('Record to update not found.'), { code: 'P2025', meta: { modelName: 'Roster' } }))
      }
      Object.assign(row, data)
      return Promise.resolve(row)
    }),
  },
  leagueTeam: { findMany: async () => [] },
  waiverRun: { create: async () => ({ id: 'run' }), update: async () => ({}), findFirst: async () => null, findMany: async () => [] },
  waiverTransaction: { create: vi.fn(async () => ({})) },
  waiverResult: { createMany: vi.fn(async () => ({})) },
  guillotineRosterState: { findFirst: async () => null },
  $transaction: (ops: Array<Promise<unknown>>) => Promise.all(ops),
} }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({ normalizedWaiverType: 'faab', waiverType: 'faab', waiverEngineConfig: {}, allowZeroFaabBid: true, faabMinBid: 0 }),
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
vi.mock('@/lib/guillotine/blindWaiverCutoff', () => ({ guillotineClaimsCutoff: async () => null }))
vi.mock('@/lib/redraft/tradeMoveLock', async (orig) => ({
  ...(await orig<typeof import('@/lib/redraft/tradeMoveLock')>()),
  isRedraftLeagueMovesLocked: async () => false,
}))

import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'

const roster = (id: string, faab = 100): RosterRow => ({ id, platformUserId: '', playerData: ['own-1'], faabRemaining: faab, waiverPriority: 1 })
const claim = (id: string, rosterId: string, addPlayerId: string, faabBid: number, priorityOrder = 1) => ({
  id, leagueId: 'L', rosterId, addPlayerId, dropPlayerId: null, faabBid, priorityOrder, status: 'pending', metadata: null,
  createdAt: new Date('2026-11-01T00:00:00Z'),
})

beforeEach(() => {
  vi.clearAllMocks()
  h.rosters = new Map([['R1', roster('R1')], ['R2', roster('R2')]])
  h.claims = []
  h.rosterUpdates = []
  h.interfere = null
  h.locks = new Map()
  h.lockError = false
})
afterEach(() => vi.useRealTimers())

describe('one run, one team, two awards', () => {
  it('keeps both players and charges both bids', async () => {
    h.claims = [claim('c1', 'R1', 'p1', 10), claim('c2', 'R1', 'p2', 20, 2)]
    const results = await processWaiverClaimsForLeague('L')
    expect(results.filter((r) => r.success).map((r) => r.claimId).sort()).toEqual(['c1', 'c2'])
    const final = h.rosters.get('R1')!
    expect([...final.playerData].sort()).toEqual(['own-1', 'p1', 'p2'])
    expect(final.faabRemaining).toBe(70)
  })
})

describe('compare-and-set on the roster write', () => {
  it('a roster changed by another writer mid-run is not overwritten; the claim stays pending', async () => {
    h.claims = [claim('c1', 'R1', 'p1', 10)]
    // A Guilly chop's FAAB split credits R1 between the run's read and its write.
    h.interfere = (id) => { if (id === 'R1') h.rosters.get('R1')!.faabRemaining = 150 }
    const results = await processWaiverClaimsForLeague('L')
    expect(results.find((r) => r.claimId === 'c1' && r.success)).toBeUndefined()
    expect(h.rosters.get('R1')).toMatchObject({ faabRemaining: 150, playerData: ['own-1'] })
  })
})

describe('one waiver run per league at a time', () => {
  it('a run that finds the league busy waits, then skips and leaves every claim pending', async () => {
    vi.useFakeTimers()
    h.claims = [claim('c1', 'R1', 'p1', 10)]
    h.locks.set('waiver:process:L', 'someone-else')
    const onSkip = vi.fn()
    const pending = processWaiverClaimsForLeague('L', { onSkip })
    await vi.runAllTimersAsync()
    expect(await pending).toEqual([])
    expect(onSkip).toHaveBeenCalledWith('run_in_progress')
    expect(h.rosterUpdates).toHaveLength(0)
  })

  it('takes the lock it waited for once the other run finishes', async () => {
    vi.useFakeTimers()
    h.claims = [claim('c1', 'R1', 'p1', 10)]
    h.locks.set('waiver:process:L', 'someone-else')
    const pending = processWaiverClaimsForLeague('L')
    await vi.advanceTimersByTimeAsync(800)
    h.locks.delete('waiver:process:L')
    await vi.runAllTimersAsync()
    expect((await pending).map((r) => r.claimId)).toEqual(['c1'])
  })

  it('releases the lock when the run ends', async () => {
    h.claims = [claim('c1', 'R1', 'p1', 10)]
    await processWaiverClaimsForLeague('L')
    expect(h.locks.size).toBe(0)
  })

  it('a lock table that cannot be read does not stop waivers', async () => {
    h.lockError = true
    h.claims = [claim('c1', 'R1', 'p1', 10)]
    expect((await processWaiverClaimsForLeague('L')).map((r) => r.claimId)).toEqual(['c1'])
  })

  it('two runs started together settle a contested player once', async () => {
    h.claims = [claim('c1', 'R1', 'p9', 30), claim('c2', 'R2', 'p9', 20)]
    vi.useFakeTimers()
    const a = processWaiverClaimsForLeague('L')
    const b = processWaiverClaimsForLeague('L')
    await vi.runAllTimersAsync()
    const all = [...(await a), ...(await b)].filter((r) => r.success)
    expect(all).toHaveLength(1)
    const holders = [...h.rosters.values()].filter((r) => r.playerData.includes('p9'))
    expect(holders.map((r) => r.id)).toEqual(['R1'])
  })
})

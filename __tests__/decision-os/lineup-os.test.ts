import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/decision-os/lineup/warehouseFacts', () => ({ loadLineupWarehouseFacts: async () => null }))
vi.mock('@/lib/decision-os/lineup/signalFacts', () => ({ loadLineupSignalFacts: async () => null }))

import {
  createLineupOsStore,
  lineupOsScope,
  LINEUP_OS_TTL_MS,
} from '@/lib/decision-os/lineup-os/store'
import {
  createLineupOsLoaders,
  refreshLineupOsLeague,
} from '@/lib/decision-os/lineup-os/readThrough'

const WAREHOUSE = { performance: null, matchup: null, uncertainty: ['x'] } as never
const SIGNAL = { injury: null, schedule: null, projections: null } as never

const wArgs = { leagueId: 'L1', sport: 'NFL', userId: 'u1', playerIds: ['p1'] }
const sArgs = { leagueId: 'L1', sport: 'NFL', week: 3, players: [{ playerId: 'p1', playerName: 'A' }] }

/** An in-memory stand-in with a controllable clock, so TTL behaviour is testable without waiting. */
function memoryStore(seed: Array<{ kind: string; scopeKey: string; facts: unknown; ageMs: number }> = []) {
  const rows = new Map<string, { facts: unknown; capturedAt: Date }>()
  for (const s of seed) rows.set(`L1|${s.kind}|${s.scopeKey}`, { facts: s.facts, capturedAt: new Date(Date.now() - s.ageMs) })
  const writes: Array<{ kind: string; scopeKey: string }> = []
  return {
    writes,
    store: {
      async read({ leagueId, kind, scopeKey }: never) {
        const row = rows.get(`${leagueId}|${kind}|${scopeKey}`)
        if (!row) return null
        const ageMs = Date.now() - row.capturedAt.getTime()
        if (ageMs > (LINEUP_OS_TTL_MS as never as Record<string, number>)[kind]) return null
        return { facts: row.facts, capturedAt: row.capturedAt, ageMs }
      },
      async write({ leagueId, kind, scopeKey, facts }: never) {
        writes.push({ kind, scopeKey })
        rows.set(`${leagueId}|${kind}|${scopeKey}`, { facts, capturedAt: new Date() })
      },
    } as never,
  }
}

describe('it accelerates without becoming a source of truth', () => {
  it('serves a FRESH entry and never calls the live loader', async () => {
    const { store } = memoryStore([{ kind: 'warehouse', scopeKey: lineupOsScope.warehouse('u1'), facts: WAREHOUSE, ageMs: 1000 }])
    const live = vi.fn(async () => ({ performance: null, matchup: null, uncertainty: ['LIVE'] }) as never)
    const l = createLineupOsLoaders({ store, liveWarehouse: live })
    const out = await l.loadWarehouseFacts(wArgs)
    expect(live).not.toHaveBeenCalled()
    expect((out as never as { uncertainty: string[] }).uncertainty).toEqual(['x'])
    expect(l.drainOutcomes().warehouse).toMatchObject({ servedFrom: 'store' })
  })

  it('treats a STALE entry as absent and derives live instead', async () => {
    // The whole safety argument. Maintained state that stops refreshing lies with confidence;
    // past its TTL this behaves exactly like the code we already had.
    const { store } = memoryStore([{
      kind: 'warehouse', scopeKey: lineupOsScope.warehouse('u1'), facts: WAREHOUSE,
      ageMs: LINEUP_OS_TTL_MS.warehouse + 1,
    }])
    const live = vi.fn(async () => ({ performance: null, matchup: null, uncertainty: ['LIVE'] }) as never)
    const l = createLineupOsLoaders({ store, liveWarehouse: live })
    const out = await l.loadWarehouseFacts(wArgs)
    expect(live).toHaveBeenCalledTimes(1)
    expect((out as never as { uncertainty: string[] }).uncertainty).toEqual(['LIVE'])
    expect(l.drainOutcomes().warehouse).toMatchObject({ servedFrom: 'live', ageMs: 0 })
  })

  it('signals expire far sooner than warehouse facts', () => {
    // Injury and bye decide whether a player can be started at all; season aggregates do not move.
    // A single global TTL would have to be tuned to the fastest input and waste the slower one.
    expect(LINEUP_OS_TTL_MS.signal).toBeLessThan(LINEUP_OS_TTL_MS.warehouse)
  })

  it('writes a live result back so the next caller does not pay for it', async () => {
    const m = memoryStore()
    const l = createLineupOsLoaders({ store: m.store, liveWarehouse: async () => WAREHOUSE })
    await l.loadWarehouseFacts(wArgs)
    expect(m.writes).toEqual([{ kind: 'warehouse', scopeKey: 'user:u1' }])
  })

  it('does NOT cache an unavailable result', async () => {
    // Caching null would turn a transient source outage into a TTL-long blackout, and
    // "unavailable" is a fact about the source, not about the league.
    const m = memoryStore()
    const l = createLineupOsLoaders({ store: m.store, liveWarehouse: async () => null })
    const out = await l.loadWarehouseFacts(wArgs)
    expect(out).toBeNull()
    expect(m.writes).toEqual([])
    expect(l.drainOutcomes().warehouse).toMatchObject({ servedFrom: 'unavailable', ageMs: null })
  })

  it('scopes warehouse per USER and signal per WEEK', async () => {
    // A writer and a reader disagreeing about the key would silently serve one manager's cited
    // roster numbers to another.
    const m = memoryStore()
    const l = createLineupOsLoaders({ store: m.store, liveWarehouse: async () => WAREHOUSE, liveSignal: async () => SIGNAL })
    await l.loadWarehouseFacts(wArgs)
    await l.loadSignalFacts(sArgs)
    expect(m.writes).toEqual([
      { kind: 'warehouse', scopeKey: 'user:u1' },
      { kind: 'signal', scopeKey: 'week:3' },
    ])
  })
})

describe('it can never break the decision path', () => {
  it('falls through when the live loader throws', async () => {
    const { store } = memoryStore()
    const l = createLineupOsLoaders({ store, liveWarehouse: async () => { throw new Error('ports down') } })
    await expect(l.loadWarehouseFacts(wArgs)).resolves.toBeNull()
  })

  it('falls through when the store itself throws', async () => {
    const store = { read: async () => { throw new Error('db down') }, write: async () => {} } as never
    const l = createLineupOsLoaders({ store, liveWarehouse: async () => WAREHOUSE })
    // A cache that throws converts an accelerator into a new way for the decision to fail.
    await expect(l.loadWarehouseFacts(wArgs)).resolves.toBeTruthy()
  })

  it('returns no cached facts when the delegate does not exist yet', async () => {
    // True before the migration is applied.
    const s = createLineupOsStore({} as never)
    await expect(s.read({ leagueId: 'L1', kind: 'warehouse', scopeKey: 'user:u1' })).resolves.toBeNull()
    await expect(s.write({ leagueId: 'L1', sport: 'NFL', kind: 'warehouse', scopeKey: 'user:u1', facts: {} })).resolves.toBeUndefined()
  })
})

describe('refresh — the half that needs a scheduler', () => {
  it('writes both fact kinds and reports what it managed', async () => {
    const m = memoryStore()
    const out = await refreshLineupOsLeague(
      { leagueId: 'L1', sport: 'NFL', userId: 'u1', week: 3, playerIds: ['p1'], players: sArgs.players },
      { store: m.store, liveWarehouse: async () => WAREHOUSE, liveSignal: async () => SIGNAL, now: () => 0 },
    )
    expect(out).toMatchObject({ leagueId: 'L1', warehouse: 'written', signal: 'written' })
    expect(m.writes).toHaveLength(2)
  })

  it('reports honestly when a source is unavailable, and still does the other', async () => {
    const m = memoryStore()
    const out = await refreshLineupOsLeague(
      { leagueId: 'L1', sport: 'NFL', userId: 'u1', week: 3, playerIds: ['p1'], players: sArgs.players },
      { store: m.store, liveWarehouse: async () => null, liveSignal: async () => SIGNAL, now: () => 0 },
    )
    expect(out.warehouse).toBe('unavailable')
    expect(out.signal).toBe('written')
  })

  it('never throws, even when everything fails', async () => {
    const m = memoryStore()
    await expect(
      refreshLineupOsLeague(
        { leagueId: 'L1', sport: 'NFL', userId: 'u1', week: 3, playerIds: ['p1'], players: sArgs.players },
        {
          store: m.store,
          liveWarehouse: async () => { throw new Error('a') },
          liveSignal: async () => { throw new Error('b') },
          now: () => 0,
        },
      ),
    ).resolves.toMatchObject({ warehouse: 'unavailable', signal: 'unavailable' })
  })
})

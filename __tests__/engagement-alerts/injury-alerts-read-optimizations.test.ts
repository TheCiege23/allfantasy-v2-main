/**
 * P4/P5 stage A: the injury-alert read optimisations must change how much is read, never what is
 * sent or recorded.
 *
 * Every scenario runs twice against the same stateful fake store, once with the optimisations on
 * (the default) and once with `AF_READ_OPTIMIZATIONS_OFF=injury-alerts`, and asserts identical
 * dispatches, identical writes and identical results. The operation counts are asserted separately.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => {
  const store = new Map<string, unknown>()
  const ops = { obsFindUnique: 0, obsFindMany: 0, injuryArgs: [] as unknown[], recipients: [] as string[] }
  let injuryRows: Array<Record<string, unknown>> = []
  let failBatchRead = false
  return {
    store, ops,
    setRows: (rows: Array<Record<string, unknown>>) => { injuryRows = rows },
    setFailBatchRead: (v: boolean) => { failBatchRead = v },
    injuries: async (args: { select?: Record<string, boolean> }) => {
      ops.injuryArgs.push(args)
      if (!args.select) return injuryRows.map((r) => ({ ...r }))
      // A real `select` returns only those columns, so a code path that reads anything else breaks here.
      return injuryRows.map((r) => Object.fromEntries(Object.keys(args.select!).map((k) => [k, r[k] ?? null])))
    },
    findUnique: async ({ where }: { where: { cacheKey: string } }) => {
      if (where.cacheKey.startsWith('injury-observation:')) ops.obsFindUnique++
      return h_store_get(store, where.cacheKey)
    },
    findMany: async ({ where }: { where: { cacheKey: { in: string[] } } }) => {
      if (where.cacheKey.in.some((k) => k.startsWith('injury-observation:'))) {
        ops.obsFindMany++
        if (failBatchRead) throw new Error('batch read failed')
      }
      return where.cacheKey.in.filter((k) => store.has(k)).map((k) => ({ cacheKey: k, data: store.get(k) }))
    },
    upsert: async ({ where, update, create }: { where: { cacheKey: string }; update: { data: unknown }; create: { data: unknown } }) => {
      store.set(where.cacheKey, store.has(where.cacheKey) ? update.data : create.data)
      return {}
    },
    createMany: async ({ data }: { data: Array<{ cacheKey: string; data: unknown }> }) => {
      for (const d of data) if (!store.has(d.cacheKey)) store.set(d.cacheKey, d.data)
      return { count: data.length }
    },
    identity: vi.fn(),
    recipients: vi.fn(),
    dispatch: vi.fn(),
    native: vi.fn(),
  }
  function h_store_get(s: Map<string, unknown>, key: string) {
    return s.has(key) ? { cacheKey: key, data: s.get(key) } : null
  }
})

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: { findUnique: h.findUnique, findMany: h.findMany, upsert: h.upsert, createMany: h.createMany },
    sportsInjury: { findMany: h.injuries },
    redraftRosterPlayer: { findMany: h.native },
    roster: { findMany: async () => [] },
    userProfile: { findUnique: async () => null, findMany: async () => [] },
  },
}))
vi.mock('@/lib/notifications/playerNewsRecipients', () => ({
  FINISHED_SEASON_STATUSES: ['completed'],
  resolvePlayerNewsIdentity: h.identity,
  resolvePlayerNewsRecipients: h.recipients,
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))

import { notifySyncedInjuries } from '@/lib/engagement-alerts/injuryAlerts'

const NOW = new Date('2026-10-25T18:00:00Z')
const recent = (min: number) => new Date(NOW.getTime() - min * 60_000)

/** A run's worth of rows covering every branch of the loop. */
function fixture() {
  return [
    // dated OUT, two players on one team: one batch
    { externalId: 'a', playerName: 'Alpha', team: 'ARI', status: 'Out', source: 'espn', date: recent(5), raw: { big: 'x'.repeat(1000) } },
    { externalId: 'b', playerName: 'Bravo', team: 'ARI', status: 'Out', source: 'espn', date: recent(6), raw: { big: 'y' } },
    // same identity again, older: skipped by the identity de-dupe
    { externalId: 'a2', playerName: 'Alpha', team: 'ARI', status: 'Questionable', source: 'espn', date: recent(30) },
    // undated, previously questionable: an observed transition
    { externalId: 'c', playerName: 'Charlie', team: 'BUF', status: 'Out', source: 'rolling_insights', date: null },
    // undated with no previous observation: baselined, not sent
    { externalId: 'd', playerName: 'Delta', team: 'BUF', status: 'Doubtful', source: 'rolling_insights', date: null },
    // same status as stored: recorded, not sent
    { externalId: 'e', playerName: 'Echo', team: 'KC', status: 'Out', source: 'espn', date: recent(3) },
    // healthy recap with no prior injury: baselined
    { externalId: 'f', playerName: 'Foxtrot', team: 'KC', status: 'Active', source: 'espn', date: recent(2) },
    // recovery from a stored injury: sent
    { externalId: 'g', playerName: 'Golf', team: 'DAL', status: 'Active', source: 'espn', date: recent(2) },
    // older than the 2-hour window: skipped
    { externalId: 'h', playerName: 'Hotel', team: 'DAL', status: 'Out', source: 'espn', date: new Date(NOW.getTime() - 3 * 3600_000) },
    // no team on the row or the identity: can never send
    { externalId: 'i', playerName: 'India', team: null, status: 'Out', source: 'espn', date: recent(4) },
    // identity unresolved / ambiguous
    { externalId: 'j', playerName: 'Juliet', team: 'NYJ', status: 'Out', source: 'espn', date: recent(4) },
    // identity lookup throws
    { externalId: 'k', playerName: 'Kilo', team: 'NYJ', status: 'Out', source: 'espn', date: recent(4) },
    // no status
    { externalId: 'l', playerName: 'Lima', team: 'NYJ', status: null, source: 'espn', date: recent(4) },
    // a batch whose dispatch fails
    { externalId: 'm', playerName: 'Mike', team: 'FAIL', status: 'Out', source: 'espn', date: recent(1) },
  ]
}

function seedStore() {
  h.store.clear()
  h.store.set('injury-observation:v1:NFL:Charlie:rolling_insights', { status: 'questionable' })
  h.store.set('injury-observation:v1:NFL:Echo:espn', { status: 'out' })
  h.store.set('injury-observation:v1:NFL:Golf:espn', { status: 'out' })
}

function setupMocks() {
  h.identity.mockImplementation(async ({ playerName }: { playerName: string }) => {
    if (playerName === 'Juliet') return { status: 'held', reason: 'ambiguous-identity' }
    if (playerName === 'Kilo') throw new Error('identity lookup failed')
    return {
      status: 'resolved',
      identity: { identityId: playerName, sport: 'NFL', sleeperId: playerName.toLowerCase(), currentTeam: playerName === 'India' ? null : undefined },
    }
  })
  h.recipients.mockImplementation(async (identity: { identityId: string }) => {
    h.ops.recipients.push(identity.identityId)
    return { byUser: new Map([['u1', ['L1']], ['u2', ['L2', 'L3']]]), degraded: false }
  })
  h.native.mockImplementation(async ({ where }: { where: { playerId: { in: string[] }; roster: { ownerId: string } } }) =>
    // u1 starts everyone; u2 starts nobody
    where.roster.ownerId === 'u1' ? [{ roster: { leagueId: 'L1' } }] : [])
  h.dispatch.mockImplementation(async (args: { meta: { team: string } }) =>
    args.meta.team === 'FAIL' ? { delivered: 0, failed: 1 } : { delivered: 1, failed: 0 })
}

type RunOutcome = {
  results: unknown[]
  dispatches: unknown[]
  store: Array<[string, unknown]>
  recipients: string[]
  obsFindUnique: number
  obsFindMany: number
  selects: unknown[]
}

/** Two consecutive runs on the same store, so state carried between runs is compared too. */
async function runScenario(mode: 'optimized' | 'legacy', mutate?: () => void): Promise<RunOutcome> {
  if (mode === 'legacy') process.env.AF_READ_OPTIMIZATIONS_OFF = 'injury-alerts'
  else delete process.env.AF_READ_OPTIMIZATIONS_OFF
  vi.clearAllMocks()
  h.ops.obsFindUnique = 0; h.ops.obsFindMany = 0; h.ops.injuryArgs = []; h.ops.recipients = []
  seedStore()
  setupMocks()
  mutate?.()
  h.setRows(fixture())
  const results = [await notifySyncedInjuries('NFL', NOW), await notifySyncedInjuries('NFL', new Date(NOW.getTime() + 120_000))]
  return {
    results,
    dispatches: h.dispatch.mock.calls.map((c) => c[0]),
    store: [...h.store.entries()].sort(([a], [b]) => a.localeCompare(b)),
    recipients: h.ops.recipients,
    obsFindUnique: h.ops.obsFindUnique,
    obsFindMany: h.ops.obsFindMany,
    selects: h.ops.injuryArgs.map((a) => (a as { select?: unknown }).select ?? null),
  }
}

const silence = vi.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => { h.setFailBatchRead(false) })
afterEach(() => { delete process.env.AF_READ_OPTIMIZATIONS_OFF })

describe('injury alerts: read optimisations are output-equivalent', () => {
  it('sends the same alerts, writes the same state and returns the same result over two runs', async () => {
    const legacy = await runScenario('legacy')
    const optimized = await runScenario('optimized')
    expect(legacy.dispatches.length).toBeGreaterThan(0)
    expect(optimized.dispatches).toEqual(legacy.dispatches)
    expect(optimized.store).toEqual(legacy.store)
    expect(optimized.results).toEqual(legacy.results)
    // The failed batch (two recipients) is still retried on the second run, in both modes.
    expect(legacy.dispatches.filter((d) => (d as { meta: { team: string } }).meta.team === 'FAIL')).toHaveLength(4)
    expect(silence).toHaveBeenCalled()
  })

  it('reads previous observations in one batch per run instead of one read per player', async () => {
    const legacy = await runScenario('legacy')
    const optimized = await runScenario('optimized')
    expect(legacy.obsFindMany).toBe(0)
    expect(legacy.obsFindUnique).toBeGreaterThanOrEqual(18) // 9 first-seen players × 2 runs
    expect(optimized.obsFindUnique).toBe(0)
    expect(optimized.obsFindMany).toBe(2) // one per run
  })

  it('does not read the raw provider JSON, and reads only columns the alert uses', async () => {
    const legacy = await runScenario('legacy')
    const optimized = await runScenario('optimized')
    expect(legacy.selects).toEqual([null, null])
    for (const select of optimized.selects) {
      expect(select).toEqual({ externalId: true, playerName: true, team: true, status: true, date: true, source: true })
    }
  })

  it('skips the recipient lookup for a row with no team, which could never send', async () => {
    const legacy = await runScenario('legacy')
    const optimized = await runScenario('optimized')
    expect(legacy.recipients).toContain('India')
    expect(optimized.recipients).not.toContain('India')
    expect(optimized.recipients).toEqual(legacy.recipients.filter((id) => id !== 'India'))
    for (const d of optimized.dispatches) expect(JSON.stringify(d)).not.toContain('India')
  })

  it('falls back to per-row reads when the batched read fails, with the same outcome', async () => {
    const legacy = await runScenario('legacy')
    const optimized = await runScenario('optimized', () => h.setFailBatchRead(true))
    expect(optimized.obsFindMany).toBe(2)
    expect(optimized.obsFindUnique).toBe(legacy.obsFindUnique)
    expect(optimized.dispatches).toEqual(legacy.dispatches)
    expect(optimized.store).toEqual(legacy.store)
    expect(optimized.results).toEqual(legacy.results)
  })

  it('a degraded lookup for a team-less row no longer counts as a run error (the one intended difference)', async () => {
    const degradeIndia = () => h.recipients.mockImplementation(async (identity: { identityId: string }) => {
      h.ops.recipients.push(identity.identityId)
      return { byUser: new Map([['u1', ['L1']]]), degraded: identity.identityId === 'India' }
    })
    const legacy = await runScenario('legacy', degradeIndia)
    const optimized = await runScenario('optimized', degradeIndia)
    // Identical sends: India can never send in either mode.
    expect(optimized.dispatches).toEqual(legacy.dispatches)
    // Legacy counted India's degraded lookup as an error on top of the failed batch.
    const errs = (o: RunOutcome) => o.results.map((r) => (r as { errors: number }).errors)
    expect(errs(legacy).every((n, i) => n === errs(optimized)[i]! + 1)).toBe(true)
  })
})

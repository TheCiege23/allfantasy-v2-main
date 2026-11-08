/**
 * Dynasty league simulation — create form → join → startup draft → finalized season, through the real code,
 * for every sport × size × draft type in the matrix. The harness is ./dynastyHarness.ts; this file owns the
 * mocks (vitest hoists vi.mock only from the test file) and writes a JSON report.
 *
 * OPT-IN: it runs only with SIM_DYNASTY=1, so a plain `npm test` stays fast. A run takes minutes.
 *
 *   SIM_DYNASTY=1 node node_modules/vitest/vitest.mjs run __tests__/dynasty-sim/dynasty-sim.test.ts
 *
 *   SIM_MATRIX=smoke  (default) one NFL 12-team league per draft type
 *   SIM_MATRIX=full   NFL/NBA/NHL/MLB × 4/8/12/16 teams × every draft type
 *   SIM_OUT=<path>    where the JSON report goes (default: dynasty-sim-report.json in the OS temp dir)
 *   SIM_SEASON=1      also play the season, playoffs and offseason (./dynastySeason.ts)
 *
 * No network: every fetch throws and is recorded. No notifications, no Meta CAPI conversions.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

const holder = vi.hoisted(() => ({ db: null as any, session: null as any }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return holder.db
  },
  get default() {
    return holder.db
  },
}))
vi.mock('next-auth', async (load) => ({ ...(await load<typeof import('next-auth')>()), getServerSession: async () => holder.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
// The real roster services, loaded by import() instead of the registry's CJS require (see rosterRegistryEsm.ts).
vi.mock('@/lib/roster-engine/RosterEngineRegistry', async () => (await import('./rosterRegistryEsm')).buildEsmRosterRegistryModule())
// Meta CAPI conversions are NOT reversible — never let a simulated signup reach them.
vi.mock('@/lib/meta-capi', () => ({ trackMetaServerEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/meta-client', () => ({ trackMetaEventsFromResponse: vi.fn(() => undefined) }))
// Locks serialize concurrent requests; the simulation is single-threaded, so they pass straight through.
vi.mock('@/lib/draft/draftLock', async (load) => {
  const real = await load<typeof import('@/lib/draft/draftLock')>()
  const pass = async (_leagueId: string, fn: () => Promise<unknown>) => ({ acquired: true, value: await fn(), backend: 'passthrough' })
  return { ...real, withPickLock: pass, withAuctionLock: pass }
})
// Every notification export becomes a no-op (the module grows new senders; a partial mock rots).
vi.mock('@/lib/draft-notifications', async (load) =>
  Object.fromEntries(Object.keys(await load<Record<string, unknown>>()).map((key) => [key, vi.fn(async () => undefined)])),
)
vi.mock('@/lib/draft-room/postDraftPickChatEvent', () => ({ postDraftPickChatEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/achievement-system', () => ({ awardAchievement: vi.fn(async () => undefined) }))
// The integrity monitor is an AF Commissioner feature; the simulated league holds it so the scan runs.
vi.mock('@/lib/integrity/leagueEntitlement', async (load) => ({
  ...(await load<typeof import('@/lib/integrity/leagueEntitlement')>()),
  checkLeagueCommissionerEntitlement: vi.fn(async () => true),
}))
// The simulated commissioner holds AF Commissioner for the automatic rookie order (see dynastySeason.ts).
vi.mock('@/lib/rookie-order/liveRookieOrderService', async (load) => ({
  ...(await load<typeof import('@/lib/rookie-order/liveRookieOrderService')>()),
  isLeagueEntitledToLiveRookieOrder: vi.fn(async () => true),
}))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn(), recordProductEvent: vi.fn() }))
vi.mock('@/lib/events', async (load) => ({
  ...(await load<typeof import('@/lib/events')>()),
  // Any event method (emit, emitInTx, …) is a no-op: the bus grows methods and a fixed stub rots.
  getPlatformEvents: () => new Proxy({}, { get: () => vi.fn(async () => ({ eventId: `sim-event-${Math.random().toString(36).slice(2, 10)}`, ok: true })) }),
}))

import type { DynastySport, LeagueRun, SimEnv, StartupDraftKind } from './dynastyHarness'

/*
 * The app and the harness load lazily, in the first hook: a test file's top-level imports run even when
 * every test is skipped, and these pull in most of the app (~27s) for nothing in a plain `npm test`.
 */
let sim: Awaited<ReturnType<typeof loadSim>>
const loadSim = async () => {
  const [{ createInMemoryPrisma }, { postCreateLeague }, harness, { runDynastySeason }] = await Promise.all([
    import('../redraft-season-simulation/inMemoryPrisma'),
    import('@/lib/league-creation/canonical/createLeagueHandler'),
    import('./dynastyHarness'),
    import('./dynastySeason'),
  ])
  return { createInMemoryPrisma, postCreateLeague, runDynastySeason, ...harness }
}

const KINDS: StartupDraftKind[] = ['snake', 'snake_3rr', 'linear', 'auction', 'auto', 'offline']
const SPORTS: DynastySport[] = ['NFL', 'NBA', 'NHL', 'MLB']
const FOOTBALL_LIKE = new Set(['NFL'])

type Case = { sport: DynastySport; teamCount: number; draft: StartupDraftKind }
function matrix(): Case[] {
  const mode = process.env.SIM_MATRIX ?? 'smoke'
  if (mode === 'full') {
    return SPORTS.flatMap((sport) =>
      [4, 8, 12, 16].flatMap((teamCount) => KINDS.filter((k) => k !== 'snake_3rr' || FOOTBALL_LIKE.has(sport)).map((draft) => ({ sport, teamCount, draft }))),
    )
  }
  if (mode.startsWith('only:')) {
    const [sport, teams, draft] = mode.slice(5).split(',')
    return [{ sport: sport as DynastySport, teamCount: Number(teams), draft: draft as StartupDraftKind }]
  }
  return KINDS.map((draft) => ({ sport: 'NFL', teamCount: 12, draft }))
}

const results: Array<LeagueRun & { network: unknown[]; logged: unknown[]; ms: number }> = []
let network: unknown[] = []
let logged: unknown[] = []
const realFetch = globalThis.fetch

beforeEach(async () => {
  sim ??= await loadSim()
  holder.db = sim.createInMemoryPrisma()
  // Every test's in-memory ids restart, so each league is league_000001. The roster-template memo is
  // keyed by league id and would hand the previous test's sport to this one — bust it, as its doc says.
  const { clearEffectiveLeagueRosterTemplateCache } = await import('@/lib/league/getEffectiveLeagueRosterTemplate')
  for (let i = 1; i <= 5; i += 1) clearEffectiveLeagueRosterTemplateCache(`league_${String(i).padStart(6, '0')}`)
  holder.session = null
  network = []
  logged = []
  for (const level of ['warn', 'error'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      // Errors nested inside objects serialize as {} — expand them, they decide real bug vs harness gap.
      const expand = (_k: string, v: unknown) =>
        v instanceof Error ? { name: v.name, message: v.message, stack: String(v.stack).split(String.fromCharCode(10)).slice(1, 6).map((l) => l.trim()) } : v
      logged.push({ level, msg: args.map((a) => (a instanceof Error ? JSON.stringify(expand('', a)) : typeof a === 'string' ? a : JSON.stringify(a, expand)?.slice(0, 1500))).join(' ').slice(0, 2000) })
    })
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    if (path === '/api/leagues' && init?.method === 'POST') return sim.postCreateLeague(new Request('http://sim.allfantasy.test/api/leagues', init))
    network.push({ host: url.replace(/^https?:\/\//, '').split('/')[0] })
    throw new Error(`dynasty sim: unexpected network call to ${url}`)
  }) as typeof fetch
}, 120_000) // the first run loads the app (sim ??= …), which takes far longer than the 10s hook default
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})
afterAll(() => {
  if (results.length === 0) return
  const out = process.env.SIM_OUT || nodePath.join(os.tmpdir(), 'dynasty-sim-report.json')
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), cases: results.length, results }, null, 2))
})

describe.skipIf(process.env.SIM_DYNASTY !== '1')('dynasty simulation: create → join → startup draft → season', () => {
  for (const c of matrix()) {
    it(`${c.sport} ${c.teamCount} teams, ${c.draft} draft`, { timeout: 1_800_000 }, async () => {
      const started = Date.now()
      const env: SimEnv = { db: holder.db, signIn: (user) => (holder.session = user ? { user } : null) }
      const run = await sim.createDynastyLeague(env, c)
      await sim.joinManagers(env, run)
      const pool = await sim.seedPlayerPool(env, run)
      await sim.runStartupDraft(env, run, pool)
      if (process.env.SIM_SEASON === '1') await sim.runDynastySeason(env, run)
      results.push({ ...run, network: [...network], logged: [...logged], ms: Date.now() - started })
      // The report is the deliverable; the assertion is only that the run itself did not crash.
      expect(run.leagueId === null || typeof run.leagueId === 'string').toBe(true)
    })
  }
})

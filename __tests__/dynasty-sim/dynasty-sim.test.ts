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
 *   SIM_MATRIX=audit  all seven sports at four teams, plus the 150-team NFL scale case
 *   SIM_MATRIX=scale  150-team NFL startup through pick 151, plus rookie pick grading
 *   SIM_AUDIT_VALUES=1  seed stored NBA, NHL and MLB dynasty values
 *   SIM_OUT=<path>    where the JSON report goes (default: dynasty-sim-report.json in the OS temp dir)
 *   SIM_SEASON=1      also play the season, playoffs and offseason (./dynastySeason.ts)
 *
 * No network: every fetch throws and is recorded. No notifications, no Meta CAPI conversions.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'
import { withTradeAuditTable } from './tradeAuditTable'

const holder = vi.hoisted(() => ({ db: null as any, session: null as any, scans: [] as Promise<void>[] }))
vi.mock('@/lib/integrity/enqueueCollusionScan', async (load) => {
  const { enqueueCollusionScan } = await load<typeof import('@/lib/integrity/enqueueCollusionScan')>()
  return {
    enqueueCollusionScan: (...args: Parameters<typeof enqueueCollusionScan>) => {
      const scan = enqueueCollusionScan(...args)
      holder.scans.push(scan)
      return scan
    },
  }
})
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
// With the scenarios on, the commissioner is a paying AF Commissioner: premium commissioner screens are open.
vi.mock('@/lib/subscription/FeatureGateService', async (load) => {
  const real = await load<typeof import('@/lib/subscription/FeatureGateService')>()
  class SimFeatureGateService extends (real.FeatureGateService as any) {
    async evaluateUserFeatureAccess(...args: unknown[]) {
        if (process.env.SIM_SCENARIOS === '1') return { allowed: true, reason: 'simulation: AF Commissioner' }
      return (super.evaluateUserFeatureAccess as any)(...args)
    }
  }
  return { ...real, FeatureGateService: SimFeatureGateService }
})
vi.mock('@/lib/subscription/EntitlementResolver', async (load) => {
  const real = await load<typeof import('@/lib/subscription/EntitlementResolver')>()
  class SimEntitlementResolver extends (real.EntitlementResolver as any) {
    async resolveForUser(...args: unknown[]) {
        if (process.env.SIM_SCENARIOS === '1') return { hasAccess: true, message: 'simulation: AF Commissioner' }
      return (super.resolveForUser as any)(...args)
    }
  }
  return { ...real, EntitlementResolver: SimEntitlementResolver }
})
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
  const [{ createInMemoryPrisma, rowsOf }, { postCreateLeague }, harness, { runDynastySeason }] = await Promise.all([
    import('../redraft-season-simulation/inMemoryPrisma'),
    import('@/lib/league-creation/canonical/createLeagueHandler'),
    import('./dynastyHarness'),
    import('./dynastySeason'),
  ])
  return { createInMemoryPrisma, rowsOf, postCreateLeague, runDynastySeason, ...harness }
}

const KINDS: StartupDraftKind[] = ['snake', 'snake_3rr', 'linear', 'auction', 'auto', 'offline']
const SPORTS: DynastySport[] = ['NFL', 'NBA', 'NHL', 'MLB']
const FOOTBALL_LIKE = new Set(['NFL'])

type Case = { sport: DynastySport; teamCount: number; draft: StartupDraftKind }
function matrix(): Case[] {
  const mode = process.env.SIM_MATRIX ?? 'smoke'
  if (mode === 'audit') {
    const auditSports: DynastySport[] = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER']
    return [...auditSports.map((sport): Case => ({ sport, teamCount: 4, draft: 'snake' })),
      { sport: 'NFL', teamCount: 150, draft: 'snake' }]
  }
  if (mode === 'scale') return [{ sport: 'NFL', teamCount: 150, draft: 'snake' }]
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
  holder.db = withTradeAuditTable(sim.createInMemoryPrisma())
  holder.scans = []
  const { resetTradeValueAuditsReadyCache } = await import('@/lib/integrity/tradeValueAudit')
  resetTradeValueAuditsReadyCache()
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
    /*
     * FantasyCalc's chart for the seeded NFL pool, valued in the pool's own rank order (`sim-nfl-rb-3` is
     * the third RB), keyed by the pool ids as Sleeper ids — the id space a native NFL league stores. Without
     * it every trade is ungraded and the collusion scan has nothing to measure. SIM_FC=off: unreachable.
     */
    if (/api\.fantasycalc\.com/.test(url) && process.env.SIM_FC !== 'off') {
      const chart = (sim.rowsOf(holder.db, 'SportsPlayer') as any[])
        .filter((p) => p.sport === 'NFL' && /^sim-nfl-/.test(String(p.id)))
        .map((p, i) => {
          const rank = Number(/-(\d+)$/.exec(String(p.id))?.[1] ?? 99)
          const value = Math.max(100, 9000 - (rank - 1) * 320)
          return {
            player: { id: i + 1, name: p.name, mflId: '', sleeperId: String(p.id), position: p.position, maybeBirthday: null, maybeHeight: null, maybeWeight: null, maybeCollege: null, maybeTeam: p.team, maybeAge: 26, maybeYoe: 4, espnId: null, fleaflickerId: null },
            value, overallRank: i + 1, positionRank: rank, trend30Day: 0, redraftDynastyValueDifference: 0, redraftDynastyValuePercDifference: 0, redraftValue: value, combinedValue: value,
            maybeMovingStandardDeviation: null, maybeMovingStandardDeviationPerc: null, maybeMovingStandardDeviationAdjusted: null, displayTrend: false, maybeOwner: null, starter: rank <= 24, maybeTier: null, maybeAdp: null,
          }
        })
      if (chart.length && process.env.SIM_AUDIT_VALUES === '1' && url.includes('isDynasty=true')) {
        const league = sim.rowsOf(holder.db, 'League')[0] as { season?: number } | undefined
        const year = (league?.season ?? new Date().getFullYear()) + 1
        for (const [index, value] of [4000, 1585].entries()) {
          chart.push({
            ...chart[0]!,
            player: { ...chart[0]!.player, id: -index - 1, name: `${year} Round ${index + 1}`, position: 'PICK', sleeperId: '' },
            value,
          })
        }
      }
      network.push({ host: `api.fantasycalc.com (served sim chart: ${chart.length})` })
      return new Response(JSON.stringify(chart), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    network.push({ host: url.replace(/^https?:\/\//, '').split('/')[0] })
    throw new Error(`dynasty sim: unexpected network call to ${url}`)
  }) as typeof fetch
}, 300_000) // the first run imports most of the app before the league case starts
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})
afterAll(() => {
  if (results.length === 0) return
  const out = process.env.SIM_OUT || nodePath.join(os.tmpdir(), 'dynasty-sim-report.json')
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), cases: results.length, results }, null, 2))
})

async function gradeScaleRookiePicks(env: SimEnv, run: LeagueRun) {
  const { marketContextFor } = await import('@/lib/trade-intel/marketContext')
  const { fantasyCalcSettingsForChart } = await import('@/lib/fantasycalc-profile-capture')
  const { writeFantasyCalcValuesToDb } = await import('@/lib/fantasycalc-db')
  const { createLeagueTradeGrader } = await import('@/lib/decision-os/trade/leagueTradeGrader')
  const { draftPickGradeAsset } = await import('@/lib/live-draft-engine/draftPickTradeGrade')
  const league = await env.db.league.findUnique({ where: { id: run.leagueId! } })
  if (!league) throw new Error('The scale league did not reach rookie pick grading.')
  const market = marketContextFor(league.settings, league.leagueType, run.teamCount)
  const profile = fantasyCalcSettingsForChart({
    chartIsDynasty: true, isSuperFlex: market.variant.superflex, leagueSize: run.teamCount,
    pprNfl: market.scoring.format === 'ppr' ? 1 : market.scoring.format === 'half_ppr' ? 0.5 : 0,
  })
  const season = Number(league.season) + 1
  const rows = [4000, 1585].map((value, index) => ({
    player: { name: `${season} Round ${index + 1}`, position: 'PICK' }, value,
  }))
  await writeFantasyCalcValuesToDb(profile, rows as Parameters<typeof writeFantasyCalcValuesToDb>[1])
  const grader = await createLeagueTradeGrader({ leagueId: run.leagueId! })
  if (!grader) throw new Error('The scale league could not load the trade grader.')
  const give = draftPickGradeAsset({ season, round: 1, overall: 150, slot: 150, teamCount: run.teamCount })
  const get = draftPickGradeAsset({ season, round: 2, overall: 151, slot: 150, teamCount: run.teamCount })
  run.stats.rookiePickGrade = await grader.grade({ give: [give], get: [get], viewerSide: false })
}

describe.skipIf(process.env.SIM_DYNASTY !== '1')('dynasty simulation: create → join → startup draft → season', () => {
  for (const c of matrix()) {
    it(`${c.sport} ${c.teamCount} teams, ${c.draft} draft`, { timeout: 1_800_000 }, async () => {
      const started = Date.now()
      const env: SimEnv = {
        db: holder.db,
        signIn: (user) => (holder.session = user ? { user } : null),
        async finishTradeScans() {
          await Promise.all(holder.scans.splice(0))
        },
      }
      const run = await sim.createDynastyLeague(env, { ...c, leagueType: process.env.SIM_LEAGUE_TYPE === 'redraft' || process.env.SIM_LEAGUE_TYPE === 'keeper' ? process.env.SIM_LEAGUE_TYPE : 'dynasty' })
      const scale = c.teamCount === 150 && ['audit', 'scale'].includes(process.env.SIM_MATRIX ?? '')
      try {
        await sim.joinManagers(env, run)
        if (process.env.SIM_SCENARIOS === '1') await (await import('./dynastyScenarios')).preDraftSettings(env, run)
        const pool = await sim.seedPlayerPool(env, run)
        await sim.checkDraftRoomNames(env, run)
        await sim.runStartupDraft(env, run, pool, scale ? 151 : undefined)
        if (scale) {
          await gradeScaleRookiePicks(env, run)
        } else {
          // The integrity scenarios need graded trades in every sport, not only the value audit.
          if (process.env.SIM_AUDIT_VALUES === '1' || process.env.SIM_SCENARIOS === '1') await sim.seedDynastyTradeValues(env, run, pool)
          if (process.env.SIM_SEASON === '1') await sim.runDynastySeason(env, run)
        }
      } catch (error) {
        run.findings.push({ code: 'AUDIT_CASE_THREW', stage: 'season', message: (error as Error).message })
      }
      results.push({ ...run, network: [...network], logged: [...logged], ms: Date.now() - started })
      if (process.env.SIM_AUDIT_VALUES === '1' && process.env.SIM_SEASON === '1' && ['NBA', 'NHL', 'MLB'].includes(c.sport)) {
        const grades = run.stats.tradeGrades as Array<{ label: string; grade: string | null }> | undefined
        expect(grades?.find((row) => row.label === 'future-pick')?.grade, JSON.stringify(grades)).toMatch(/^[A-F]$/)
      }
      if (scale) {
        expect(run.findings, JSON.stringify(run.findings)).toEqual([])
        expect(run.managerIds).toHaveLength(149)
        expect(run.stats.startupSlots).toBe(150)
        expect(run.stats.picksMade).toBe(151)
        expect(network.filter((call) => JSON.stringify(call).includes('fantasycalc.com'))).toEqual([])
        const grade = run.stats.rookiePickGrade as Awaited<ReturnType<
          import('@/lib/decision-os/trade/leagueTradeGrader').LeagueTradeGrader['grade']
        >>
        expect(grade.graded, JSON.stringify(grade)).toBe(true)
        if (grade.graded) {
          expect(grade.giveValue).toBeGreaterThan(grade.getValue)
          expect(grade.getValue).toBeGreaterThan(0)
        }
      } else if (process.env.SIM_MATRIX === 'audit') {
        expect(run.leagueId, JSON.stringify(run.findings)).toBeTruthy()
        expect(run.findings.some((finding) => finding.code === 'AUDIT_CASE_THREW'), JSON.stringify(run.findings)).toBe(false)
      } else {
        expect(run.leagueId === null || typeof run.leagueId === 'string').toBe(true)
      }

      // Year-2 carryover is a dynasty rule: a redraft or keeper league starts year 2 from empty rosters.
      if (process.env.SIM_SEASON === '1' && run.leagueType === 'dynasty' && c.teamCount === 4 && c.draft === 'snake' && (c.sport === 'NHL' || c.sport === 'MLB')) {
        const findings = JSON.stringify(run.findings)
        expect(run.stats.seasonClose, findings).toMatchObject({ ok: true, champion: expect.any(String) })
        expect(run.stats.lastScoredPlayoffWeeks).toEqual([expect.any(Number), expect.any(Number)])
        expect(run.stats.history).toEqual({ leagueSeasons: 1, franchiseSeasons: 4, seasonResults: 4 })
        expect(run.stats.nextSeasons).toEqual([{ season: expect.any(Number), status: 'setup' }])
        expect(run.stats.carryover).toEqual({ owners: 4, lost: 0, gained: 0 })
      }
    })
  }
})

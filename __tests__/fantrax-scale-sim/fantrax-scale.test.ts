/**
 * Fantrax-scale imported leagues — import → join/claim → trades → evaluator → collusion scan → rank →
 * Chimmy tools, through the real code, for NFL/NBA/NHL/MLB at 32, 128 and 256 teams. The harness is
 * ./fantraxScaleHarness.ts; this file owns the mocks (vitest hoists vi.mock only from the test file).
 *
 * OPT-IN: it runs only with SIM_FANTRAX=1, so a plain `npm test` stays fast. 256 teams × 4 sports ≈ 6 min.
 *
 *   SIM_FANTRAX=1 node node_modules/vitest/vitest.mjs run __tests__/fantrax-scale-sim/fantrax-scale.test.ts
 *
 *   SIM_FX_MATRIX=smoke (default) NBA 32
 *   SIM_FX_MATRIX=size:128          every sport at one size
 *   SIM_FX_MATRIX=full  NFL/NBA/NHL/MLB × 32/128/256
 *   SIM_FX_MATRIX=audit  all seven sports at 8 teams
 *   SIM_AUDIT_VALUES=1  seed NHL, MLB, NCAAF and NCAAB stored values in the audit matrix
 *   SIM_FX_MATRIX=only:NHL,128
 *   SIM_OUT=<path>      where the JSON report goes (default: fantrax-scale-report.json in the OS temp dir)
 *   SIM_FC=empty|sim|sim-raw  FantasyCalc answers empty / with a chart of the fabricated NFL players named
 *                       "First Last" / the same chart in Fantrax's "Last, First" order (a control).
 *                       Unset, FantasyCalc is unreachable like every other host.
 *   SIM_SEED_VALUES=0   skip seeding identity rows and trade values
 *   SIM_SEED_SOCCER_LINKS=0   seed Soccer match values but omit Fantrax IDs from the registry
 *
 * No network: Fantrax's HTTP functions are fabricated; every other fetch throws and is recorded.
 * No notifications, no Meta CAPI conversions, no model calls.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import nodePath from 'node:path'

const holder = vi.hoisted(() => ({ db: null as any, session: null as any, fx: null as any }))
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
vi.mock('@/lib/roster-engine/RosterEngineRegistry', async () => (await import('../dynasty-sim/rosterRegistryEsm')).buildEsmRosterRegistryModule())
// Meta CAPI conversions are NOT reversible.
vi.mock('@/lib/meta-capi', () => ({ trackMetaServerEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/meta-client', () => ({ trackMetaEventsFromResponse: vi.fn(() => undefined) }))
vi.mock('@/lib/draft-notifications', async (load) =>
  Object.fromEntries(Object.keys(await load<Record<string, unknown>>()).map((key) => [key, vi.fn(async () => undefined)])),
)
vi.mock('@/lib/achievement-system', () => ({ awardAchievement: vi.fn(async () => undefined) }))
vi.mock('@/lib/integrity/leagueEntitlement', async (load) => ({
  ...(await load<typeof import('@/lib/integrity/leagueEntitlement')>()),
  checkLeagueCommissionerEntitlement: vi.fn(async () => true),
}))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordEngineTelemetrySample: vi.fn(), recordProductEvent: vi.fn() }))
vi.mock('@/lib/events', async (load) => ({
  ...(await load<typeof import('@/lib/events')>()),
  getPlatformEvents: () => new Proxy({}, { get: () => vi.fn(async () => ({ eventId: `sim-event-${Math.random().toString(36).slice(2, 10)}`, ok: true })) }),
}))
// Fantrax's HTTP layer, served from the fabricated league for the case being run.
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (load) => {
  const real = await load<typeof import('@/lib/league-import/fantrax/fantraxApi')>()
  const fx = () => holder.fx
  const unrelated = { unrelated: { fantraxId: 'unrelated', name: 'Nobody, A', team: 'X', position: 'X' } }
  return {
    ...real,
    getFantraxLeagueInfo: vi.fn(async () => ({ ok: true, data: fx().info })),
    getFantraxLeagueTeams: vi.fn(async () => ({ ok: true, data: Object.values(fx().info.teamInfo) })),
    getFantraxTeamRosters: vi.fn(async () => ({ ok: true, data: fx().rosters })),
    getFantraxPlayerIds: vi.fn(async (code: string) => ({ ok: true, data: (code === fx().sport || (code === 'CFB' && fx().sport === 'NCAAF')) ? fx().playerMap : unrelated })),
    getFantraxStandings: vi.fn(async () => ({ ok: true, data: fx().standings })),
    fetchFantraxScheduleWithScores: vi.fn(async () => {
      if (fx().sport !== 'SOCCER' && fx().sport !== 'NCAAB') {
        return { rows: [], position: null, periodsRead: 0, periodsFailed: 0, periodScores: [] }
      }
      const info = fx().info
      return {
        rows: real.flattenFantraxSchedule(info).map((row) =>
          row.week === 1 ? { ...row, awayScore: 42.5, homeScore: 0, played: true } : row),
        position: real.resolveFantraxSeasonPosition(info),
        periodsRead: 1,
        periodsFailed: 0,
        periodScores: [],
      }
    }),
    getFantraxDraftResults: vi.fn(async () => ({ ok: false, failure: { kind: 'not_found', message: 'no draft (sim)' } })),
    getFantraxDraftPicks: vi.fn(async () => ({ ok: false, failure: { kind: 'not_found', message: 'no picks (sim)' } })),
    getFantraxLeagues: vi.fn(async () => ({ ok: false, failure: { kind: 'not_found', message: 'no secret (sim)' } })),
    getFantraxMatchupScores: vi.fn(async () => ({ ok: false, failure: { kind: 'not_found', message: 'no scores (sim)' } })),
    getFantraxAdp: vi.fn(async () => ({ ok: false, failure: { kind: 'not_found', message: 'no adp (sim)' } })),
  }
})

import type { ScaleEnv, ScaleRun, ScaleSport } from './fantraxScaleHarness'

/* Loaded lazily, in the first hook: top-level imports run even when every test is skipped (see dynasty-sim). */
let sim: Awaited<ReturnType<typeof loadSim>>
const loadSim = async () => {
  const [{ createInMemoryPrisma }, harness] = await Promise.all([
    import('../redraft-season-simulation/inMemoryPrisma'),
    import('./fantraxScaleHarness'),
  ])
  return { createInMemoryPrisma, ...harness }
}

const SPORTS: ScaleSport[] = ['NFL', 'NBA', 'NHL', 'MLB']
const SIZES = [32, 128, 256]

function cases(): Array<{ sport: ScaleSport; teamCount: number }> {
  const mode = process.env.SIM_FX_MATRIX ?? 'smoke'
  if (mode === 'audit') return (['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const).map((sport) => ({ sport, teamCount: 8 }))
  if (mode === 'full') return SPORTS.flatMap((sport) => SIZES.map((teamCount) => ({ sport, teamCount })))
  if (mode.startsWith('size:')) return SPORTS.map((sport) => ({ sport, teamCount: Number(mode.slice(5)) }))
  if (mode.startsWith('only:')) {
    const [sport, n] = mode.slice(5).split(',')
    return [{ sport: sport as ScaleSport, teamCount: Number(n) }]
  }
  return [{ sport: 'NBA', teamCount: 32 }]
}

const realFetch = globalThis.fetch
const network: Array<{ host: string; at: string }> = []
const report: ScaleRun[] = []
const integrityLog: string[] = []

beforeEach(async () => {
  vi.stubEnv('AI_FEATURES_ENABLED', 'false')
  sim ??= await loadSim()
  holder.db = sim.createInMemoryPrisma()
  holder.session = null
  globalThis.fetch = (async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input)
    let host = url
    try {
      host = new URL(url).host
    } catch {}
    // SIM_FC=empty: FantasyCalc answers with an empty chart instead of being unreachable (an experiment
    // to separate "FantasyCalc is down" from "this sport has no values").
    // SIM_FC=sim: FantasyCalc's chart for the fabricated NFL players, named "First Last" as FantasyCalc
    // names everyone. SIM_FC=sim-raw: the same chart in Fantrax's "Last, First" order — the control.
    if ((process.env.SIM_FC === 'sim' || process.env.SIM_FC === 'sim-raw') && host === 'api.fantasycalc.com') {
      const fx = holder.fx
      const chart = fx && fx.sport === 'NFL'
        ? Object.entries(fx.playerMap as Record<string, { name: string; position: string; team: string }>).map(([id, ref], i) => {
            const rank = fx.valueRank[id] ?? 40
            const value = Math.max(50, 9000 - rank * 240)
            return {
              player: { id: i + 1, name: process.env.SIM_FC === 'sim' ? sim.firstLast(ref.name) : ref.name, mflId: '', sleeperId: `90${String(i + 1).padStart(5, '0')}`, position: ref.position, maybeBirthday: null, maybeHeight: null, maybeWeight: null, maybeCollege: null, maybeTeam: ref.team, maybeAge: 26, maybeYoe: 4, espnId: null, fleaflickerId: null },
              value, overallRank: i + 1, positionRank: i + 1, trend30Day: 0, redraftDynastyValueDifference: 0, redraftDynastyValuePercDifference: 0, redraftValue: value, combinedValue: value,
              maybeMovingStandardDeviation: null, maybeMovingStandardDeviationPerc: null, maybeMovingStandardDeviationAdjusted: null, displayTrend: false, maybeOwner: null, starter: rank < 22, maybeTier: null, maybeAdp: null,
            }
          })
        : []
      network.push({ host: `${host} (served sim chart: ${chart.length})`, at: '' })
      return new Response(JSON.stringify(chart), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (process.env.SIM_FC === 'empty' && host === 'api.fantasycalc.com') {
      network.push({ host: `${host} (served empty)`, at: '' })
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const frames = String(new Error().stack).split('\n').slice(2, 18).map((l) => l.trim().replace(/\(.*?dynwt[\\/]/, '('))
    network.push({ host, at: frames.join(' | ').slice(0, 1800) })
    throw new Error(`network disabled in simulation (${host})`)
  }) as typeof fetch
  for (const m of ['log', 'info', 'warn', 'debug'] as const)
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
      if (/integrity|collusion|repeat-pair/i.test(line)) integrityLog.push(line.slice(0, 400))
    })
}, 120_000) // the first run loads the app (sim ??= …), far longer than the 10s hook default
afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
afterAll(() => {
  if (report.length === 0) return
  const out = process.env.SIM_OUT || nodePath.join(os.tmpdir(), 'fantrax-scale-report.json')
  const hosts: Record<string, number> = {}
  for (const n of network) hosts[n.host] = (hosts[n.host] ?? 0) + 1
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), networkHosts: hosts, networkSamples: network.slice(0, 15), integrityLog: integrityLog.slice(0, 40), results: report }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2))
})

describe.skipIf(process.env.SIM_FANTRAX !== '1')('Fantrax-scale imported leagues', () => {
  for (const c of cases()) {
    it(`${c.sport} ${c.teamCount} teams`, { timeout: 3_600_000 }, async () => {
      const sourceLeagueId = `sim${c.sport.toLowerCase()}${c.teamCount}`
      const env: ScaleEnv = {
        db: holder.db,
        signIn: (user) => {
          holder.session = user ? { user: { id: user.id, email: user.email, name: user.name } } : null
        },
        fx: sim.fabricateFantraxLeague(c.sport, c.teamCount, sourceLeagueId),
      }
      holder.fx = env.fx
      const run: ScaleRun = { sport: c.sport, teamCount: c.teamCount, sourceLeagueId, leagueId: null, commissionerId: sim.COMMISH.id, findings: [], stats: {}, timings: {} }
      report.push(run)
      const step = async (name: string, fn: () => Promise<void>) => {
        try {
          await fn()
        } catch (e) {
          run.findings.push({ code: 'STEP_THREW', stage: name, message: `${(e as Error).message}`, detail: String((e as Error).stack).split('\n').slice(0, 6).join(' | ') })
        }
      }
      if (c.sport === 'SOCCER') await step('seed-identities', () => sim.seedSoccerIdentities(env))
      await step('import', () => sim.importLeague(env, run))
      await step('seed-values', () => sim.seedTradeValues(env, run))
      await step('join', () => sim.joinAndClaim(env, run))
      await step('trades', () => sim.runTrades(env, run))
      await step('rank+chimmy', () => sim.runRankAndChimmy(env, run))
      expect(run.leagueId, JSON.stringify(run.findings).slice(0, 800)).toBeTruthy()
      if (c.sport === 'NCAAB') {
        expect(run.stats.importStatus).toBe(200)
        expect(run.stats.imported).toMatchObject({
          sport: 'NCAAB', rosters: c.teamCount, rosteredPlayers: 14 * c.teamCount,
          seasons: 1, seasonRosters: c.teamCount, seasonPlayers: 14 * c.teamCount, linked: c.teamCount,
        })
        if (c.teamCount >= 2) {
          expect(run.stats.ncaabSeason).toEqual({ status: 'in_season', currentWeek: 2, totalWeeks: 20, playoffStartWeek: 19 })
        }
        if (c.teamCount >= 6 && process.env.SIM_AUDIT_VALUES === '1' && process.env.SIM_SEED_VALUES !== '0') {
          expect(run.stats.tradeGrades).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'fair', grade: 'C' }),
            expect.objectContaining({ label: 'collusion-1', grade: 'F' }),
          ]))
        }
      }
      if (c.sport === 'SOCCER') {
        expect(run.stats.importStatus).toBe(200)
        expect(run.stats.imported).toMatchObject({
          sport: 'SOCCER', rosters: c.teamCount, rosteredPlayers: 11 * c.teamCount,
          seasons: 1, seasonRosters: c.teamCount, seasonPlayers: 11 * c.teamCount, linked: c.teamCount,
        })
        expect(run.stats.seatsHeld).toBe(c.teamCount)
        if (c.teamCount >= 2) {
          expect(run.stats.soccerSeason).toMatchObject({
            currentWeek: 2, totalWeeks: 38, playoffStartWeek: 39, source: 'fantrax',
            matchups: [
              { week: 1, awayScore: 42.5, homeScore: 0, status: 'final' },
              { week: 2, awayScore: null, homeScore: null, status: 'scheduled' },
              { week: 38, awayScore: null, homeScore: null, status: 'scheduled' },
            ],
          })
        }
        if (c.teamCount < 6) return
        const grades = run.stats.tradeGrades as Array<{ label: string; grade: string | null; basis: string | null; withheld: string | null }>
        expect(grades).toHaveLength(5)
        if (process.env.SIM_SEED_VALUES === '0') {
          expect(grades.every((g) => !g.grade && g.withheld?.includes('No soccer match data'))).toBe(true)
        } else if (process.env.SIM_SEED_SOCCER_LINKS === '0') {
          expect(grades.every((g) => !g.grade && g.withheld?.includes('verified Fantrax player ID'))).toBe(true)
        } else {
          expect(grades.find((g) => g.label === 'fair'), JSON.stringify(grades)).toMatchObject({ grade: 'C' })
          expect(grades.find((g) => g.label === 'collusion-1')?.grade).toMatch(/^[DF]$/)
          expect(grades.every((g) => g.grade)).toBe(true)
          expect(grades[0]?.basis).toContain('supported Fantrax Soccer rules')
        }
      }
    })
  }
})

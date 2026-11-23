/**
 * The CFBD quota reserve on the `?intel=1` tick. The main import-players run already stands its devy
 * phases down below the reserve; this tick runs three more CFBD background jobs and asked nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  ingest: vi.fn(),
  refresh: vi.fn(async () => ({ sleeperLeagues: 0, picked: 0, slot: 1, historyFactsWritten: null, ingest: null, errors: [] })),
  intel: vi.fn(async () => ({ feeds: 'inside cadence' })),
  heartbeats: [] as Array<{ jobName: string; outcome: Record<string, unknown> | null; threw: boolean }>,
  remainingMs: null as number | null,
  gate: { allowed: true, remaining: null as number | null, reason: null as string | null },
  teams: vi.fn(async () => ({ skipped: 'weekly cadence' })),
  pool: vi.fn(async () => ({ skipped: 'weekly cadence' })),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/sports-data-importer', () => ({
  runSportsDataImporter: vi.fn(async () => {
    throw new Error('the main run must not be reached by an intel tick')
  }),
}))
vi.mock('@/lib/league-import/sleeper/sleeperTradeFactRotation', () => ({ rotateSleeperTradeFacts: h.refresh }))
vi.mock('@/lib/devy/devyIntelRefresh', () => ({ refreshDevyIntelSources: h.intel }))
vi.mock('@/lib/devy/ingestFantraxDevyAdp', () => ({
  ingestFantraxDevyAdp: vi.fn(async () => ({ priced: 0, withSchool: 0, updated: 0, unmatched: 0, ambiguous: 0, teamEntries: 0 })),
}))
vi.mock('@/lib/devy/devyHeadshotRefresh', () => ({
  refreshDevyHeadshots: vi.fn(async () => ({ refreshed: 0 })),
  refreshCollegeSportsPlayerHeadshots: vi.fn(async () => ({ refreshed: 0 })),
}))
vi.mock('@/lib/espn/ncaabEspnIngest', () => ({
  isNcaabRosterSeason: vi.fn(() => false),
  syncEspnNcaabTeamMapIfDue: vi.fn(),
  syncEspnNcaabRosters: vi.fn(),
}))
vi.mock('@/lib/player-identity/ingestMlbFantraxIdentities', () => ({
  ingestMlbFantraxIdentities: vi.fn(async () => ({ skipped: 'weekly cadence', updated: 0 })),
}))
vi.mock('@/lib/player-identity/ingestNcaafFantraxIdentities', () => ({
  ingestNcaafFantraxIdentities: vi.fn(async () => ({ skipped: 'weekly cadence', updated: 0 })),
}))
vi.mock('@/lib/devy/ingestNcaabDevyPool', () => ({ ingestNcaabDevyPoolIfDue: h.ingest }))

/* Faithful to the real contract: run fn, derive the outcome from its result, record, rethrow. */
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async <T,>(
    ctx: { jobName: string },
    fn: () => Promise<T>,
    extract?: (r: T) => Record<string, unknown>,
  ): Promise<T> => {
    try {
      const result = await fn()
      h.heartbeats.push({ jobName: ctx.jobName, outcome: extract ? extract(result) : {}, threw: false })
      return result
    } catch (err) {
      h.heartbeats.push({ jobName: ctx.jobName, outcome: null, threw: true })
      throw err
    }
  },
}))

vi.mock('@/lib/cron/runBudget', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cron/runBudget')>('@/lib/cron/runBudget')
  return {
    ...actual,
    createRunBudget: (...args: Parameters<typeof actual.createRunBudget>) => {
      const real = actual.createRunBudget(...args)
      if (h.remainingMs == null) return real
      return { ...real, remainingMs: () => h.remainingMs as number, exhausted: () => false }
    },
  }
})

vi.mock('@/lib/cfbd-quota', () => ({ cfbdBackgroundAllowed: vi.fn(async () => h.gate) }))
vi.mock('@/lib/sport-teams/ingestCollegeTeams', () => ({ ingestCollegeTeamsIfDue: h.teams }))
vi.mock('@/lib/ncaaf/cfbdRosterPool', () => ({ refreshCollegeRosterPoolIfDue: h.pool }))

import { GET } from '@/app/api/cron/import-players/route'

const intelTick = () => GET(new NextRequest('http://localhost/api/cron/import-players?intel=1'))

beforeEach(() => {
  h.ingest.mockReset()
  h.ingest.mockResolvedValue({ skipped: 'weekly cadence' })
  h.intel.mockClear()
  h.teams.mockClear()
  h.pool.mockClear()
  h.heartbeats.length = 0
  h.remainingMs = 230_000
  h.gate = { allowed: true, remaining: null, reason: null }
})

afterEach(() => vi.restoreAllMocks())

describe('the ?intel=1 tick keeps the CFBD reserve', () => {
  it('below the reserve, the intel feeds, the team directory and the roster pool all stand down and say why', async () => {
    h.gate = { allowed: false, remaining: 12_000, reason: 'CFBD quota reserve: 12000 calls left this month, at or below the 15000 kept for stats and scores' }
    await intelTick()
    expect(h.intel).not.toHaveBeenCalled()
    expect(h.teams).not.toHaveBeenCalled()
    expect(h.pool).not.toHaveBeenCalled()
    const row = h.heartbeats.find((b) => b.jobName === 'cron-devy-intel-sources')
    expect(row).toBeDefined()
    expect(row!.threw).toBe(false)
  })

  it('above the reserve, all three run as before', async () => {
    await intelTick()
    expect(h.intel).toHaveBeenCalledTimes(1)
    expect(h.teams).toHaveBeenCalledTimes(1)
    expect(h.pool).toHaveBeenCalledTimes(1)
  })
})

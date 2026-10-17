import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The scheduled writer for rivalry_records and drama_events (lib/relationship-insights/
 * relationshipRefreshPass.ts). Pinned: it only runs in the nightly window; it picks leagues whose
 * matchup facts moved since their watermark, never-refreshed first; it runs rivalries BEFORE drama;
 * it watermarks with the facts time read BEFORE the run (never `now`); a league that throws or that
 * the budget cut off is NOT marked, so it is retried.
 */

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  cacheFindMany: vi.fn(),
  cacheUpsert: vi.fn(),
  leagueFindUnique: vi.fn(),
  runRivalryEngine: vi.fn(),
  runLeagueDramaEngine: vi.fn(),
  buildRivalryEngineSignals: vi.fn(),
  recordSyncJobRun: vi.fn(),
  exhausted: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    matchupFact: { groupBy: mocks.groupBy },
    sportsDataCache: { findMany: mocks.cacheFindMany, upsert: mocks.cacheUpsert },
    league: { findUnique: mocks.leagueFindUnique },
  },
}))
vi.mock('@/lib/rivalry-engine/RivalryEngine', () => ({ runRivalryEngine: mocks.runRivalryEngine }))
vi.mock('@/lib/drama-engine/LeagueDramaEngine', () => ({ runLeagueDramaEngine: mocks.runLeagueDramaEngine }))
vi.mock('@/lib/rivalry-engine/rivalryEngineInputs', () => ({ buildRivalryEngineSignals: mocks.buildRivalryEngineSignals }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({ recordSyncJobRun: mocks.recordSyncJobRun }))
vi.mock('@/lib/cron/runBudget', () => ({ createRunBudget: () => ({ exhausted: mocks.exhausted, elapsedMs: () => 0, remainingMs: () => 1 }) }))

import { runRelationshipRefreshPass } from '@/lib/relationship-insights/relationshipRefreshPass'

const NIGHT = new Date('2026-10-02T05:00:00Z')
const DAY = new Date('2026-10-02T15:00:00Z')
const t = (iso: string) => new Date(iso)

function facts(rows: Array<[string, number, string]>) {
  mocks.groupBy.mockResolvedValue(rows.map(([leagueId, season, at]) => ({ leagueId, season, _max: { createdAt: t(at) } })))
}
function watermarks(entries: Record<string, string>) {
  mocks.cacheFindMany.mockResolvedValue(
    Object.entries(entries).map(([id, at]) => ({ cacheKey: `relationship-refresh:v1:${id}`, data: { factsAt: at } })),
  )
}
const LEAGUE = { sport: 'NFL', season: 2026, settings: null, teams: [{ externalId: '1' }, { externalId: '2' }] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.exhausted.mockReturnValue(false)
  mocks.leagueFindUnique.mockResolvedValue(LEAGUE)
  mocks.buildRivalryEngineSignals.mockResolvedValue({ tradeCountByPair: new Map() })
  mocks.runRivalryEngine.mockResolvedValue({ processed: 3, created: 2, updated: 1, rivalryIds: [] })
  mocks.runLeagueDramaEngine.mockResolvedValue({ created: 4, updated: 0, eventIds: [] })
  mocks.recordSyncJobRun.mockResolvedValue(undefined)
  mocks.cacheUpsert.mockResolvedValue({})
  watermarks({})
})

describe('runRelationshipRefreshPass', () => {
  it('does nothing outside 03:00–10:59 UTC, without reading a row', async () => {
    const r = await runRelationshipRefreshPass({ now: DAY, budgetMs: 60_000 })
    expect(r).toEqual({ ran: false, reason: 'outside the nightly window' })
    expect(mocks.groupBy).not.toHaveBeenCalled()
  })

  it('refreshes only leagues whose facts moved past their watermark, never-refreshed first', async () => {
    facts([
      ['fresh', 2026, '2026-10-01T10:00:00Z'], // watermark equal → skip
      ['moved', 2026, '2026-10-01T12:00:00Z'], // watermark older → refresh
      ['never', 2025, '2026-09-01T00:00:00Z'], // no watermark → refresh, and first
    ])
    watermarks({ fresh: '2026-10-01T10:00:00.000Z', moved: '2026-10-01T09:00:00.000Z' })

    const r = await runRelationshipRefreshPass({ now: NIGHT, budgetMs: 60_000 })

    expect(r).toMatchObject({ ran: true, withFacts: 3, stale: 2, visited: 2, refreshed: 2, failed: 0 })
    expect(mocks.runRivalryEngine.mock.calls.map((c) => c[0].leagueId)).toEqual(['never', 'moved'])
  })

  it('runs rivalries BEFORE drama, over every season with facts, and drama on the current season', async () => {
    facts([['lg', 2024, '2026-09-01T00:00:00Z'], ['lg', 2026, '2026-10-01T00:00:00Z'], ['lg', 2025, '2026-09-20T00:00:00Z']])
    const order: string[] = []
    mocks.runRivalryEngine.mockImplementation(async () => (order.push('rivalry'), { processed: 0, created: 0, updated: 0, rivalryIds: [] }))
    mocks.runLeagueDramaEngine.mockImplementation(async () => (order.push('drama'), { created: 0, updated: 0, eventIds: [] }))

    await runRelationshipRefreshPass({ now: NIGHT, budgetMs: 60_000 })

    expect(order).toEqual(['rivalry', 'drama'])
    expect(mocks.runRivalryEngine.mock.calls[0]![0]).toMatchObject({ leagueId: 'lg', sport: 'NFL', seasons: [2024, 2025, 2026] })
    expect(mocks.buildRivalryEngineSignals.mock.calls[0]![0]).toMatchObject({ seasons: [2024, 2025, 2026], teamExternalIds: new Set(['1', '2']) })
    expect(mocks.runLeagueDramaEngine.mock.calls[0]![0]).toMatchObject({ leagueId: 'lg', sport: 'NFL', season: 2026 })
  })

  it('watermarks with the facts time read BEFORE the run, never with now', async () => {
    facts([['lg', 2026, '2026-10-01T07:30:00Z']])
    await runRelationshipRefreshPass({ now: NIGHT, budgetMs: 60_000 })

    const arg = mocks.cacheUpsert.mock.calls[0]![0]
    expect(arg.where).toEqual({ cacheKey: 'relationship-refresh:v1:lg' })
    expect(arg.create.data).toEqual({ factsAt: '2026-10-01T07:30:00.000Z', refreshedAt: NIGHT.toISOString() })
    // Durable: the hourly purge deletes expired sportsDataCache rows, so an ordinary TTL would re-run every league.
    expect(arg.create.expiresAt.getTime() - NIGHT.getTime()).toBeGreaterThan(365 * 24 * 3600 * 1000)
  })

  it('does not mark a league that throws, so it is retried, and reports it', async () => {
    facts([['bad', 2026, '2026-10-01T00:00:00Z'], ['good', 2026, '2026-10-01T00:00:00Z']])
    mocks.runRivalryEngine.mockImplementation(async (input: { leagueId: string }) => {
      if (input.leagueId === 'bad') throw new Error('boom')
      return { processed: 1, created: 1, updated: 0, rivalryIds: [] }
    })

    const r = await runRelationshipRefreshPass({ now: NIGHT, budgetMs: 60_000 })

    expect(r).toMatchObject({ ran: true, visited: 2, refreshed: 1, failed: 1 })
    expect(mocks.cacheUpsert.mock.calls.map((c) => c[0].where.cacheKey)).toEqual(['relationship-refresh:v1:good'])
    expect(mocks.recordSyncJobRun.mock.calls[0]![1]).toMatchObject({ status: 'partial', errors: ['bad: boom'] })
  })

  it('stops when the budget is spent and leaves the rest unmarked', async () => {
    facts([['a', 2026, '2026-10-01T00:00:00Z'], ['b', 2026, '2026-10-01T00:00:00Z']])
    mocks.exhausted.mockReturnValueOnce(false).mockReturnValue(true)

    const r = await runRelationshipRefreshPass({ now: NIGHT, budgetMs: 60_000 })

    expect(r).toMatchObject({ ran: true, stale: 2, visited: 1, stoppedEarly: true })
    expect(mocks.cacheUpsert).toHaveBeenCalledTimes(1)
  })

  it('marks but skips an unsupported or vanished league, so it is not retried every hour', async () => {
    facts([['gone', 2026, '2026-10-01T00:00:00Z']])
    mocks.leagueFindUnique.mockResolvedValue(null)

    const r = await runRelationshipRefreshPass({ now: NIGHT, budgetMs: 60_000 })

    expect(r).toMatchObject({ ran: true, refreshed: 0, skippedUnsupportedSport: 1 })
    expect(mocks.runRivalryEngine).not.toHaveBeenCalled()
    expect(mocks.cacheUpsert).toHaveBeenCalledTimes(1)
  })
})

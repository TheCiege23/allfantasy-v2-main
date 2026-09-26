import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `GET /api/cron/import-schedules?riProfiles=1`, driven end to end with the vendor calls, the
 * budget and the heartbeat mocked.
 *
 * 🛑 WHAT THIS PINS, measured on production 2026-09-26: NCAAF (69,043 players) consumed the whole
 * budget whenever the rotation reached it, the sports behind it were deferred — MLB went a week
 * between refreshes — and every one of those runs was recorded `success`. Now the 03:10 UTC fire is
 * NCAAF alone, the 09:10 fire is the other six, and a run that defers a sport records `partial`.
 */
type SyncCtx = { jobName: string; jobScope?: string }

const h = vi.hoisted(() => ({
  syncRuns: [] as Array<{ ctx: SyncCtx; outcome: Record<string, unknown> | null }>,
  teamsCalls: [] as string[],
  playersCalls: [] as string[],
  /** Sports allowed to start before the budget reads exhausted. */
  sportsBeforeExhausted: Infinity,
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: vi.fn(async (ctx: SyncCtx, fn: () => Promise<unknown>, extract?: (r: unknown) => unknown) => {
    const result = await fn()
    h.syncRuns.push({ ctx, outcome: extract ? (extract(result) as Record<string, unknown>) : null })
    return result
  }),
}))
vi.mock('@/lib/rolling-insights', () => ({ syncNFLScheduleToDb: vi.fn() }))
vi.mock('@/lib/api-sports', () => ({
  syncAPISportsGamesToDb: vi.fn(),
  syncAPISportsGameOddsToDb: vi.fn(),
  clearAPISportsDiagnostics: vi.fn(),
  getAPISportsDiagnostics: vi.fn(() => ({})),
}))
vi.mock('@/lib/sports-data/theSportsDbIngest', () => ({
  LEAGUES: {},
  ingestRosters: vi.fn(),
  ingestSchedule: vi.fn(),
  ingestTeams: vi.fn(),
}))
vi.mock('@/lib/sports-data/rollingInsightsTeamsPlayers', () => ({
  syncRollingInsightsTeamsToDb: vi.fn(async ({ sport }: { sport: string }) => {
    h.teamsCalls.push(sport)
    return { written: 1, withLogo: 0, byLeague: {}, deferredLeagues: [], notModified: false, errors: [] }
  }),
  syncRollingInsightsPlayersToDb: vi.fn(async ({ sport }: { sport: string }) => {
    h.playersCalls.push(sport)
    return { written: 10, withImage: 0, byLeague: {}, deferredLeagues: [], notModified: false, errors: [] }
  }),
}))
vi.mock('@/lib/cron/runBudget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cron/runBudget')>()
  return {
    ...actual,
    // Exhausted once `sportsBeforeExhausted` sports have started their team sweep.
    createRunBudget: () => ({
      exhausted: () => h.teamsCalls.length >= h.sportsBeforeExhausted,
      elapsedMs: () => 0,
      remainingMs: () => 200_000,
    }),
  }
})

async function fireAt(iso: string) {
  vi.setSystemTime(new Date(iso))
  const { GET } = await import('@/app/api/cron/import-schedules/route')
  const res = await GET(new Request('http://localhost/api/cron/import-schedules?riProfiles=1') as never)
  return (await res.json()) as { results: { rolling_insights_profiles: Record<string, unknown> } }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  h.syncRuns.length = 0
  h.teamsCalls.length = 0
  h.playersCalls.length = 0
  h.sportsBeforeExhausted = Infinity
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetModules()
})

describe('import-schedules ?riProfiles=1', () => {
  it('the 03:10 UTC fire sweeps NCAAF alone', async () => {
    await fireAt('2026-09-27T03:10:00Z')
    expect(h.teamsCalls).toEqual(['NCAAF'])
    expect(h.playersCalls).toEqual(['NCAAF'])
    expect(h.syncRuns[0]!.ctx).toMatchObject({ jobName: 'cron-import-schedules-ri-profiles', jobScope: 'NCAAF' })
    expect(h.syncRuns[0]!.outcome).not.toHaveProperty('status') // nothing deferred → inferred success
  })

  it('the 09:10 UTC fire sweeps the other six and never NCAAF', async () => {
    await fireAt('2026-09-27T09:10:00Z')
    expect(h.teamsCalls).toHaveLength(6)
    expect(h.teamsCalls).not.toContain('NCAAF')
    expect(h.syncRuns[0]!.outcome).not.toHaveProperty('status')
  })

  it('a run that defers sports is recorded PARTIAL, naming them — not success', async () => {
    h.sportsBeforeExhausted = 2
    const body = await fireAt('2026-09-27T09:10:00Z')
    expect(h.teamsCalls).toHaveLength(2)
    const outcome = h.syncRuns[0]!.outcome!
    expect(outcome.status).toBe('partial')
    expect((outcome.metadata as { deferredSports: string[] }).deferredSports).toHaveLength(4)
    expect(body.results.rolling_insights_profiles.deferredSports).toHaveLength(4)
  })
})

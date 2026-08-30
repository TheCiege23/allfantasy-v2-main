/**
 * `?week=` must not fan out across sports on /api/cron/compute-projections.
 *
 * WHAT THIS GUARDS
 * Omitting `?sport=` runs the whole sport rotation, and `handle()` hands every sport the SAME
 * `URL` object. `runOneSport` parsed `?week=` off it and, when present, ALSO set
 * `writeWeeklySnapshots: true`. So `?week=3` with no sport stamped week 3 onto NCAAF, NCAAB, NBA,
 * NHL and MLB rows using a number that only ever meant the NFL's week. College weeks do not line
 * up with NFL weeks and the other codes have no football week at all.
 *
 * Not hypothetical: the header on `handle()` records that NCAAF's existing AFProjectionSnapshot
 * rows came from "a manual backfill", which is this path.
 *
 * ⚠ WHAT THIS DOES *NOT* GUARD, recorded so the wrong thing is not "fixed" later. The AUTOMATIC
 * path was never exposed. It was reported that once NFL week 1 starts, the Sleeper season-state
 * gate would flip true for every sport and stamp NFL week numbers onto college rows. It does not:
 * `writeAfProjectionSnapshots` gates that lookup on `sport === 'NFL'`, so `inRegularSeason` stays
 * null for every other sport and `writeWeekly` stays false regardless of the NFL calendar. That
 * was verified against the deployed tree before this guard was written — the hand-run override
 * was the only way to cross sports, which is why the fix lives in the route.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const writeAfProjectionSnapshots = vi.fn()

vi.mock('server-only', () => ({}))

vi.mock('@/lib/af-projections/writeAfProjectionSnapshots', () => ({
  writeAfProjectionSnapshots: (...a: unknown[]) => writeAfProjectionSnapshots(...a),
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))

/* Pass-through: the assertion is about the ARGUMENTS the writer receives, so telemetry must not
 * sit between the route and the mock. */
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))

/* One sport in the rotation keeps the test about week scoping rather than about the budget. */
vi.mock('@/lib/sport-scope', () => ({ SUPPORTED_SPORTS: ['NCAAF'] }))

vi.mock('@/lib/cron/runBudget', () => ({
  createRunBudget: () => ({ exhausted: () => false }),
  rotateForFairness: (xs: string[]) => xs,
}))

import { GET } from '@/app/api/cron/compute-projections/route'

function req(qs: string) {
  return new Request(`https://example.test/api/cron/compute-projections${qs}`) as never
}

/** The single options object the writer was called with. */
function writerArgs(): Record<string, unknown> {
  expect(writeAfProjectionSnapshots).toHaveBeenCalledTimes(1)
  return writeAfProjectionSnapshots.mock.calls[0]![0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  writeAfProjectionSnapshots.mockResolvedValue({
    written: 10,
    refused: 0,
    statLinesRead: 10,
    sourceSeason: 2025,
    targetSeason: 2026,
    scoringFormat: 'ppr',
    idpPreset: 'balanced',
    refusalsByReason: {},
    basisCounts: {},
    confidenceCounts: {},
    errors: [],
  })
})

describe('compute-projections — ?week= scoping', () => {
  it('DROPS a bare ?week= on an unscoped run rather than applying it to every sport', async () => {
    const res = await GET(req('?week=3'))
    const body = await res.json()

    const args = writerArgs()
    expect(args.sport).toBe('NCAAF')
    // The whole point: no NFL week number reaches a college row.
    expect(args.targetWeek).toBeUndefined()
    expect(args.writeWeeklySnapshots).toBeUndefined()

    // And the operator is told, rather than silently receiving a season baseline.
    expect(JSON.stringify(body)).toContain('week=3 ignored')
  })

  it('HONOURS ?week= when the caller scoped it with ?sport=', async () => {
    await GET(req('?sport=NCAAF&week=3'))

    const args = writerArgs()
    expect(args.sport).toBe('NCAAF')
    expect(args.targetWeek).toBe(3)
    expect(args.writeWeeklySnapshots).toBe(true)
  })

  it('still honours a scoped NFL week', async () => {
    await GET(req('?sport=NFL&week=5'))

    const args = writerArgs()
    expect(args.sport).toBe('NFL')
    expect(args.targetWeek).toBe(5)
    expect(args.writeWeeklySnapshots).toBe(true)
  })

  it('leaves an ordinary scheduled run untouched — no week, no weekly write, no note', async () => {
    const res = await GET(req(''))
    const body = await res.json()

    const args = writerArgs()
    expect(args.targetWeek).toBeUndefined()
    expect(args.writeWeeklySnapshots).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('ignored')
  })

  it('ignores an out-of-range week without reporting a phantom drop', async () => {
    // 0 and 19+ never became a targetWeek even before this change, so there is nothing to report.
    const res = await GET(req('?week=99'))
    const body = await res.json()

    expect(writerArgs().targetWeek).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain('ignored')
  })
})

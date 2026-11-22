/**
 * In the NFL season the nightly projection run takes NFL first, so its shared time budget can never
 * run out before NFL (owner's decision, 2026-10-27). Measured before this: NFL wrote nothing on 3 of
 * 14 in-season nights, deferred behind college football. See lib/af-projections/projectionSportOrder.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { projectionSportOrder } from '@/lib/af-projections/projectionSportOrder'

const writeAfProjectionSnapshots = vi.fn()
const budget = vi.hoisted(() => ({ allowed: 1 }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/af-projections/writeAfProjectionSnapshots', () => ({
  writeAfProjectionSnapshots: (...a: unknown[]) => writeAfProjectionSnapshots(...a),
}))
vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock('@/lib/sport-scope', () => ({ SUPPORTED_SPORTS: ['NCAAF', 'NBA', 'NFL'] }))
/* The rotation puts NFL last, and the budget lets exactly one sport run: the shape of Oct 19 and 20. */
vi.mock('@/lib/cron/runBudget', () => ({
  createRunBudget: () => {
    let used = 0
    return { exhausted: () => used++ >= budget.allowed }
  },
  rotateForFairness: (xs: string[]) => xs,
}))

import { GET } from '@/app/api/cron/compute-projections/route'

const sportsWritten = () => writeAfProjectionSnapshots.mock.calls.map((c) => (c[0] as { sport: string }).sport)

beforeEach(() => {
  vi.clearAllMocks()
  budget.allowed = 1
  writeAfProjectionSnapshots.mockResolvedValue({
    written: 10, refused: 0, statLinesRead: 10, sourceSeason: 2026, targetSeason: 2026, scoringFormat: 'ppr',
    idpPreset: 'balanced', refusalsByReason: {}, basisCounts: {}, confidenceCounts: {}, errors: [],
  })
})
afterEach(() => vi.useRealTimers())

describe('projectionSportOrder', () => {
  const rotated = ['NCAAF', 'NBA', 'NFL', 'NHL']

  it('puts NFL first from preseason through the Super Bowl, the rest in their rotation', () => {
    for (const day of ['2026-08-01', '2026-10-19', '2027-01-03', '2027-02-14']) {
      expect(projectionSportOrder(rotated, new Date(`${day}T07:50:00Z`))).toEqual(['NFL', 'NCAAF', 'NBA', 'NHL'])
    }
  })

  it('leaves the rotation alone in the NFL offseason', () => {
    for (const day of ['2026-02-16', '2026-05-01', '2026-07-31']) {
      expect(projectionSportOrder(rotated, new Date(`${day}T07:50:00Z`))).toEqual(rotated)
    }
  })

  it('adds nothing when NFL is not in the list', () => {
    expect(projectionSportOrder(['NBA', 'NHL'], new Date('2026-10-19T07:50:00Z'))).toEqual(['NBA', 'NHL'])
  })
})

describe('the nightly run', () => {
  it('reaches NFL in season even when the budget only covers one sport', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T07:50:00Z') })
    const body = await (await GET(new Request('https://example.test/api/cron/compute-projections') as never)).json()
    expect(sportsWritten()).toEqual(['NFL'])
    expect(body.deferredForBudget).toEqual(['NCAAF', 'NBA'])
  })

  it('keeps the plain rotation out of season', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-05-01T07:50:00Z') })
    await GET(new Request('https://example.test/api/cron/compute-projections') as never)
    expect(sportsWritten()).toEqual(['NCAAF'])
  })
})

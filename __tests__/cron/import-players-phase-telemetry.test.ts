/**
 * The main import run records WHICH phases it dropped.
 *
 * 🛑 WHY THIS EXISTS. `sync_job_runs` is written as soon as the IMPORT finishes — on purpose, so a
 * run killed at the 300s edge still leaves a row — which means it cannot carry a decision the
 * maintenance phases have not made yet. So `deferredPhases` lived only in the response body, and
 * the slow-tier dispatcher echoes the first 1,500 characters of that body and cuts the rest.
 *
 * Measured 2026-09-17 while deciding whether the psych rotation still starves: across 8 days,
 * `sync_job_runs` could not say why 20 of 36 fires profiled nothing, because no phase outcome was
 * persisted anywhere. The rotation now has its own heartbeat; this closes the same gap for the
 * phases that remain in the main run.
 *
 * ⚠ BEHAVIOURAL, NOT A SOURCE GREP. The sibling tests in this repo assert on the route's text,
 * which can see that an update call exists but not what it writes — and what it writes is the
 * whole point. This drives the real route with an exhausted budget, so every phase defers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  updated: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  createThrows: false,
}))

vi.mock('@/app/api/cron/_auth', () => ({ requireCronAuth: () => true }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    syncJobRun: {
      create: vi.fn(async (args: Record<string, unknown>) => {
        h.created.push(args)
        if (h.createThrows) throw new Error('telemetry down')
        return { id: 'run-1' }
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        h.updated.push(args)
        return {}
      }),
    },
  },
}))
vi.mock('@/lib/workers/sports-data-importer', () => ({
  runSportsDataImporter: vi.fn(async () => ({
    imported: 7,
    sports: ['NFL'],
    durationMs: 1234,
    rowsSkippedByGuard: 0,
    teamCodeCounts: {},
    skippedSports: [],
    staleFallbackApplied: false,
    pagedSeeds: [],
    seedCursors: {},
  })),
}))
/* An exhausted budget: every maintenance phase defers, which is the state being recorded. */
vi.mock('@/lib/cron/runBudget', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cron/runBudget')>('@/lib/cron/runBudget')
  return {
    ...actual,
    createRunBudget: () => ({ exhausted: () => true, elapsedMs: () => 240_001, remainingMs: () => 0 }),
  }
})
vi.mock('@/lib/psychological-profiles/ProfileRefreshService', () => ({
  refreshStaleLeagueProfiles: vi.fn(async () => {
    throw new Error('the rotation moved to the intel tick and must not run here')
  }),
}))

async function run() {
  const { GET } = await import('@/app/api/cron/import-players/route')
  const res = await GET(new NextRequest('http://localhost/api/cron/import-players'))
  return { res, body: (await res.json()) as Record<string, unknown> }
}

beforeEach(() => {
  vi.resetModules()
  h.created.length = 0
  h.updated.length = 0
  h.createThrows = false
  process.env.CRON_SECRET = 'test'
})

describe('the import run records the phases it dropped', () => {
  it('writes the row when the import finishes, then updates it with the phase outcome', async () => {
    const { res, body } = await run()

    expect(res.status).toBe(200)
    expect(h.created).toHaveLength(1)
    expect(h.updated).toHaveLength(1)
    expect(h.updated[0].where).toEqual({ id: 'run-1' })

    const metadata = h.updated[0].data.metadata as Record<string, unknown>
    // The fact that was previously unreadable after the fact.
    expect(Array.isArray(metadata.deferredPhases)).toBe(true)
    expect((metadata.deferredPhases as string[]).length).toBeGreaterThan(0)
    expect(metadata.budgetExhausted).toBe(true)
    // One fact in one place: the row and the response body must not disagree.
    expect(metadata.deferredPhases).toEqual(body.deferredPhases)
  })

  it('keeps what the first write recorded, so the update adds rather than replaces', async () => {
    await run()
    const created = (h.created[0].data as { metadata: Record<string, unknown> }).metadata
    const updated = h.updated[0].data.metadata as Record<string, unknown>
    for (const key of Object.keys(created)) {
      expect(updated, `the update dropped ${key}`).toHaveProperty(key)
    }
  })

  it('still answers 200 when the telemetry write itself fails', async () => {
    h.createThrows = true
    const { res } = await run()

    // A failed telemetry write must not fail an import that already succeeded.
    expect(res.status).toBe(200)
    expect(h.updated).toHaveLength(0)
  })
})

/**
 * D.5-scheduler — cron route auth + behavior contract.
 *
 * Verifies:
 *  - Missing/wrong secret → 401 (no recompute is invoked).
 *  - Correct CRON_SECRET → 200 + structured report (recompute called once with
 *    real-mode + apply=true defaults).
 *  - includeTest=true must be explicit (never the cron default).
 *  - dryRun=true flips apply to false (manual ops escape hatch).
 *  - Errors from the recompute service surface as 207 with a structured body
 *    (not a 500 — the report is still useful).
 *  - Service throw → 500 with structured error body.
 *  - No supabase references in any D.5-scheduler file.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the recompute service BEFORE importing the route.
const mockRecompute = vi.fn()
vi.mock('@/lib/adp/recomputeAllFantasyAdp', () => ({
  recomputeAllFantasyAdp: (...args: unknown[]) => mockRecompute(...args),
}))

import { GET, POST } from '@/app/api/cron/recompute-allfantasy-adp/route'

const root = resolve(__dirname, '..', '..')

function makeReq(url: string, init?: RequestInit) {
  // Next's NextRequest accepts a standard Request — we use that here so the
  // tests run under the same vitest config the rest of the draft suite uses.
  return new Request(url, init) as unknown as Parameters<typeof GET>[0]
}

const SAMPLE_REPORT = {
  mode: 'apply',
  startedAt: '2026-04-25T09:00:00.000Z',
  finishedAt: '2026-04-25T09:00:12.000Z',
  durationMs: 12000,
  sport: 'NFL',
  season: null,
  draftMode: 'real',
  includeTest: false,
  picksScanned: 8211,
  picksKept: 7204,
  filteredOutBySource: 41,
  filteredOutByAsset: 12,
  filteredOutByMode: 954,
  uniquePlayers: 612,
  uniqueContexts: 38,
  snapshotsWritten: 23256,
  byDraftMode: { real: 23256, mock: 0, test: 0 },
  errors: [],
}

describe('D.5-scheduler — cron route auth', () => {
  beforeEach(() => {
    mockRecompute.mockReset()
    mockRecompute.mockResolvedValue({ ...SAMPLE_REPORT })
    process.env.CRON_SECRET = 'unit-test-secret'
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
    delete process.env.LEAGUE_CRON_SECRET
    delete process.env.BRACKET_ADMIN_SECRET
    delete process.env.ADMIN_PASSWORD
    delete process.env.IMPORT_WORKER_SECRET
  })

  it('rejects with 401 when no secret header is present', async () => {
    const res = await GET(makeReq('http://localhost/api/cron/recompute-allfantasy-adp'))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(mockRecompute).not.toHaveBeenCalled()
  })

  it('rejects with 401 when the bearer token is wrong', async () => {
    const res = await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { Authorization: 'Bearer not-the-real-secret' },
      }),
    )
    expect(res.status).toBe(401)
    expect(mockRecompute).not.toHaveBeenCalled()
  })

  it('rejects POST with 401 when no secret is provided', async () => {
    const res = await POST(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', { method: 'POST' }),
    )
    expect(res.status).toBe(401)
    expect(mockRecompute).not.toHaveBeenCalled()
  })

  it('accepts the correct secret via Authorization: Bearer', async () => {
    const res = await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.report.snapshotsWritten).toBe(23256)
    expect(mockRecompute).toHaveBeenCalledTimes(1)
  })

  it('accepts the correct secret via X-Cron-Secret header', async () => {
    const res = await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { 'X-Cron-Secret': 'unit-test-secret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(mockRecompute).toHaveBeenCalledTimes(1)
  })
})

describe('D.5-scheduler — recompute invocation defaults', () => {
  beforeEach(() => {
    mockRecompute.mockReset()
    mockRecompute.mockResolvedValue({ ...SAMPLE_REPORT })
    process.env.CRON_SECRET = 'unit-test-secret'
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('default invocation: NFL real-mode apply=true, includeTest=false', async () => {
    await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(mockRecompute).toHaveBeenCalledWith({
      sport: 'NFL',
      season: null,
      draftMode: 'real',
      includeTest: false,
      apply: true,
    })
  })

  it('test picks are excluded by default (includeTest=false)', async () => {
    await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    const call = mockRecompute.mock.calls[0][0]
    expect(call.includeTest).toBe(false)
    expect(call.draftMode).toBe('real')
  })

  it('?includeTest=true is honored (admin escape hatch)', async () => {
    await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp?includeTest=true', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(mockRecompute.mock.calls[0][0].includeTest).toBe(true)
  })

  it('?dryRun=true flips apply to false (does not write snapshots)', async () => {
    mockRecompute.mockResolvedValueOnce({ ...SAMPLE_REPORT, mode: 'dry-run', snapshotsWritten: 0 })
    await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp?dryRun=true', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(mockRecompute.mock.calls[0][0].apply).toBe(false)
  })

  it('?sport=NHL is uppercased and forwarded (extensibility hook)', async () => {
    await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp?sport=nhl', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(mockRecompute.mock.calls[0][0].sport).toBe('NHL')
  })

  it('?season=2025 narrows the recompute', async () => {
    await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp?season=2025', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(mockRecompute.mock.calls[0][0].season).toBe('2025')
  })
})

describe('D.5-scheduler — error handling', () => {
  beforeEach(() => {
    mockRecompute.mockReset()
    process.env.CRON_SECRET = 'unit-test-secret'
  })
  afterEach(() => {
    delete process.env.CRON_SECRET
  })

  it('non-empty report.errors → 207 multi-status with structured body', async () => {
    mockRecompute.mockResolvedValue({
      ...SAMPLE_REPORT,
      errors: ["upsert Ja'Marr Chase (real): unique constraint violation"],
    })
    const res = await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(res.status).toBe(207)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.report.errors).toHaveLength(1)
  })

  it('thrown service error → 500 with structured error body', async () => {
    mockRecompute.mockRejectedValue(new Error('database is down'))
    const res = await GET(
      makeReq('http://localhost/api/cron/recompute-allfantasy-adp', {
        headers: { Authorization: 'Bearer unit-test-secret' },
      }),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toBe('database is down')
  })
})

describe('D.5-scheduler — no forbidden BaaS references', () => {
  // Per project guidance: Neon + Prisma only. Split the forbidden token so
  // this test file doesn't trigger its own assertion.
  const FORBIDDEN = 'supa' + 'base'
  const filesToCheck = [
    'app/api/cron/recompute-allfantasy-adp/route.ts',
    'lib/adp/recomputeAllFantasyAdp.ts',
    'scripts/recompute-allfantasy-adp.ts',
  ]
  for (const rel of filesToCheck) {
    it(`${rel} contains no forbidden BaaS imports`, () => {
      const src = readFileSync(resolve(root, rel), 'utf8')
      expect(src.toLowerCase()).not.toContain(FORBIDDEN)
    })
  }
})

describe('D.5-scheduler — vercel.json cron entry', () => {
  it('vercel.json registers /api/cron/recompute-allfantasy-adp on a daily schedule', () => {
    const src = readFileSync(resolve(root, 'cron-schedule.json'), 'utf8')
    const json = JSON.parse(src) as { crons?: Array<{ path: string; schedule: string }> }
    const entry = json.crons?.find((c) => c.path === '/api/cron/recompute-allfantasy-adp')
    expect(entry, 'expected a cron entry for the AllFantasy ADP recompute').toBeDefined()
    // Daily — first cron field is a single hour, last three are wildcards.
    // (We don't pin a specific hour here; matches `0 H * * *` for any H.)
    expect(entry!.schedule).toMatch(/^\d+\s+\d+\s+\*\s+\*\s+\*$/)
  })
})

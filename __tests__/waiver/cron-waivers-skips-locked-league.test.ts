// @vitest-environment node
/**
 * GET /api/cron/waivers re-reads the commissioner's "Lock all roster moves" for each due league when it
 * runs. A locked league is skipped BEFORE its automation job — no attempt against the day's idempotency
 * key, its claims untouched and pending — and the response and heartbeat say it was skipped as locked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  locked: new Set<string>(),
  discover: vi.fn(),
  job: vi.fn(),
  heartbeats: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async ({ where }: { where: { id: string } }) => ({ lockAllMoves: h.locked.has(where.id) }) },
} }))
vi.mock('@/lib/automation/audit', () => ({ writeAutomationAuditLog: vi.fn(async () => undefined) }))
vi.mock('@/lib/automation/jobs/waivers/discoverDueWaiverLeagues', () => ({ discoverDueWaiverLeagues: h.discover }))
vi.mock('@/lib/automation/jobs/waivers/processLeagueWaiversJob', () => ({ processLeagueWaiversJob: h.job }))
vi.mock('@/lib/production-health/syncJobRunTelemetry', () => ({
  withSyncJobRun: async (_ctx: unknown, fn: () => Promise<unknown>, extract: (r: unknown) => unknown) => {
    const r = await fn()
    h.heartbeats.push(extract(r))
    return r
  },
}))
vi.mock('@/lib/survivor-guillotine/live', () => ({ runSGAutomaticChopNight: async () => ({ scanned: 0, due: 0, results: [] }) }))
vi.mock('@/lib/survivor-guillotine/operations', () => ({
  runSGDueAuctions: async () => ({ scanned: 0, due: 0, results: [] }),
  runSGSelectionDeadlines: async () => ({ scanned: 0, due: 0, results: [] }),
}))

import { GET } from '@/app/api/cron/waivers/route'

const due = (leagueId: string) => ({ leagueId, pendingClaimCount: 3, scheduledFor: new Date('2026-10-25T10:00:00Z'), waiverType: 'faab', metadata: {} })
const call = () => GET(new Request('http://localhost/api/cron/waivers', { headers: { authorization: 'Bearer s3cret' } }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 's3cret'
  h.locked = new Set(['LOCKED'])
  h.heartbeats = []
  h.discover.mockResolvedValue([due('LOCKED'), due('OPEN')])
  h.job.mockResolvedValue({ ok: true, automationJobId: 'j', summary: { message: 'Processed 3 claim(s)' }, message: 'ok' })
})

describe('/api/cron/waivers and the move lock', () => {
  it('skips a locked league without running its job, and processes the unlocked one', async () => {
    const body = await (await call()).json()
    expect(h.job).toHaveBeenCalledTimes(1)
    expect(h.job).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'OPEN' }))
    expect(body).toMatchObject({ ok: true, discovered: 2, processed: 1, failed: 0, skippedLocked: 1 })
    expect(body.results).toContainEqual(expect.objectContaining({
      leagueId: 'LOCKED',
      ok: true,
      skipped: 'league_moves_locked',
      message: expect.stringMatching(/skipped: the commissioner has locked all roster moves/i),
    }))
    expect(h.heartbeats[0]).toMatchObject({ status: 'success', metadata: { skippedLocked: 1 } })
  })

  it('the next fire after the lock is lifted runs the league', async () => {
    await call()
    h.locked.clear()
    const body = await (await call()).json()
    expect(h.job).toHaveBeenLastCalledWith(expect.objectContaining({ leagueId: 'OPEN' }))
    expect(h.job).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'LOCKED' }))
    expect(body).toMatchObject({ processed: 2, skippedLocked: 0 })
  })
})

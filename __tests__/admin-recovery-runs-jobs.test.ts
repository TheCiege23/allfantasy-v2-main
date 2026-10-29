/**
 * The admin recovery buttons run their league-engine job now. They used to enqueue it onto BullMQ,
 * which has no worker in production, so "Process waivers" and friends reported success and did nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({ run: vi.fn(), audit: vi.fn(), snapshot: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAudit: m.audit }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ transitionLeagueState: vi.fn() }))
vi.mock('@/lib/workers/league-engine-worker', () => ({ runLeagueEngineJobNow: m.run }))
vi.mock('@/server/services/statCorrectionService', () => ({ reprocessWeekAfterStatCorrection: vi.fn() }))
vi.mock('@/lib/admin/operations/leagueInspectService', () => ({ buildLeagueInspectSnapshot: m.snapshot }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ pauseDraftSession: vi.fn() }))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))
vi.mock('@/lib/jobs/enqueue', () => ({ enqueueLeagueEngineJob: vi.fn(() => { throw new Error('must not enqueue') }) }))

import { runAdminLeagueRecovery } from '@/lib/admin/recovery/adminRecoveryService'

beforeEach(() => {
  vi.clearAllMocks()
  m.snapshot.mockResolvedValue({ league: { id: 'L1' } })
})

describe('admin recovery', () => {
  it('"process waivers" runs the waiver job in-process and reports its result', async () => {
    m.run.mockResolvedValue({ ok: true, kind: 'waiver_process', processedAt: 'now', detail: { claimResults: 2 } })
    const r = await runAdminLeagueRecovery({ leagueId: 'L1', adminUserId: 'admin', action: { type: 'enqueue_waiver_process' } })
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'waiver_process', leagueId: 'L1' }), expect.stringMatching(/^admin:waiver:/))
    expect(r).toMatchObject({ ok: true, detail: { run: { detail: { claimResults: 2 } } } })
    expect(m.audit).toHaveBeenCalled()
  })

  it('a job that fails is reported as a failure, not as "queued"', async () => {
    m.run.mockResolvedValue({ ok: false, kind: 'scoring_week', processedAt: 'now', error: 'no season' })
    const r = await runAdminLeagueRecovery({ leagueId: 'L1', adminUserId: 'admin', action: { type: 'enqueue_scoring_week', season: 2026, weekOrRound: 3 } })
    expect(r).toEqual({ ok: false, error: 'no season' })
  })
})

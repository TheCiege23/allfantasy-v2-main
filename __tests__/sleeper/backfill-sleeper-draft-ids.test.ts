/** @vitest-environment node */
/**
 * The backfill writes a GLOBALLY unique column across rows that legitimately share a value.
 *
 * One Sleeper league is N AllFantasy League rows — one per importer — so several
 * DraftSessions point at one upstream draft, and `sleeperDraftId @unique` lets only the
 * first hold it. Before the guard, every other row threw P2002 on every pass, forever;
 * production logged a repeating `Unique constraint failed on the fields: (sleeperDraftId)`.
 *
 * ⚠ `@vitest-environment node` is load-bearing: `lib/prisma` returns null when `window`
 * is defined, so under the default jsdom environment these mocks sit on a null object.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
const findUnique = vi.fn()
const update = vi.fn()
const sessionCount = vi.fn()
const leagueCount = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
      count: (...a: unknown[]) => sessionCount(...a),
    },
    league: { count: (...a: unknown[]) => leagueCount(...a) },
  },
}))

import { backfillSleeperDraftIds } from '@/lib/sleeper/sync/backfillSleeperDraftIds'

/** One session belonging to league L2, still missing its draft id. */
const PENDING = [{ id: 's2', leagueId: 'L2', league: { platformLeagueId: '100' } }]

beforeEach(() => {
  vi.clearAllMocks()
  findMany.mockResolvedValue(PENDING)
  leagueCount.mockResolvedValue(5)
  sessionCount.mockResolvedValue(3)
  update.mockResolvedValue({ id: 's2' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ draft_id: 'D1' }) })),
  )
})

describe('backfillSleeperDraftIds — a draft id shared by sibling league rows', () => {
  it('skips the id when another session holds it, and never attempts the write', async () => {
    findUnique.mockResolvedValue({ id: 's1', leagueId: 'L1' })

    const result = await backfillSleeperDraftIds()

    // The write is the thing that used to throw. It must not be reached at all.
    expect(update).not.toHaveBeenCalled()
    expect(result.claimedByAnotherSession).toBe(1)
    expect(result.resolved).toBe(0)
    // Counted apart from `failed`, which is reserved for a real outage.
    expect(result.failed).toBe(0)
    expect(result.failures[0]?.reason).toContain('already held by league L1')
  })

  it('assigns the id normally when nothing holds it', async () => {
    findUnique.mockResolvedValue(null)

    const result = await backfillSleeperDraftIds()

    expect(update).toHaveBeenCalledTimes(1)
    expect(result.resolved).toBe(1)
    expect(result.claimedByAnotherSession).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('still writes when the holder IS this same session, which is not a collision', async () => {
    // Re-running the backfill over a row that already resolved must not report a conflict
    // against itself — that would turn a no-op into a permanent phantom gap.
    findUnique.mockResolvedValue({ id: 's2', leagueId: 'L2' })

    const result = await backfillSleeperDraftIds()

    expect(update).toHaveBeenCalledTimes(1)
    expect(result.resolved).toBe(1)
    expect(result.claimedByAnotherSession).toBe(0)
  })

  it('classifies a lost race as claimed rather than failed', async () => {
    // The read is not a lock: two passes can interleave, so the constraint stays the
    // authority. If this landed in `failed` the guard would only move the noise.
    findUnique.mockResolvedValue(null)
    update.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))

    const result = await backfillSleeperDraftIds()

    expect(result.claimedByAnotherSession).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.failures[0]?.reason).toBe('sleeperDraftId claimed concurrently')
  })

  it('still reports a genuine outage as failed', async () => {
    // The guard must not swallow everything — a non-P2002 error is an outage and has to
    // keep reaching `failed`, or the counter it was added to protect becomes meaningless.
    findUnique.mockResolvedValue(null)
    update.mockRejectedValue(new Error('connection reset'))

    const result = await backfillSleeperDraftIds()

    expect(result.failed).toBe(1)
    expect(result.claimedByAnotherSession).toBe(0)
    expect(result.failures[0]?.reason).toContain('connection reset')
  })
})

/**
 * Exactly-once draft completion (lib/live-draft-engine/DraftSessionService.ts `completeDraftSession`).
 *
 * Several completers can reach a full board at the same moment: the last pick, the draft-tick cron,
 * auto-draft fill, an import commit, the self-heal. `completeDraftSession` used to read the status and
 * then `update` by id with no condition, so two callers that both read `in_progress` both "made" the
 * transition and both sent `draft_ended`. The season-tournament branch compared a status read before
 * the call with the result after it, which races the same way.
 *
 * The Prisma mock models the one database behaviour the fix relies on: a conditional `updateMany` is
 * evaluated against the row as it stands when the write runs (Postgres re-checks the WHERE of an
 * UPDATE that waited on a row lock), while an unconditional `update` always writes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    status: 'in_progress',
    version: 1,
    /** How many callers must reach the read before any of them may continue. */
    barrierSize: 1,
    arrived: 0,
    release: null as null | (() => void),
    gate: null as null | Promise<void>,
    seasonMode: false,
  }
  function resetBarrier(size: number) {
    state.barrierSize = size
    state.arrived = 0
    state.gate = new Promise<void>((r) => (state.release = r))
  }
  /** Every caller waits here until `barrierSize` callers have arrived: they all read the same status. */
  async function barrier() {
    state.arrived++
    if (state.arrived >= state.barrierSize) state.release?.()
    await state.gate
  }
  const sessionRow = () => ({
    id: 'session-1',
    leagueId: 'league-1',
    status: state.status,
    rounds: 1,
    teamCount: 2,
    draftType: 'snake',
    slotOrder: [],
    completedAt: null,
    version: state.version,
  })
  const picks = [
    { overall: 1, playerName: 'A', position: 'QB', pickMetadata: null },
    { overall: 2, playerName: 'B', position: 'RB', pickMetadata: null },
  ]
  const tx = {
    draftSession: {
      findFirst: vi.fn(async () => {
        const snapshot = sessionRow()
        await barrier()
        return snapshot
      }),
      findUnique: vi.fn(async () => ({ status: state.status })),
      update: vi.fn(async () => {
        state.status = 'completed'
        state.version++
        return sessionRow()
      }),
      updateMany: vi.fn(async ({ where }: { where: { status?: { not?: string } } }) => {
        if (where.status?.not && state.status === where.status.not) return { count: 0 }
        state.status = 'completed'
        state.version++
        return { count: 1 }
      }),
    },
    draftPick: { findMany: vi.fn(async () => picks) },
  }
  const prisma = {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    draftSession: {
      findFirst: vi.fn(async () => {
        const snapshot = sessionRow()
        if (state.seasonMode) await barrier()
        return snapshot
      }),
    },
    league: { findUnique: vi.fn(async () => ({ userId: null })) },
  }
  /** The season-tournament completer: its own CAS under the control lock, same shared state. */
  async function seasonOutcome() {
    if (!state.seasonMode) return null
    if (state.status === 'completed') return { completed: true, transitioned: false, sessionId: 'session-1' }
    state.status = 'completed'
    state.version++
    return { completed: true, transitioned: true, sessionId: 'session-1' }
  }
  return {
    state,
    resetBarrier,
    tx,
    prisma,
    seasonOutcome,
    notify: vi.fn(async () => {}),
    emit: vi.fn(async () => {}),
    lifecycle: vi.fn(async () => ({ applied: false })),
    archive: vi.fn(async () => ({})),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/tournament/seasonDraftCompletion', () => ({
  completeSeasonDraftWithOutcome: async () => {
    // A season completer reached after every caller read the pre-completion status.
    return h.seasonOutcome()
  },
  completeSeasonDraft: async () => {
    const o = await h.seasonOutcome()
    return o === null ? null : o.completed
  },
}))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: h.archive, updateSessionWithArchive: vi.fn() }))
vi.mock('@/server/services/leagueLifecycleService', () => ({
  applyPostDraftLifecycleInTransaction: h.lifecycle,
  applyDraftingLifecycleOnDraftResetInTransaction: vi.fn(),
  ensureDraftingLifecycleForActiveSession: vi.fn(),
}))
vi.mock('@/lib/draft-notifications', () => ({ notifyDraftLifecycle: h.notify }))
// The service imports this dynamically; two concurrent first imports can resolve one caller to the real
// module (seen: the real service throwing on the mock prisma), which hides a duplicate call. Mocking the
// implementation module too sends every attempt to the same spy.
vi.mock('@/lib/draft-notifications/DraftNotificationService', () => ({ notifyDraftLifecycle: h.notify }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: h.emit }), EVENT: { DRAFT_COMPLETED: 'draft.completed' } }))
vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({ runPostDraftFinalizationArtifacts: vi.fn(async () => {}) }))
vi.mock('@/lib/survivor-guillotine/operations', () => ({ bootstrapSGAfterDraft: vi.fn(async () => {}) }))
vi.mock('@/lib/survivor/SurvivorDraftBootstrapService', () => ({ runSurvivorPostDraftBootstrap: vi.fn(async () => {}) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => {}) }))

const { completeDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
await import('@/lib/draft-notifications')

beforeEach(() => {
  vi.clearAllMocks()
  h.state.status = 'in_progress'
  h.state.version = 1
  h.state.seasonMode = false
  h.resetBarrier(1)
})

describe('completeDraftSession — ordinary drafts', () => {
  it('a single completer transitions and announces once', async () => {
    expect(await completeDraftSession('league-1')).toBe(true)
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith('league-1', 'draft_ended', 'session-1')
    expect(h.emit).toHaveBeenCalledTimes(1)
  })

  it('two concurrent completers that both read in_progress: draft_ended is sent exactly once', async () => {
    h.resetBarrier(2)
    const results = await Promise.all([completeDraftSession('league-1'), completeDraftSession('league-1')])
    // Both read in_progress before either wrote (the race the CAS closes).
    expect(h.tx.draftSession.findFirst).toHaveBeenCalledTimes(2)
    expect(results).toEqual([true, true])
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.emit).toHaveBeenCalledTimes(1)
    expect(h.lifecycle).toHaveBeenCalledTimes(1)
    expect(h.archive).toHaveBeenCalledTimes(1)
    expect(h.state.version).toBe(2)
  })

  it('an already completed draft is idempotent and announces nothing', async () => {
    h.state.status = 'completed'
    expect(await completeDraftSession('league-1')).toBe(true)
    expect(h.notify).not.toHaveBeenCalled()
  })
})

describe('completeDraftSession — season tournament drafts', () => {
  it('two concurrent completers: draft_ended is sent exactly once', async () => {
    h.state.seasonMode = true
    h.resetBarrier(2)
    const gatedOutcome = h.seasonOutcome
    // Hold both callers until each has made any pre-read it is going to make.
    let entered = 0
    let open!: () => void
    const both = new Promise<void>((r) => (open = r))
    h.seasonOutcome = async () => {
      entered++
      if (entered >= 2) open()
      await both
      return gatedOutcome()
    }
    try {
      const results = await Promise.all([completeDraftSession('league-1'), completeDraftSession('league-1')])
      expect(results).toEqual([true, true])
      expect(h.notify).toHaveBeenCalledTimes(1)
    } finally {
      h.seasonOutcome = gatedOutcome
    }
  })
})

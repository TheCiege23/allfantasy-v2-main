/**
 * undoLastPick — timer reset behavior (mocked Prisma).
 *
 * Bug fixed: before this commit, undoLastPick bumped `version` but left
 * `timerEndAt` pointing at the old pick's deadline. A commissioner undo at
 * T-5s would give the restored on-clock manager only 5 seconds before the
 * auto-pick worker fired again.
 *
 * Fixed behavior:
 * - in_progress + timerSeconds set  → fresh timerEndAt, clear pausedRemainingSeconds + overnightFrozenPickSeconds
 * - paused                           → timer fields untouched (resume still works)
 * - in_progress + untimed            → timer fields untouched
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted store + Prisma mock
// ---------------------------------------------------------------------------

const ctx = vi.hoisted(() => {
  type PickRow = {
    id: string
    sessionId: string
    overall: number
    round: number
    slot: number
    rosterId: string
    playerName: string
    position: string
    playerId?: string | null
    team?: string | null
    source?: string | null
  }

  let capturedUpdateData: Record<string, unknown> | null = null
  let deletedPickId: string | null = null

  const store = {
    session: {
      id: 'session-1',
      leagueId: 'league-1',
      status: 'in_progress' as string,
      timerSeconds: 90 as number | null,
      // Simulate a nearly-expired timer — 5 s left.
      timerEndAt: new Date(Date.now() + 5_000) as Date | null,
      pausedRemainingSeconds: null as number | null,
      overnightFrozenPickSeconds: null as number | null,
      version: 3,
    },
    picks: [
      {
        id: 'pick-1',
        sessionId: 'session-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-a',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        team: 'KC',
        source: 'user',
      },
    ] as PickRow[],
  }

  function buildTx() {
    return {
      draftPick: {
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          deletedPickId = where.id
          store.picks = store.picks.filter((p) => p.id !== where.id)
        }),
      },
      draftSession: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          capturedUpdateData = { ...data }
        }),
      },
      draftPickAuditLog: {
        create: vi.fn(async () => {}),
      },
    }
  }

  const prisma = {
    draftSession: {
      findUnique: vi.fn(async () => ({
        ...store.session,
        // Return picks sorted desc (highest overall first), take 1 — mirrors the real query.
        picks: [...store.picks].sort((a, b) => b.overall - a.overall).slice(0, 1),
      })),
    },
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      capturedUpdateData = null
      deletedPickId = null
      return fn(buildTx())
    }),
  }

  function reset() {
    store.session.status = 'in_progress'
    store.session.timerSeconds = 90
    store.session.timerEndAt = new Date(Date.now() + 5_000)
    store.session.pausedRemainingSeconds = null
    store.session.overnightFrozenPickSeconds = null
    store.session.version = 3
    store.picks = [
      {
        id: 'pick-1',
        sessionId: 'session-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-a',
        playerName: 'Patrick Mahomes',
        position: 'QB',
        team: 'KC',
        source: 'user',
      },
    ]
    capturedUpdateData = null
    deletedPickId = null
  }

  return {
    store,
    prisma,
    reset,
    getCapture: () => ({ capturedUpdateData, deletedPickId }),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: ctx.prisma }))

// ---------------------------------------------------------------------------
// Import under test (after mocks are registered)
// ---------------------------------------------------------------------------

const { undoLastPick } = await import('@/lib/live-draft-engine/DraftSessionService')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('undoLastPick', () => {
  beforeEach(() => {
    ctx.reset()
    vi.clearAllMocks()
  })

  it('returns false when no picks exist', async () => {
    ctx.store.picks = []
    expect(await undoLastPick('league-1')).toBe(false)
  })

  it('returns true on success', async () => {
    expect(await undoLastPick('league-1')).toBe(true)
  })

  it('deletes the last pick', async () => {
    await undoLastPick('league-1')
    expect(ctx.getCapture().deletedPickId).toBe('pick-1')
  })

  describe('in_progress + timerSeconds set (standard case)', () => {
    it('resets timerEndAt to a full fresh window', async () => {
      const before = Date.now()
      await undoLastPick('league-1')
      const { capturedUpdateData } = ctx.getCapture()
      expect(capturedUpdateData?.timerEndAt).toBeInstanceOf(Date)
      const endMs = (capturedUpdateData!.timerEndAt as Date).getTime()
      // Must be ~90 s from before the call, not ~5 s (the stale leftover)
      expect(endMs).toBeGreaterThanOrEqual(before + 89_000)
      expect(endMs).toBeLessThanOrEqual(before + 91_000)
    })

    it('clears pausedRemainingSeconds so stale leftovers cannot corrupt the restored clock', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().capturedUpdateData?.pausedRemainingSeconds).toBeNull()
    })

    it('clears overnightFrozenPickSeconds', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().capturedUpdateData?.overnightFrozenPickSeconds).toBeNull()
    })
  })

  describe('paused — timer fields must not be overwritten', () => {
    beforeEach(() => {
      ctx.store.session.status = 'paused'
      ctx.store.session.timerEndAt = null
      ctx.store.session.pausedRemainingSeconds = 30
    })

    it('does not set timerEndAt in the update', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().capturedUpdateData).not.toHaveProperty('timerEndAt')
    })

    it('does not overwrite pausedRemainingSeconds (resume must still work)', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().capturedUpdateData).not.toHaveProperty('pausedRemainingSeconds')
    })

    it('still deletes the pick', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().deletedPickId).toBe('pick-1')
    })
  })

  describe('in_progress + untimed (timerSeconds null)', () => {
    beforeEach(() => {
      ctx.store.session.timerSeconds = null
      ctx.store.session.timerEndAt = null
    })

    it('does not set timerEndAt in the update', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().capturedUpdateData).not.toHaveProperty('timerEndAt')
    })

    it('still deletes the pick', async () => {
      await undoLastPick('league-1')
      expect(ctx.getCapture().deletedPickId).toBe('pick-1')
    })
  })
})

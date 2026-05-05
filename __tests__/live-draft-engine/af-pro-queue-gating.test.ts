/**
 * AF Pro draft queue gating — unit coverage for persisted AI reorder vs suggestion-only paths,
 * locked-row reorder semantics, and autopick consuming persisted `DraftQueue.order`.
 *
 * AUDIT (repo facts):
 * - **Where queue order is stored**: `DraftQueue.order` JSON (`sessionId` + `userId`), primary path for
 *   GET/PUT `/draft/queue`, POST `/draft/queue/ai-reorder`, and **`tryQueueAutoPick`** (reads session queues).
 * - **DraftQueueEntry**: Alternative row-based queue (`draft_queue_entries`) — not wired to ai-reorder/autopick
 *   in this slice.
 * - **Autopick reads queue**: `SlowDraftRuntimeService.tryQueueAutoPick` loads `draftSession.queues`, finds
 *   row by `userId`, iterates **`order`** array in array order (after filtering drafted / ineligible positions).
 * - **AI reorder**: Deterministic **`reorderQueueByNeed`** / **`reorderQueueByNeedRespectingLocks`**; optional
 *   OpenAI explanation only when league UI allows (`aiQueueReorderEnabled`). Persist requires AF Pro feature
 *   **`pro_draft_ai`** + **`Roster.settings.aiManageDraftQueueEnabled`** (via PUT `/draft/queue` body).
 * - **AF Pro check**: `EntitlementResolver.resolveForUser(..., 'pro_draft_ai')` in ai-reorder route and when
 *   enabling AI manage flag on PUT queue.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reorderQueueByNeedRespectingLocks } from '@/lib/draft-queue-engine'
import {
  mergeAiManageDraftQueuePreference,
  getAiManageDraftQueueEnabled,
} from '@/lib/live-draft-engine/draftQueueAiPreferences'
import {
  annotatePersistedAiQueueOrder,
  planDraftQueueAiReorder,
} from '@/lib/live-draft-engine/draftQueueAiReorder'
import type { QueueEntry } from '@/lib/live-draft-engine/types'

const hm = vi.hoisted(() => ({
  draftSessionFindUnique: vi.fn(),
  rosterFindUnique: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  submitPick: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: hm.draftSessionFindUnique },
    roster: { findUnique: hm.rosterFindUnique },
  },
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/live-draft-engine/RosterFitValidation')>()
  return {
    ...actual,
    getAllowedPositionsAndRosterSize: hm.getAllowedPositionsAndRosterSize,
  }
})

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: hm.submitPick,
}))

describe('planDraftQueueAiReorder — AF Pro + aiManageDraftQueueEnabled', () => {
  const baseQueue: QueueEntry[] = [
    { playerName: 'Jayden Daniels', position: 'QB' },
    { playerName: 'Jahmyr Gibbs', position: 'RB' },
    { playerName: 'Mike Evans', position: 'WR' },
  ]

  it('Normal user (no AF Pro): suggestion only; manual queue unchanged as display', () => {
    const plan = planDraftQueueAiReorder({
      queue: baseQueue,
      rosterPositions: [],
      sport: 'NFL',
      hasProDraftAiAccess: false,
      aiManageDraftQueueEnabled: false,
    })
    expect(plan.mode).toBe('suggestion_af_pro_required')
    expect(plan.persistOrder).toBeNull()
    expect(plan.displayOrder.map((e) => e.playerName)).toEqual([
      'Jayden Daniels',
      'Jahmyr Gibbs',
      'Mike Evans',
    ])
    expect(plan.suggestionOrder.map((e) => e.playerName).join(',')).toContain('Jayden')
  })

  it('AF Pro but aiManageDraftQueueEnabled false: no persist; display stays manual order', () => {
    const plan = planDraftQueueAiReorder({
      queue: baseQueue,
      rosterPositions: [],
      sport: 'NFL',
      hasProDraftAiAccess: true,
      aiManageDraftQueueEnabled: false,
    })
    expect(plan.mode).toBe('suggestion_ai_manage_disabled')
    expect(plan.persistOrder).toBeNull()
    expect(plan.displayOrder).toEqual(baseQueue)
  })

  it('AF Pro + enabled: persist order differs from suggestion tracking; persist payload annotated', () => {
    const plan = planDraftQueueAiReorder({
      queue: baseQueue,
      rosterPositions: [],
      sport: 'NFL',
      hasProDraftAiAccess: true,
      aiManageDraftQueueEnabled: true,
    })
    expect(plan.mode).toBe('persist')
    expect(plan.persistOrder).not.toBeNull()
    expect(plan.persistOrder!.length).toBe(3)
    expect(plan.persistOrder!.some((e) => e.isAiAdjusted === true)).toBe(true)
  })
})

describe('reorderQueueByNeedRespectingLocks', () => {
  it('locked rank-1 entry stays first; other rows may reorder around it', () => {
    const queue: QueueEntry[] = [
      { playerName: 'Keeper WR', position: 'WR', lockedByUser: true },
      { playerName: 'Jayden Daniels', position: 'QB' },
      { playerName: 'Jahmyr Gibbs', position: 'RB' },
    ]
    const { reordered } = reorderQueueByNeedRespectingLocks({
      queue,
      rosterPositions: [],
      sport: 'NFL',
    })
    expect(reordered[0]?.playerName).toBe('Keeper WR')
    expect(reordered[0]?.lockedByUser).toBe(true)
    expect(reordered.length).toBe(3)
  })
})

describe('annotatePersistedAiQueueOrder', () => {
  it('records aiOriginalRank and clears aiReason for locked rows', () => {
    const before: QueueEntry[] = [
      { playerName: 'A', position: 'RB', lockedByUser: true },
      { playerName: 'B', position: 'WR' },
    ]
    const after: QueueEntry[] = [
      { playerName: 'A', position: 'RB', lockedByUser: true },
      { playerName: 'B', position: 'WR' },
    ]
    const out = annotatePersistedAiQueueOrder(before, after, 'Test explanation for reorder.')
    expect(out[0]?.lockedByUser).toBe(true)
    expect(out[0]?.isAiAdjusted).toBe(false)
    expect(out[0]?.aiReason).toBeNull()
    expect(out[1]?.isAiAdjusted).toBe(true)
    expect(out[1]?.aiOriginalRank).toBe(2)
  })
})

describe('roster settings helpers', () => {
  it('mergeAiManageDraftQueuePreference preserves unrelated keys', () => {
    const merged = mergeAiManageDraftQueuePreference({ foo: 'bar' }, true)
    expect(merged.foo).toBe('bar')
    expect(getAiManageDraftQueueEnabled(merged)).toBe(true)
  })
})

describe('tryQueueAutoPick — consumes persisted DraftQueue.order only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hm.getAllowedPositionsAndRosterSize.mockResolvedValue({
      draftEligiblePositions: new Set(['QB', 'RB', 'WR', 'TE', 'DST']),
      rosterUnionAllowedPositions: new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']),
      totalRosterSize: 16,
    })
    hm.submitPick.mockResolvedValue({ success: true })
    hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'user-1' })
  })

  function mockSession(queue: QueueEntry[], picks: Array<{ playerName: string; position: string }> = []) {
    hm.draftSessionFindUnique.mockResolvedValue({
      status: 'in_progress',
      picks,
      queues: [{ userId: 'user-1', order: queue }],
    })
  }

  it('manual order A then B: autopick targets Player A first (AI manage off scenario simulated by DB order)', async () => {
    mockSession([
      { playerName: 'Player A', position: 'RB' },
      { playerName: 'Player B', position: 'WR' },
    ])
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')
    expect(result.success).toBe(true)
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        playerName: 'Player A',
        position: 'RB',
        source: 'auto',
      }),
    )
  })

  it('persisted AI-style order B then A: autopick targets Player B first', async () => {
    mockSession([
      { playerName: 'Player B', position: 'WR' },
      { playerName: 'Player A', position: 'RB' },
    ])
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')
    expect(result.success).toBe(true)
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        playerName: 'Player B',
        position: 'WR',
      }),
    )
  })

  it('skips unavailable head after AI reorder when top name already drafted', async () => {
    mockSession(
      [
        { playerName: 'Drafted Guy', position: 'QB' },
        { playerName: 'Still Here', position: 'RB' },
      ],
      [{ playerName: 'Drafted Guy', position: 'QB' }],
    )
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')
    expect(result.success).toBe(true)
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        playerName: 'Still Here',
        position: 'RB',
      }),
    )
  })

  it('empty queue: no autopick from queue path (fallback is elsewhere)', async () => {
    mockSession([])
    const { tryQueueAutoPick } = await import('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService')
    const result = await tryQueueAutoPick('league-1', 'roster-1')
    expect(result.success).toBe(false)
    expect(hm.submitPick).not.toHaveBeenCalled()
  })
})

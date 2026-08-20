import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Two properties, both about what happens when Sleeper misbehaves.
 *
 * The sync deletes every mirrored pick before re-inserting. That is fine when the fetch
 * succeeded and merely wrong when it did not: the old code treated a failed /picks call as
 * "zero picks", so a single upstream 500 deleted the board and inserted nothing. On a
 * one-minute mirror during a live draft that blanks the screen mid-draft.
 */
const deleteMany = vi.fn()
const createMany = vi.fn()
const sessionUpdate = vi.fn()
const findManySessions = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: (...a: unknown[]) => findManySessions(...a),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        draftSession: { update: (...a: unknown[]) => sessionUpdate(...a) },
        draftPick: {
          deleteMany: (...a: unknown[]) => deleteMany(...a),
          createMany: (...a: unknown[]) => createMany(...a),
        },
      }),
  },
}))

import { syncDraftFromSleeper } from '@/lib/draft/sleeperSync'
import { mirrorActiveSleeperDrafts } from '@/lib/draft/mirrorActiveSleeperDrafts'

const DRAFT_OK = { ok: true, json: async () => ({ draft_id: 'd1', league_id: 'L1', status: 'drafting', settings: { rounds: 15, teams: 12, pick_timer: 120 } }) }
const PICKS_OK = {
  ok: true,
  json: async () => [
    { pick_no: 1, round: 1, draft_slot: 1, player_id: '4034', picked_by: 'u1', metadata: { first_name: 'A', last_name: 'Player', position: 'RB', team: 'SF' } },
  ],
}
const USERS_OK = { ok: true, json: async () => [{ user_id: 'u1', display_name: 'Manager One' }] }

function mockFetchSequence(draftRes: unknown, picksRes: unknown, usersRes: unknown = USERS_OK) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes('/picks')) return picksRes
    if (u.includes('/users')) return usersRes
    return draftRes
  }) as never
}

beforeEach(() => {
  deleteMany.mockReset(); createMany.mockReset(); sessionUpdate.mockReset(); findManySessions.mockReset()
  sessionUpdate.mockResolvedValue({ id: 'sess1' })
})

describe('sleeper draft sync: an upstream failure must not blank the board', () => {
  it('mirrors picks when both fetches succeed', async () => {
    mockFetchSequence(DRAFT_OK, PICKS_OK)
    await syncDraftFromSleeper('d1', 'sess1')
    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(createMany).toHaveBeenCalledTimes(1)
    expect(createMany.mock.calls[0][0].data).toHaveLength(1)
  })

  it('throws instead of deleting when the picks fetch fails', async () => {
    mockFetchSequence(DRAFT_OK, { ok: false, status: 500 })
    await expect(syncDraftFromSleeper('d1', 'sess1')).rejects.toThrow(/picks fetch failed: 500/)
    expect(deleteMany).not.toHaveBeenCalled()
    expect(createMany).not.toHaveBeenCalled()
  })

  it('throws when the picks payload is not an array', async () => {
    mockFetchSequence(DRAFT_OK, { ok: true, json: async () => ({ error: 'nope' }) })
    await expect(syncDraftFromSleeper('d1', 'sess1')).rejects.toThrow(/not an array/)
    expect(deleteMany).not.toHaveBeenCalled()
  })

  it('records an unknown pick time as unknown, never as "now"', async () => {
    mockFetchSequence(DRAFT_OK, PICKS_OK)
    await syncDraftFromSleeper('d1', 'sess1')
    expect(createMany.mock.calls[0][0].data[0].pickedAt).toBeNull()
  })

  it('labels mirrored picks as mirrored, not as a manual entry', async () => {
    mockFetchSequence(DRAFT_OK, PICKS_OK)
    await syncDraftFromSleeper('d1', 'sess1')
    expect(createMany.mock.calls[0][0].data[0].source).toBe('sleeper-mirror')
  })

  it('writes nothing when the draft itself is unreachable', async () => {
    mockFetchSequence({ ok: false, status: 404 }, PICKS_OK)
    await expect(syncDraftFromSleeper('d1', 'sess1')).rejects.toThrow(/draft fetch failed: 404/)
    expect(deleteMany).not.toHaveBeenCalled()
  })
})

describe('mirror scan: one league failing must not stop the rest', () => {
  it('continues past a failing draft and reports it', async () => {
    findManySessions.mockResolvedValue([
      { id: 'sA', sleeperDraftId: 'dA' },
      { id: 'sB', sleeperDraftId: 'dB' },
    ])
    let call = 0
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url)
      if (u.includes('dA')) return { ok: false, status: 503 }
      if (u.includes('/picks')) return PICKS_OK
      if (u.includes('/users')) return USERS_OK
      call += 1
      return DRAFT_OK
    }) as never

    const r = await mirrorActiveSleeperDrafts()
    expect(r.scanned).toBe(2)
    expect(r.mirrored).toBe(1)
    expect(r.failed).toBe(1)
    expect(r.failures[0].draftSessionId).toBe('sA')
  })

  it('never polls a completed draft', async () => {
    findManySessions.mockResolvedValue([])
    await mirrorActiveSleeperDrafts()
    const where = findManySessions.mock.calls[0][0].where
    expect(where.status.in).not.toContain('completed')
    expect(where.status.in).toEqual(expect.arrayContaining(['pre_draft', 'in_progress']))
  })

  it('clamps the scan cap rather than trusting the caller', async () => {
    findManySessions.mockResolvedValue([])
    await mirrorActiveSleeperDrafts({ maxDrafts: 100000 })
    expect(findManySessions.mock.calls[0][0].take).toBe(200)
  })
})

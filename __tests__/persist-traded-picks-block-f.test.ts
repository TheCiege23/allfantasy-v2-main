/**
 * Block F — integration test proving `persistTradedPicks` writes rows to
 * `future_draft_picks` via Prisma upsert, validates every required field on
 * both create and update paths, and never duplicates on re-import.
 *
 * This is a Prisma-mock test — the real DB round-trip is exercised by the
 * unique-index-backed upsert in Postgres and is redundant to validate here.
 * The `where` clause we build must exactly match the composite unique the
 * schema declares (`leagueId_pickSeason_round_originalRosterId`); this test
 * asserts that shape byte-for-byte.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  futureDraftPickUpsert: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    futureDraftPick: { upsert: mocks.futureDraftPickUpsert },
  },
}))

async function invokePersist(...args: Parameters<typeof import('@/lib/league-import/ImportedLeagueCommitService').persistTradedPicks>) {
  const { persistTradedPicks } = await import('@/lib/league-import/ImportedLeagueCommitService')
  return persistTradedPicks(...args)
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.futureDraftPickUpsert.mockResolvedValue({ id: 'fdp-1' })
})

describe('persistTradedPicks — field mapping (fresh create path)', () => {
  it('writes leagueId, pickSeason, round, originalRosterId, currentOwnerId, traded=true', async () => {
    const result = await invokePersist('lea-abc', [
      {
        season: 2026,
        round: 1,
        original_roster_id: '1',
        current_owner_roster_id: '7',
        previous_owner_roster_id: '4',
      },
    ])

    expect(result).toEqual({ written: 1, skipped: 0 })
    expect(mocks.futureDraftPickUpsert).toHaveBeenCalledOnce()

    const call = mocks.futureDraftPickUpsert.mock.calls[0][0]
    expect(call.where).toEqual({
      leagueId_pickSeason_round_originalRosterId: {
        leagueId: 'lea-abc',
        pickSeason: 2026,
        round: 1,
        originalRosterId: '1',
      },
    })
    expect(call.create).toMatchObject({
      leagueId: 'lea-abc',
      pickSeason: 2026,
      round: 1,
      originalRosterId: '1',
      currentOwnerId: '7',
      traded: true,
    })
    // previous_owner_roster_id is intentionally dropped (schema limitation).
    expect(call.create).not.toHaveProperty('previousOwnerRosterId')
    expect(call.create).not.toHaveProperty('previous_owner_id')
  })

  it('writes all 6 audit-fixture rows in sequence', async () => {
    const picks = [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7', previous_owner_roster_id: '4' },
      { season: 2026, round: 2, original_roster_id: '1', current_owner_roster_id: '11', previous_owner_roster_id: '12' },
      { season: 2027, round: 2, original_roster_id: '1', current_owner_roster_id: '4', previous_owner_roster_id: '12' },
      { season: 2028, round: 1, original_roster_id: '7', current_owner_roster_id: '4', previous_owner_roster_id: '7' },
      { season: 2028, round: 4, original_roster_id: '12', current_owner_roster_id: '9', previous_owner_roster_id: '12' },
      { season: 2026, round: 3, original_roster_id: '5', current_owner_roster_id: '12' }, // no prev
    ]
    const result = await invokePersist('lea-abc', picks)
    expect(result).toEqual({ written: 6, skipped: 0 })
    expect(mocks.futureDraftPickUpsert).toHaveBeenCalledTimes(6)
  })
})

describe('persistTradedPicks — update path (dedup on re-import)', () => {
  it('re-import with same composite key + new ownership issues a Prisma upsert that would update currentOwnerId', async () => {
    // First import
    await invokePersist('lea-abc', [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
    ])

    // Re-import: same season/round/original, but ownership moved to roster 3
    await invokePersist('lea-abc', [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '3' },
    ])

    expect(mocks.futureDraftPickUpsert).toHaveBeenCalledTimes(2)

    // Both calls use the SAME `where` composite → Prisma treats them as the same
    // row; the second call's `update` is what would land in the DB.
    const secondCall = mocks.futureDraftPickUpsert.mock.calls[1][0]
    expect(secondCall.where.leagueId_pickSeason_round_originalRosterId).toEqual({
      leagueId: 'lea-abc',
      pickSeason: 2026,
      round: 1,
      originalRosterId: '1',
    })
    expect(secondCall.update).toEqual({
      currentOwnerId: '3',
      traded: true,
    })
  })

  it('two identical re-imports produce identical write intent (idempotent)', async () => {
    const pick = { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' }

    const r1 = await invokePersist('lea-abc', [pick])
    const r2 = await invokePersist('lea-abc', [pick])

    expect(r1).toEqual({ written: 1, skipped: 0 })
    expect(r2).toEqual({ written: 1, skipped: 0 })
    // Both calls hit the same composite `where` → guaranteed no duplicate rows.
    const w1 = mocks.futureDraftPickUpsert.mock.calls[0][0].where
    const w2 = mocks.futureDraftPickUpsert.mock.calls[1][0].where
    expect(w1).toEqual(w2)
  })
})

describe('persistTradedPicks — defensive behavior', () => {
  it('returns { written: 0, skipped: 0 } and skips DB entirely for []', async () => {
    const result = await invokePersist('lea-abc', [])
    expect(result).toEqual({ written: 0, skipped: 0 })
    expect(mocks.futureDraftPickUpsert).not.toHaveBeenCalled()
  })

  it('handles undefined input safely', async () => {
    const result = await invokePersist('lea-abc', undefined as unknown as never)
    expect(result).toEqual({ written: 0, skipped: 0 })
    expect(mocks.futureDraftPickUpsert).not.toHaveBeenCalled()
  })

  it('skips a malformed row without stopping the loop', async () => {
    const picks = [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
      { season: 2026, round: 2, original_roster_id: '1' } as unknown, // missing current_owner_roster_id
      { season: 2027, round: 1, original_roster_id: '5', current_owner_roster_id: '9' },
    ]
    const result = await invokePersist('lea-abc', picks as never[])
    expect(result.written).toBe(2)
    expect(result.skipped).toBe(1)
    expect(mocks.futureDraftPickUpsert).toHaveBeenCalledTimes(2)
  })

  it('continues past a Prisma error on one row', async () => {
    mocks.futureDraftPickUpsert
      .mockResolvedValueOnce({ id: 'ok-1' })
      .mockRejectedValueOnce(new Error('unique constraint under race'))
      .mockResolvedValueOnce({ id: 'ok-3' })

    const picks = [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
      { season: 2026, round: 2, original_roster_id: '1', current_owner_roster_id: '11' },
      { season: 2027, round: 2, original_roster_id: '1', current_owner_roster_id: '4' },
    ]
    const result = await invokePersist('lea-abc', picks)
    expect(result.written).toBe(2)
    expect(result.skipped).toBe(1)
  })
})

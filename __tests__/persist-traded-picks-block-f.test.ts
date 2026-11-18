import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: mocks.executeRaw,
  },
}))

async function invokePersist(
  ...args: Parameters<typeof import('@/lib/league-import/ImportedLeagueCommitService').persistTradedPicks>
) {
  const { persistTradedPicks } = await import('@/lib/league-import/ImportedLeagueCommitService')
  return persistTradedPicks(...args)
}

function boundValues(callIndex = 0): unknown[] {
  const joinedSql = mocks.executeRaw.mock.calls[callIndex]?.[1] as { values?: unknown[] } | undefined
  return joinedSql?.values ?? []
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.executeRaw.mockResolvedValue(1)
})

describe('persistTradedPicks — bulk persistence', () => {
  it('writes a full provider response in one parameterized upsert', async () => {
    const picks = [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7', previous_owner_roster_id: '4' },
      { season: 2026, round: 2, original_roster_id: '1', current_owner_roster_id: '11', previous_owner_roster_id: '12' },
      { season: 2027, round: 2, original_roster_id: '1', current_owner_roster_id: '4', previous_owner_roster_id: '12' },
      { season: 2028, round: 1, original_roster_id: '7', current_owner_roster_id: '4', previous_owner_roster_id: '7' },
      { season: 2028, round: 4, original_roster_id: '12', current_owner_roster_id: '9', previous_owner_roster_id: '12' },
      { season: 2026, round: 3, original_roster_id: '5', current_owner_roster_id: '12' },
    ]

    await expect(invokePersist('lea-abc', picks)).resolves.toEqual({ written: 6, skipped: 0 })
    expect(mocks.executeRaw).toHaveBeenCalledOnce()

    const sql = (mocks.executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
    expect(sql).toContain('INSERT INTO "future_draft_picks"')
    expect(sql).toContain('ON CONFLICT ("leagueId", "pickSeason", "round", "originalRosterId")')
    expect(boundValues()).toEqual(expect.arrayContaining(['lea-abc', 2026, 2028, '1', '7', '12']))
  })

  it('stores a pick as traded unless the provider says it has not moved, and lets a later import correct it', async () => {
    await invokePersist('lea-abc', [
      { season: 2027, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
      { season: 2027, round: 1, original_roster_id: '2', current_owner_roster_id: '2', traded: false },
    ])
    // Sleeper and MFL rows carry no flag and stay traded; a Fantrax own pick is stored as not traded.
    expect(boundValues().filter((v) => typeof v === 'boolean')).toEqual([true, false])
    const sql = (mocks.executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
    expect(sql).toContain('"traded" = EXCLUDED."traded"')
  })

  it('keeps the last owner for a duplicate key while preserving processed-input counts', async () => {
    const result = await invokePersist('lea-abc', [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '3' },
    ])

    expect(result).toEqual({ written: 2, skipped: 0 })
    expect(mocks.executeRaw).toHaveBeenCalledOnce()
    expect(boundValues()).toContain('3')
    expect(boundValues()).not.toContain('7')
  })

  it('splits a failed batch so one bad row does not lose the others', async () => {
    mocks.executeRaw
      .mockRejectedValueOnce(new Error('batch failed'))
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('bad row'))

    const result = await invokePersist('lea-abc', [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
      { season: 2026, round: 2, original_roster_id: '1', current_owner_roster_id: '11' },
    ])

    expect(result).toEqual({ written: 1, skipped: 1 })
    expect(mocks.executeRaw).toHaveBeenCalledTimes(3)
  })

  it('skips malformed rows before touching the database', async () => {
    const result = await invokePersist('lea-abc', [
      { season: 2026, round: 1, original_roster_id: '1', current_owner_roster_id: '7' },
      { season: 2026, round: 2, original_roster_id: '1' } as never,
      { season: 2027, round: 1, original_roster_id: '5', current_owner_roster_id: '9' },
    ])

    expect(result).toEqual({ written: 2, skipped: 1 })
    expect(mocks.executeRaw).toHaveBeenCalledOnce()
  })

  it('returns an empty result without a database call', async () => {
    await expect(invokePersist('lea-abc', [])).resolves.toEqual({ written: 0, skipped: 0 })
    await expect(invokePersist('lea-abc', undefined as never)).resolves.toEqual({ written: 0, skipped: 0 })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })
})

async function invokeClear(
  ...args: Parameters<typeof import('@/lib/league-import/ImportedLeagueCommitService').clearReturnedTradedPicks>
) {
  const { clearReturnedTradedPicks } = await import('@/lib/league-import/ImportedLeagueCommitService')
  return clearReturnedTradedPicks(...args)
}

/**
 * 🛑 THE TRADED-BACK CASE. A pick traded A -> B and later B -> A drops out of the
 * provider's traded list, and nothing removed its stored row — so it kept showing
 * B as the holder forever.
 */
describe('clearReturnedTradedPicks — a pick that came home', () => {
  it('deletes only rows the provider named, and only provider-written traded ones', async () => {
    mocks.executeRaw.mockResolvedValue(2)
    const result = await invokeClear('lea-abc', [
      { season: 2027, round: 1, original_roster_id: '18' },
      { season: 2028, round: 4, original_roster_id: '27' },
    ])

    expect(result).toEqual({ cleared: 2, skipped: 0 })
    expect(mocks.executeRaw).toHaveBeenCalledOnce()
    const sql = (mocks.executeRaw.mock.calls[0][0] as TemplateStringsArray).join(' ')
    expect(sql).toContain('DELETE FROM "future_draft_picks"')
    /* Every guard is load-bearing: drop one and the delete widens. */
    expect(sql).toContain('f."leagueId" =')
    expect(sql).toContain('f."traded" = TRUE')
    expect(sql).toContain('f."currentOwnerId" <> f."originalRosterId"')
    expect(sql).toContain('f."sourceTradeId" IS NULL')
    expect(sql).toContain(`f."status" = 'active'`)
    expect(mocks.executeRaw.mock.calls[0]).toContain('lea-abc')
    expect(boundValues()).toEqual([2027, 1, '18', 2028, 4, '27'])
  })

  it('does nothing at all for an empty or missing list', async () => {
    await expect(invokeClear('lea-abc', [])).resolves.toEqual({ cleared: 0, skipped: 0 })
    await expect(invokeClear('lea-abc', undefined as never)).resolves.toEqual({ cleared: 0, skipped: 0 })
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it('skips a malformed pick rather than widening the delete', async () => {
    mocks.executeRaw.mockResolvedValue(1)
    const result = await invokeClear('lea-abc', [
      { season: 2027, round: 1, original_roster_id: '18' },
      { season: 2027, round: 1, original_roster_id: '' },
      { season: Number.NaN, round: 1, original_roster_id: '5' },
      null as never,
    ])
    expect(result).toEqual({ cleared: 1, skipped: 3 })
    expect(boundValues()).toEqual([2027, 1, '18'])
  })

  it('names each pick once and batches a large league', async () => {
    mocks.executeRaw.mockResolvedValue(0)
    const picks = Array.from({ length: 1351 }, (_, i) => ({
      season: 2027 + (i % 10), round: 1 + (i % 4), original_roster_id: String(Math.floor(i / 40)),
    }))
    const unique = new Set(picks.map((p) => `${p.season}|${p.round}|${p.original_roster_id}`)).size
    await invokeClear('lea-abc', [...picks, picks[0]!])
    const bound = mocks.executeRaw.mock.calls.reduce((sum, _call, i) => sum + boundValues(i).length, 0)
    expect(bound).toBe(unique * 3)
    expect(mocks.executeRaw.mock.calls.length).toBe(Math.ceil(unique / 500))
  })
})

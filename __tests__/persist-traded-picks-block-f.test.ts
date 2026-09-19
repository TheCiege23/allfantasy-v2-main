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

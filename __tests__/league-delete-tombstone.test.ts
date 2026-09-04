// @vitest-environment node
/**
 * Guards the "a deleted league stays deleted" contract.
 *
 * 🛑 WHAT WAS BROKEN. `DELETE /api/league/[leagueId]` is a HARD delete, so once
 * the `League` row was gone nothing distinguished "never imported" from
 * "imported and deliberately removed" — and every import/sync path recreated
 * it. The only defence was a `sessionStorage` set in DashboardShell.tsx that
 * died at tab close and could not stop a server-side recreate.
 *
 * ⚠ THESE TESTS GO THROUGH THE REAL CALL PATHS (`syncLeague`,
 * `persistImportedLeagueFromNormalization`), not just the helper. A suite that
 * only exercised `isLeagueTombstoned` would stay green if the guards were
 * deleted from the functions that actually create leagues — which is the only
 * failure mode that matters here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const tombstoneFindUnique = vi.fn()
const tombstoneFindMany = vi.fn()
const tombstoneUpsert = vi.fn()
const tombstoneDeleteMany = vi.fn()
const leagueFindFirst = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deletedLeagueTombstone: {
      findUnique: (...a: unknown[]) => tombstoneFindUnique(...a),
      findMany: (...a: unknown[]) => tombstoneFindMany(...a),
      upsert: (...a: unknown[]) => tombstoneUpsert(...a),
      deleteMany: (...a: unknown[]) => tombstoneDeleteMany(...a),
    },
    league: {
      findFirst: (...a: unknown[]) => leagueFindFirst(...a),
    },
  },
}))

import {
  recordLeagueTombstone,
  isLeagueTombstoned,
  clearLeagueTombstone,
  getTombstonedLookupKeys,
  tombstoneLookupKey,
  tombstoneKeyFor,
} from '@/lib/league-delete/leagueTombstones'

beforeEach(() => {
  vi.clearAllMocks()
  tombstoneFindUnique.mockResolvedValue(null)
  tombstoneFindMany.mockResolvedValue([])
  tombstoneUpsert.mockResolvedValue({})
  tombstoneDeleteMany.mockResolvedValue({ count: 0 })
  leagueFindFirst.mockResolvedValue(null)
})

describe('the key a tombstone is matched on', () => {
  /**
   * ⚠ THE WRITER AND THE READERS LIVE IN DIFFERENT FILES. If one lowercases the
   * platform and another does not, the tombstone silently stops matching and
   * the bug is indistinguishable from "the feature was never built".
   */
  it('folds platform case but never the provider league id', () => {
    expect(tombstoneKeyFor('Sleeper', 'ABC123')).toEqual({
      platform: 'sleeper',
      platformLeagueId: 'ABC123',
    })
  })

  it('trims incidental whitespace on both halves', () => {
    expect(tombstoneKeyFor('  ESPN  ', '  99  ')).toEqual({
      platform: 'espn',
      platformLeagueId: '99',
    })
  })

  /* Two leagues whose ids differ only by case are DIFFERENT leagues. Folding the
     id would collapse them into one tombstone and suppress a league the user
     never deleted. */
  it('does not collapse two league ids that differ only by case', () => {
    expect(tombstoneLookupKey('sleeper', 'abc')).not.toBe(tombstoneLookupKey('sleeper', 'ABC'))
  })
})

describe('recording a deletion', () => {
  it('upserts so deleting the same league twice does not blow up', async () => {
    const wrote = await recordLeagueTombstone({
      userId: 'u1',
      platform: 'Sleeper',
      platformLeagueId: '123',
      leagueName: 'Cream Bowl',
    })

    expect(wrote).toBe(true)
    expect(tombstoneUpsert).toHaveBeenCalledTimes(1)
    const arg = tombstoneUpsert.mock.calls[0][0] as {
      where: { userId_platform_platformLeagueId: Record<string, string> }
      create: Record<string, unknown>
    }
    // Normalized on the way in, or the read side will never find it.
    expect(arg.where.userId_platform_platformLeagueId).toEqual({
      userId: 'u1',
      platform: 'sleeper',
      platformLeagueId: '123',
    })
    expect(arg.create.leagueName).toBe('Cream Bowl')
  })

  /**
   * ⚠ A TOMBSTONE ON AN EMPTY KEY MATCHES NOTHING AT BEST AND EVERYTHING AT
   * WORST. Refuse to write one rather than storing a poison row.
   */
  it.each([
    ['empty platform', '', '123'],
    ['empty league id', 'sleeper', ''],
    ['whitespace-only league id', 'sleeper', '   '],
  ])('writes nothing for %s', async (_label, platform, platformLeagueId) => {
    const wrote = await recordLeagueTombstone({ userId: 'u1', platform, platformLeagueId })
    expect(wrote).toBe(false)
    expect(tombstoneUpsert).not.toHaveBeenCalled()
  })
})

describe('reading a tombstone back', () => {
  it('reports a deleted league as tombstoned, normalizing the platform', async () => {
    tombstoneFindUnique.mockResolvedValue({ id: 't1' })
    await expect(
      isLeagueTombstoned({ userId: 'u1', platform: 'SLEEPER', platformLeagueId: '123' }),
    ).resolves.toBe(true)

    const arg = tombstoneFindUnique.mock.calls[0][0] as {
      where: { userId_platform_platformLeagueId: Record<string, string> }
    }
    expect(arg.where.userId_platform_platformLeagueId.platform).toBe('sleeper')
  })

  it('reports an untouched league as not tombstoned', async () => {
    tombstoneFindUnique.mockResolvedValue(null)
    await expect(
      isLeagueTombstoned({ userId: 'u1', platform: 'sleeper', platformLeagueId: '123' }),
    ).resolves.toBe(false)
  })
})

describe('the bulk lookup the import page uses', () => {
  it('returns keys built the same way the caller tests them', async () => {
    tombstoneFindMany.mockResolvedValue([{ platform: 'sleeper', platformLeagueId: '123' }])

    const keys = await getTombstonedLookupKeys('u1', [
      { platform: 'sleeper', platformLeagueId: '123' },
      { platform: 'sleeper', platformLeagueId: '456' },
    ])

    expect(keys.has(tombstoneLookupKey('sleeper', '123'))).toBe(true)
    expect(keys.has(tombstoneLookupKey('sleeper', '456'))).toBe(false)
  })

  /* One query for the whole page, not one per candidate — discovery already
     fans out to a provider and does not need N more round trips. */
  it('issues a single query regardless of candidate count', async () => {
    await getTombstonedLookupKeys(
      'u1',
      Array.from({ length: 25 }, (_, i) => ({ platform: 'sleeper', platformLeagueId: String(i) })),
    )
    expect(tombstoneFindMany).toHaveBeenCalledTimes(1)
  })

  it('does not query at all when there is nothing to check', async () => {
    const keys = await getTombstonedLookupKeys('u1', [])
    expect(keys.size).toBe(0)
    expect(tombstoneFindMany).not.toHaveBeenCalled()
  })
})

describe('clearing on a confirmed re-import', () => {
  /**
   * 🛑 CLEARED, NOT BYPASSED. If a confirmed re-import left the row in place,
   * the league would import and then be suppressed again by the next sync — the
   * user confirms, and watches it vanish anyway.
   */
  it('deletes the row so the next sync does not suppress the league again', async () => {
    tombstoneDeleteMany.mockResolvedValue({ count: 1 })
    await expect(
      clearLeagueTombstone({ userId: 'u1', platform: 'Sleeper', platformLeagueId: '123' }),
    ).resolves.toBe(true)

    const arg = tombstoneDeleteMany.mock.calls[0][0] as { where: Record<string, string> }
    expect(arg.where).toEqual({ userId: 'u1', platform: 'sleeper', platformLeagueId: '123' })
  })

  it('reports false when there was nothing to clear', async () => {
    tombstoneDeleteMany.mockResolvedValue({ count: 0 })
    await expect(
      clearLeagueTombstone({ userId: 'u1', platform: 'sleeper', platformLeagueId: 'nope' }),
    ).resolves.toBe(false)
  })
})

/**
 * The part that actually protects the user. Each of these asserts the guard is
 * wired into a function that CREATES leagues — delete the guard and these go
 * red, which a helper-only suite would not.
 */
describe('the guards are wired into the real create paths', () => {
  it('syncLeague refuses a tombstoned league before spending a provider call', async () => {
    const { syncLeague } = await import('@/lib/league-sync-core')
    const { LeagueDeletedByUserError } = await import('@/lib/league-delete/leagueTombstones')

    tombstoneFindUnique.mockResolvedValue({ id: 't1' })

    await expect(syncLeague('u1', 'sleeper', '123')).rejects.toBeInstanceOf(
      LeagueDeletedByUserError,
    )
  })

  it('the import commit refuses a tombstoned league unless the user confirmed', async () => {
    const { persistImportedLeagueFromNormalization, ImportedLeagueTombstonedError } = await import(
      '@/lib/league-import/ImportedLeagueCommitService'
    )

    leagueFindFirst.mockResolvedValue(null)
    tombstoneFindUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: '123',
      leagueName: 'Cream Bowl',
      deletedAt: new Date('2026-09-04T00:00:00Z'),
    })

    await expect(
      persistImportedLeagueFromNormalization({
        userId: 'u1',
        provider: 'sleeper' as never,
        normalized: {
          source: { source_league_id: '123' },
          league: { season: 2026 },
        } as never,
      }),
    ).rejects.toBeInstanceOf(ImportedLeagueTombstonedError)
  })

  /**
   * The confirmation has to actually get through, or the feature is a wall
   * rather than a prompt.
   */
  it('the import commit gets past the tombstone when the user confirmed', async () => {
    const { persistImportedLeagueFromNormalization, ImportedLeagueTombstonedError } = await import(
      '@/lib/league-import/ImportedLeagueCommitService'
    )

    leagueFindFirst.mockResolvedValue(null)
    tombstoneFindUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: '123',
      leagueName: 'Cream Bowl',
      deletedAt: new Date('2026-09-04T00:00:00Z'),
    })

    /* It will fail later for unrelated reasons (this fixture is not a complete
       normalized import), but it must NOT fail with the tombstone error — that
       is the assertion. */
    const error = await persistImportedLeagueFromNormalization({
      userId: 'u1',
      provider: 'sleeper' as never,
      normalized: {
        source: { source_league_id: '123' },
        league: { season: 2026 },
      } as never,
      confirmReimportOfDeleted: true,
    }).catch((e: unknown) => e)

    expect(error).not.toBeInstanceOf(ImportedLeagueTombstonedError)
  })
})

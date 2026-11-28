// @vitest-environment node
/**
 * Step 5 of docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md: a provider league switched to AllFantasy in place is
 * never imported or re-synced again beside itself. Modelled on league-delete-tombstone.test.ts: each guard is asserted
 * inside a function that CREATES leagues, so deleting the guard turns a test red — a helper-only suite would not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const conversionFindFirst = vi.fn()
const tombstoneFindUnique = vi.fn()
const leagueFindFirst = vi.fn()
const leagueUpsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueNativeConversion: { findFirst: (...a: unknown[]) => conversionFindFirst(...a) },
    deletedLeagueTombstone: { findUnique: (...a: unknown[]) => tombstoneFindUnique(...a) },
    league: {
      findFirst: (...a: unknown[]) => leagueFindFirst(...a),
      findUnique: vi.fn(async () => null),
      upsert: (...a: unknown[]) => leagueUpsert(...a),
    },
  },
}))

import { ConvertedLeagueError, findConvertedLeague } from '@/lib/league/nativeConversionLookup'

const CONVERTED = { leagueId: 'native-league', league: { name: 'Cream Bowl' } }

beforeEach(() => {
  vi.clearAllMocks()
  conversionFindFirst.mockResolvedValue(null)
  tombstoneFindUnique.mockResolvedValue(null)
  leagueFindFirst.mockResolvedValue(null)
  leagueUpsert.mockResolvedValue({ id: 'should-not-be-written' })
})

describe('findConvertedLeague', () => {
  it('looks up an applied conversion by provider (any case) and any of the ids given, de-duplicated', async () => {
    conversionFindFirst.mockResolvedValue(CONVERTED)
    expect(await findConvertedLeague({ platform: 'Sleeper', platformLeagueIds: ['123', ' 123 ', '99', null, ''] }))
      .toEqual({ leagueId: 'native-league', leagueName: 'Cream Bowl' })
    expect(conversionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { fromPlatform: { equals: 'Sleeper', mode: 'insensitive' }, fromPlatformLeagueId: { in: ['123', '99'] }, status: 'applied' },
    }))
  })

  it('does not query with nothing to look up', async () => {
    expect(await findConvertedLeague({ platform: 'sleeper', platformLeagueIds: [null, ' '] })).toBeNull()
    expect(conversionFindFirst).not.toHaveBeenCalled()
  })

  it('fails open: a lookup that errors answers "not converted", so one hiccup cannot block every import', async () => {
    conversionFindFirst.mockRejectedValue(new Error('relation does not exist'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await findConvertedLeague({ platform: 'sleeper', platformLeagueIds: ['123'] })).toBeNull()
  })
})

describe('the guard is wired into every path that writes an imported league', () => {
  it('the legacy re-sync refuses before spending a provider call', async () => {
    const { syncLeague } = await import('@/lib/league-sync-core')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    conversionFindFirst.mockResolvedValue(CONVERTED)
    await expect(syncLeague('u1', 'sleeper', '123')).rejects.toBeInstanceOf(ConvertedLeagueError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the Sleeper re-sync refuses before fetching from Sleeper', async () => {
    const { syncSleeperLeague } = await import('@/lib/sleeper-sync')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    conversionFindFirst.mockResolvedValue(CONVERTED)
    await expect(syncSleeperLeague('123', 'u1')).rejects.toThrow('This league now runs on AllFantasy as "Cream Bowl"')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('the import commit refuses the league itself, as a conflict every import route already answers with a 409', async () => {
    const { persistImportedLeagueFromNormalization, ImportedLeagueConvertedError, ImportedLeagueConflictError } = await import('@/lib/league-import/ImportedLeagueCommitService')
    conversionFindFirst.mockResolvedValue(CONVERTED)
    const error = await persistImportedLeagueFromNormalization({
      userId: 'u1', provider: 'sleeper' as never,
      normalized: { source: { source_league_id: '123' }, league: { season: 2026 } } as never,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ImportedLeagueConvertedError)
    expect(error).toBeInstanceOf(ImportedLeagueConflictError)
    expect((error as { leagueId: string }).leagueId).toBe('native-league')
  })

  it("the import commit refuses NEXT season's Sleeper league, whose history names the switched one", async () => {
    const { persistImportedLeagueFromNormalization, ImportedLeagueConvertedError } = await import('@/lib/league-import/ImportedLeagueCommitService')
    conversionFindFirst.mockImplementation(async ({ where }: { where: { fromPlatformLeagueId: { in: string[] } } }) =>
      where.fromPlatformLeagueId.in.includes('old-2026') ? CONVERTED : null)
    const error = await persistImportedLeagueFromNormalization({
      userId: 'u1', provider: 'sleeper' as never,
      normalized: { source: { source_league_id: 'new-2027' }, league: { season: 2027 }, previous_seasons: [{ season: '2026', source_league_id: 'old-2026' }] } as never,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ImportedLeagueConvertedError)
  })

  it('positive control: with no conversion on record the commit gets past the guard', async () => {
    const { persistImportedLeagueFromNormalization, ImportedLeagueConvertedError } = await import('@/lib/league-import/ImportedLeagueCommitService')
    // It fails later for unrelated reasons (this is not a complete normalized import); it must not fail with this error.
    const error = await persistImportedLeagueFromNormalization({
      userId: 'u1', provider: 'sleeper' as never,
      normalized: { source: { source_league_id: '123' }, league: { season: 2026 } } as never,
    }).catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(ImportedLeagueConvertedError)
  })

  it('the Sleeper bulk import skips the league and writes nothing', async () => {
    const { upsertSleeperLeagueMetadataOnly } = await import('@/lib/league/sleeper-import-process')
    conversionFindFirst.mockResolvedValue(CONVERTED)
    expect(await upsertSleeperLeagueMetadataOnly({ league_id: '123', name: 'Cream Bowl' } as never, 'u1', 2026, 'NFL' as never)).toBeNull()
    expect(leagueUpsert).not.toHaveBeenCalled()
  })
})

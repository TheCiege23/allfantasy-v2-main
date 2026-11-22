import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * A provider-proven commissioner with no team joins an already-imported league as co-commissioner.
 *
 * Measured 2026-11-17: the KBI commissioner had a team in 1 of 29 conference leagues, so
 * `claimExistingLeagueForMember` (team claims only) could not join them anywhere else, and each
 * import created a second copy — 28 duplicates of leagues already drafting on another copy.
 */

const h = vi.hoisted(() => ({
  prisma: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(h.prisma)),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/rank/calculateRank', () => ({ calculateAndSaveRank: vi.fn(async () => null) }))

import { joinExistingLeagueAsCoCommissioner } from '@/lib/league-import/ImportedLeagueCommitService'
import { IMPORT_CO_COMMISSIONERS_KEY, isTournamentCoCommissioner } from '@/lib/league/tournamentCoCommissioners'

const ARGS = { userId: 'af-commish', provider: 'sleeper' as const, platformLeagueId: '1338541041204076544', seasonYear: 2026 }
const OTHER = { id: 'league-live', name: 'KBI North Black', sport: 'NFL' }

beforeEach(() => {
  vi.clearAllMocks()
  h.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma))
})

describe('joinExistingLeagueAsCoCommissioner', () => {
  it('records the commissioner on the existing copy instead of creating a new one', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER)
    h.prisma.league.findUnique.mockResolvedValue({ settings: { tournamentCoCommissionerIds: ['t-1'], other: 1 } })

    const result = await joinExistingLeagueAsCoCommissioner(ARGS)

    expect(result?.league.id).toBe('league-live')
    expect(result?.joinedExisting).toBe(true)
    expect(result?.existed).toBe(false)
    // Oldest copy, never another account's arbitrary pick, and never the caller's own copy.
    expect(h.prisma.league.findFirst.mock.calls[0]![0]).toMatchObject({
      where: { userId: { not: 'af-commish' }, platform: 'sleeper', platformLeagueId: ARGS.platformLeagueId, season: 2026 },
      orderBy: { createdAt: 'asc' },
    })
    const written = (h.prisma.league.update.mock.calls[0]![0] as { data: { settings: Record<string, unknown> } }).data.settings
    // Written to the import key, leaving the tournament list (which the tournament sync owns) alone.
    expect(written[IMPORT_CO_COMMISSIONERS_KEY]).toEqual(['af-commish'])
    expect(written.tournamentCoCommissionerIds).toEqual(['t-1'])
    expect(written.other).toBe(1)
    expect(isTournamentCoCommissioner(written, 'af-commish')).toBe(true)
  })

  it('a second import by the same commissioner is a no-op, not a second grant', async () => {
    h.prisma.league.findFirst.mockResolvedValue(OTHER)
    h.prisma.league.findUnique.mockResolvedValue({ settings: { [IMPORT_CO_COMMISSIONERS_KEY]: ['af-commish'] } })
    const result = await joinExistingLeagueAsCoCommissioner(ARGS)
    expect(result?.existed).toBe(true)
    expect(h.prisma.league.update).not.toHaveBeenCalled()
  })

  it('with no other copy it answers null, so the import creates the league as before', async () => {
    h.prisma.league.findFirst.mockResolvedValue(null)
    expect(await joinExistingLeagueAsCoCommissioner(ARGS)).toBeNull()
  })
})

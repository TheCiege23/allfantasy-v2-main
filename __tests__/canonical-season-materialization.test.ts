/**
 * ESPN Commissioner Import Certification & Canonical Import Lifecycle phase.
 *
 * `materializeRedraftSeasonForImportedLeague` is the provider-agnostic
 * canonical-lifecycle-completion step: it reads only `League`/`LeagueTeam`
 * (already-canonical, provider-neutral tables every import commit writes to)
 * and creates a real `RedraftSeason`/`RedraftRoster` set, so Trade Decision
 * OS and other RedraftSeason-scoped consumers work for any provider without
 * provider-specific logic. Physically re-verified against a real disposable
 * database with real Sleeper and ESPN data — see
 * `docs/redraft/CANONICAL_IMPORT_LIFECYCLE.md`. This is the source-level
 * regression guard for that behavior.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { leagueFindUnique, seasonFindUnique, seasonCreate, rosterCount, teamFindMany, rosterCreate } = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  seasonFindUnique: vi.fn(),
  seasonCreate: vi.fn(),
  rosterCount: vi.fn(),
  teamFindMany: vi.fn(),
  rosterCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    redraftSeason: { findUnique: seasonFindUnique, create: seasonCreate },
    redraftRoster: { count: rosterCount, create: rosterCreate },
    leagueTeam: { findMany: teamFindMany },
  },
}))

function team(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1',
    ownerName: 'Owner One',
    teamName: 'Team One',
    avatarUrl: null,
    platformUserId: 'provider-user-1',
    wins: 8,
    losses: 5,
    ties: 0,
    pointsFor: 1200,
    currentRank: 1,
    ...overrides,
  }
}

describe('materializeRedraftSeasonForImportedLeague', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is provider-agnostic — reads only League/LeagueTeam, never a provider-specific payload', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', season: 2026, status: 'complete', playoffStartWeek: 15 })
    seasonFindUnique.mockResolvedValue(null)
    teamFindMany.mockResolvedValue([team()])
    seasonCreate.mockResolvedValue({ id: 'season-1' })
    rosterCreate.mockResolvedValue({ id: 'roster-1' })

    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    const result = await materializeRedraftSeasonForImportedLeague('league-1')

    expect(result).toEqual({ seasonId: 'season-1', created: true, rosterCount: 1 })
    expect(seasonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ leagueId: 'league-1', sport: 'NFL', season: 2026, status: 'complete' }) }),
    )
  })

  it('is idempotent — a second call for the same league/season returns the existing season, no duplicate create', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', season: 2026, status: 'complete', playoffStartWeek: 15 })
    seasonFindUnique.mockResolvedValue({ id: 'existing-season' })
    rosterCount.mockResolvedValue(12)

    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    const result = await materializeRedraftSeasonForImportedLeague('league-1')

    expect(result).toEqual({ seasonId: 'existing-season', created: false, rosterCount: 12 })
    expect(seasonCreate).not.toHaveBeenCalled()
  })

  it('skips unsupported sports rather than creating a malformed season', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'league-1', sport: 'MLB', season: 2026, status: 'complete', playoffStartWeek: 15 })

    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    const result = await materializeRedraftSeasonForImportedLeague('league-1')

    expect(result.skippedReason).toBe('UNSUPPORTED_SPORT')
    expect(seasonCreate).not.toHaveBeenCalled()
  })

  it('skips when the league has no teams yet rather than creating an empty season', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', season: 2026, status: 'complete', playoffStartWeek: 15 })
    seasonFindUnique.mockResolvedValue(null)
    teamFindMany.mockResolvedValue([])

    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    const result = await materializeRedraftSeasonForImportedLeague('league-1')

    expect(result.skippedReason).toBe('NO_TEAMS')
    expect(seasonCreate).not.toHaveBeenCalled()
  })

  it('maps an in-progress League.status to an in-progress season, never fabricating "complete"', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', season: 2026, status: 'in_season', playoffStartWeek: 15 })
    seasonFindUnique.mockResolvedValue(null)
    teamFindMany.mockResolvedValue([team()])
    seasonCreate.mockResolvedValue({ id: 'season-1' })
    rosterCreate.mockResolvedValue({ id: 'roster-1' })

    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    await materializeRedraftSeasonForImportedLeague('league-1')

    expect(seasonCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'in_season', currentWeek: 1 }) }),
    )
  })

  it('never fabricates a real AppUser ownerId — falls back to the LeagueTeam id for unclaimed/orphaned teams', async () => {
    leagueFindUnique.mockResolvedValue({ id: 'league-1', sport: 'NFL', season: 2026, status: 'complete', playoffStartWeek: 15 })
    seasonFindUnique.mockResolvedValue(null)
    teamFindMany.mockResolvedValue([team({ id: 'orphan-team-1', platformUserId: null })])
    seasonCreate.mockResolvedValue({ id: 'season-1' })
    rosterCreate.mockResolvedValue({ id: 'roster-1' })

    const { materializeRedraftSeasonForImportedLeague } = await import('@/lib/league-import/canonicalSeasonMaterialization')
    await materializeRedraftSeasonForImportedLeague('league-1')

    expect(rosterCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerId: 'orphan-team-1' }) }),
    )
  })
})

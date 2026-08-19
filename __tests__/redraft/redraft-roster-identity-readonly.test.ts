import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resolveRedraftRosterLookup,
  resolveRedraftRosterLookupReadOnly,
} from '@/lib/redraft/redraftRosterIdentity'

/**
 * Phase B.1 — proves the read-only identity resolver is genuinely write-free and that the legacy
 * write-capable resolver preserves its owner-repair behavior. Both share one read-only resolution
 * core, so when no repair is warranted they return byte-identical results.
 */
const mocks = vi.hoisted(() => ({
  redraftSeasonFindFirst: vi.fn(),
  redraftRosterFindFirst: vi.fn(),
  redraftRosterUpdate: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: mocks.redraftSeasonFindFirst },
    redraftRoster: { findFirst: mocks.redraftRosterFindFirst, update: mocks.redraftRosterUpdate },
    roster: { findFirst: mocks.rosterFindFirst },
    leagueTeam: { findFirst: mocks.leagueTeamFindFirst },
  },
}))

const seasonRow = { id: 'season-1', leagueId: 'lg-1' }
const viewerTeamRow = {
  id: 'team-1',
  leagueId: 'lg-1',
  externalId: 'ext-1',
  ownerName: 'Real Owner',
  teamName: 'Real Team',
  avatarUrl: 'http://avatar/1',
  claimedByUserId: 'user-1',
  platformUserId: 'sleeper-1',
}
const viewerGenericRosterRow = { id: 'gen-1', leagueId: 'lg-1', platformUserId: 'sleeper-1' }

/**
 * Configure the viewer-resolution path (no requestedRosterId / seasonId). `ownerId` controls whether
 * a repair is warranted: a `roster:gen-1` value differs from the preferred `user-1` (repairable),
 * while `user-1` is already canonical (no-op).
 */
function configureViewerScenario(ownerId: string) {
  const viewerRosterRow = {
    id: 'rr-1',
    seasonId: 'season-1',
    leagueId: 'lg-1',
    ownerId,
    ownerName: 'Stale Name',
    teamName: 'Stale Team',
    avatarUrl: null,
  }
  const updatedRosterRow = {
    id: 'rr-1',
    seasonId: 'season-1',
    leagueId: 'lg-1',
    ownerId: 'user-1',
    ownerName: viewerTeamRow.ownerName,
    teamName: viewerTeamRow.teamName,
    avatarUrl: viewerTeamRow.avatarUrl,
  }

  mocks.redraftSeasonFindFirst.mockResolvedValue(seasonRow)
  mocks.leagueTeamFindFirst.mockResolvedValue(viewerTeamRow)
  mocks.rosterFindFirst.mockResolvedValue(viewerGenericRosterRow)
  mocks.redraftRosterFindFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
    if (where?.NOT) return null // owner-repair conflict check → no conflict
    if (typeof where?.id === 'string') return null // exact-roster lookup (unused here)
    return viewerRosterRow // candidate lookup
  })
  mocks.redraftRosterUpdate.mockResolvedValue(updatedRosterRow)

  return { viewerRosterRow, updatedRosterRow }
}

describe('Phase B.1 — read-only identity resolver extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('(1) read-only resolver returns the resolved roster as-stored (no repair)', async () => {
    const { viewerRosterRow } = configureViewerScenario('roster:gen-1')

    const result = await resolveRedraftRosterLookupReadOnly({ userId: 'user-1', leagueId: 'lg-1' })

    expect(result.roster).toEqual(viewerRosterRow)
    expect(result.roster?.ownerId).toBe('roster:gen-1') // un-repaired
    expect(result.resolvedBy).toBe('viewer_owner_candidates')
    expect(result.repairedOwnerId).toBeNull()
    expect(result.season).toEqual(seasonRow)
  })

  it('(2) read-only resolver NEVER calls redraftRoster.update (no write, no owner repair)', async () => {
    configureViewerScenario('roster:gen-1') // repair WOULD be warranted

    await resolveRedraftRosterLookupReadOnly({ userId: 'user-1', leagueId: 'lg-1' })

    expect(mocks.redraftRosterUpdate).not.toHaveBeenCalled()
    // Also no owner-repair conflict probe (that branch only runs inside the write path).
    expect(mocks.redraftRosterFindFirst).toHaveBeenCalledTimes(1)
  })

  it('(3) legacy write-capable resolver still performs owner repair when expected', async () => {
    const { updatedRosterRow } = configureViewerScenario('roster:gen-1')

    const result = await resolveRedraftRosterLookup({ userId: 'user-1', leagueId: 'lg-1' })

    expect(mocks.redraftRosterUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.redraftRosterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rr-1' },
        data: expect.objectContaining({ ownerId: 'user-1' }),
      }),
    )
    expect(result.roster).toEqual(updatedRosterRow)
    expect(result.roster?.ownerId).toBe('user-1') // repaired
    expect(result.resolvedBy).toBe('viewer_owner_repaired')
    expect(result.repairedOwnerId).toBe('user-1')
  })

  it('(parity) read-only and write-capable return identical results when no repair is warranted', async () => {
    configureViewerScenario('user-1') // owner already canonical → repair is a no-op

    const readOnly = await resolveRedraftRosterLookupReadOnly({ userId: 'user-1', leagueId: 'lg-1' })

    vi.clearAllMocks()
    configureViewerScenario('user-1')
    const writeCapable = await resolveRedraftRosterLookup({ userId: 'user-1', leagueId: 'lg-1' })

    expect(mocks.redraftRosterUpdate).not.toHaveBeenCalled()
    expect(writeCapable).toEqual(readOnly)
    expect(writeCapable.resolvedBy).toBe('viewer_owner_candidates')
    expect(writeCapable.repairedOwnerId).toBeNull()
  })
})

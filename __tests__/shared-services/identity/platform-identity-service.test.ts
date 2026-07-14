import { beforeEach, describe, expect, it, vi } from 'vitest'

const { userProfileFindFirst, userProfileUpdate, leagueAuthFindUnique } = vi.hoisted(() => ({
  userProfileFindFirst: vi.fn(),
  userProfileUpdate: vi.fn(),
  leagueAuthFindUnique: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: {
      findFirst: userProfileFindFirst,
      update: userProfileUpdate,
    },
    leagueAuth: {
      findUnique: leagueAuthFindUnique,
    },
  },
}))

describe('resolvePlatformIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a stored Sleeper identity from UserProfile', async () => {
    userProfileFindFirst.mockResolvedValue({
      sleeperUserId: '591462610482806784',
      sleeperUsername: 'theciege24',
      sleeperLinkedAt: new Date('2026-01-01T00:00:00Z'),
      sleeperVerifiedAt: new Date('2026-01-01T00:00:00Z'),
    })

    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-1', 'sleeper')

    expect(result.resolutionMethod).toBe('stored')
    expect(result.providerUserId).toBe('591462610482806784')
    expect(result.sourceAttribution.sourceTable).toBe('UserProfile')
    expect(userProfileFindFirst).toHaveBeenCalledWith({
      where: { userId: 'af-user-1' },
      select: expect.any(Object),
    })
  })

  it('reports not_available when no Sleeper link exists', async () => {
    userProfileFindFirst.mockResolvedValue(null)

    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-2', 'sleeper')

    expect(result.resolutionMethod).toBe('not_available')
    expect(result.providerUserId).toBeNull()
  })

  it('resolves a stored ESPN identity from LeagueAuth.espnSwid', async () => {
    leagueAuthFindUnique.mockResolvedValue({
      espnSwid: 'encrypted-swid-value',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      updatedAt: new Date('2026-02-02T00:00:00Z'),
    })

    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-3', 'espn')

    expect(result.resolutionMethod).toBe('stored')
    expect(result.sourceAttribution.sourceTable).toBe('LeagueAuth')
    expect(leagueAuthFindUnique).toHaveBeenCalledWith({
      where: { userId_platform: { userId: 'af-user-3', platform: 'espn' } },
      select: expect.any(Object),
    })
  })

  it('reports transient_credential_only for Yahoo when a credential exists', async () => {
    leagueAuthFindUnique.mockResolvedValue({
      apiKey: null,
      oauthToken: 'encrypted-token',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      updatedAt: new Date('2026-03-01T00:00:00Z'),
    })

    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-4', 'yahoo')

    expect(result.resolutionMethod).toBe('transient_credential_only')
    expect(result.providerUserId).toBeNull()
  })

  it('reports transient_credential_only for MFL when an API key exists', async () => {
    leagueAuthFindUnique.mockResolvedValue({
      apiKey: 'encrypted-key',
      oauthToken: null,
      createdAt: new Date('2026-03-05T00:00:00Z'),
      updatedAt: new Date('2026-03-05T00:00:00Z'),
    })

    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-5', 'mfl')

    expect(result.resolutionMethod).toBe('transient_credential_only')
  })

  it('reports not_available for Yahoo/MFL when no credential row exists', async () => {
    leagueAuthFindUnique.mockResolvedValue(null)

    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-6', 'yahoo')

    expect(result.resolutionMethod).toBe('not_available')
  })

  it('always reports not_available for Fantrax without querying Prisma (no AppUser relation exists)', async () => {
    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-7', 'fantrax')

    expect(result.resolutionMethod).toBe('not_available')
    expect(userProfileFindFirst).not.toHaveBeenCalled()
    expect(leagueAuthFindUnique).not.toHaveBeenCalled()
  })

  it('always reports not_available for Fleaflicker (no per-user storage exists)', async () => {
    const { resolvePlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await resolvePlatformIdentity('af-user-8', 'fleaflicker')

    expect(result.resolutionMethod).toBe('not_available')
  })
})

describe('listPlatformIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userProfileFindFirst.mockResolvedValue(null)
    leagueAuthFindUnique.mockResolvedValue(null)
  })

  it('resolves all six registered providers', async () => {
    const { listPlatformIdentities } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const results = await listPlatformIdentities('af-user-9')

    expect(results).toHaveLength(6)
    expect(results.map((r) => r.platform).sort()).toEqual(
      ['espn', 'fantrax', 'fleaflicker', 'mfl', 'sleeper', 'yahoo'].sort()
    )
  })
})

describe('linkPlatformIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links a verified Sleeper identity when no other FantasyUser owns it', async () => {
    userProfileFindFirst
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce({
        // post-write resolve
        sleeperUserId: 'sleeper-123',
        sleeperUsername: 'newhandle',
        sleeperLinkedAt: new Date('2026-04-01T00:00:00Z'),
        sleeperVerifiedAt: null,
      })
    userProfileUpdate.mockResolvedValue({})

    const { linkPlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const result = await linkPlatformIdentity({
      fantasyUserId: 'af-user-10',
      platform: 'sleeper',
      verifiedProviderUserId: 'sleeper-123',
      displayName: 'newhandle',
    })

    expect(result.providerUserId).toBe('sleeper-123')
    expect(userProfileUpdate).toHaveBeenCalledWith({
      where: { userId: 'af-user-10' },
      data: expect.objectContaining({
        sleeperUserId: 'sleeper-123',
        sleeperUsername: 'newhandle',
      }),
    })
  })

  it('rejects linking a Sleeper id already owned by a different FantasyUser', async () => {
    userProfileFindFirst.mockResolvedValueOnce({ userId: 'af-user-other' })

    const { linkPlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')
    const { DuplicateIdentityLinkError } = await import('@/lib/shared-services/identity/errors')

    await expect(
      linkPlatformIdentity({
        fantasyUserId: 'af-user-11',
        platform: 'sleeper',
        verifiedProviderUserId: 'sleeper-already-taken',
      })
    ).rejects.toThrow(DuplicateIdentityLinkError)
    expect(userProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty/unverified provider user id without touching Prisma', async () => {
    const { linkPlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')

    await expect(
      linkPlatformIdentity({ fantasyUserId: 'af-user-12', platform: 'sleeper', verifiedProviderUserId: '   ' })
    ).rejects.toThrow(/verified provider user id/i)
    expect(userProfileFindFirst).not.toHaveBeenCalled()
    expect(userProfileUpdate).not.toHaveBeenCalled()
  })

  it('rejects explicit linking for credential-based platforms (espn/yahoo/mfl)', async () => {
    const { linkPlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')

    await expect(
      linkPlatformIdentity({ fantasyUserId: 'af-user-13', platform: 'espn', verifiedProviderUserId: 'swid-value' })
    ).rejects.toThrow(/credential-based/i)
  })

  it('rejects explicit linking for Fantrax/Fleaflicker (no identity target exists)', async () => {
    const { linkPlatformIdentity } = await import('@/lib/shared-services/identity/PlatformIdentityService')

    await expect(
      linkPlatformIdentity({ fantasyUserId: 'af-user-14', platform: 'fantrax', verifiedProviderUserId: 'someuser' })
    ).rejects.toThrow()
  })
})

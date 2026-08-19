import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appUserFindUnique, appUserFindMany } = vi.hoisted(() => ({
  appUserFindUnique: vi.fn(),
  appUserFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: {
      findUnique: appUserFindUnique,
      findMany: appUserFindMany,
    },
  },
}))

describe('resolveFantasyUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves an existing AppUser as a canonical FantasyUser', async () => {
    appUserFindUnique.mockResolvedValue({
      id: 'af-user-1',
      displayName: 'The Ciege',
      email: 'ciege@example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })

    const { resolveFantasyUser } = await import('@/lib/shared-services/identity/FantasyUserResolver')
    const result = await resolveFantasyUser('af-user-1')

    expect(result).toEqual({
      fantasyUserId: 'af-user-1',
      displayName: 'The Ciege',
      email: 'ciege@example.com',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
  })

  it('returns null when no AppUser exists for the id', async () => {
    appUserFindUnique.mockResolvedValue(null)

    const { resolveFantasyUser } = await import('@/lib/shared-services/identity/FantasyUserResolver')
    const result = await resolveFantasyUser('does-not-exist')

    expect(result).toBeNull()
  })
})

describe('resolveFantasyUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves multiple FantasyUsers in one call', async () => {
    appUserFindMany.mockResolvedValue([
      { id: 'af-user-1', displayName: 'A', email: 'a@example.com', createdAt: new Date('2026-01-01T00:00:00Z') },
      { id: 'af-user-2', displayName: 'B', email: 'b@example.com', createdAt: new Date('2026-01-02T00:00:00Z') },
    ])

    const { resolveFantasyUsers } = await import('@/lib/shared-services/identity/FantasyUserResolver')
    const results = await resolveFantasyUsers(['af-user-1', 'af-user-2'])

    expect(results).toHaveLength(2)
    expect(results[0].fantasyUserId).toBe('af-user-1')
    expect(results[1].fantasyUserId).toBe('af-user-2')
  })

  it('short-circuits without querying Prisma for an empty list', async () => {
    const { resolveFantasyUsers } = await import('@/lib/shared-services/identity/FantasyUserResolver')
    const results = await resolveFantasyUsers([])

    expect(results).toEqual([])
    expect(appUserFindMany).not.toHaveBeenCalled()
  })
})

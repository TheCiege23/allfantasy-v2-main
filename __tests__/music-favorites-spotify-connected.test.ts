/**
 * GET /api/music/favorites now answers "is Spotify linked?" alongside the favourites.
 *
 * 🛑 WHY THIS ROUTE CARRIES THE FLAG AT ALL. It used to be `session.user.spotifyAccount`, a boolean
 * on the NextAuth session — and a boolean on the session has to be computed EAGERLY, so one or two
 * prisma reads ran in the session callback on every authenticated request in the product, for a
 * fact whose only consumer in the repo is `hooks/useMusicWidget.ts`. That hook already fetches this
 * route on mount, so the flag now costs nothing anywhere.
 *
 * The flag is a PASSENGER, and every assertion here is about a passenger not damaging its host:
 * it must not 500 the favourites when its own lookup fails, and it must survive the
 * missing-table branch, which returns 200 with an empty list and is the easiest place to drop it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.hoisted(() => vi.fn())
const authAccountFindFirstMock = vi.hoisted(() => vi.fn())
const userProfileFindUniqueMock = vi.hoisted(() => vi.fn())
const favoriteFindManyMock = vi.hoisted(() => vi.fn())

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))

vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    authAccount: { findFirst: authAccountFindFirstMock },
    userProfile: { findUnique: userProfileFindUniqueMock },
    userMusicFavorite: { findMany: favoriteFindManyMock },
  },
}))

/*
 * Only the error class is needed, and mocking the module keeps the real Prisma client out of the
 * test — importing it populates process.env from `.env`, which points at production in this repo.
 */
class FakeKnownRequestError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}
vi.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },
}))

const ROW = {
  id: 'f1',
  trackId: 't1',
  trackName: 'Song',
  artistName: 'Artist',
  trackImage: null,
  createdAt: new Date('2026-09-19T00:00:00Z'),
}

async function get() {
  const { GET } = await import('@/app/api/music/favorites/route')
  const response = await GET({} as any)
  return { response, body: await response.json() }
}

describe('the Spotify flag rides on the favourites response', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authAccountFindFirstMock.mockResolvedValue(null)
    userProfileFindUniqueMock.mockResolvedValue(null)
    favoriteFindManyMock.mockResolvedValue([ROW])
  })

  it('reports connected from a linked auth_accounts row', async () => {
    authAccountFindFirstMock.mockResolvedValue({ id: 'acct-1' })

    const { response, body } = await get()

    expect(response.status).toBe(200)
    expect(body.spotifyConnected).toBe(true)
    expect(body.favorites).toHaveLength(1)
  })

  it('stops at the auth_accounts hit instead of also reading the profile', async () => {
    // The whole point of the move was to stop paying for reads nobody needs.
    authAccountFindFirstMock.mockResolvedValue({ id: 'acct-1' })

    await get()

    expect(authAccountFindFirstMock).toHaveBeenCalledTimes(1)
    expect(userProfileFindUniqueMock).not.toHaveBeenCalled()
  })

  it('falls back to the profile timestamp when no auth_accounts row exists', async () => {
    // Spotify can also be linked through Settings, which writes the profile and no auth account.
    userProfileFindUniqueMock.mockResolvedValue({ spotifyConnectedAt: new Date() })

    const { body } = await get()

    expect(body.spotifyConnected).toBe(true)
  })

  it('reports not connected when neither source says so', async () => {
    const { body } = await get()

    expect(body.spotifyConnected).toBe(false)
  })

  it('reports not connected for a profile row with a null timestamp', async () => {
    userProfileFindUniqueMock.mockResolvedValue({ spotifyConnectedAt: null })

    const { body } = await get()

    expect(body.spotifyConnected).toBe(false)
  })
})

describe('the passenger does not damage its host', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authAccountFindFirstMock.mockResolvedValue(null)
    userProfileFindUniqueMock.mockResolvedValue(null)
    favoriteFindManyMock.mockResolvedValue([ROW])
  })

  it('still serves the favourites when the Spotify lookup throws', async () => {
    // 🛑 THE LOAD-BEARING ASSERTION IS THE 200 AND THE LIST, NOT THE FLAG. A lookup that can 500
    // the favourites is a worse trade than a boolean that reads false.
    authAccountFindFirstMock.mockRejectedValue(new Error('connection terminated'))

    const { response, body } = await get()

    expect(response.status).toBe(200)
    expect(body.favorites).toHaveLength(1)
    expect(body.spotifyConnected).toBe(false)
  })

  it('keeps the flag on the missing-table branch', async () => {
    /*
     * ⚠ THIS IS THE CASE THE FIRST VERSION GOT WRONG. `user_music_favorites` may not exist yet, and
     * that branch answers with an empty list and a 200. Resolving the flag before the favourites
     * read is pointless unless this branch can still report it — otherwise a connected user gets
     * "not connected" and is sent to re-link an account they already have.
     */
    authAccountFindFirstMock.mockResolvedValue({ id: 'acct-1' })
    favoriteFindManyMock.mockRejectedValue(
      new FakeKnownRequestError('The table `user_music_favorites` does not exist', 'P2021'),
    )

    const { response, body } = await get()

    expect(response.status).toBe(200)
    expect(body.favorites).toEqual([])
    expect(body.spotifyConnected).toBe(true)
  })

  it('still 500s on an unrelated database failure', async () => {
    // The missing-table branch must not become a catch-all that hides real breakage.
    favoriteFindManyMock.mockRejectedValue(new Error('boom'))

    const { response } = await get()

    expect(response.status).toBe(500)
  })

  it('reads nothing at all for a signed-out caller', async () => {
    getServerSessionMock.mockResolvedValue(null)

    const { response } = await get()

    expect(response.status).toBe(401)
    expect(authAccountFindFirstMock).not.toHaveBeenCalled()
    expect(userProfileFindUniqueMock).not.toHaveBeenCalled()
    expect(favoriteFindManyMock).not.toHaveBeenCalled()
  })
})

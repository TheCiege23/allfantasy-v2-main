import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 DISCOVERY LISTED ONE SLEEPER ACCOUNT AND THE GATE CHECKED ANOTHER. Discovery reads the
 * username that was typed; the commissioner gate reads the Sleeper id stored on the profile, and
 * discovery only stamps that id when it is empty. A profile linked to a different (or stale)
 * account therefore saw every league, and then every single and bulk import failed with "You are
 * not a member of that Sleeper league." — with no hint of which account the gate had used.
 */

const { requireVerifiedUserMock, lookupSleeperUserMock, getUserLeaguesMock, userProfile } = vi.hoisted(() => ({
  requireVerifiedUserMock: vi.fn(),
  lookupSleeperUserMock: vi.fn(),
  getUserLeaguesMock: vi.fn(),
  userProfile: { upsert: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile,
    deletedLeagueTombstone: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/sleeper/user-lookup', () => ({
  lookupSleeperUser: lookupSleeperUserMock,
}))

vi.mock('@/lib/sleeper-client', () => ({
  getUserLeagues: getUserLeaguesMock,
}))

async function discover(body: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/leagues/import/discover/route')
  const res = await POST(
    new Request('http://localhost/api/leagues/import/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'sleeper', accountIdentifier: 'newhandle', ...body }),
    }) as any,
  )
  expect(res.status).toBe(200)
  return res.json()
}

describe('Sleeper discovery against a profile linked to a different account', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'u1' })
    lookupSleeperUserMock.mockResolvedValue({
      status: 'found',
      user: { user_id: 'sleeper-new', username: 'newhandle', display_name: 'NewHandle' },
    })
    getUserLeaguesMock.mockResolvedValue([])
    userProfile.upsert.mockResolvedValue({
      userId: 'u1',
      sleeperUserId: 'sleeper-old',
      sleeperUsername: 'oldhandle',
    })
    userProfile.update.mockResolvedValue({})
  })

  it('names the linked account and leaves the link alone', async () => {
    const body = await discover()
    expect(body.sleeperAccountMismatch).toEqual({ linkedUsername: 'oldhandle' })
    expect(userProfile.update).not.toHaveBeenCalled()
  })

  it('reports no mismatch when the linked account is the one discovered', async () => {
    userProfile.upsert.mockResolvedValue({ userId: 'u1', sleeperUserId: 'sleeper-new', sleeperUsername: 'newhandle' })
    const body = await discover()
    expect(body).not.toHaveProperty('sleeperAccountMismatch')
  })

  it('switches the link on relinkSleeper and clears the old verification', async () => {
    const body = await discover({ relinkSleeper: true })
    expect(userProfile.update).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: expect.objectContaining({
        sleeperUserId: 'sleeper-new',
        sleeperUsername: 'newhandle',
        sleeperVerifiedAt: null,
      }),
    })
    expect(body).not.toHaveProperty('sleeperAccountMismatch')
  })

  it('keeps the mismatch when another login holds the discovered Sleeper id', async () => {
    userProfile.update.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['sleeperUserId'] } }),
    )
    const body = await discover({ relinkSleeper: true })
    expect(body).toMatchObject({
      handleLinkedElsewhere: true,
      sleeperAccountMismatch: { linkedUsername: 'oldhandle' },
    })
  })
})

describe('Sleeper gate — a linked account that is not in the league', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('marks the refusal notMember so the failure can be counted apart from "not the commissioner"', async () => {
    userProfile.findFirst.mockResolvedValue({ sleeperUserId: 'sleeper-old', sleeperUsername: 'oldhandle' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [{ user_id: 'sleeper-new', is_owner: true }] }),
    )
    const { assertImportCommissioner } = await import('@/lib/league-import/commissionerGate')
    const result = await assertImportCommissioner({ appUserId: 'u1', provider: 'sleeper', sourceLeagueId: 'league-1' })
    expect(result).toMatchObject({ ok: false, notMember: true, reason: 'You are not a member of that Sleeper league.' })
    vi.unstubAllGlobals()
  })
})

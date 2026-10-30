import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSessionMock = vi.fn()

const leagueFindFirstMock = vi.fn()
const leagueDeleteManyMock = vi.fn()
const sleeperLeagueFindFirstMock = vi.fn()
const sleeperLeagueDeleteManyMock = vi.fn()
const legacyTournamentFindFirstMock = vi.fn()
const legacyTournamentDeleteManyMock = vi.fn()
const transactionMock = vi.fn()
const leagueFindUniqueMock = vi.fn()
const tombstoneUpsertMock = vi.fn()
const resolveLeagueMembershipMock = vi.fn()

vi.mock('@/lib/league-access', () => ({
  resolveLeagueMembership: resolveLeagueMembershipMock,
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    /*
     * ⚠ ADDED FOR THE TOMBSTONE FEATURE (de9bda225, "a deleted league stays deleted").
     * The delete/import paths now call prisma.deletedLeagueTombstone, and a mock without
     * it fails as "Cannot read properties of undefined (reading 'upsert'/'findUnique')" —
     * which reads as a broken route rather than a mock that has not kept up.
     */
    deletedLeagueTombstone: {
      upsert: tombstoneUpsertMock,
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    league: {
      findFirst: leagueFindFirstMock,
      findUnique: leagueFindUniqueMock,
      deleteMany: leagueDeleteManyMock,
    },
    sleeperLeague: {
      findFirst: sleeperLeagueFindFirstMock,
      deleteMany: sleeperLeagueDeleteManyMock,
    },
    legacyTournament: {
      findFirst: legacyTournamentFindFirstMock,
      deleteMany: legacyTournamentDeleteManyMock,
    },
    $transaction: transactionMock,
  },
}))

describe('DELETE /api/league/[leagueId] contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })

    leagueDeleteManyMock.mockResolvedValue({ count: 1 })
    sleeperLeagueDeleteManyMock.mockResolvedValue({ count: 1 })
    legacyTournamentFindFirstMock.mockResolvedValue(null)
    legacyTournamentDeleteManyMock.mockResolvedValue({ count: 0 })

    transactionMock.mockImplementation(async (ops: Array<Promise<unknown>>) => Promise.all(ops))
    leagueFindUniqueMock.mockResolvedValue(null)
    tombstoneUpsertMock.mockResolvedValue({})
    resolveLeagueMembershipMock.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
  })

  /*
   * Production 2026-10-30: a tester's two Sleeper leagues were imported by an account since
   * deleted. They reached them through a claimed team, so the route found no row of theirs and
   * answered "0 removed" forever. Now it tombstones the league for them alone.
   */
  describe('a league someone else imported', () => {
    const call = async (id: string) => {
      leagueFindFirstMock.mockResolvedValueOnce(null)
      sleeperLeagueFindFirstMock.mockResolvedValueOnce(null)
      const { DELETE } = await import('@/app/api/league/[leagueId]/route')
      return DELETE(new Request(`http://localhost/api/league/${id}`, { method: 'DELETE' }), {
        params: Promise.resolve({ leagueId: id }),
      })
    }

    it('tombstones an imported league for a member and deletes nothing shared', async () => {
      leagueFindUniqueMock.mockResolvedValueOnce({ platform: 'sleeper', platformLeagueId: '1389720315973627904', name: 'KB NFL' })
      resolveLeagueMembershipMock.mockResolvedValueOnce({ ok: true, access: { isOwner: false, via: 'claim' } })

      const res = await call('lg-shared')

      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        ok: true,
        tombstoned: true,
        removed: { leagueRows: 0, sleeperLeagueRows: 0, tournamentRows: 0, memberLeagues: 1 },
      })
      expect(resolveLeagueMembershipMock).toHaveBeenCalledWith('lg-shared', 'user-1')
      expect(tombstoneUpsertMock).toHaveBeenCalledTimes(1)
      expect(tombstoneUpsertMock.mock.calls[0][0].create).toMatchObject({
        userId: 'user-1',
        platform: 'sleeper',
        platformLeagueId: '1389720315973627904',
        leagueName: 'KB NFL',
      })
      expect(transactionMock).not.toHaveBeenCalled()
      expect(leagueDeleteManyMock).not.toHaveBeenCalled()
    })

    it('does not tombstone an imported league for a non-member', async () => {
      leagueFindUniqueMock.mockResolvedValueOnce({ platform: 'sleeper', platformLeagueId: 'x', name: 'Theirs' })

      const res = await call('lg-stranger')

      await expect(res.json()).resolves.toMatchObject({ removed: { leagueRows: 0, sleeperLeagueRows: 0, tournamentRows: 0 } })
      expect(tombstoneUpsertMock).not.toHaveBeenCalled()
    })

    it('does not offer it for a native league the viewer only joined', async () => {
      leagueFindUniqueMock.mockResolvedValueOnce({ platform: 'allfantasy', platformLeagueId: 'af-1', name: 'Survivor' })
      resolveLeagueMembershipMock.mockResolvedValueOnce({ ok: true, access: { isOwner: false, via: 'redraft' } })

      const res = await call('lg-native')

      await expect(res.json()).resolves.toMatchObject({ removed: { leagueRows: 0 } })
      expect(tombstoneUpsertMock).not.toHaveBeenCalled()
      expect(resolveLeagueMembershipMock).not.toHaveBeenCalled()
    })
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { DELETE } = await import('@/app/api/league/[leagueId]/route')

    const res = await DELETE(new Request('http://localhost/api/league/lg-1', { method: 'DELETE' }), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Not authenticated' })
  })

  it('is idempotent when league id is not found in either table', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(null)
    sleeperLeagueFindFirstMock.mockResolvedValueOnce(null)

    const { DELETE } = await import('@/app/api/league/[leagueId]/route')

    const res = await DELETE(new Request('http://localhost/api/league/lg-missing', { method: 'DELETE' }), {
      params: Promise.resolve({ leagueId: 'lg-missing' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      removed: {
        leagueRows: 0,
        sleeperLeagueRows: 0,
        tournamentRows: 0,
      },
    })
    expect(leagueDeleteManyMock).not.toHaveBeenCalled()
    expect(sleeperLeagueDeleteManyMock).not.toHaveBeenCalled()
  })

  it('deletes linked league and sleeper rows so removed league cannot reappear', async () => {
    leagueFindFirstMock.mockResolvedValueOnce({
      id: 'lg-1',
      platform: 'sleeper',
      platformLeagueId: 'sleeper-123',
    })
    sleeperLeagueFindFirstMock.mockResolvedValueOnce(null)

    const { DELETE } = await import('@/app/api/league/[leagueId]/route')

    const res = await DELETE(new Request('http://localhost/api/league/lg-1', { method: 'DELETE' }), {
      params: Promise.resolve({ leagueId: 'lg-1' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      /*
       * ⚠ `tombstoned` IS PART OF THE CONTRACT NOW (de9bda225). The route records a
       * tombstone so a deleted league cannot be recreated by the next import or sync, and
       * reports whether it managed to. The idempotent "not found" case above returns
       * EARLY, before that step, which is why it still has no `tombstoned` key — the
       * asymmetry is the route's, not an oversight here.
       */
      tombstoned: true,
      removed: {
        leagueRows: 1,
        sleeperLeagueRows: 1,
        tournamentRows: 0,
      },
    })

    expect(leagueDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        OR: [
          { id: 'lg-1' },
          {
            platform: 'sleeper',
            platformLeagueId: 'sleeper-123',
          },
        ],
      },
    })

    expect(sleeperLeagueDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        OR: [{ id: 'lg-1' }, { sleeperLeagueId: 'sleeper-123' }],
      },
    })

    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('deletes linked rows when request id matches sleeper league row', async () => {
    leagueFindFirstMock.mockResolvedValueOnce(null)
    sleeperLeagueFindFirstMock.mockResolvedValueOnce({
      id: 'sl-row-1',
      sleeperLeagueId: 'sleeper-777',
    })

    const { DELETE } = await import('@/app/api/league/[leagueId]/route')

    const res = await DELETE(new Request('http://localhost/api/league/sl-row-1', { method: 'DELETE' }), {
      params: Promise.resolve({ leagueId: 'sl-row-1' }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      /*
       * ⚠ `tombstoned` IS PART OF THE CONTRACT NOW (de9bda225). The route records a
       * tombstone so a deleted league cannot be recreated by the next import or sync, and
       * reports whether it managed to. The idempotent "not found" case above returns
       * EARLY, before that step, which is why it still has no `tombstoned` key — the
       * asymmetry is the route's, not an oversight here.
       */
      tombstoned: true,
      removed: {
        leagueRows: 1,
        sleeperLeagueRows: 1,
        tournamentRows: 0,
      },
    })

    expect(leagueDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        OR: [
          { id: 'sl-row-1' },
          {
            platform: 'sleeper',
            platformLeagueId: 'sleeper-777',
          },
        ],
      },
    })

    expect(sleeperLeagueDeleteManyMock).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        OR: [{ id: 'sl-row-1' }, { sleeperLeagueId: 'sleeper-777' }],
      },
    })
  })
})

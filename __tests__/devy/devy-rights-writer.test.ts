import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  devyPlayerFindUniqueMock,
  devyPlayerFindFirstMock,
  devyRightsFindUniqueMock,
  devyRightsCreateMock,
  appendDevyLifecycleEventMock,
} = vi.hoisted(() => ({
  devyPlayerFindUniqueMock: vi.fn(),
  devyPlayerFindFirstMock: vi.fn(),
  devyRightsFindUniqueMock: vi.fn(),
  devyRightsCreateMock: vi.fn(),
  appendDevyLifecycleEventMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    devyPlayer: {
      findUnique: devyPlayerFindUniqueMock,
      findFirst: devyPlayerFindFirstMock,
    },
    devyRights: {
      findUnique: devyRightsFindUniqueMock,
      create: devyRightsCreateMock,
    },
  },
}))

vi.mock('@/lib/devy/lifecycle/DevyAuditLog', () => ({
  appendDevyLifecycleEvent: appendDevyLifecycleEventMock,
}))

describe('recordDraftedDevyRights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendDevyLifecycleEventMock.mockResolvedValue(undefined)
  })

  it('creates NCAA_DEVY_ACTIVE rights for a devy_pick with a pool-supplied DevyPlayer id', async () => {
    devyPlayerFindUniqueMock.mockResolvedValueOnce({ id: 'devy-1', graduatedToNFL: false })
    devyRightsFindUniqueMock.mockResolvedValueOnce(null)
    devyRightsCreateMock.mockResolvedValueOnce({ id: 'rights-1' })

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Arch Manning',
      devyPlayerId: 'devy-1',
      assetType: 'devy_pick',
      seasonYear: 2026,
    })

    expect(result).toEqual({ ok: true, created: true, rightsId: 'rights-1' })
    expect(devyRightsCreateMock).toHaveBeenCalledWith({
      data: {
        leagueId: 'league-1',
        rosterId: 'roster-1',
        devyPlayerId: 'devy-1',
        state: 'NCAA_DEVY_ACTIVE',
        seasonYear: 2026,
        sourceConfidence: 100,
      },
    })
    expect(appendDevyLifecycleEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        eventType: 'pool_assignment',
        rosterId: 'roster-1',
        devyPlayerId: 'devy-1',
      })
    )
  })

  it('creates COLLEGE_ACTIVE rights for a c2c_college pick', async () => {
    devyPlayerFindUniqueMock.mockResolvedValueOnce({ id: 'devy-2', graduatedToNFL: false })
    devyRightsFindUniqueMock.mockResolvedValueOnce(null)
    devyRightsCreateMock.mockResolvedValueOnce({ id: 'rights-2' })

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Jeremiah Smith',
      devyPlayerId: 'devy-2',
      assetType: 'c2c_college',
      seasonYear: 2026,
    })

    expect(result.ok).toBe(true)
    expect(devyRightsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'COLLEGE_ACTIVE' }) })
    )
  })

  it('is idempotent: an existing (league, roster, player) row short-circuits without a create', async () => {
    devyPlayerFindUniqueMock.mockResolvedValueOnce({ id: 'devy-1', graduatedToNFL: false })
    devyRightsFindUniqueMock.mockResolvedValueOnce({ id: 'rights-existing' })

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Arch Manning',
      devyPlayerId: 'devy-1',
      assetType: 'devy_pick',
    })

    expect(result).toEqual({ ok: true, created: false, rightsId: 'rights-existing' })
    expect(devyRightsCreateMock).not.toHaveBeenCalled()
    expect(appendDevyLifecycleEventMock).not.toHaveBeenCalled()
  })

  it('treats a P2002 race as the idempotent path, re-reading the winner row', async () => {
    devyPlayerFindUniqueMock.mockResolvedValueOnce({ id: 'devy-1', graduatedToNFL: false })
    devyRightsFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'rights-raced' })
    devyRightsCreateMock.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Arch Manning',
      devyPlayerId: 'devy-1',
      assetType: 'devy_pick',
    })

    expect(result).toEqual({ ok: true, created: false, rightsId: 'rights-raced' })
  })

  it('falls back to the validator name lookup when the pool id is absent, at lower confidence', async () => {
    devyPlayerFindFirstMock.mockResolvedValueOnce({ id: 'devy-3' })
    devyRightsFindUniqueMock.mockResolvedValueOnce(null)
    devyRightsCreateMock.mockResolvedValueOnce({ id: 'rights-3' })

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Dylan Raiola',
      devyPlayerId: null,
      assetType: 'devy_pick',
      seasonYear: 2026,
    })

    expect(devyPlayerFindUniqueMock).not.toHaveBeenCalled()
    expect(result.created).toBe(true)
    expect(devyRightsCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ devyPlayerId: 'devy-3', sourceConfidence: 80 }),
      })
    )
  })

  it('reports a labeled absence when no devy player matches — never a fabricated row', async () => {
    devyPlayerFindUniqueMock.mockResolvedValueOnce({ id: 'devy-4', graduatedToNFL: true })
    devyPlayerFindFirstMock.mockResolvedValueOnce(null)

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'roster-1',
      playerName: 'Unknown Player',
      devyPlayerId: 'devy-4',
      assetType: 'devy_pick',
    })

    expect(result).toEqual({ ok: false, created: false, reason: 'devy_player_not_found' })
    expect(devyRightsCreateMock).not.toHaveBeenCalled()
  })

  it('labels a missing League/Roster FK instead of throwing', async () => {
    devyPlayerFindUniqueMock.mockResolvedValueOnce({ id: 'devy-1', graduatedToNFL: false })
    devyRightsFindUniqueMock.mockResolvedValueOnce(null)
    devyRightsCreateMock.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: 'P2003' }))

    const { recordDraftedDevyRights } = await import('@/lib/devy/rightsWriter')
    const result = await recordDraftedDevyRights({
      leagueId: 'league-1',
      rosterId: 'ghost-roster',
      playerName: 'Arch Manning',
      devyPlayerId: 'devy-1',
      assetType: 'devy_pick',
    })

    expect(result).toEqual({ ok: false, created: false, reason: 'league_or_roster_missing' })
  })

  it('resolveDevySeasonYear follows the promotion-route convention (season rolls in April)', async () => {
    const { resolveDevySeasonYear } = await import('@/lib/devy/rightsWriter')
    expect(resolveDevySeasonYear(new Date(2026, 7, 24))).toBe(2026)
    expect(resolveDevySeasonYear(new Date(2026, 1, 1))).toBe(2025)
  })
})

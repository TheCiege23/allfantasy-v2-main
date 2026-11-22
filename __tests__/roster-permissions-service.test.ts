import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The roster editor's permission (lib/roster-engine/RosterPermissionsService.ts) is the shared commissioner rule with
 * the rosters area (lib/league/commissionerAccess.ts, 2026-11-16): the head commissioner, or a co-commissioner granted
 * rosters. It compared League.userId alone, so a co-commissioner given rosters was refused.
 */
const leagueFindFirstMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: leagueFindFirstMock,
    },
  },
}))

const league = (teams: Array<{ id: string; isCommissioner?: boolean; isCoCommissioner?: boolean }>, settings: unknown = {}) => ({
  userId: 'u-commissioner',
  settings,
  teams: teams.map((t) => ({ isCommissioner: false, isCoCommissioner: false, role: 'member', ...t })),
})

describe('RosterPermissionsService commissioner enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows the head commissioner and marks non-read-only', async () => {
    leagueFindFirstMock.mockResolvedValue({ ...league([]), userId: 'u-1' })
    const { checkCommissionerPermission } = await import('../lib/roster-engine/RosterPermissionsService')

    const permission = await checkCommissionerPermission('u-1', 'league-1')
    expect(permission.isCommissioner).toBe(true)
    expect(permission.readOnly).toBe(false)
    expect(permission.reason).toBeUndefined()
  })

  it('rejects a member with the commissioner-only reason', async () => {
    leagueFindFirstMock.mockResolvedValue(league([{ id: 't1' }]))
    const { checkCommissionerPermission, detectReadOnlyRosterView } = await import('../lib/roster-engine/RosterPermissionsService')

    const permission = await checkCommissionerPermission('u-member', 'league-1')
    expect(permission.isCommissioner).toBe(false)
    expect(permission.readOnly).toBe(true)
    expect(permission.reason).toBe('Commissioner only for editing')

    const readOnly = await detectReadOnlyRosterView('u-member', 'league-1')
    expect(readOnly).toBe(true)
  })

  it('a co-commissioner granted rosters may edit; one granted only scoring may not, and is told why', async () => {
    const { checkCommissionerPermission } = await import('../lib/roster-engine/RosterPermissionsService')
    leagueFindFirstMock.mockResolvedValue(league([{ id: 'co1', isCoCommissioner: true }], { co_commissioner_scopes: { co1: ['rosters'] } }))
    expect(await checkCommissionerPermission('u-co', 'league-1')).toEqual({ isCommissioner: true, readOnly: false })
    leagueFindFirstMock.mockResolvedValue(league([{ id: 'co1', isCoCommissioner: true }], { co_commissioner_scopes: { co1: ['scoring'] } }))
    const refused = await checkCommissionerPermission('u-co', 'league-1')
    expect(refused).toMatchObject({ isCommissioner: false, readOnly: true })
    expect(refused.reason).toMatch(/rosters permission/)
  })
})

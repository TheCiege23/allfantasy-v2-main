/**
 * A team that changes hands is its new owner's (phase 9, 2026-10-29): autopilot and inactive-manager mode
 * were switched on for the PREVIOUS owner's absence, so they end, the commissioner is told, and trades
 * offered to the new owner go through — even before the hourly run gets to it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => {
  const state = { settings: {} as Record<string, unknown>, owners: {} as Record<string, string | null> }
  const tx = {
    $queryRaw: vi.fn(async () => []),
    league: {
      findUnique: vi.fn(async () => ({ settings: state.settings })),
      update: vi.fn(async ({ data }: { data: { settings: Record<string, unknown> } }) => { state.settings = data.settings; return {} }),
    },
  }
  return {
    state,
    prisma: {
      $queryRaw: vi.fn(async () => [{ id: 'L' }]),
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      league: { findUnique: vi.fn(async () => ({ settings: state.settings, platform: 'allfantasy', userId: 'league-owner' })) },
      roster: {
        findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id in state.owners).map((id) => ({ id, platformUserId: state.owners[id] }))),
        findFirst: vi.fn(async ({ where }: { where: { id: string | { in: string[] }; platformUserId?: string } }) => {
          const ids = typeof where.id === 'string' ? [where.id] : where.id.in
          const id = ids.find((r) => r in m.state.owners && (where.platformUserId === undefined || m.state.owners[r] === where.platformUserId))
          return id ? { id, platformUserId: m.state.owners[id] } : null
        }),
      },
    },
    elevated: vi.fn(async () => true),
    log: vi.fn(async () => ({ id: 'a' })),
    notify: vi.fn(async () => ({})),
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: m.elevated }))
vi.mock('@/server/services/auditService', () => ({ logAction: m.log }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.notify }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({ EntitlementResolver: class { resolveForUser = async () => ({ hasAccess: true }) } }))

import { managedForOwner, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { endManagedForNewOwners, isOwnerOnAutopilot, NEW_OWNER_ENDED_ACTION, runInactiveManagerLineups, setChimmyAutopilot, setInactiveManagerMode } from '@/lib/inactive-manager/inactiveManagerService'

const managed = () => readManagedLineups(m.state.settings)

beforeEach(() => {
  vi.clearAllMocks()
  m.state.settings = { other: 1 }
  m.state.owners = { r1: 'orphan-r1', r2: 'owner-2' }
})

describe('managedForOwner', () => {
  it('current for the owner it was switched on for, new_owner after a change, unstamped for old entries', () => {
    const entry = { since: 's', byUserId: 'c', ownerUserId: 'orphan-r1' }
    expect(managedForOwner(entry, 'orphan-r1')).toBe('current')
    expect(managedForOwner(entry, 'new-person')).toBe('new_owner')
    expect(managedForOwner({ since: 's', byUserId: 'c' }, 'anyone')).toBe('unstamped')
    expect(managedForOwner({ since: 's', byUserId: 'c', ownerUserId: null }, null)).toBe('current')
  })
})

describe('switching it on records the owner', () => {
  it('both switches stamp who owned the team at that moment', async () => {
    await setInactiveManagerMode('L', 'commish', 'r2', true)
    await setChimmyAutopilot('L', 'commish', 'r1', 'dynasty_owner')
    expect(managed().r2!.ownerUserId).toBe('owner-2')
    expect(managed().r1!.ownerUserId).toBe('orphan-r1')
  })
})

describe('a takeover', () => {
  beforeEach(async () => {
    await setChimmyAutopilot('L', 'commish', 'r1', 'dynasty_owner')
    await setInactiveManagerMode('L', 'commish', 'r2', true)
    vi.clearAllMocks()
  })

  it('ends the mode for the team that changed hands, leaves the other, and tells the commissioners', async () => {
    m.state.owners.r1 = 'new-owner'
    expect(await endManagedForNewOwners('L', 'league-owner', 'Dyn')).toEqual(['r1'])
    expect(Object.keys(managed())).toEqual(['r2'])
    expect(m.state.settings.other).toBe(1)
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ actionType: NEW_OWNER_ENDED_ACTION, entityId: 'r1', metadata: expect.objectContaining({ previousOwnerId: 'orphan-r1', newOwnerId: 'new-owner', autopilot: true }) }))
    expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['commish', 'league-owner'], type: 'inactive_manager_new_owner' }))
  })

  it('the hourly run ends it before it sets a lineup for anyone', async () => {
    m.state.owners.r1 = 'new-owner'
    const r = await runInactiveManagerLineups()
    expect(r.skipped.new_owner).toBe(1)
    expect(Object.keys(managed())).toEqual(['r2'])
  })

  it('does nothing while nobody has changed hands', async () => {
    expect(await endManagedForNewOwners('L', 'league-owner', 'Dyn')).toEqual([])
    expect(Object.keys(managed()).sort()).toEqual(['r1', 'r2'])
    expect(m.notify).not.toHaveBeenCalled()
  })

  it('trades offered to the new owner go through at once; the old owner\'s team still refuses them', async () => {
    expect(await isOwnerOnAutopilot('L', 'orphan-r1')).toBe(true)
    m.state.owners.r1 = 'new-owner'
    expect(await isOwnerOnAutopilot('L', 'new-owner')).toBe(false)
  })
})

describe('entries from before owners were recorded', () => {
  it('are stamped with the current owner, so a later change is caught', async () => {
    m.state.settings = { af_managed_lineups: { r1: { since: 's', byUserId: 'commish' } } }
    expect(await endManagedForNewOwners('L', 'league-owner', 'Dyn')).toEqual([])
    expect(managed().r1!.ownerUserId).toBe('orphan-r1')
    m.state.owners.r1 = 'new-owner'
    expect(await endManagedForNewOwners('L', 'league-owner', 'Dyn')).toEqual(['r1'])
  })
})

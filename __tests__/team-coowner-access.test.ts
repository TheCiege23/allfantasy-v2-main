import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ findCoOwner: vi.fn(), findRoster: vi.fn(), findTeam: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { teamCoOwner: { findUnique: db.findCoOwner }, roster: { findFirst: db.findRoster }, leagueTeam: { findFirst: db.findTeam } } }))
import { acceptedCoOwnerRosterId, isAcceptedCoOwnerForRoster, isAcceptedCoOwnerForRedraftRoster } from '@/lib/team-coowners/access'

beforeEach(() => { vi.clearAllMocks(); db.findCoOwner.mockResolvedValue(null); db.findRoster.mockResolvedValue(null); db.findTeam.mockResolvedValue(null) })
describe('team co-owner roster access', () => {
  it('fails closed if the additive table has not been deployed', async () => {
    db.findCoOwner.mockRejectedValueOnce({ code: 'P2021' })
    expect(await acceptedCoOwnerRosterId('l1', 'u1')).toBeNull()
  })
  it('does not hide other database errors', async () => {
    db.findCoOwner.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(acceptedCoOwnerRosterId('l1', 'u1')).rejects.toThrow('database unavailable')
  })
  it('grants no access before the invitation is accepted', async () => {
    db.findCoOwner.mockResolvedValue({ rosterId: 'r1', acceptedAt: null, rosterOwnerKey: 'owner', claimedOwnerId: null, roster: { leagueId: 'l1', platformUserId: 'owner' } })
    expect(await acceptedCoOwnerRosterId('l1', 'u1')).toBeNull()
  })
  it('restricts an accepted co-owner to the invited roster and league', async () => {
    db.findCoOwner.mockResolvedValue({ rosterId: 'r1', acceptedAt: new Date(), rosterOwnerKey: 'owner', claimedOwnerId: null, roster: { leagueId: 'l1', platformUserId: 'owner' } })
    expect(await isAcceptedCoOwnerForRoster('l1', 'r1', 'u1')).toBe(true)
    expect(await isAcceptedCoOwnerForRoster('l1', 'r2', 'u1')).toBe(false)
    db.findCoOwner.mockResolvedValueOnce({ rosterId: 'r1', acceptedAt: new Date(), rosterOwnerKey: 'owner', claimedOwnerId: null, roster: { leagueId: 'other', platformUserId: 'owner' } })
    expect(await acceptedCoOwnerRosterId('l1', 'u1')).toBeNull()
  })
  it('revokes access if the invitee later claims their own team', async () => {
    db.findCoOwner.mockResolvedValue({ rosterId: 'r1', acceptedAt: new Date(), rosterOwnerKey: 'owner', claimedOwnerId: null, roster: { leagueId: 'l1', platformUserId: 'owner' } })
    db.findTeam.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'own-team' })
    expect(await acceptedCoOwnerRosterId('l1', 'u1')).toBeNull()
  })
  it('revokes access when the roster owner changes', async () => {
    db.findCoOwner.mockResolvedValue({ rosterId: 'r1', acceptedAt: new Date(), rosterOwnerKey: 'former', claimedOwnerId: null, roster: { leagueId: 'l1', platformUserId: 'new' } })
    expect(await acceptedCoOwnerRosterId('l1', 'u1')).toBeNull()
  })
  it('requires the explicit canonical-to-redraft roster link', async () => {
    db.findCoOwner.mockResolvedValue({ rosterId: 'r1', acceptedAt: new Date(), rosterOwnerKey: 'owner', claimedOwnerId: null, roster: { leagueId: 'l1', platformUserId: 'owner' } })
    expect(await isAcceptedCoOwnerForRedraftRoster('l1', 'redraft-1', 'u1')).toBe(false)
    db.findRoster.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'r1' })
    expect(await isAcceptedCoOwnerForRedraftRoster('l1', 'redraft-1', 'u1')).toBe(true)
    expect(db.findRoster).toHaveBeenCalledWith({ where: { id: 'r1', leagueId: 'l1', redraftRosterId: 'redraft-1' }, select: { id: true } })
  })
})

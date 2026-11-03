// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const db = vi.hoisted(() => ({ session: vi.fn(), roster: vi.fn(), team: vi.fn(), league: vi.fn(), users: vi.fn(), invite: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), commissioner: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: db.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: db.commissioner }))
vi.mock('@/lib/league/isNativeLeague', () => ({ isNativePlatform: (value: string) => value === 'allfantasy' }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: db.league }, roster: { findFirst: db.roster }, leagueTeam: { findFirst: db.team }, appUser: { findMany: db.users }, teamCoOwner: { findUnique: db.invite, findFirst: db.invite, create: db.create, updateMany: db.update, deleteMany: db.remove } } }))
import { POST, PATCH, DELETE } from '@/app/api/leagues/[leagueId]/team-coowners/handler'

const ctx = { params: Promise.resolve({ leagueId: 'league-1' }) }
const request = (method: string, data: unknown = {}) => new NextRequest('http://localhost/api/leagues/league-1/team-coowners?id=invite-1', { method, headers: { 'content-type': 'application/json' }, ...(method === 'DELETE' ? {} : { body: JSON.stringify(data) }) })
beforeEach(() => { vi.clearAllMocks(); db.session.mockResolvedValue({ user: { id: 'owner' } }); db.league.mockResolvedValue({ platform: 'allfantasy' }); db.roster.mockResolvedValue(null); db.team.mockResolvedValue(null); db.commissioner.mockResolvedValue(false) })

describe('team co-owner invitations', () => {
  it('rejects an invitation from someone who does not manage the roster', async () => {
    db.roster.mockResolvedValueOnce({ platformUserId: 'someone-else' })
    const response = await POST(request('POST', { rosterId: 'r1', username: 'invitee' }), ctx)
    expect(response.status).toBe(403); expect(db.create).not.toHaveBeenCalled()
  })
  it('creates a pending invitation with the current team owner recorded', async () => {
    db.roster.mockResolvedValueOnce({ platformUserId: 'owner' }).mockResolvedValueOnce(null).mockResolvedValueOnce({ platformUserId: 'owner' })
    db.team.mockResolvedValueOnce(null).mockResolvedValueOnce({ claimedByUserId: 'owner' })
    db.users.mockResolvedValue([{ id: 'invitee' }]); db.create.mockResolvedValue({ id: 'invite-1' })
    const response = await POST(request('POST', { rosterId: 'r1', username: 'invitee' }), ctx)
    expect(response.status).toBe(201)
    expect(db.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'invitee', rosterId: 'r1', rosterOwnerKey: 'owner', claimedOwnerId: 'owner' }) }))
  })
  it('rejects acceptance after the team changes owner', async () => {
    db.session.mockResolvedValue({ user: { id: 'invitee' } })
    db.invite.mockResolvedValue({ id: 'invite-1', rosterId: 'r1', rosterOwnerKey: 'old', claimedOwnerId: null, roster: { leagueId: 'league-1', platformUserId: 'new' } })
    const response = await PATCH(request('PATCH', { action: 'accept' }), ctx)
    expect(response.status).toBe(409); expect(db.update).not.toHaveBeenCalled()
  })
  it('does not allow a stranger to revoke an invitation', async () => {
    db.invite.mockResolvedValue({ userId: 'invitee', rosterId: 'r1' }); db.roster.mockResolvedValue({ platformUserId: 'another-owner' })
    const response = await DELETE(request('DELETE'), ctx)
    expect(response.status).toBe(403); expect(db.remove).not.toHaveBeenCalled()
  })
})

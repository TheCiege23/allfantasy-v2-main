import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ roster: vi.fn(), coOwner: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { roster: { findFirst: h.roster }, leagueTeam: { findFirst: vi.fn(async () => null) } } }))
vi.mock('@/lib/commissioner/permissions', () => ({ isCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null), isAcceptedCoOwnerForRoster: h.coOwner }))
import { canSubmitPickForRoster, canSubmitDispersalPickForUser } from '@/lib/live-draft-engine/auth'

describe('co-owner draft authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); h.roster.mockResolvedValue({ id: 'r1', platformUserId: 'owner' }) })
  it.each([['accepted roster', true], ['pending, revoked, or another roster', false]])('%s: limits both pick types', async (_name, allowed) => {
    h.coOwner.mockResolvedValue(allowed)
    expect(await canSubmitPickForRoster('l1', 'co-user', 'r1')).toBe(allowed)
    expect(await canSubmitDispersalPickForUser('l1', 'co-user', 'r1')).toBe(allowed)
    expect(h.coOwner).toHaveBeenCalledWith('l1', 'r1', 'co-user')
  })
  it('rejects a nonexistent roster even if a co-owner helper would allow it', async () => {
    h.roster.mockResolvedValue(null)
    h.coOwner.mockResolvedValue(true)
    expect(await canSubmitPickForRoster('l1', 'co-user', 'r2')).toBe(false)
    expect(await canSubmitDispersalPickForUser('l1', 'co-user', 'r2')).toBe(false)
  })
})

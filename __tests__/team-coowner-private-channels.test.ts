import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ coOwner: vi.fn(), roster: vi.fn(), cycle: vi.fn(), guests: vi.fn() }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: h.coOwner }))
vi.mock('@/lib/zombie/rosterTeamMap', () => ({ getRosterTeamMap: vi.fn(async () => ({ rosterIdToTeamId: new Map() })) }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: vi.fn(async () => ({ userId: 'commissioner', season: 2026 })) },
  roster: { findFirst: h.roster, findMany: vi.fn(async () => []) },
  bigBrotherCycle: { findFirst: h.cycle }, bigBrotherJuryMember: { findMany: vi.fn(async () => []) },
  bigBrotherHohRoomGuest: { findMany: h.guests },
} }))
import { getAccessibleBbChannels } from '@/lib/big-brother/BigBrotherChatChannels'
describe('co-owner private channel access', () => {
  beforeEach(() => {
    vi.clearAllMocks(); h.roster.mockResolvedValue(null); h.guests.mockResolvedValue([])
    h.cycle.mockResolvedValue({ id: 'cycle', week: 1, hohRosterId: 'shared', nominee1RosterId: 'other', nominee2RosterId: null, replacementNomineeRosterId: null })
  })
  it('grants only the shared team rooms to an accepted co-owner', async () => {
    h.coOwner.mockResolvedValue('shared')
    const channels = await getAccessibleBbChannels('league', 'co-user')
    expect(channels.find(c => c.key === 'hoh_room')).toMatchObject({ canRead: true, canWrite: true })
    expect(channels.find(c => c.key === 'nominees')).toMatchObject({ canRead: false, canWrite: false })
  })
  it('removes private room access when the invitation is revoked', async () => {
    h.coOwner.mockResolvedValue(null)
    const channels = await getAccessibleBbChannels('league', 'co-user')
    expect(channels.find(c => c.key === 'hoh_room')).toMatchObject({ canRead: false, canWrite: false })
  })
})

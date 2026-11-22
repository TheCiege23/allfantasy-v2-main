/**
 * Who may open a Survivor huddle (`source = tribe_<id>`) in league chat. The rule is the canonical
 * access context, so an active manager sees their own tribe, a non-playing host sees every tribe,
 * a playing commissioner is a manager, the merge moves everyone to the merged tribe, and an
 * eliminated manager is out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  tribes: new Map<string, { id: string; isMerged: boolean }>(),
  snapshot: null as null | Record<string, unknown>,
  prisma: {
    survivorTribe: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => h.tribes.get(where.id) ?? null) },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(async () => null) }))
vi.mock('@/lib/survivor/survivorAccessControl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/survivor/survivorAccessControl')>()
  return {
    ...actual,
    resolveSurvivorAccessContext: vi.fn(async (leagueId: string, userId: string) =>
      h.snapshot ? actual.buildSurvivorAccessContextFromSnapshot({ leagueId, userId, ...(h.snapshot as object) } as never) : null),
  }
})

import { canAccessSurvivorTribeChatSource } from '@/lib/survivor/survivorTribeChatAccess'

function manager(tribeId: string, extra: Record<string, unknown> = {}) {
  return {
    role: 'member',
    leagueOwnerUserId: 'owner-1',
    settings: { commissionerParticipationMode: 'non_participating_host' },
    player: { userId: 'u', playerState: 'active', tribeId, redraftRosterId: 'r', canAccessTribeChat: true, canAccessMergeChat: false, canAccessExileChat: false, canAccessJuryChat: false, canAccessFinaleChat: false, isJuryMember: false, isFinalist: false, ...extra },
    roster: { id: 'r' },
  }
}

describe('canAccessSurvivorTribeChatSource', () => {
  beforeEach(() => {
    h.tribes.clear()
    h.tribes.set('tribe-a', { id: 'tribe-a', isMerged: false })
    h.tribes.set('tribe-b', { id: 'tribe-b', isMerged: false })
    h.tribes.set('merged-1', { id: 'merged-1', isMerged: true })
    h.snapshot = null
  })

  it('league chat and non-tribe sources are open to the member', async () => {
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', null)).toBe(true)
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', undefined)).toBe(true)
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'draft')).toBe(true)
  })

  it('an active manager reads their own huddle and not another tribe’s', async () => {
    h.snapshot = manager('tribe-a')
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-a')).toBe(true)
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-b')).toBe(false)
  })

  it('a tribe that does not belong to the league is refused', async () => {
    h.snapshot = manager('tribe-a')
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_nope')).toBe(false)
  })

  it('a non-playing commissioner host reads every huddle', async () => {
    h.snapshot = { ...manager('tribe-a'), role: 'commissioner', player: null, roster: null }
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-a')).toBe(true)
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-b')).toBe(true)
  })

  it('a playing commissioner is a manager: own tribe only', async () => {
    h.snapshot = { ...manager('tribe-a'), role: 'commissioner', settings: { commissionerParticipationMode: 'participating_player' } }
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-a')).toBe(true)
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-b')).toBe(false)
  })

  it('after the merge the merged tribe is the huddle and the old one closes', async () => {
    h.snapshot = manager('merged-1', { canAccessTribeChat: false, canAccessMergeChat: true })
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_merged-1')).toBe(true)
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-a')).toBe(false)
  })

  it('an eliminated manager loses the huddle', async () => {
    h.snapshot = manager('tribe-a', { playerState: 'exile', canAccessTribeChat: false })
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-a')).toBe(false)
  })

  it('someone who is not in the league is refused', async () => {
    h.snapshot = { role: null, leagueOwnerUserId: 'owner-1', settings: {}, player: null, roster: null }
    expect(await canAccessSurvivorTribeChatSource('league-1', 'u', 'tribe_tribe-a')).toBe(false)
  })
})

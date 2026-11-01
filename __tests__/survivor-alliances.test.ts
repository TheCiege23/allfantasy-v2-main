// @vitest-environment node
/**
 * Alliance chats: who may open one, host visibility, and the send guard (voted-out members lose
 * posting; a non-playing host posts in tribe huddles but never in an alliance).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), findFirst: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorChatChannel: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    roster: { findFirst: vi.fn() },
  },
  chat: vi.fn(),
  access: vi.fn(),
  audit: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: h.chat }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: h.access }))
vi.mock('@/lib/survivor/auditEntry', () => ({ logSurvivorAuditEntry: h.audit }))

import { validateAllianceRequest } from '@/lib/survivor/survivorAlliancePolicy'
import { createSurvivorAlliance, leaveSurvivorAlliance } from '@/lib/survivor/survivorAlliances'
import { canSendToChannel } from '@/lib/survivor/chatPermissionGuard'

const cast = [
  { userId: 'u1', displayName: 'Ana', playerState: 'active', tribeId: 'scorps' },
  { userId: 'u2', displayName: 'Ben', playerState: 'active', tribeId: 'scorps' },
  { userId: 'u3', displayName: 'Cy', playerState: 'active', tribeId: 'shrooms' },
  { userId: 'u4', displayName: 'Dee', playerState: 'eliminated', tribeId: null },
]
const on = { alliancesEnabled: true, allianceMaxSize: 3, allianceSameTribeOnly: false }

describe('validateAllianceRequest', () => {
  const base = { settings: on, creator: cast[0]!, cast, name: 'The Core', merged: false, existingMemberSets: [] as string[][] }
  it('accepts active castaways up to the size', () => {
    expect(validateAllianceRequest({ ...base, requestedUserIds: ['u2', 'u3'] })).toEqual({ ok: true, name: 'The Core', memberUserIds: ['u1', 'u2', 'u3'] })
  })
  it('refuses: off, out creator, voted-out invitee, too big, Chimmy, other tribe, duplicate', () => {
    expect(validateAllianceRequest({ ...base, settings: { ...on, alliancesEnabled: false }, requestedUserIds: ['u2'] })).toMatchObject({ ok: false, code: 'disabled' })
    expect(validateAllianceRequest({ ...base, creator: cast[3]!, requestedUserIds: ['u2'] })).toMatchObject({ ok: false, code: 'not_active' })
    expect(validateAllianceRequest({ ...base, requestedUserIds: ['u4'] })).toMatchObject({ ok: false, code: 'bad_members' })
    expect(validateAllianceRequest({ ...base, settings: { ...on, allianceMaxSize: 2 }, requestedUserIds: ['u2', 'u3'] })).toMatchObject({ ok: false, code: 'too_big' })
    expect(validateAllianceRequest({ ...base, requestedUserIds: ['survivor-ai-host'] })).toMatchObject({ ok: false, code: 'host' })
    expect(validateAllianceRequest({ ...base, settings: { ...on, allianceSameTribeOnly: true }, requestedUserIds: ['u3'] })).toMatchObject({ ok: false, code: 'cross_tribe' })
    expect(validateAllianceRequest({ ...base, settings: { ...on, allianceSameTribeOnly: true }, merged: true, requestedUserIds: ['u3'] }).ok).toBe(true)
    expect(validateAllianceRequest({ ...base, requestedUserIds: ['u2'], existingMemberSets: [['u2', 'u1']] })).toMatchObject({ ok: false, code: 'duplicate' })
    expect(validateAllianceRequest({ ...base, requestedUserIds: [] })).toMatchObject({ ok: false, code: 'too_small' })
  })
})

describe('creating and leaving alliances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', language: 'en', survivorMode: true, settings: { commissionerParticipationMode: 'non_participating_host', survivorGovernance: { alliancesEnabled: true, allianceMaxSize: 4 } } })
    h.db.survivorPlayer.findMany.mockResolvedValue(cast)
    h.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', mergeTriggeredAt: null })
    h.db.survivorChatChannel.findMany.mockResolvedValue([])
    h.db.survivorChatChannel.create.mockResolvedValue({ id: 'ch-1' })
    h.db.survivorPlayer.findFirst.mockResolvedValue(null)
    h.db.roster.findFirst.mockResolvedValue(null)
    h.chat.mockResolvedValue({})
  })

  it('members only by default; the audit carries no member list', async () => {
    const result = await createSurvivorAlliance('L1', 'u1', { name: '  The   Core ', memberUserIds: ['u2'] })
    expect(result).toEqual({ ok: true, channelId: 'ch-1', name: 'The Core', memberUserIds: ['u1', 'u2'] })
    expect(h.db.survivorChatChannel.create).toHaveBeenCalledWith({ data: { leagueId: 'L1', name: 'The Core', channelType: 'alliance', memberUserIds: ['u1', 'u2'], readOnlyUserIds: [] }, select: { id: true } })
    const audit = h.db.survivorAuditEntry.create.mock.calls[0]![0].data
    expect(JSON.stringify(audit.data)).not.toContain('u2')
    expect(audit.isVisibleToCommissioner).toBe(false)
  })

  it('with host reading on, a non-playing host joins read-only', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', language: 'en', survivorMode: true, settings: { commissionerParticipationMode: 'non_participating_host', survivorGovernance: { alliancesEnabled: true, allianceHostCanRead: true } } })
    await createSurvivorAlliance('L1', 'u1', { name: 'Core', memberUserIds: ['u2'] })
    expect(h.db.survivorChatChannel.create.mock.calls[0]![0].data).toMatchObject({ memberUserIds: ['u1', 'u2', 'host'], readOnlyUserIds: ['host'] })
  })

  it('a playing commissioner is never added as a reader', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', language: 'en', survivorMode: true, settings: { commissionerParticipationMode: 'participating_player', survivorGovernance: { alliancesEnabled: true, allianceHostCanRead: true } } })
    await createSurvivorAlliance('L1', 'u1', { name: 'Core', memberUserIds: ['u2'] })
    expect(h.db.survivorChatChannel.create.mock.calls[0]![0].data).toMatchObject({ readOnlyUserIds: [] })
  })

  it('leaving closes an alliance that would be left with one castaway', async () => {
    h.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'ch-1', memberUserIds: ['u1', 'u2', 'host'], readOnlyUserIds: ['host'] })
    expect(await leaveSurvivorAlliance('L1', 'u1', 'ch-1')).toEqual({ ok: true, archived: true })
    expect(h.db.survivorChatChannel.update).toHaveBeenCalledWith({ where: { id: 'ch-1' }, data: expect.objectContaining({ memberUserIds: ['u2', 'host'], isArchived: true }) })
  })
})

describe('the send guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.access.mockResolvedValue({ isNonParticipatingCommissionerHost: false })
  })
  const channel = (type: string, members: string[]) => ({ id: 'c', leagueId: 'L1', channelType: type, memberUserIds: members, isArchived: false })

  it('an alliance member who is voted out can no longer post', async () => {
    h.db.survivorPlayer.findFirst.mockResolvedValue({ playerState: 'eliminated' })
    h.db.survivorChatChannel.findFirst.mockResolvedValue(channel('alliance', ['u1', 'u4']))
    expect(await canSendToChannel('L1', 'u4', 'c')).toEqual({ allowed: false, reason: 'alliance_access_revoked' })
    h.db.survivorPlayer.findFirst.mockResolvedValue({ playerState: 'active' })
    expect(await canSendToChannel('L1', 'u1', 'c')).toEqual({ allowed: true })
  })

  it('a non-playing host with no player row posts in a tribe huddle', async () => {
    h.db.survivorPlayer.findFirst.mockResolvedValue(null)
    h.db.survivorChatChannel.findFirst.mockResolvedValue(channel('tribe', ['u1', 'host']))
    h.access.mockResolvedValue({ isNonParticipatingCommissionerHost: true })
    expect(await canSendToChannel('L1', 'host', 'c')).toEqual({ allowed: true })
  })

  it('a playing commissioner who is out stays read-only in the huddle', async () => {
    h.db.survivorPlayer.findFirst.mockResolvedValue({ playerState: 'eliminated', canAccessTribeChat: false })
    h.db.survivorChatChannel.findFirst.mockResolvedValue(channel('tribe', ['host']))
    expect(await canSendToChannel('L1', 'host', 'c')).toEqual({ allowed: false, reason: 'tribe_access_revoked' })
  })

  it('a host reading an alliance cannot post in it', async () => {
    h.db.survivorPlayer.findFirst.mockResolvedValue(null)
    h.db.survivorChatChannel.findFirst.mockResolvedValue(channel('alliance', ['u1', 'u2', 'host']))
    h.access.mockResolvedValue({ isNonParticipatingCommissionerHost: true })
    expect(await canSendToChannel('L1', 'host', 'c')).toEqual({ allowed: false, reason: 'alliance_access_revoked' })
  })
})

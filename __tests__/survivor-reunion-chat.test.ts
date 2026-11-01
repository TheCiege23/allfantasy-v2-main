// @vitest-environment node
/**
 * The reunion: after a champion is crowned, Island Chat reopens to voted-out managers (commissioner
 * toggle, default on), once, with one welcome line.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    survivorPlayer: { findFirst: vi.fn(), findMany: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn(), update: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findUnique: vi.fn() },
    league: { findUnique: vi.fn() },
    jurySession: { findUnique: vi.fn() },
  },
  post: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: h.post }))

import { canSendToChannel } from '@/lib/survivor/chatPermissionGuard'
import { isReunionOpen, openReunionChatOnce, reunionAnnouncement } from '@/lib/survivor/survivorReunion'

beforeEach(() => {
  vi.clearAllMocks()
  h.db.survivorPlayer.findFirst.mockResolvedValue({ playerState: 'eliminated' })
  h.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'ch', channelType: 'league', isArchived: false, memberUserIds: ['out'] })
  h.db.league.findUnique.mockResolvedValue({ settings: {}, language: 'en' })
  h.db.jurySession.findUnique.mockResolvedValue(null)
  h.db.survivorAuditEntry.create.mockResolvedValue({})
  h.db.survivorAuditEntry.findUnique.mockResolvedValue(null)
})

describe('Island Chat for a voted-out manager', () => {
  it('stays read-only until a champion is crowned', async () => {
    expect(await canSendToChannel('L1', 'out', 'ch')).toEqual({ allowed: false, reason: 'eliminated_read_only' })
  })

  it('reopens for the reunion once a champion is crowned', async () => {
    h.db.jurySession.findUnique.mockResolvedValue({ winnerId: 'champ' })
    expect(await canSendToChannel('L1', 'out', 'ch')).toEqual({ allowed: true })
  })

  it('stays closed after the finale when the commissioner turned the reunion off', async () => {
    h.db.jurySession.findUnique.mockResolvedValue({ winnerId: 'champ' })
    h.db.league.findUnique.mockResolvedValue({ settings: { reunionChatEnabled: false } })
    expect((await canSendToChannel('L1', 'out', 'ch')).allowed).toBe(false)
  })
})

describe('openReunionChatOnce', () => {
  it('adds every manager back, posts one welcome in the league language, and only once', async () => {
    h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'out' }, { userId: 'jury1' }, { userId: 'champ' }])
    h.db.league.findUnique.mockResolvedValue({ settings: {}, language: 'es' })
    expect(await openReunionChatOnce('L1', 'Ana')).toBe('opened')
    expect(h.db.survivorChatChannel.update).toHaveBeenCalledWith({ where: { id: 'ch' }, data: { memberUserIds: ['out', 'jury1', 'champ'] } })
    expect(h.post).toHaveBeenCalledTimes(1)
    expect(h.post.mock.calls[0]![1].data.content).toContain('reunión')
    h.db.survivorAuditEntry.findUnique.mockResolvedValue({ id: 'survivor-reunion:L1' })
    expect(await openReunionChatOnce('L1', 'Ana')).toBe('already_open')
    expect(h.post).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the commissioner turned it off', async () => {
    h.db.league.findUnique.mockResolvedValue({ settings: { reunionChatEnabled: false } })
    expect(await openReunionChatOnce('L1', 'Ana')).toBe('disabled')
    expect(h.post).not.toHaveBeenCalled()
  })

  it('pure gate and copy', () => {
    expect(isReunionOpen({ reunionChatEnabled: true, crowned: false })).toBe(false)
    expect(isReunionOpen({ reunionChatEnabled: true, crowned: true })).toBe(true)
    expect(reunionAnnouncement('en', 'Ana')).toContain('Welcome to the reunion')
  })
})

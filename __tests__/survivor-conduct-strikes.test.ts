// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorPlayer: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorAuditEntry: { create: vi.fn(), findMany: vi.fn() },
    leagueChatMessage: { create: vi.fn() },
  },
  remove: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/survivor/survivorRemovePlayer', () => ({ removeSurvivorPlayer: h.remove }))

import { activeConductStrikes, conductStrikeOutcome, validateStrikeReason } from '@/lib/survivor/survivorConductStrikes'
import { issueSurvivorConductStrike, revokeSurvivorConductStrike } from '@/lib/survivor/survivorConductService'

const issued = (id: string, userId: string, reason: string, at: string) => ({ id, action: 'conduct_strike_issued', targetUserId: userId, week: 3, createdAt: at, data: { reason } })
const revoked = (strikeId: string, userId: string) => ({ id: `rv-${strikeId}`, action: 'conduct_strike_revoked', targetUserId: userId, week: 3, createdAt: '2026-10-05T00:00:00Z', data: { strikeId } })

describe('strike rules', () => {
  it('counts standing strikes per castaway, minus withdrawals', () => {
    const rows = [issued('s1', 'u1', 'Spam', '2026-10-01T00:00:00Z'), issued('s2', 'u1', 'Insults', '2026-10-02T00:00:00Z'), issued('s3', 'u2', 'Spam', '2026-10-03T00:00:00Z'), revoked('s1', 'u1')]
    expect(activeConductStrikes(rows, 'u1').map((s) => s.id)).toEqual(['s2'])
    expect(activeConductStrikes(rows).map((s) => s.userId)).toEqual(['u1', 'u2'])
  })
  it('the original policy: a warning, then removal (when automatic removal is on)', () => {
    expect(conductStrikeOutcome(1, { strikeLimit: 2, strikeAutoRemove: true })).toEqual({ limitReached: false, removeNow: false, remaining: 1 })
    expect(conductStrikeOutcome(2, { strikeLimit: 2, strikeAutoRemove: true })).toEqual({ limitReached: true, removeNow: true, remaining: 0 })
    expect(conductStrikeOutcome(2, { strikeLimit: 2, strikeAutoRemove: false })).toEqual({ limitReached: true, removeNow: false, remaining: 0 })
  })
  it('a reason is required', () => {
    expect(validateStrikeReason(' x ')).toMatch(/reason/)
    expect(validateStrikeReason('x'.repeat(281))).toMatch(/280/)
    expect(validateStrikeReason('Repeated insults in league chat')).toBeNull()
  })
})

describe('issuing and withdrawing a strike', () => {
  let rows: Array<ReturnType<typeof issued> | ReturnType<typeof revoked>>
  beforeEach(() => {
    vi.clearAllMocks()
    rows = []
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', language: 'en', settings: { survivorGovernance: { strikeLimit: 2, strikeAutoRemove: true } } })
    h.db.survivorPlayer.findUnique.mockResolvedValue({ playerState: 'active', displayName: 'Jordan' })
    h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 4 })
    h.db.survivorAuditEntry.create.mockImplementation(async ({ data }: { data: { action: string; targetUserId: string; data: Record<string, unknown> } }) => {
      const id = `s${rows.length + 1}`
      rows.push(data.action === 'conduct_strike_issued' ? issued(id, data.targetUserId, String(data.data.reason), `2026-10-0${rows.length + 1}T00:00:00Z`) : revoked(String(data.data.strikeId), data.targetUserId))
      return { id }
    })
    h.db.survivorAuditEntry.findMany.mockImplementation(async () => rows)
    h.db.leagueChatMessage.create.mockResolvedValue({})
  })

  it('first strike warns privately; the second removes the castaway through the shared removal', async () => {
    const first = await issueSurvivorConductStrike('L1', { targetUserId: 'u1', reason: 'Harassing a tribemate', actorUserId: 'host' })
    expect(first).toEqual({ ok: true, strikeId: 's1', activeStrikes: 1, limit: 2, limitReached: false, removed: false })
    expect(h.db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ category: 'conduct', action: 'conduct_strike_issued', targetUserId: 'u1', isVisibleToPublic: false }), select: { id: true } })
    const dm = h.db.leagueChatMessage.create.mock.calls[0]![0].data
    expect(dm).toMatchObject({ isPrivate: true, visibleToUserId: 'u1', messageSubtype: 'chimmy_private' })
    expect(dm.message).toContain('strike 1 of 2')
    expect(h.remove).not.toHaveBeenCalled()

    const second = await issueSurvivorConductStrike('L1', { targetUserId: 'u1', reason: 'Again', actorUserId: 'host' })
    expect(second).toMatchObject({ ok: true, activeStrikes: 2, limitReached: true, removed: true })
    expect(h.remove).toHaveBeenCalledWith('L1', expect.objectContaining({ targetUserId: 'u1', commissionerId: 'host', actionType: 'remove_player_conduct' }))
  })

  it('without automatic removal the limit is reported, not acted on', async () => {
    h.db.league.findUnique.mockResolvedValue({ userId: 'host', language: 'es', settings: { survivorGovernance: { strikeLimit: 1, strikeAutoRemove: false } } })
    const result = await issueSurvivorConductStrike('L1', { targetUserId: 'u1', reason: 'Spam', actorUserId: 'host' })
    expect(result).toMatchObject({ ok: true, limitReached: true, removed: false })
    expect(h.remove).not.toHaveBeenCalled()
    expect(h.db.leagueChatMessage.create.mock.calls[0]![0].data.message).toContain('falta de conducta 1 de 1')
  })

  it('refuses a missing reason, an unknown castaway and one already out', async () => {
    expect(await issueSurvivorConductStrike('L1', { targetUserId: 'u1', reason: '', actorUserId: 'host' })).toMatchObject({ ok: false, status: 400 })
    h.db.survivorPlayer.findUnique.mockResolvedValueOnce(null)
    expect(await issueSurvivorConductStrike('L1', { targetUserId: 'nobody', reason: 'Spam spam', actorUserId: 'host' })).toMatchObject({ ok: false, status: 404 })
    h.db.survivorPlayer.findUnique.mockResolvedValueOnce({ playerState: 'eliminated', displayName: 'Jordan' })
    expect(await issueSurvivorConductStrike('L1', { targetUserId: 'u1', reason: 'Spam spam', actorUserId: 'host' })).toMatchObject({ ok: false, status: 409 })
  })

  it('withdraws the latest strike', async () => {
    await issueSurvivorConductStrike('L1', { targetUserId: 'u1', reason: 'Harassing', actorUserId: 'host' })
    expect(await revokeSurvivorConductStrike('L1', { targetUserId: 'u1', reason: '', actorUserId: 'host', strikeId: null })).toEqual({ ok: true, activeStrikes: 0 })
    expect(await revokeSurvivorConductStrike('L1', { targetUserId: 'u1', reason: '', actorUserId: 'host', strikeId: null })).toMatchObject({ ok: false, status: 404 })
  })
})

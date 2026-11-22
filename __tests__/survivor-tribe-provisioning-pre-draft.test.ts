// @vitest-environment node
/**
 * Tribes exist BEFORE the draft (owner's call, 2026-10-20). The locked plan writes SurvivorTribe +
 * SurvivorTribeMember rows keyed by Roster id through assignSurvivorTribes in `preDraft` mode:
 * no SurvivorPlayer row is required, the game state stays pre_draft, and the post-draft run
 * (which finds the tribes already assigned) is what stamps the counts onto the game state.
 */
import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: vi.fn() }))

import { assignSurvivorTribes } from '@/lib/survivor/survivorTribeProvisioning'

const db = {
  survivorTribe: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  survivorTribeMember: { create: vi.fn(), deleteMany: vi.fn() },
  survivorPlayer: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  survivorLeagueConfig: { findUnique: vi.fn(), create: vi.fn() },
  survivorAuditEntry: { create: vi.fn() },
  survivorGameState: { upsert: vi.fn() },
  league: { findUnique: vi.fn() },
}
const tx = db as unknown as Prisma.TransactionClient

const participants = Array.from({ length: 6 }, (_, i) => ({ userId: `u${i}`, rosterId: `roster-${i}`, displayName: `Manager ${i}` }))
const mapping = Object.fromEntries(participants.map((p, i) => [p.userId, i % 2]))

beforeEach(() => {
  vi.resetAllMocks()
  db.survivorTribe.findMany.mockResolvedValue([])
  db.league.findUnique.mockResolvedValue({ sport: 'NBA', settings: { defaultTeamCount: 6, tribeCount: 2 } })
  db.survivorLeagueConfig.findUnique.mockResolvedValue(null)
  db.survivorLeagueConfig.create.mockResolvedValue({ id: 'cfg' })
  let n = 0
  db.survivorTribe.create.mockImplementation(async () => ({ id: `tribe-${n++}` }))
  db.survivorPlayer.updateMany.mockResolvedValue({ count: 0 })
})

describe('assignSurvivorTribes before the draft', () => {
  it('writes tribes and roster-keyed members from the given cast, touches no player rows, and leaves the game state alone', async () => {
    const out = await assignSurvivorTribes('lg', { db: tx, mode: 'commissioner_manual', manualMapping: mapping, tribeCount: 2, participants, preDraft: true, actorUserId: 'commish' })
    expect(out).toMatchObject({ ok: true, created: true, alreadyAssigned: false })
    expect(out.ok && out.tribes.map(t => t.memberCount)).toEqual([3, 3])
    // Members point at the seats (Roster ids), which is what the post-draft cast links to.
    expect(db.survivorTribeMember.create).toHaveBeenCalledTimes(6)
    expect(db.survivorTribeMember.create.mock.calls.map(c => c[0].data)).toEqual(expect.arrayContaining([
      { tribeId: 'tribe-0', rosterId: 'roster-0' }, { tribeId: 'tribe-1', rosterId: 'roster-1' },
    ]))
    // No SurvivorPlayer rows exist yet: the link is updateMany (a no-op), never update (a throw).
    expect(db.survivorPlayer.findMany).not.toHaveBeenCalled()
    expect(db.survivorPlayer.update).not.toHaveBeenCalled()
    expect(db.survivorPlayer.updateMany).toHaveBeenCalledTimes(6)
    expect(db.survivorGameState.upsert).not.toHaveBeenCalled()
    expect(db.survivorAuditEntry.create.mock.calls[0][0].data).toMatchObject({ action: 'tribes_assigned', data: expect.objectContaining({ preDraft: true, sizes: [3, 3] }) })
  })

  it('refuses a mapping that does not cover the given cast, writing nothing', async () => {
    const out = await assignSurvivorTribes('lg', { db: tx, mode: 'commissioner_manual', manualMapping: { u0: 0 }, tribeCount: 2, participants, preDraft: true })
    expect(out).toMatchObject({ ok: false, code: 'manual_invalid' })
    expect(db.survivorTribe.create).not.toHaveBeenCalled()
  })

  it('the post-draft run finds the tribes already assigned and stamps the counts on the game state', async () => {
    db.survivorTribe.findMany.mockResolvedValue([
      { id: 'tribe-0', slotIndex: 0, name: 'A', members: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] },
      { id: 'tribe-1', slotIndex: 1, name: 'B', members: [{ id: 'm4' }, { id: 'm5' }, { id: 'm6' }] },
    ])
    const out = await assignSurvivorTribes('lg', { db: tx, mode: 'commissioner_manual', manualMapping: mapping, tribeCount: 2 })
    expect(out).toMatchObject({ ok: true, created: false, alreadyAssigned: true })
    expect(db.survivorGameState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ phase: 'pre_merge', activeTribeCount: 2, activePlayerCount: 6 }),
      update: { activeTribeCount: 2, activePlayerCount: 6 },
    }))
    expect(db.survivorTribe.create).not.toHaveBeenCalled()
  })
})

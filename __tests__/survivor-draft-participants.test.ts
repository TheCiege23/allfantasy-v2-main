import type { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareSurvivorDraftParticipants } from '@/lib/survivor/survivorDraftParticipants'

const rosters = Array.from({ length: 16 }, (_, i) => ({ id: `roster-${i}`, platformUserId: `user-${i}` }))
const users = rosters.map((r, i) => ({ id: r.platformUserId, displayName: `Manager ${i}`, username: `manager${i}` }))
const db = {
  league: { findUnique: vi.fn() }, draftSession: { findFirst: vi.fn() }, survivorGameState: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() }, appUser: { findMany: vi.fn() },
  survivorPlayer: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  survivorTribe: { findMany: vi.fn() }, survivorIdol: { count: vi.fn() }, survivorAuditEntry: { findFirst: vi.fn() },
}
const tx = db as unknown as Prisma.TransactionClient
const prepare = () => prepareSurvivorDraftParticipants('league', 'draft', tx)

describe('Survivor drafted cast reconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    db.league.findUnique.mockResolvedValue({ userId: 'user-0', platform: 'allfantasy', survivorMode: true,
      settings: { defaultTeamCount: 16, commissionerParticipationMode: 'participating_player' } })
    db.draftSession.findFirst.mockResolvedValue({ id: 'draft', status: 'completed', sessionKind: 'live', teamCount: 16,
      slotOrder: rosters.map((r, i) => ({ slot: i + 1, rosterId: r.id })).reverse() })
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_draft', currentWeek: 0 })
    db.roster.findMany.mockResolvedValue(rosters)
    db.appUser.findMany.mockResolvedValue(users)
    db.survivorPlayer.findMany.mockResolvedValue([])
    db.survivorTribe.findMany.mockResolvedValue([])
    db.survivorIdol.count.mockResolvedValue(0)
    db.survivorPlayer.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('links late-joining managers to actual Roster IDs and uses slot order, not draft pick ownership', async () => {
    expect(await prepare()).toEqual({ ok: true, alreadyStarted: false, draftOrder: users.map((u) => u.id) })
    expect(db.survivorPlayer.upsert).toHaveBeenCalledTimes(16)
    expect(db.survivorPlayer.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      create: expect.objectContaining({ userId: 'user-1', redraftRosterId: 'roster-1', displayName: 'Manager 1' }),
      update: { redraftRosterId: 'roster-1' },
    }))
  })
  it('removes only unused creation placeholders and preserves real player state on update', async () => {
    db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'open-slot-league-2', playerState: 'active', tribeId: null, idolIds: [] }])
    expect((await prepare()).ok).toBe(true)
    expect(db.survivorPlayer.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({
      userId: { startsWith: 'open-slot-league-', notIn: users.map((u) => u.id) }, tribeId: null, idolIds: { isEmpty: true },
    }) })
    expect(db.survivorPlayer.upsert.mock.calls[0][0].update).not.toHaveProperty('playerState')
  })
  it('requires an owner for every drafted seat before any cast writes', async () => {
    db.appUser.findMany.mockResolvedValue(users.slice(1))
    expect(await prepare()).toMatchObject({ ok: false, code: 'unclaimed_seats' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
    expect(db.survivorPlayer.deleteMany).not.toHaveBeenCalled()
  })
  it('blocks a drafted commissioner configured as a non-participating host', async () => {
    db.league.findUnique.mockResolvedValue({ userId: 'user-0', platform: 'allfantasy', survivorMode: true, settings: {} })
    expect(await prepare()).toMatchObject({ ok: false, code: 'host_owns_team' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
  })
  it('supports a non-participating host who does not occupy a drafted seat', async () => {
    db.league.findUnique.mockResolvedValue({ userId: 'host', platform: 'allfantasy', survivorMode: true, settings: {} })
    expect((await prepare()).ok).toBe(true)
    expect(db.survivorPlayer.upsert.mock.calls.some(([args]) => args.create.userId === 'host')).toBe(false)
  })
  it.each(['mock', 'in_progress', 'superseded', 'provider'])('does not initialize a %s draft', async (reason) => {
    const base = await db.draftSession.findFirst()
    db.draftSession.findFirst.mockResolvedValue({ ...base, ...(reason === 'mock' ? { sessionKind: 'mock' }
      : reason === 'superseded' ? { id: 'newer-draft' } : reason === 'provider' ? { sleeperDraftId: 'external' } : { status: reason }) })
    expect(await prepare()).toMatchObject({ ok: false, code: 'draft_not_ready' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
  })
  it('refuses automatic mutation of an imported league', async () => {
    db.league.findUnique.mockResolvedValue({ platform: 'sleeper', survivorMode: true })
    expect(await prepare()).toMatchObject({ ok: false, code: 'not_native_survivor' })
    expect(db.roster.findMany).not.toHaveBeenCalled()
  })
  it('rejects duplicated or missing draft slots', async () => {
    const base = await db.draftSession.findFirst()
    db.draftSession.findFirst.mockResolvedValue({ ...base, slotOrder: base.slotOrder.map(() => base.slotOrder[0]) })
    expect(await prepare()).toMatchObject({ ok: false, code: 'cast_mismatch' })
  })
  it('preserves progressed gameplay, including eliminated and Exile players', async () => {
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'post_merge', currentWeek: 8 })
    expect(await prepare()).toEqual({ ok: true, alreadyStarted: true, draftOrder: [] })
    expect(db.roster.findMany).not.toHaveBeenCalled()
    expect(db.survivorPlayer.deleteMany).not.toHaveBeenCalled()
  })
  it('preserves older hidden inventories for review instead of reseeding them', async () => {
    db.survivorIdol.count.mockResolvedValue(2)
    db.survivorAuditEntry.findFirst.mockResolvedValue(null)
    expect(await prepare()).toMatchObject({ ok: false, code: 'legacy_inventory_requires_review' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
  })
  it('does not remove departed real players or unused placeholders that already hold idols', async () => {
    db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'open-slot-league-2', playerState: 'active', tribeId: null, idolIds: ['idol'] }])
    expect(await prepare()).toMatchObject({ ok: false, code: 'existing_cast_requires_review' })
    expect(db.survivorPlayer.deleteMany).not.toHaveBeenCalled()
  })
  it('reconciles complete preassigned tribes without changing their membership', async () => {
    db.survivorTribe.findMany.mockResolvedValue(Array.from({ length: 4 }, (_, i) => ({
      id: `tribe-${i}`, members: rosters.slice(i * 4, i * 4 + 4).map((r) => ({ rosterId: r.id })),
    })))
    expect((await prepare()).ok).toBe(true)
    expect(db.survivorPlayer.upsert.mock.calls[0][0].update).toEqual({ redraftRosterId: 'roster-0', tribeId: 'tribe-0' })
  })
  it('blocks incomplete existing tribes instead of inventing assignments', async () => {
    db.survivorTribe.findMany.mockResolvedValue([{ id: 'tribe', members: [{ rosterId: 'roster-0' }] }])
    expect(await prepare()).toMatchObject({ ok: false, code: 'existing_tribes_require_review' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
  })
  it('blocks one user owning multiple Survivor seats before any cast writes', async () => {
    db.roster.findMany.mockResolvedValue(rosters.map((r, i) => i === 15 ? { ...r, platformUserId: 'user-0' } : r))
    expect(await prepare()).toMatchObject({ ok: false, code: 'duplicate_owners' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
  })
  function transferredHost(extra: Record<string, unknown> = {}) {
    db.league.findUnique.mockResolvedValue({ userId: 'host', platform: 'allfantasy', survivorMode: true, settings: {} })
    db.survivorPlayer.findMany.mockResolvedValue([{ id: 'host-cast', userId: 'host', playerState: 'active', tribeId: null, idolIds: [],
      tokenBalance: 0, totalTokensEarned: 0, eliminatedWeek: null, isJuryMember: false, isFinalist: false, hasImmunityThisWeek: false, ...extra }])
  }
  it('removes only the unused creator cast entry after a host transfers their team', async () => {
    transferredHost()
    db.survivorPlayer.deleteMany.mockResolvedValue({ count: 1 })
    expect((await prepare()).ok).toBe(true)
    expect(db.survivorPlayer.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: 'host-cast', userId: 'host', tokenBalance: 0, totalTokensEarned: 0 }) })
    expect(db.survivorPlayer.upsert.mock.calls.some(([args]) => args.create.userId === 'host')).toBe(false)
  })
  it.each([{ tokenBalance: 1 }, { totalTokensEarned: 1 }, { idolIds: ['secret'] }, { tribeId: 'tribe' }])('preserves a host entry with gameplay state: %j', async (state) => {
    transferredHost(state)
    expect(await prepare()).toMatchObject({ ok: false, code: 'existing_cast_requires_review' })
    expect(db.survivorPlayer.deleteMany).not.toHaveBeenCalled()
  })
  it('preserves concurrent host changes instead of adding an extra tribe participant', async () => {
    transferredHost()
    db.survivorPlayer.deleteMany.mockResolvedValue({ count: 0 })
    expect(await prepare()).toMatchObject({ ok: false, code: 'existing_cast_requires_review' })
    expect(db.survivorPlayer.upsert).not.toHaveBeenCalled()
  })
})

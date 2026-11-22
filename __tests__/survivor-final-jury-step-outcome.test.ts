// @vitest-environment node
/**
 * A castaway cut by the final jury step goes through the league's NORMAL elimination outcome — the
 * same code a Tribal vote-out runs (eliminateCastawayInTransaction in survivorEliminationService):
 * roster released to waivers, or Exile Island when it is on. They join the jury, and their pending
 * trades are voided. Real elimination service; only Prisma and side channels are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const state = { applied: false, settings: {} as Record<string, unknown> }
  const db = {
    $queryRaw: vi.fn(async () => []),
    league: { findUnique: vi.fn(async () => ({ settings: state.settings, survivorFinal3: true, language: 'en', platform: 'manual' })) },
    survivorAuditEntry: {
      findFirst: vi.fn(async ({ where }: { where: { action: string } }) => (where.action === 'final_jury_step_applied' && state.applied ? { id: 'gate' } : null)),
      create: vi.fn(async ({ data }: { data: { action: string } }) => { if (data.action === 'final_jury_step_applied') state.applied = true; return {} }),
      update: vi.fn(),
    },
    survivorNotification: { create: vi.fn() },
    survivorGameState: { findUnique: vi.fn(async () => ({ phase: 'jury' })), upsert: vi.fn() },
    survivorPlayer: {
      findMany: vi.fn(async () => ['1', '2', '3', '4'].map((n) => ({ userId: `u${n}`, displayName: `P${n}`, redraftRosterId: `r${n}` }))),
      findUnique: vi.fn(async () => ({ id: 'p-u4', userId: 'u4', playerState: 'active', redraftRosterId: 'r4' })),
      update: vi.fn(), count: vi.fn(async () => 3),
    },
    roster: { findFirst: vi.fn(async () => ({ id: 'r4', redraftRosterId: 'season-r4', playerData: ['athlete-1'] })), update: vi.fn(), create: vi.fn() },
    redraftRoster: { findFirst: vi.fn(async () => ({ id: 'season-r4', seasonId: 'season', season: { season: 2026 } })), update: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn(async () => [{ playerId: 'athlete-1' }, { playerId: 'athlete-2' }]), updateMany: vi.fn() },
    redraftRosterMoveHistory: { create: vi.fn() },
    waiverClaim: { updateMany: vi.fn() },
    survivorTribeMember: { deleteMany: vi.fn() },
    survivorJuryMember: { upsert: vi.fn() },
    survivorChatChannel: { findMany: vi.fn(async () => [{ id: 'merge', memberUserIds: ['u1', 'u4'] }]), findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 'exile-ch', memberUserIds: ['u4'] })), update: vi.fn() },
    exileIsland: { upsert: vi.fn() },
    survivorExileLeague: { findUnique: vi.fn(async () => null) },
    survivorChallenge: { findMany: vi.fn(async () => [{ id: 'c-final', configJson: { builder: 1, kind: 'closest_without_going_over', scope: 'individual', opensAt: '', locksAt: '' }, resultJson: { outcome: 'settled', truth: { value: 47 }, immunityRosterIds: ['r1'] } }]) },
    survivorChallengeSubmission: { findMany: vi.fn(async () => [
      { rosterId: 'r1', submission: { answer: { value: 45 } }, submittedAt: new Date('2026-12-20T18:01:00Z') },
      { rosterId: 'r2', submission: { answer: { value: 40 } }, submittedAt: new Date('2026-12-20T18:02:00Z') },
      { rosterId: 'r3', submission: { answer: { value: 52 } }, submittedAt: new Date('2026-12-20T18:03:00Z') },
    ]) },
  }
  return { state, db, voidTrades: vi.fn(async () => 0), removeTribeChat: vi.fn(async () => {}), chat: vi.fn(async () => ({})) }
})
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { ...m.db, $transaction: (fn: (tx: typeof m.db) => unknown) => fn(m.db) } }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: m.chat }))
vi.mock('@/lib/redraft/voidPendingTradesForElimination', () => ({ voidPendingRedraftTradesForRoster: m.voidTrades }))
vi.mock('@/lib/survivor/SurvivorChatMembershipService', () => ({ removeRosterFromTribeChat: m.removeTribeChat }))
vi.mock('@/lib/survivor/SurvivorSitOutEngine', () => ({ maybeTriggerSurvivorTribeShuffleRecommendation: vi.fn() }))
vi.mock('@/lib/survivor/playerBoundIdolTransfer', () => ({ movePlayerBoundIdolsInTransaction: vi.fn(async () => {}) }))

import { applyFinalJuryStepIfDue } from '@/lib/survivor/survivorFinalJuryStepService'

const step = { finalJuryStepEnabled: true, finalJuryStepCount: 1, finalistCount: 3, juryEnabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  m.state.applied = false
})

describe('final jury step: the league’s elimination outcome', () => {
  it('removed_to_waivers: releases the roster to waivers, joins the jury, voids trades', async () => {
    m.state.settings = { ...step, exileIslandEnabled: false }
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('applied')
    // The roster is released exactly as after a Tribal.
    expect(m.db.redraftRosterPlayer.updateMany).toHaveBeenCalledWith({ where: { rosterId: 'season-r4', droppedAt: null }, data: expect.objectContaining({ isLocked: false }) })
    expect(m.db.redraftRoster.update).toHaveBeenCalledWith({ where: { id: 'season-r4' }, data: { isEliminated: true } })
    expect(m.db.waiverClaim.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', rosterId: 'r4', status: 'pending' }, data: { status: 'cancelled' } })
    expect(m.db.survivorPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ playerState: 'eliminated', eliminatedWeek: 17, isJuryMember: true, canAccessJuryChat: true, canAccessExileChat: false }) }))
    expect(m.db.survivorJuryMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { leagueId: 'L1', rosterId: 'r4', votedOutWeek: 17 } }))
    expect(m.db.exileIsland.upsert).not.toHaveBeenCalled()
    const eliminated = m.db.survivorAuditEntry.create.mock.calls.map((c) => (c as unknown as [{ data: Record<string, unknown> }])[0].data).find((d) => d.action === 'player_eliminated')
    expect(eliminated).toMatchObject({ relatedEntityId: 'final_jury_step:c-final:r4', relatedEntityType: 'final_jury_step', data: expect.objectContaining({ outcome: 'removed_to_waivers' }) })
    expect(m.db.survivorChatChannel.update).toHaveBeenCalledWith({ where: { id: 'merge' }, data: { memberUserIds: ['u1'] } })
    expect(m.removeTribeChat).toHaveBeenCalledWith('L1', 'r4')
    expect(m.voidTrades.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['r4', 'season-r4'])
  })

  it('exile_island: releases the roster AND sends them to Exile, as a Tribal does', async () => {
    m.state.settings = { ...step, exileIslandEnabled: true, exileReturnWeek: 99 }
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('applied')
    expect(m.db.redraftRosterPlayer.updateMany).toHaveBeenCalledTimes(1)
    expect(m.db.survivorPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ playerState: 'exile', canAccessExileChat: true, isJuryMember: true }) }))
    expect(m.db.exileIsland.upsert).toHaveBeenCalledTimes(1)
    expect(m.db.survivorChatChannel.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ channelType: 'exile', memberUserIds: ['u4'] }) }))
    const actions = m.db.survivorAuditEntry.create.mock.calls.map((c) => (c as unknown as [{ data: { action: string } }])[0].data.action)
    expect(actions).toEqual(expect.arrayContaining(['roster_released', 'jury_joined', 'player_eliminated', 'exile_enrolled', 'final_jury_step_applied']))
    expect(m.voidTrades).toHaveBeenCalled()
  })

  it('a rerun after the step committed changes nothing (the gate holds)', async () => {
    m.state.settings = { ...step, exileIslandEnabled: false }
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('applied')
    vi.clearAllMocks()
    expect(await applyFinalJuryStepIfDue('L1', 17)).toBe('done')
    expect(m.db.redraftRosterPlayer.updateMany).not.toHaveBeenCalled()
    expect(m.db.survivorPlayer.update).not.toHaveBeenCalled()
    expect(m.voidTrades).not.toHaveBeenCalled()
  })
})

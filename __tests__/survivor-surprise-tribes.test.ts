// @vitest-environment node
/**
 * Surprise two-tribe weeks after the merge: weeks sealed once at the merge, never the last two
 * councils; a sealed week splits the cast into two equal temporary tribes (an odd cast benches one
 * manager, who is safe); the split is announced in the merge chat; at the week flip everyone is
 * one tribe again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorCommissionerAction: { findUnique: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    survivorTribeSwap: { findFirst: vi.fn(), create: vi.fn() },
    survivorTribe: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    survivorLeagueConfig: { findUnique: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    survivorTribeMember: { create: vi.fn(), deleteMany: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn() },
  },
  chat: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_leagueId: string, work: (tx: typeof m.db) => Promise<unknown>) => work(m.db) }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: m.chat }))

import {
  chooseSurpriseWeeks,
  dissolveSurpriseTribes,
  ensureSurpriseTribeWeek,
  getActiveSurpriseTribeWeek,
  sealSurpriseTribeWeeks,
  splitIntoTwoTribes,
  surpriseWeekCandidates,
} from '@/lib/survivor/survivorSurpriseTribes'

const plan = { eliminationWeeks: [3, 5, 7, 9, 11, 13, 15] }
const first = () => 0

describe('pure rules', () => {
  it('candidates come after the given week and never include the last two councils', () => {
    expect(surpriseWeekCandidates(plan, 7)).toEqual([9, 11])
    expect(surpriseWeekCandidates(plan, 0)).toEqual([3, 5, 7, 9, 11])
    expect(surpriseWeekCandidates(plan, 12)).toEqual([])
  })

  it('draws distinct weeks, as many as asked or as many as exist', () => {
    expect(chooseSurpriseWeeks([9, 11, 12], 2, first)).toEqual([9, 11])
    expect(chooseSurpriseWeeks([9, 11], 5, first)).toEqual([9, 11])
    expect(chooseSurpriseWeeks([9, 11], 0, first)).toEqual([])
    const drawn = chooseSurpriseWeeks([3, 5, 7, 9, 11], 3)
    expect(new Set(drawn).size).toBe(3)
    for (const week of drawn) expect([3, 5, 7, 9, 11]).toContain(week)
  })

  it('splits an even cast in half and benches one manager of an odd cast', () => {
    expect(splitIntoTwoTribes(['a', 'b', 'c', 'd'], first)).toEqual({ tribes: [['a', 'b'], ['c', 'd']], benched: null })
    expect(splitIntoTwoTribes(['e', 'd', 'c', 'b', 'a'], first)).toEqual({ tribes: [['a', 'b'], ['c', 'd']], benched: 'e' })
    const random = splitIntoTwoTribes(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(random.tribes[0]).toHaveLength(3)
    expect(random.tribes[1]).toHaveLength(3)
    expect([...random.tribes[0], ...random.tribes[1]].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })
})

const cast = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((userId, index) => ({ id: `sp-${userId}`, userId, displayName: userId.toUpperCase(), tribeId: 'merged', redraftRosterId: `r-${userId}`, index }))

function arrangeMerged(opts: { weeks?: number[] | null; setting?: number; active?: typeof cast; drawn?: boolean } = {}) {
  m.db.league.findUnique.mockResolvedValue({ settings: { postMergeSurpriseTribeWeeks: opts.setting ?? 2 } })
  m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'post_merge', mergeTriggeredAt: new Date('2027-01-05T00:00:00Z') })
  m.db.survivorCommissionerAction.findUnique.mockResolvedValue(opts.weeks === undefined ? null : opts.weeks === null ? null : { newState: { weeks: opts.weeks } })
  m.db.survivorCommissionerAction.create.mockResolvedValue({})
  m.db.survivorAuditEntry.create.mockResolvedValue({})
  m.db.survivorTribeSwap.findFirst.mockResolvedValue(opts.drawn ? { id: 'swap', newTribes: { tribeIds: ['ember', 'tide'], benchedUserId: null, mergedTribeId: 'merged', previous: [] } } : null)
  m.db.survivorTribe.findMany.mockResolvedValue(opts.drawn ? [{ id: 'ember' }, { id: 'tide' }] : [])
  m.db.survivorTribe.findFirst.mockResolvedValue({ id: 'merged' })
  let created = 0
  m.db.survivorTribe.create.mockImplementation(async () => ({ id: ['ember', 'tide'][created++] }))
  m.db.survivorLeagueConfig.findUnique.mockResolvedValue({ id: 'cfg' })
  m.db.survivorPlayer.findMany.mockResolvedValue(opts.active ?? cast)
  m.db.survivorPlayer.update.mockResolvedValue({})
  m.db.survivorTribeMember.create.mockResolvedValue({})
  m.db.survivorTribeSwap.create.mockResolvedValue({})
  m.db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'merge-chat' })
  m.chat.mockResolvedValue({})
}

describe('sealing', () => {
  beforeEach(() => vi.clearAllMocks())

  it('seals once, after the merge, from the candidate weeks; a later call returns the same weeks', async () => {
    arrangeMerged({ weeks: null })
    expect(await sealSurpriseTribeWeeks('L1', { plan, afterWeek: 7, count: 2, pick: first })).toEqual([9, 11])
    expect(m.db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: 'survivor-surprise-weeks:L1', actionType: 'surprise_tribe_weeks_sealed', commissionerId: 'survivor-ai-host', newState: { weeks: [9, 11], count: 2 },
    }) })
    vi.clearAllMocks()
    arrangeMerged({ weeks: [9, 11] })
    expect(await sealSurpriseTribeWeeks('L1', { plan, afterWeek: 7, count: 3, pick: first })).toEqual([9, 11])
    expect(m.db.survivorCommissionerAction.create).not.toHaveBeenCalled()
  })
})

describe('ensureSurpriseTribeWeek', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does nothing when the rule is off or the season has not merged', async () => {
    arrangeMerged({ setting: 0 })
    expect(await ensureSurpriseTribeWeek('L1', 9, plan)).toEqual({ drawn: false, reason: 'disabled' })
    arrangeMerged({ weeks: null })
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', mergeTriggeredAt: null })
    expect(await ensureSurpriseTribeWeek('L1', 9, plan)).toEqual({ drawn: false, reason: 'not_merged' })
    expect(m.db.survivorCommissionerAction.create).not.toHaveBeenCalled()
  })

  it('on a sealed week splits the cast into two temporary tribes, benches the odd manager, and announces it', async () => {
    arrangeMerged({ weeks: [9, 11] })
    const outcome = await ensureSurpriseTribeWeek('L1', 9, plan, { pick: first })
    expect(outcome).toEqual({ drawn: true, tribeIds: ['ember', 'tide'], benchedUserId: 'g' })
    expect(m.db.survivorTribe.create).toHaveBeenCalledTimes(2)
    expect(m.db.survivorTribe.create.mock.calls[0][0].data).toMatchObject({ leagueId: 'L1', configId: 'cfg', name: 'Ember', slotIndex: 1018, isActive: true, isMerged: false, phase: 'surprise' })
    expect(m.db.survivorTribe.create.mock.calls[1][0].data).toMatchObject({ name: 'Tide', slotIndex: 1019 })
    expect(m.db.survivorTribeMember.create.mock.calls.map(([args]) => [args.data.tribeId, args.data.rosterId])).toEqual([
      ['ember', 'r-a'], ['ember', 'r-b'], ['ember', 'r-c'], ['tide', 'r-d'], ['tide', 'r-e'], ['tide', 'r-f'],
    ])
    expect(m.db.survivorPlayer.update).toHaveBeenCalledTimes(6)
    expect(m.db.survivorPlayer.update).toHaveBeenCalledWith({ where: { id: 'sp-f' }, data: { tribeId: 'tide' } })
    expect(m.db.survivorTribeSwap.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      week: 9, swapType: 'surprise_two_tribes',
      afterSnapshot: [{ tribeId: 'ember', rosterIds: ['r-a', 'r-b', 'r-c'] }, { tribeId: 'tide', rosterIds: ['r-d', 'r-e', 'r-f'] }],
      newTribes: expect.objectContaining({ tribeIds: ['ember', 'tide'], benchedUserId: 'g', mergedTribeId: 'merged' }),
    }) })
    expect(m.chat).toHaveBeenCalledWith(m.db, { data: expect.objectContaining({ channelId: 'merge-chat', content: expect.stringContaining('G sits this one out and is safe') }) })
    expect(m.db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'surprise_tribes_drawn', week: 9, data: { tribeIds: ['ember', 'tide'], sizes: [3, 3], benchedUserId: 'g' } }) })
  })

  it('skips a week that is not sealed, a week already drawn, and a cast too small to split', async () => {
    arrangeMerged({ weeks: [9, 11] })
    expect(await ensureSurpriseTribeWeek('L1', 10, plan)).toEqual({ drawn: false, reason: 'not_sealed_week' })
    arrangeMerged({ weeks: [9, 11], drawn: true })
    expect(await ensureSurpriseTribeWeek('L1', 9, plan)).toEqual({ drawn: false, reason: 'already_drawn' })
    arrangeMerged({ weeks: [9, 11], active: cast.slice(0, 5) })
    expect(await ensureSurpriseTribeWeek('L1', 9, plan)).toEqual({ drawn: false, reason: 'cast_too_small' })
    expect(m.db.survivorTribe.create).not.toHaveBeenCalled()
  })
})

describe('the week in force and its end', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is in force while both temporary tribes are active, and gone once they are retired', async () => {
    arrangeMerged({ drawn: true })
    expect(await getActiveSurpriseTribeWeek('L1', 9)).toEqual({ week: 9, tribeIds: ['ember', 'tide'], benchedUserId: null })
    m.db.survivorTribe.findMany.mockResolvedValue([{ id: 'ember' }])
    expect(await getActiveSurpriseTribeWeek('L1', 9)).toBeNull()
    m.db.survivorTribeSwap.findFirst.mockResolvedValue(null)
    expect(await getActiveSurpriseTribeWeek('L1', 9)).toBeNull()
  })

  it('dissolving puts everyone back on the merged tribe, retires the tribes and announces it', async () => {
    arrangeMerged({ drawn: true })
    m.db.survivorTribeSwap.findFirst.mockResolvedValue({ id: 'swap', newTribes: { tribeIds: ['ember', 'tide'], benchedUserId: 'g', mergedTribeId: 'merged', previous: cast.map((p) => ({ userId: p.userId, tribeId: 'merged' })) } })
    m.db.survivorPlayer.updateMany.mockResolvedValue({ count: 1 })
    m.db.survivorTribeMember.deleteMany.mockResolvedValue({ count: 6 })
    m.db.survivorTribe.updateMany.mockResolvedValue({ count: 2 })
    expect(await dissolveSurpriseTribes('L1', 9)).toEqual({ dissolved: true })
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledTimes(7)
    expect(m.db.survivorPlayer.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', userId: 'a', tribeId: { in: ['ember', 'tide'] } }, data: { tribeId: 'merged' } })
    expect(m.db.survivorTribeMember.deleteMany).toHaveBeenCalledWith({ where: { tribeId: { in: ['ember', 'tide'] } } })
    expect(m.db.survivorTribe.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['ember', 'tide'] } }, data: { isActive: false } })
    expect(m.chat).toHaveBeenCalledWith(m.db, { data: expect.objectContaining({ channelId: 'merge-chat', content: expect.stringContaining('one tribe again') }) })
    expect(m.db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'surprise_tribes_dissolved' }) })

    m.db.survivorTribe.findMany.mockResolvedValue([])
    expect(await dissolveSurpriseTribes('L1', 9)).toEqual({ dissolved: false })
  })
})

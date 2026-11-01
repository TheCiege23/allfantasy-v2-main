/**
 * Weekly tribe prizes (survivorWeeklyPrizes.ts + survivorWeeklyPrizeRunner.ts) and the key-position
 * tribe tie-break (survivorCouncilImmunity.ts). Defaults keep today's behaviour: no prize, ties on id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  applied: [] as Array<Record<string, unknown>>,
  settings: {} as Record<string, unknown>,
  game: { phase: 'pre_merge', mergeTriggeredAt: null } as Record<string, unknown> | null,
  tribes: [{ id: 'A' }, { id: 'B' }],
  players: [] as Array<Record<string, unknown>>,
  scores: [] as Array<Record<string, unknown>>,
  mergedTribes: [] as Array<{ id: string }>,
  surprise: null as { week: number; tribeIds: string[]; benchedUserId: string | null } | null,
}))
vi.mock('@/lib/survivor/survivorSurpriseTribes', () => ({ getActiveSurpriseTribeWeek: vi.fn(async () => m.surprise) }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: m.settings })) },
    survivorGameState: { findUnique: vi.fn(async () => m.game) },
    survivorTribe: { findMany: vi.fn(async (args?: { where?: { isMerged?: boolean } }) => (args?.where?.isMerged ? m.mergedTribes : m.tribes)) },
    survivorPlayer: { findMany: vi.fn(async () => m.players) },
    survivorWeeklyScore: { findMany: vi.fn(async () => m.scores) },
  },
}))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getWeeklyEffectState: vi.fn(async () => ({ immuneTribeIds: new Set() })) }))
vi.mock('@/lib/survivor/survivorRewardEngine', () => ({
  applySurvivorReward: vi.fn(async (input: Record<string, unknown>) => {
    const duplicate = m.applied.some((a) => a.idempotencyKey === input.idempotencyKey)
    if (!duplicate) m.applied.push(input)
    return { ok: true, rewardId: input.idempotencyKey, status: 'applied', duplicate, changes: [], note: null }
  }),
  applyDueDeferredSurvivorRewards: vi.fn(async () => []),
}))
vi.mock('@/lib/survivor/survivorTribeTieBreak', () => ({
  loadTribePositionLeaderScores: vi.fn(async () => new Map([['A', 12], ['B', 31]])),
}))

import {
  competingTribeIdsFromScores,
  planWeeklyTribePrizes,
  readSurvivorHouseRules,
  readSurvivorWeeklyPrizes,
  SURVIVOR_WEEKLY_PRIZE_DEFAULTS,
  tribePositionLeaders,
  validateSurvivorWeeklyPrizes,
} from '@/lib/survivor/survivorWeeklyPrizes'
import { hasTribeTotalTie, loadWeekTieBreak, pickAttendingTribeId, pickImmuneTribeIds, rankTribesByTotal } from '@/lib/survivor/survivorCouncilImmunity'
import { applyWeeklyTribePrizes } from '@/lib/survivor/survivorWeeklyPrizeRunner'

beforeEach(() => {
  m.applied = []
  m.settings = { survivorWeeklyPrizes: { winningTribeFaabPerPlayer: 100, topScorerReward: 'score_boost', topScorerAmount: 25 } }
  m.game = { phase: 'pre_merge', mergeTriggeredAt: null }
  m.players = [
    { userId: 'ua1', tribeId: 'A', redraftRosterId: 'a1' }, { userId: 'ua2', tribeId: 'A', redraftRosterId: 'a2' },
    { userId: 'ub1', tribeId: 'B', redraftRosterId: 'b1' }, { userId: 'ub2', tribeId: 'B', redraftRosterId: 'b2' },
  ]
  m.scores = [
    { userId: 'ua1', tribeId: 'A', finalScore: 90, countedTowardTribeTotal: true }, { userId: 'ua2', tribeId: 'A', finalScore: 110, countedTowardTribeTotal: true },
    { userId: 'ub1', tribeId: 'B', finalScore: 50, countedTowardTribeTotal: true }, { userId: 'ub2', tribeId: 'B', finalScore: 60, countedTowardTribeTotal: true },
  ]
})

describe('weekly prize settings', () => {
  it('defaults to no prizes and no tie-break (current behaviour)', () => {
    expect(readSurvivorWeeklyPrizes({})).toEqual(SURVIVOR_WEEKLY_PRIZE_DEFAULTS)
    expect(readSurvivorWeeklyPrizes({ survivorWeeklyPrizes: { topScorerReward: 'yacht', tribeTieBreakPosition: 'qb' } })).toMatchObject({ topScorerReward: 'none', tribeTieBreakPosition: 'QB' })
  })
  it('validates amounts and positions for the sport', () => {
    expect(validateSurvivorWeeklyPrizes({ ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, winningTribeFaabPerPlayer: 2.5 }, 'NFL')[0]).toMatch(/whole amount/)
    expect(validateSurvivorWeeklyPrizes({ ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, topScorerReward: 'faab', topScorerAmount: 0 }, 'NFL')[0]).toMatch(/top scorer/)
    expect(validateSurvivorWeeklyPrizes({ ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, tribeTieBreakPosition: 'QB' }, 'NFL')).toEqual([])
    expect(validateSurvivorWeeklyPrizes({ ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, tribeTieBreakPosition: 'QB' }, 'NBA')[0]).toMatch(/tie-break/)
  })
  it('reads house rules trimmed and capped', () => {
    expect(readSurvivorHouseRules({ survivorHouseRules: '  No screenshots.\r\nBe kind.  ' })).toBe('No screenshots.\nBe kind.')
    expect(readSurvivorHouseRules({ survivorHouseRules: 'x'.repeat(5000) })).toHaveLength(4000)
    expect(readSurvivorHouseRules({})).toBe('')
  })
})

describe('planWeeklyTribePrizes', () => {
  it('pays every member FAAB and the top scorer the extra, on deterministic keys', () => {
    const plan = planWeeklyTribePrizes({
      leagueId: 'L1', week: 4, winningTribeId: 'A',
      prizes: { ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, winningTribeFaabPerPlayer: 100, topScorerReward: 'faab', topScorerAmount: 25 },
      members: [{ rosterId: 'a2', userId: 'ua2', finalScore: 110 }, { rosterId: 'a1', userId: 'ua1', finalScore: 90 }, { rosterId: 'a3', userId: 'ua3', finalScore: Number.NEGATIVE_INFINITY }],
    })
    expect(plan.map((p) => p.idempotencyKey)).toEqual([
      'weekly_prize:tribe_faab:L1:4:a1', 'weekly_prize:tribe_faab:L1:4:a2', 'weekly_prize:tribe_faab:L1:4:a3', 'weekly_prize:top_scorer:L1:4:A',
    ])
    expect(plan[3].spec).toEqual({ type: 'faab_grant', rosterId: 'a2', amount: 25 })
  })
  it('puts a points prize on NEXT week', () => {
    const [p] = planWeeklyTribePrizes({ leagueId: 'L1', week: 4, winningTribeId: 'A', prizes: { ...SURVIVOR_WEEKLY_PRIZE_DEFAULTS, topScorerReward: 'score_boost', topScorerAmount: 20 }, members: [{ rosterId: 'a1', userId: 'u', finalScore: 1 }] })
    expect(p.spec).toEqual({ type: 'score_bonus', rosterId: 'a1', points: 20, targetWeek: 5 })
  })
  it('pays nothing with the defaults', () => {
    expect(planWeeklyTribePrizes({ leagueId: 'L1', week: 4, winningTribeId: 'A', prizes: SURVIVOR_WEEKLY_PRIZE_DEFAULTS, members: [{ rosterId: 'a1', userId: 'u', finalScore: 1 }] })).toEqual([])
  })
})

describe('applyWeeklyTribePrizes (season runner step)', () => {
  it('pays the top tribe once, however many ticks run', async () => {
    const first = await applyWeeklyTribePrizes('L1', 4)
    expect(first.paid).toEqual(['weekly_prize:tribe_faab:L1:4:a1', 'weekly_prize:tribe_faab:L1:4:a2', 'weekly_prize:top_scorer:L1:4:A'])
    expect(m.applied[2]).toMatchObject({ source: { kind: 'weekly_prize' }, reward: { type: 'score_bonus', rosterId: 'a2', points: 25, targetWeek: 5 } })
    expect((await applyWeeklyTribePrizes('L1', 4)).paid).toEqual([])
    expect(m.applied).toHaveLength(3)
  })
  it('does nothing when prizes are off or after the merge', async () => {
    m.settings = {}
    expect(await applyWeeklyTribePrizes('L1', 4)).toEqual({ paid: [], skipped: 'off' })
    m.settings = { survivorWeeklyPrizes: { winningTribeFaabPerPlayer: 10 } }
    m.game = { phase: 'merge', mergeTriggeredAt: new Date() }
    expect(await applyWeeklyTribePrizes('L1', 4)).toEqual({ paid: [], skipped: 'merged' })
  })
  it('post-merge: off by default, so a surprise two-tribe week still pays nothing (today’s behaviour)', async () => {
    m.game = { phase: 'post_merge', mergeTriggeredAt: new Date() }
    m.surprise = { week: 4, tribeIds: ['A', 'B'], benchedUserId: null }
    expect(await applyWeeklyTribePrizes('L1', 4)).toEqual({ paid: [], skipped: 'merged' })
    m.surprise = null
  })
  it('post-merge with payInTribeWeeksAfterMerge: pays the winning surprise tribe from that week’s tribe structure', async () => {
    m.settings = { survivorWeeklyPrizes: { winningTribeFaabPerPlayer: 30, payInTribeWeeksAfterMerge: true } }
    m.game = { phase: 'post_merge', mergeTriggeredAt: new Date() }
    m.mergedTribes = [{ id: 'M' }]
    // The surprise tribes are already dissolved: everyone is back on M, but the score rows remember.
    m.players = m.players.map((p) => ({ ...p, tribeId: 'M' }))
    const res = await applyWeeklyTribePrizes('L1', 4)
    expect(res.paid).toEqual(['weekly_prize:tribe_faab:L1:4:a1', 'weekly_prize:tribe_faab:L1:4:a2'])
    m.mergedTribes = []
  })
  it('post-merge with the setting on but one merged tribe competing: no tribe prize', async () => {
    m.settings = { survivorWeeklyPrizes: { winningTribeFaabPerPlayer: 30, payInTribeWeeksAfterMerge: true } }
    m.game = { phase: 'post_merge', mergeTriggeredAt: new Date() }
    m.mergedTribes = [{ id: 'M' }]
    m.scores = m.scores.map((s) => ({ ...s, tribeId: 'M' }))
    expect(await applyWeeklyTribePrizes('L1', 4)).toEqual({ paid: [], skipped: 'no_tribes' })
    m.mergedTribes = []
  })
  it('competingTribeIdsFromScores ignores the merged tribe and empty rows', () => {
    expect(competingTribeIdsFromScores([{ tribeId: 'B' }, { tribeId: 'M' }, { tribeId: null }, { tribeId: 'A' }, { tribeId: 'B' }], ['M'])).toEqual(['A', 'B'])
    expect(readSurvivorWeeklyPrizes({}).payInTribeWeeksAfterMerge).toBe(false)
    expect(readSurvivorWeeklyPrizes({ survivorWeeklyPrizes: { payInTribeWeeksAfterMerge: true } }).payInTribeWeeksAfterMerge).toBe(true)
  })
  it('breaks a tied week with the key position (B has the better QB)', async () => {
    m.settings = { survivorWeeklyPrizes: { winningTribeFaabPerPlayer: 10, tribeTieBreakPosition: 'QB' } }
    m.scores = m.scores.map((s) => ({ ...s, finalScore: 100 }))
    const res = await applyWeeklyTribePrizes('L1', 4)
    expect(res.paid).toEqual(['weekly_prize:tribe_faab:L1:4:b1', 'weekly_prize:tribe_faab:L1:4:b2'])
  })
})

describe('key-position tribe tie-break', () => {
  const tied = new Map([['A', 100], ['B', 100], ['C', 80]])
  it('is today’s id order without a tie-break, and the key position with one', () => {
    expect(rankTribesByTotal(tied)).toEqual(['A', 'B', 'C'])
    expect(rankTribesByTotal(tied, new Map([['A', 10], ['B', 25]]))).toEqual(['B', 'A', 'C'])
    expect(hasTribeTotalTie(tied)).toBe(true)
    expect(hasTribeTotalTie(new Map([['A', 1], ['B', 2]]))).toBe(false)
  })
  it('the lower key-position tribe attends on a tied bottom; the sync pick cannot overrule the rule', () => {
    const totals = new Map([['A', 50], ['B', 50]])
    expect(pickAttendingTribeId({ totals, tribeIds: ['A', 'B'], immuneTribeIds: [] })).toBe('A')
    expect(pickAttendingTribeId({ totals, tribeIds: ['A', 'B'], immuneTribeIds: [], tieBreak: new Map([['A', 30], ['B', 10]]) })).toBe('B')
    expect(pickImmuneTribeIds({ totals, tribeIds: ['A', 'B'], twoHighest: false, scoreImmuneTribeId: 'A' })).toEqual(['A'])
    expect(pickImmuneTribeIds({ totals, tribeIds: ['A', 'B'], twoHighest: false, scoreImmuneTribeId: 'A', tieBreak: new Map([['A', 10], ['B', 30]]) })).toEqual(['B'])
  })
  it('loads position scores only for a real tie with a position set, and degrades on failure', async () => {
    const load = vi.fn(async () => new Map([['A', 1]]))
    expect(await loadWeekTieBreak('L1', 4, new Map([['A', 1], ['B', 2]]), ['A', 'B'], { tieBreakPosition: 'QB', loadTieBreak: load })).toBeNull()
    expect(await loadWeekTieBreak('L1', 4, tied, ['A', 'B'], { tieBreakPosition: 'none', loadTieBreak: load })).toBeNull()
    expect(load).not.toHaveBeenCalled()
    expect(await loadWeekTieBreak('L1', 4, tied, ['A', 'B'], { tieBreakPosition: 'QB', loadTieBreak: load })).toEqual(new Map([['A', 1]]))
    expect(await loadWeekTieBreak('L1', 4, tied, ['A', 'B'], { tieBreakPosition: 'QB', loadTieBreak: async () => { throw new Error('no stats') } })).toBeNull()
  })
  it('tribePositionLeaders keeps each tribe’s best starter at the position', () => {
    const map = tribePositionLeaders([
      { tribeId: 'A', position: 'QB', points: 18, isStarter: true },
      { tribeId: 'A', position: 'QB', points: 25, isStarter: false },
      { tribeId: 'B', position: 'WR/QB', points: 21, isStarter: true },
      { tribeId: 'B', position: 'RB', points: 40, isStarter: true },
    ], 'qb')
    expect(map).toEqual(new Map([['A', 18], ['B', 21]]))
  })
})

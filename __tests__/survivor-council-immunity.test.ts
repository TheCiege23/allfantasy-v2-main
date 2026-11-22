// @vitest-environment node
/**
 * Which tribes are safe from Tribal Council this week, and which one attends: one resolver shared
 * by the necklace award and the council opener, so the tribe told it is safe is never sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorWeeklyScore: { findMany: vi.fn() },
  },
  effects: { getWeeklyEffectState: vi.fn() },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getWeeklyEffectState: m.effects.getWeeklyEffectState }))

import {
  pickAttendingTribeId,
  pickImmuneTribeIds,
  rankTribesByTotal,
  resolveWeekImmuneTribeIds,
  tribeTotals,
} from '@/lib/survivor/survivorCouncilImmunity'

const totals = new Map([['vela', 356.8], ['kora', 310], ['lumo', 80], ['nami', 200]])
const tribes = ['vela', 'kora', 'lumo', 'nami']
const noEffects = () => ({ immuneTribeIds: new Set<string>(), protectedRosterIds: new Set<string>(), frozenWaiverRosterIds: new Set<string>(), scoreBoostByRoster: new Map<string, number>() })

describe('tribeTotals', () => {
  it('sums counted, finite scores per tribe and ignores Exile and sit-out rows', () => {
    expect(tribeTotals([
      { tribeId: 'vela', finalScore: 100 },
      { tribeId: 'vela', finalScore: 50, countedTowardTribeTotal: true },
      { tribeId: 'vela', finalScore: 999, countedTowardTribeTotal: false },
      { tribeId: null, finalScore: 999 },
      { tribeId: 'kora', finalScore: Number.NaN },
    ])).toEqual(new Map([['vela', 150]]))
  })

  it('ranks the highest total first and breaks a tie on tribe id', () => {
    expect(rankTribesByTotal(new Map([['b', 10], ['a', 10], ['c', 30]]))).toEqual(['c', 'a', 'b'])
  })
})

describe('pickImmuneTribeIds', () => {
  it('by default only the top tribe is safe', () => {
    expect(pickImmuneTribeIds({ totals, tribeIds: tribes, twoHighest: false })).toEqual(['vela'])
  })

  it('two-highest makes the top two safe once there are at least three tribes', () => {
    expect(pickImmuneTribeIds({ totals, tribeIds: tribes, twoHighest: true })).toEqual(['vela', 'kora'])
    expect(pickImmuneTribeIds({ totals, tribeIds: ['vela', 'kora'], twoHighest: true })).toEqual(['vela'])
  })

  it('a tribe that won immunity in a challenge is safe first, and the top tribe stays safe too', () => {
    expect(pickImmuneTribeIds({ totals, tribeIds: tribes, twoHighest: false, rewardTribeIds: ['lumo'] })).toEqual(['lumo', 'vela'])
  })

  it('treats the score sync pick as the top tribe while it is active, and ignores a stale one', () => {
    expect(pickImmuneTribeIds({ totals, tribeIds: tribes, twoHighest: true, scoreImmuneTribeId: 'kora' })).toEqual(['kora', 'vela'])
    expect(pickImmuneTribeIds({ totals, tribeIds: tribes, twoHighest: false, scoreImmuneTribeId: 'gone' })).toEqual(['vela'])
    expect(pickImmuneTribeIds({ totals: new Map(), tribeIds: tribes, twoHighest: false, scoreImmuneTribeId: 'kora' })).toEqual(['kora'])
  })

  it('never covers every tribe: someone always attends', () => {
    expect(pickImmuneTribeIds({ totals, tribeIds: ['vela', 'kora'], twoHighest: false, rewardTribeIds: ['kora', 'vela'] })).toEqual(['vela'])
    expect(pickImmuneTribeIds({ totals, tribeIds: ['vela', 'kora', 'lumo'], twoHighest: true, rewardTribeIds: ['lumo'] })).toEqual(['lumo', 'vela'])
    expect(pickImmuneTribeIds({ totals, tribeIds: ['vela'], twoHighest: true })).toEqual([])
  })
})

describe('pickAttendingTribeId', () => {
  it('sends the lowest-scoring tribe that is not safe', () => {
    expect(pickAttendingTribeId({ totals, tribeIds: tribes, immuneTribeIds: ['vela', 'kora'] })).toBe('lumo')
    expect(pickAttendingTribeId({ totals, tribeIds: tribes, immuneTribeIds: ['vela', 'lumo'] })).toBe('nami')
  })

  it('puts tribes without a counted score after every scored tribe, and finds nobody when every tribe is safe', () => {
    expect(pickAttendingTribeId({ totals: new Map([['kora', 10]]), tribeIds: ['kora', 'lumo', 'nami'], immuneTribeIds: [] })).toBe('kora')
    expect(pickAttendingTribeId({ totals: new Map(), tribeIds: ['nami', 'lumo'], immuneTribeIds: [] })).toBe('lumo')
    expect(pickAttendingTribeId({ totals, tribeIds: ['vela'], immuneTribeIds: ['vela'] })).toBeNull()
  })
})

describe('resolveWeekImmuneTribeIds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.db.league.findUnique.mockResolvedValue({ settings: { twoHighestTribesImmune: true } })
    m.db.survivorTribe.findMany.mockResolvedValue(tribes.map(id => ({ id })))
    m.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }])
    m.db.survivorWeeklyScore.findMany.mockResolvedValue([
      { tribeId: 'vela', finalScore: 300, countedTowardTribeTotal: true },
      { tribeId: 'kora', finalScore: 200, countedTowardTribeTotal: true },
      { tribeId: 'lumo', finalScore: 50, countedTowardTribeTotal: true },
      { tribeId: 'nami', finalScore: 100, countedTowardTribeTotal: true },
    ])
    m.effects.getWeeklyEffectState.mockResolvedValue(noEffects())
  })

  it('loads finalized, counted scores for active managers and applies the league rule', async () => {
    const result = await resolveWeekImmuneTribeIds('L1', 6)
    expect(m.db.survivorWeeklyScore.findMany.mock.calls[0][0].where).toEqual({
      leagueId: 'L1', week: 6, isFinalized: true, countedTowardTribeTotal: true, tribeId: { not: null }, userId: { in: ['u1', 'u2'] },
    })
    expect(m.db.survivorTribe.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', isActive: true })
    expect(result.immuneTribeIds).toEqual(['vela', 'kora'])
    expect(result.attendingTribeId).toBe('lumo')
    expect(result.rewardTribeIds).toEqual([])
    expect(result.totals.get('nami')).toBe(100)
  })

  it('a tribe immunity won in a challenge (the effect audit) keeps that tribe home', async () => {
    m.effects.getWeeklyEffectState.mockResolvedValue({ ...noEffects(), immuneTribeIds: new Set(['lumo']) })
    const result = await resolveWeekImmuneTribeIds('L1', 6, {
      settings: { twoHighestTribesImmune: false } as never,
      tribeIds: tribes,
      scoreImmuneTribeId: 'vela',
    })
    expect(m.effects.getWeeklyEffectState).toHaveBeenCalledWith('L1', 6)
    expect(result.rewardTribeIds).toEqual(['lumo'])
    expect(result.immuneTribeIds).toEqual(['lumo', 'vela'])
    expect(result.attendingTribeId).toBe('nami')
    expect(m.db.league.findUnique).not.toHaveBeenCalled()
    expect(m.db.survivorTribe.findMany).not.toHaveBeenCalled()
  })

  it('an unreadable effect audit never blocks the council', async () => {
    m.effects.getWeeklyEffectState.mockRejectedValue(new Error('no table'))
    const result = await resolveWeekImmuneTribeIds('L1', 6, {
      scores: [{ tribeId: 'vela', finalScore: 10 }, { tribeId: 'kora', finalScore: 5 }],
      tribeIds: ['vela', 'kora'],
    })
    expect(result.immuneTribeIds).toEqual(['vela'])
    expect(result.attendingTribeId).toBe('kora')
    expect(m.db.survivorWeeklyScore.findMany).not.toHaveBeenCalled()
  })
})

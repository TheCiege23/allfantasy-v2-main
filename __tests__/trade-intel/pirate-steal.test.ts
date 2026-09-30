/**
 * Pirate steals are not trades (Guap, 2026-09-30). In a Pirate league the winner of a matchup takes a
 * player off the loser, and Sleeper records it as a one-way trade — Pirate League twinty logged seven
 * in 2026 week 3. These pin how a steal is recognised, that it is never graded, and that a player sold
 * for FAAB (Jameis Winston for $35, same league) is never mistaken for one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  emptySideIndex,
  isPirateLeague,
  isPirateSteal,
  pirateStealReason,
} from '@/lib/trade-intel/pirateSteal'
import { faabFor, type GradedTrade, type TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { gradeArchivedTrade, oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'

const confirmed = (type: string) => ({ leagueTypeConfirmation: { type } })

describe('isPirateLeague — confirmed first, then the name', () => {
  it('a league confirmed Pirate is Pirate, whatever it is called', () => {
    expect(isPirateLeague({ name: 'Sunday Crew', settings: confirmed('pirate') })).toBe(true)
  })

  it('a league confirmed as anything else is NOT, even named Pirate — the person who confirmed it decides', () => {
    // Pirate League twinty, as production held it on 2026-09-30: confirmed plain Redraft.
    expect(isPirateLeague({ name: 'Pirate League twinty', settings: confirmed('redraft') })).toBe(false)
  })

  it('an unconfirmed league is Pirate when its name says so, in any case', () => {
    expect(isPirateLeague({ name: 'Pirate League!', settings: {} })).toBe(true)
    expect(isPirateLeague({ name: "Post's PIRATES", settings: null })).toBe(true)
    expect(isPirateLeague({ name: 'KBFL', settings: {} })).toBe(false)
    expect(isPirateLeague({ name: null, settings: undefined })).toBe(false)
  })
})

describe('emptySideIndex / isPirateSteal', () => {
  it('finds the one side that received nothing', () => {
    expect(emptySideIndex([{ playersIn: 0, picksIn: 0 }, { playersIn: 1, picksIn: 0 }])).toBe(0)
    expect(emptySideIndex([{ playersIn: 1, picksIn: 0 }, { playersIn: 0, picksIn: 0 }])).toBe(1)
  })

  it('a two-sided trade, or nothing at all, has no empty side', () => {
    expect(emptySideIndex([{ playersIn: 4, picksIn: 0 }, { playersIn: 2, picksIn: 0 }])).toBeNull()
    expect(emptySideIndex([{ playersIn: 0, picksIn: 0 }, { playersIn: 0, picksIn: 0 }])).toBeNull()
  })

  it('a pick or FAAB received is something — that side is not empty', () => {
    expect(emptySideIndex([{ playersIn: 0, picksIn: 1 }, { playersIn: 1, picksIn: 0 }])).toBeNull()
    expect(emptySideIndex([{ playersIn: 0, picksIn: 0, faabIn: 35 }, { playersIn: 1, picksIn: 0, faabIn: 0 }])).toBeNull()
  })

  it('the same one-way shape is a steal only inside a Pirate league', () => {
    const sides = [{ playersIn: 0, picksIn: 0 }, { playersIn: 1, picksIn: 0 }] as const
    expect(isPirateSteal({ pirateLeague: true, sides })).toBe(true)
    expect(isPirateSteal({ pirateLeague: false, sides })).toBe(false)
  })

  it('names who took whom when it can', () => {
    expect(pirateStealReason({ taker: 'cstanhope12', from: 'BigTzzy57' })).toMatch(/^Pirate steal — cstanhope12 took this from BigTzzy57/)
    expect(pirateStealReason()).toMatch(/^Pirate steal — A player was taken/)
    expect(pirateStealReason()).toMatch(/not graded/)
  })
})

const player = (name: string, playerId: string, position: string) => ({
  playerId, name, position, pointsBySeason: {}, creditedBySeason: {}, departed: null, gamesMissedBySeason: {},
})

function side(o: Partial<TradeSideGrade> & { rosterId: number; managerName: string }): TradeSideGrade {
  return {
    ownerId: String(o.rosterId), teamName: null, avatar: null,
    playersIn: [], playersOut: [], picksIn: [], picksOut: [],
    madePlayoffs: null, seasonNets: [], cumulativeNet: 0, initialGrade: 'C', currentGrade: 'C', trend: 'steady',
    ...o,
  }
}

const trade = (sides: TradeSideGrade[]): GradedTrade => ({
  id: 'L:1410573737530503168', season: '2026', week: 3, createdIso: '2026-09-29T12:39:14.990Z',
  multiTeam: false, tie: true, hasPendingPicks: false, sides,
})

const grader = (pirateLeague: boolean) => {
  const grade = vi.fn(async () => ({ graded: false as const, reason: 'graded by the chart', basis: null }))
  return { g: { grade, pirateLeague, leagueType: null } as unknown as LeagueTradeGrader, grade }
}

describe('the completed-trade grade calls a steal a steal', () => {
  // Zay Flowers taken for nothing (Pirate League twinty, transaction 1410573737530503168).
  const ZAY = player('Zay Flowers', '9997', 'WR')
  const STEAL = trade([
    side({ rosterId: 4, managerName: 'BigTzzy57', playersOut: [ZAY], faabIn: 0, faabOut: 0 }),
    side({ rosterId: 11, managerName: 'cstanhope12', playersIn: [ZAY], faabIn: 0, faabOut: 0 }),
  ])

  it('in a Pirate league: not graded, marked as a steal, the taker named — and the chart never asked', async () => {
    const { g, grade } = grader(true)
    const view = await oneGradeForCompletedTrade('row-1', STEAL, 2026, { graderFor: async () => g })
    expect(view).toMatchObject({ graded: false, kind: 'pirate_steal' })
    expect(view.graded ? '' : view.reason).toMatch(/^Pirate steal — cstanhope12 took this from BigTzzy57/)
    expect(grade).not.toHaveBeenCalled()
  })

  it('outside one, the same shape stays an ordinary giveaway', async () => {
    const { g } = grader(false)
    const view = await oneGradeForCompletedTrade('row-1', STEAL, 2026, { graderFor: async () => g })
    expect(view).toMatchObject({ graded: false, reason: expect.stringContaining('BigTzzy57 received nothing') })
    expect((view as { kind?: string }).kind).toBeUndefined()
  })

  it('a player sold for FAAB is a TRADE, even in a Pirate league — it goes to the chart', async () => {
    const WINSTON = player('Jameis Winston', '2306', 'QB')
    const wb = [{ amount: 35, sender: 8, receiver: 3 }]
    const sale = trade([
      side({ rosterId: 3, managerName: 'sender', playersOut: [WINSTON], ...faabFor(wb, 3) }),
      side({ rosterId: 8, managerName: 'buyer', playersIn: [WINSTON], ...faabFor(wb, 8) }),
    ])
    const { g, grade } = grader(true)
    const view = await oneGradeForCompletedTrade('row-1', sale, 2026, { graderFor: async () => g })
    expect(grade).toHaveBeenCalledTimes(1)
    expect(view).toMatchObject({ reason: 'graded by the chart' })
  })

  it('a real two-sided trade in a Pirate league is graded normally', async () => {
    const t = trade([
      side({ rosterId: 1, managerName: 'TheCiege24', playersIn: [player('Justin Herbert', '6797', 'QB')], playersOut: [player('Joe Burrow', '6770', 'QB')], faabIn: 0, faabOut: 0 }),
      side({ rosterId: 2, managerName: 'Hibboisthebest', playersIn: [player('Joe Burrow', '6770', 'QB')], playersOut: [player('Justin Herbert', '6797', 'QB')], faabIn: 0, faabOut: 0 }),
    ])
    const { g, grade } = grader(true)
    await oneGradeForCompletedTrade('row-1', t, 2026, { graderFor: async () => g })
    expect(grade).toHaveBeenCalledTimes(1)
  })
})

describe('an archived row is called a steal only when its FAAB was read', () => {
  const args = {
    received: [] as string[],
    gave: [{ name: 'Zay Flowers', sleeperId: '9997' }],
    picksIn: [],
    picksOut: [],
    currentSeason: 2026,
    labels: { receiver: 'BigTzzy57', partner: 'cstanhope12' },
  }

  it('FAAB read and zero, in a Pirate league → a steal, the partner as the taker', async () => {
    const { g, grade } = grader(true)
    const view = await gradeArchivedTrade(g, { ...args, faab: { received: 0, gave: 0 } })
    expect(view).toMatchObject({ graded: false, kind: 'pirate_steal' })
    expect(view.graded ? '' : view.reason).toMatch(/cstanhope12 took this from BigTzzy57/)
    expect(grade).not.toHaveBeenCalled()
  })

  it('FAAB unknown (a `LeagueTrade` row) → never called a steal; it could be a FAAB sale', async () => {
    const { g } = grader(true)
    const view = await gradeArchivedTrade(g, args)
    expect((view as { kind?: string }).kind).toBeUndefined()
  })
})

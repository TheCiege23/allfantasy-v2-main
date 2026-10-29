/**
 * Guillotine trade grades, the pure rules (`lib/decision-os/trade/guillotineValue.ts`): the survival
 * curve, the free level a lineup slot can count on, points over it, what the chops release and the wire
 * holds, FAAB's purchasing power, and the grade. Guap's decisions, 2026-10-11.
 */
import { describe, expect, it } from 'vitest'
import {
  faabWorth,
  gradeGuillotineDeal,
  lineupPoints,
  pointsOverReplacement,
  releaseValue,
  slotReplacement,
  survivalCurve,
  wireValue,
  type GuillotineContext,
  type GuillotineSeat,
} from '@/lib/decision-os/trade/guillotineValue'
import type { BoardPlayer } from '@/lib/decision-os/trade/sportPointsValue'

// The league that prompted this: four FLEX and one SUPER_FLEX starter.
const SEATS: GuillotineSeat[] = [
  ...Array.from({ length: 4 }, () => ({ slot: 'FLEX', eligible: ['RB', 'WR', 'TE'] })),
  { slot: 'SUPER_FLEX', eligible: ['QB', 'RB', 'WR', 'TE'] },
]

function p(id: string, position: string, perGame: number, sampleGames: number | null = 5): BoardPlayer {
  return { id, name: `P ${id}`, position, perGame, sampleGames, aliases: [`s${id}`] }
}

describe('survivalCurve', () => {
  it('expects (T − 1) / 2 weeks when the season outlasts the field', () => {
    const w = survivalCurve(14, 13)
    expect(w).toHaveLength(14)
    expect(w[0]).toBeCloseTo(6.5, 9)
    expect(w[13]).toBe(0)
  })

  it('stops at the NFL weeks left when the field outlasts the season', () => {
    // C = 5 chops: (13 + 12 + 11 + 10 + 9) / 14.
    expect(survivalCurve(14, 5)[0]).toBeCloseTo(55 / 14, 9)
  })

  it('gives a player released later fewer weeks', () => {
    const w = survivalCurve(14, 13)
    for (let k = 1; k < w.length; k++) expect(w[k]!).toBeLessThan(w[k - 1]!)
  })

  it('has nothing left to play with one team alive', () => {
    expect(survivalCurve(1, 10)).toEqual([0])
  })
})

describe('slotReplacement', () => {
  const board = [p('a', 'WR', 17.4), p('b', 'QB', 17.3), p('c', 'RB', 15.6), p('d', 'WR', 14), p('e', 'QB', 13), p('f', 'TE', 9)]

  it('is the free agent left once every live team has claimed one, not the best', () => {
    const r = slotReplacement(board, new Set(), SEATS, 2)
    // FLEX takes RB/WR/TE: a 17.4, c 15.6, d 14, f 9 → the third is d.
    expect(r.get('FLEX')).toEqual({ name: 'P d', perGame: 14 })
    // SUPER_FLEX adds the QBs: a, b, c, d, e → the third is c.
    expect(r.get('SUPER_FLEX')).toEqual({ name: 'P c', perGame: 15.6 })
  })

  it('never counts a rostered player, or one with too few games behind him', () => {
    const r = slotReplacement([...board, p('hot', 'WR', 40, 1)], new Set(['a']), SEATS, 0)
    expect(r.get('FLEX')!.perGame).toBe(15.6)
  })

  it('reads an exhausted wire as nothing free', () => {
    expect(slotReplacement(board, new Set(), SEATS, 50).get('FLEX')!.perGame).toBe(0)
  })
})

describe('pointsOverReplacement', () => {
  const repl = new Map([['FLEX', { perGame: 12 }], ['SUPER_FLEX', { perGame: 14 }]])

  it('measures a quarterback against the one slot that takes him', () => {
    expect(pointsOverReplacement({ position: 'QB', perGame: 19.4 }, SEATS, repl)).toBeCloseTo(5.4, 9)
  })

  it('measures a flex player in the slot where he adds most', () => {
    expect(pointsOverReplacement({ position: 'RB', perGame: 15 }, SEATS, repl)).toBeCloseTo(3, 9)
  })

  it('is nothing for a player below the free level, or one no slot takes', () => {
    expect(pointsOverReplacement({ position: 'RB', perGame: 10 }, SEATS, repl)).toBe(0)
    expect(pointsOverReplacement({ position: 'K', perGame: 30 }, SEATS, repl)).toBe(0)
  })
})

describe('lineupPoints', () => {
  it('fills the most restrictive slot first', () => {
    const seats: GuillotineSeat[] = [{ slot: 'SUPER_FLEX', eligible: ['QB', 'RB'] }, { slot: 'QB', eligible: ['QB'] }]
    // QB slot takes the 20; SUPER_FLEX the better of 18 (QB) and 15 (RB).
    expect(lineupPoints([p('q1', 'QB', 20), p('q2', 'QB', 18), p('r', 'RB', 15)], seats)).toBe(38)
  })
})

describe('what FAAB buys', () => {
  const board = new Map([p('star', 'RB', 20), p('mid', 'RB', 13), p('weak', 'RB', 8)].map((x) => [x.id, x]))
  const repl = new Map([['FLEX', { perGame: 10 }], ['SUPER_FLEX', { perGame: 10 }]])
  const survival = survivalCurve(3, 13) // [1, 1/3, 0]

  it('releases the weakest roster first, for the weeks after its chop, and never the strongest', () => {
    const v = releaseValue({
      rosters: [{ players: ['star'], faab: 50 }, { players: ['mid'], faab: 50 }, { players: ['weak'], faab: 50 }],
      board, seats: SEATS, replacementBySlot: repl, survival,
    })
    // Chop 1 (weak, 0 over) × W(1); chop 2 (mid, 3 over) × W(2) = 0. The star's roster survives.
    expect(v).toBeCloseTo(0 * survival[1]! + 3 * survival[2]!, 9)
    const reversed = releaseValue({
      rosters: [{ players: ['weak'], faab: 50 }, { players: ['star'], faab: 50 }, { players: ['mid'], faab: 50 }],
      board, seats: SEATS, replacementBySlot: repl, survival,
    })
    expect(reversed).toBeCloseTo(v, 9)
  })

  it('counts the wire above the free level for every week a team can expect to survive', () => {
    const w = wireValue({ board: [...board.values()], rostered: new Set(['star']), seats: SEATS, replacementBySlot: repl, survival })
    expect(w).toBeCloseTo(3 * survival[0]!, 9)
  })

  it('prices FAAB as its share of the live teams’ FAAB, times the wire and the releases', () => {
    const ctx = { liveFaab: 400, wireValue: 60, releaseValue: 140 }
    expect(faabWorth(100, ctx)).toBeCloseTo(50, 9)
    expect(faabWorth(0, ctx)).toBe(0)
    expect(faabWorth(900, ctx)).toBeCloseTo(200, 9)
    expect(faabWorth(10, { ...ctx, liveFaab: 0 })).toBeNull()
  })
})

describe('gradeGuillotineDeal', () => {
  // Burrow 19.4 a week and Willis 10.2 in the SUPER_FLEX; the free SUPER_FLEX is 13.3.
  const board = [
    { ...p('burrow', 'QB', 19.4), name: 'Joe Burrow', aliases: ['6770'] },
    { ...p('willis', 'QB', 10.2), name: 'Malik Willis', aliases: ['8183'] },
  ]
  const ctx: GuillotineContext = {
    board,
    seats: SEATS,
    replacementBySlot: new Map([['FLEX', { name: 'Free FLEX', perGame: 11.9 }], ['SUPER_FLEX', { name: 'Free SF', perGame: 13.3 }]]),
    teamsAlive: 14,
    startingTeams: 18,
    weeksLeft: 13,
    survival: survivalCurve(14, 13),
    liveFaab: 1899,
    wireValue: 251.7,
    releaseValue: 554.7,
    lineupLabel: '4 FLEX, 1 SUPER_FLEX',
  }

  it('grades a player against a player and FAAB on points over the free level and purchasing power', () => {
    const v = gradeGuillotineDeal({
      give: [{ kind: 'player', playerId: '6770', name: 'Joe Burrow' }],
      get: [{ kind: 'player', name: 'Malik Willis' }, { kind: 'faab', amount: 75 }],
      ctx,
    })
    if (!v.graded) throw new Error(v.reason)
    const burrow = (19.4 - 13.3) * 6.5
    const faab = (75 / 1899) * (251.7 + 554.7)
    expect(v.lines[0]!.leagueValue).toBeCloseTo(Math.round(burrow * 10) / 10, 9)
    expect(v.lines[1]!.leagueValue).toBe(0)
    expect(v.lines[2]!.leagueValue).toBeCloseTo(Math.round(faab * 10) / 10, 9)
    expect(v.giveValue).toBe(Math.round(burrow))
    expect(v.getValue).toBe(Math.round(faab))
    expect(v.lines.map((l) => [l.name, l.valueSource])).toEqual([
      ['Joe Burrow', 'guillotine_points'], ['Malik Willis', 'guillotine_points'], ['$75 FAAB', 'guillotine_faab'],
    ])
    expect(v.basis).toMatch(/4 FLEX, 1 SUPER_FLEX/)
  })

  it('withholds a pick, an unknown player, and FAAB with no balance on file', () => {
    const give = [{ kind: 'player' as const, name: 'Joe Burrow' }]
    expect(gradeGuillotineDeal({ give, get: [{ kind: 'pick', year: 2027, round: 1 }], ctx })).toMatchObject({ graded: false, reason: expect.stringMatching(/picks are not priced/) })
    expect(gradeGuillotineDeal({ give, get: [{ kind: 'player', name: 'Nobody Atall' }], ctx })).toMatchObject({ graded: false })
    expect(gradeGuillotineDeal({ give, get: [{ kind: 'faab', amount: 20 }], ctx: { ...ctx, liveFaab: 0 } })).toMatchObject({ graded: false, reason: expect.stringMatching(/FAAB/) })
  })

  it('withholds when no chop is left to play', () => {
    expect(gradeGuillotineDeal({ give: [{ kind: 'player', name: 'Joe Burrow' }], get: [{ kind: 'faab', amount: 5 }], ctx: { ...ctx, survival: [0] } })).toMatchObject({ graded: false })
  })
})

/**
 * War Room phase 6 — the war chest (lib/core-app/warRoomWarChest.ts) and the trade map
 * (lib/core-app/warRoomTradeMap.ts).
 *
 * War chest pins: only a FAAB league has one; an unrecorded balance is unknown and ranked last, never
 * $0; ties share a rank; the use-it-or-lose-it line appears only for a redraft team still in it, with
 * money left, in the last USE_IT_WEEKS weeks — never for a keeper or dynasty budget whose carry-over is
 * not read.
 *
 * Trade map pins: a "they have" is a rival's non-starter who beats YOUR weakest starter at his position;
 * a "they need" is a position where their starters sit under the league average AND your depth would
 * start there; reserve/taxi players are not depth; two-way fits come first; the list is capped and the
 * overflow counted.
 */

import { describe, expect, it } from 'vitest'

import type { ScenarioModel, ScenarioPlayer, ScenarioTeam } from '@/lib/core-app/outlookScenario'
import { measureScarcity } from '@/lib/core-app/warRoomFormat'
import { buildTradeMap, MAX_PARTNERS } from '@/lib/core-app/warRoomTradeMap'
import { buildWarChest, USE_IT_WEEKS, type WarChestRow } from '@/lib/core-app/warRoomWarChest'

/* ── war chest ─────────────────────────────────────────────────────────── */

const rows = (over: Partial<Record<string, number | null>> = {}): WarChestRow[] =>
  (
    [
      ['me', 'Mine', true, 42],
      ['a', 'Team Taco', false, 88],
      ['b', 'Bench Mob', false, 42],
      ['c', 'Gridiron Goblins', false, 5],
      ['d', 'Never Synced', false, null],
    ] as const
  ).map(([rosterId, name, isYou, remaining]) => ({
    rosterId,
    name,
    isYou,
    remaining: rosterId in over ? (over[rosterId] ?? null) : remaining,
  }))

const chest = (over: Partial<Parameters<typeof buildWarChest>[0]> = {}) =>
  buildWarChest({ waiverType: 'faab', budget: 100, teams: rows(), weeksRemaining: 6, horizon: 'this_season', posture: 'bubble', ...over })

describe('buildWarChest', () => {
  it('a league that does not run FAAB has no war chest', () => {
    expect(chest({ waiverType: 'rolling' })).toEqual({ kind: 'none', why: 'not_faab' })
    expect(chest({ waiverType: null })).toEqual({ kind: 'none', why: 'not_faab' })
  })

  it('FAAB with no balance recorded anywhere says so', () => {
    const teams = rows({ me: null, a: null, b: null, c: null })
    expect(chest({ teams })).toEqual({ kind: 'none', why: 'not_read' })
  })

  it('most money first, unknown last; a tie shares a rank and you sort first within it', () => {
    const c = chest()
    if (c.kind !== 'faab') throw new Error('expected faab')
    expect(c.rows.map((r) => r.rosterId)).toEqual(['a', 'me', 'b', 'c', 'd'])
    expect(c.rank).toBe(2)
    expect(c.known).toBe(4)
    expect(c.you).toBe(42)
    expect(c.rows.find((r) => r.rosterId === 'd')!.remaining).toBeNull()
  })

  it('🛑 an unrecorded balance sorts after a real $0 — missing is not empty', () => {
    const teams = [...rows(), { rosterId: 'z', name: 'Zero Bucks', isYou: false, remaining: 0 }]
    const c = chest({ teams })
    if (c.kind !== 'faab') throw new Error('expected faab')
    expect(c.rows.map((r) => r.rosterId).slice(-2)).toEqual(['z', 'd'])
    expect(c.known).toBe(5)
  })

  it('your balance unrecorded: no rank, and nothing invented', () => {
    const c = chest({ teams: rows({ me: null }) })
    expect(c).toMatchObject({ kind: 'faab', you: null, rank: null, known: 3 })
  })

  it('a zero or missing budget is not a budget', () => {
    expect(chest({ budget: 0 })).toMatchObject({ budget: null })
    expect(chest({ budget: null })).toMatchObject({ budget: null })
  })

  it('use it or lose it: redraft, still in it, money left, within the last weeks', () => {
    expect(chest({ weeksRemaining: USE_IT_WEEKS })).toMatchObject({ useIt: true })
    expect(chest({ weeksRemaining: USE_IT_WEEKS + 1 })).toMatchObject({ useIt: false })
    expect(chest({ weeksRemaining: 2, horizon: 'carries_over' })).toMatchObject({ useIt: false })
    expect(chest({ weeksRemaining: 2, posture: 'eliminated' })).toMatchObject({ useIt: false })
    expect(chest({ weeksRemaining: 2, teams: rows({ me: 0 }) })).toMatchObject({ useIt: false })
    expect(chest({ weeksRemaining: null })).toMatchObject({ useIt: false })
  })
})

/* ── trade map ─────────────────────────────────────────────────────────── */

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
let n = 0
const p = (name: string, position: string, points: number, over: Partial<ScenarioPlayer> = {}): ScenarioPlayer => ({
  id: `${name}-${n++}`,
  name,
  position,
  team: 'NYG',
  points,
  slot: 'B',
  injury: null,
  byeWeek: null,
  age: 25,
  ...over,
})

/** You: deep at RB, thin at WR (WR2 scores 6). Them: deep at WR, thin at RB (RB2 scores 5). Other: no depth. */
function teams(): ScenarioTeam[] {
  return [
    {
      rosterId: 'you',
      name: 'My Team',
      isYou: true,
      players: [
        p('My QB', 'QB', 20, { slot: 'S' }),
        p('My RB1', 'RB', 18, { slot: 'S' }),
        p('My RB2', 'RB', 16, { slot: 'S' }),
        p('My RB3', 'RB', 15, { slot: 'S' }),
        p('My RB4', 'RB', 14),
        p('My WR1', 'WR', 15, { slot: 'S' }),
        p('My WR2', 'WR', 6, { slot: 'S' }),
        p('My TE', 'TE', 9, { slot: 'S' }),
      ],
    },
    {
      rosterId: 'them',
      name: 'Team Taco',
      isYou: false,
      players: [
        p('Their QB', 'QB', 19, { slot: 'S' }),
        p('Their RB1', 'RB', 15, { slot: 'S' }),
        p('Their RB2', 'RB', 5, { slot: 'S' }),
        p('Their WR1', 'WR', 17, { slot: 'S' }),
        p('Their WR2', 'WR', 16, { slot: 'S' }),
        p('Their WR3', 'WR', 15, { slot: 'S' }),
        p('Their WR4', 'WR', 14),
        p('Their TE', 'TE', 8, { slot: 'S' }),
      ],
    },
    {
      rosterId: 'other',
      name: 'Balanced Bunch',
      isYou: false,
      players: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR'].map((pos, i) => p(`B${i}`, pos, 30, { slot: 'S' })),
    },
  ]
}

function model(over: Partial<ScenarioModel> = {}): ScenarioModel {
  return {
    leagueId: 'L',
    basisWeek: { season: '2026', week: 10 },
    refusal: null,
    slots: SLOTS,
    teams: teams(),
    freeAgents: [],
    sim: {} as ScenarioModel['sim'],
    seed: 1,
    weeks: [10, 11],
    youRosterId: 'you',
    ...over,
  }
}

const mapOf = (m: ScenarioModel) => buildTradeMap(m, measureScarcity(m))

describe('buildTradeMap', () => {
  it('they have depth where you are thin, and are thin where your depth would start', () => {
    const map = mapOf(model())!
    expect(map.partners).toHaveLength(1)
    const them = map.partners[0]
    expect(them.rosterId).toBe('them')
    // Their WR4 (14) over your weakest WR starter (6).
    expect(them.theyHave).toEqual([{ player: expect.objectContaining({ name: 'Their WR4', position: 'WR', points: 14 }), upgrade: 8 }])
    // Their RBs average 10 against a league RB average of 129/7 ≈ 18.4; your RB4 (14) beats their RB2 (5).
    expect(them.theyNeed).toEqual([
      { position: 'RB', underLeague: -8.4, yourPlayer: expect.objectContaining({ name: 'My RB4' }), upgrade: 9 },
    ])
    expect(map.matched).toBe(1)
    expect(map.basisWeek).toEqual({ season: '2026', week: 10 })
  })

  it('a team with no depth and no thin spot your depth fills is not listed', () => {
    expect(mapOf(model())!.partners.map((x) => x.rosterId)).not.toContain('other')
  })

  it('your depth would start for a team that is NOT thin there: not a "they need"', () => {
    const t = teams()
    // RBs 40 and 12: their weakest RB is below your RB4 (14), but their RB average is above the league's.
    t.push({
      rosterId: 'strong',
      name: 'Strong Backs',
      isYou: false,
      players: [
        p('S QB', 'QB', 30, { slot: 'S' }),
        p('S RB1', 'RB', 40, { slot: 'S' }),
        p('S RB2', 'RB', 12, { slot: 'S' }),
        p('S WR1', 'WR', 30, { slot: 'S' }),
        p('S WR2', 'WR', 30, { slot: 'S' }),
        p('S WR3', 'WR', 30, { slot: 'S' }),
        p('S TE', 'TE', 30, { slot: 'S' }),
      ],
    })
    expect(mapOf(model({ teams: t }))!.partners.map((x) => x.rosterId)).not.toContain('strong')
  })

  it('reserve and taxi players are not depth', () => {
    const t = teams()
    // ⚠ `bestLineup` (the shared rule) may START a taxi player who outscores a starter, so the taxi
    // player here projects below their lineup; the point is that sitting on the taxi squad is not depth.
    // Their TE starts at 13, so a taxi TE at 12 sits outside their lineup — and would beat your TE (9).
    // A TE row appearing means taxi was counted as depth; the IR TE is out of every lineup regardless.
    t[1].players.find((x) => x.name === 'Their TE')!.points = 13
    t[1].players.push(p('Their IR TE', 'TE', 25, { slot: 'I' }), p('Their Taxi TE', 'TE', 12, { slot: 'T' }))
    const have = mapOf(model({ teams: t }))!.partners[0].theyHave
    expect(have.map((h) => h.player.name)).toEqual(['Their WR4'])
  })

  it('a player the manager set as a starter but who is outside the best lineup IS depth', () => {
    const t = teams()
    t[1].players.find((x) => x.name === 'Their WR4')!.slot = 'S'
    expect(mapOf(model({ teams: t }))!.partners[0].theyHave[0].player.name).toBe('Their WR4')
  })

  it('names one player per position — the best upgrade', () => {
    const t = teams()
    t[1].players.push(p('Their WR5', 'WR', 12))
    const have = mapOf(model({ teams: t }))!.partners[0].theyHave
    expect(have).toHaveLength(1)
    expect(have[0].player.name).toBe('Their WR4')
  })

  it('two-way fits come before one-way ones, and the list is capped with the overflow counted', () => {
    const t = teams()
    // Clones of "them" with no thin RB spot: they only have (one-way), with a BIGGER upgrade than the two-way team.
    for (let i = 0; i < MAX_PARTNERS + 1; i++) {
      t.push({
        rosterId: `oneway${i}`,
        name: `One Way ${i}`,
        isYou: false,
        players: [
          p('QB', 'QB', 30, { slot: 'S' }),
          p('RB a', 'RB', 30, { slot: 'S' }),
          p('RB b', 'RB', 30, { slot: 'S' }),
          p('WR a', 'WR', 30, { slot: 'S' }),
          p('WR b', 'WR', 30, { slot: 'S' }),
          p('WR c', 'WR', 30, { slot: 'S' }),
          p('TE', 'TE', 30, { slot: 'S' }),
          p(`Deep WR ${i}`, 'WR', 20),
        ],
      })
    }
    const map = mapOf(model({ teams: t }))!
    expect(map.partners).toHaveLength(MAX_PARTNERS)
    expect(map.matched).toBe(MAX_PARTNERS + 2)
    expect(map.partners[0].rosterId).toBe('them')
  })

  it('no map without your team, or when the rosters could not be priced', () => {
    expect(mapOf(model({ youRosterId: null }))).toBeNull()
    expect(mapOf(model({ refusal: 'no rosters' }))).toBeNull()
    expect(mapOf(model({ slots: [] }))).toBeNull()
  })
})

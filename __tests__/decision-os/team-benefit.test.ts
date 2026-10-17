/**
 * The design's value engine, shadowed beside the one grade (Phase 3). Every formula is pinned against
 * a hand-checkable example.
 */
import { describe, expect, it } from 'vitest'

import {
  availability,
  computeTeamBenefit,
  designLetter,
  fairnessLabel,
  horizonWeeks,
  lineupImpact,
  packageValue,
  replacementLevels,
  rosPoints,
  TEAM_BENEFIT_MODEL,
  valuePlayers,
  type BenefitHorizon,
  type BenefitPlayer,
  type TeamBenefitInput,
} from '@/lib/decision-os/trade/teamBenefit'
import type { LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'

const H: BenefitHorizon = { currentWeek: 13, finalWeek: 16, playoffStartWeek: 15 } // weeks 13–16, playoffs 15–16

const P = (id: string, over: Partial<BenefitPlayer> = {}): BenefitPlayer => ({
  playerId: id, name: id.toUpperCase(), position: 'RB', team: 'BUF', perGame: 10, injuryStatus: null, byeWeek: null, marketValue: 1000, ...over,
})

describe('availability — the design’s injury table', () => {
  it.each([
    [null, 0, 1], ['Active', 0, 1],
    ['Questionable', 0, 0.75], ['Q', 1, 1],
    ['Doubtful', 0, 0.25], ['D', 2, 1],
    ['Out', 0, 0], ['Out', 1, 0.9], ['Out', 2, 1],
    ['IR', 0, 0], ['IR', 3, 0], ['IR', 4, 1], // earliest legal return: 4 weeks
    ['PUP', 1, 0],
  ] as const)('%s, %i week(s) ahead → %f', (status, offset, want) => {
    expect(availability(status, offset)).toBe(want)
  })
})

describe('rest-of-season points', () => {
  it('Σ rate × availability, zero on the bye, 1.5× in playoff weeks', () => {
    expect(horizonWeeks(H)).toEqual({ weeks: [13, 14, 15, 16], playoffWeeks: [15, 16] })
    // 10 + 10 + 15 + 15
    expect(rosPoints(P('a'), H)).toBe(50)
    // Bye in week 15 removes a playoff game: 10 + 10 + 0 + 15
    expect(rosPoints(P('a', { byeWeek: 15 }), H)).toBe(35)
    // Questionable this week: 7.5 + 10 + 15 + 15
    expect(rosPoints(P('a', { injuryStatus: 'Questionable' }), H)).toBe(47.5)
  })

  it('an unprojected player has NO rest-of-season total — null, never zero', () => {
    expect(rosPoints(P('a', { perGame: null }), H)).toBeNull()
  })
})

describe('replacement and value', () => {
  const players = new Map([
    ['star', P('star', { perGame: 20, marketValue: 8000 })],
    ['mid', P('mid', { perGame: 12, marketValue: 3000 })],
    ['fa1', P('fa1', { perGame: 8, marketValue: 200 })],
    ['fa2', P('fa2', { perGame: 6, marketValue: 100 })],
    ['wrfa', P('wrfa', { position: 'WR', perGame: 9, marketValue: 150 })],
  ])

  it('replacement is the BEST projected free agent at each position', () => {
    const r = replacementLevels(players, ['fa1', 'fa2', 'wrfa'], H)
    expect(r.get('RB')).toBe(40) // fa1: 8×(1+1+1.5+1.5)
    expect(r.get('WR')).toBe(45)
  })

  it('VORP over that replacement; 0–100 normalization; the 0.7 / 0.3 blend', () => {
    const { byId } = valuePlayers({ players, leaguePlayerIds: ['star', 'mid'], freeAgentIds: ['fa1', 'fa2', 'wrfa'], horizon: H })
    expect(byId.get('star')).toMatchObject({ ros: 100, vorp: 60, vorpNorm: 100, marketNorm: 100, value: 100 })
    // mid: ros 60, vorp 20 → 33.3; market 3000/8000 → 37.5; 0.7×33.33 + 0.3×37.5
    expect(byId.get('mid')!.value).toBeCloseTo(0.7 * (20 / 60) * 100 + 0.3 * 37.5, 5)
    expect(byId.get('fa2')!.vorp).toBe(0) // below replacement is zero, never negative
  })

  it('package value: best first, the 0.85 depth discount compounds on the VORP part only', () => {
    const { byId } = valuePlayers({ players, leaguePlayerIds: ['star', 'mid'], freeAgentIds: ['fa1', 'fa2', 'wrfa'], horizon: H })
    const star = byId.get('star')!
    const mid = byId.get('mid')!
    expect(packageValue(['mid', 'star'], byId)).toBeCloseTo(0.7 * star.vorpNorm + 0.3 * star.marketNorm + 0.7 * mid.vorpNorm * 0.85 + 0.3 * mid.marketNorm, 5)
  })
})

describe('lineup impact across the remaining weeks', () => {
  const seats: LineupSlotSpec[] = [{ slot: 'RB', eligible: ['RB'], count: 1 }, { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }]

  it('averages the optimal-lineup change over every remaining week — byes and injuries move it', () => {
    const players = new Map([
      ['a', P('a', { perGame: 10 })],
      ['b', P('b', { perGame: 8 })],
      ['c', P('c', { perGame: 15, byeWeek: 14 })],
    ])
    // Before {a,b}: 18 every week. After {a,c}: 25, then 10 on c's bye (b is gone), 25, 25 → mean 21.25.
    expect(lineupImpact(['a', 'b'], ['a', 'c'], seats, players, H)).toEqual({ deltaPerWeek: 3.25, beforePerWeek: 18 })
  })

  it('an unprojected player cannot start — he is not priced at zero into a lineup either', () => {
    const players = new Map([['a', P('a', { perGame: 10 })], ['x', P('x', { perGame: null })]])
    expect(lineupImpact(['a'], ['a', 'x'], seats, players, H).deltaPerWeek).toBe(0)
  })
})

describe('fairness label and the design letter', () => {
  it.each([[0, 'fair'], [9, 'fair'], [10, 'leans'], [24, 'leans'], [25, 'lopsided'], [40, 'lopsided'], [41, 'heavily_lopsided'], [-60, 'heavily_lopsided']] as const)('gap %i → %s', (g, want) => {
    expect(fairnessLabel(g)).toBe(want)
  })

  it('60 / 40: a side can lose on paper and still grade well because the trade fixes its lineup', () => {
    // −10% package gap, but +5% weekly starting points (scaled ×5 = 25): 0.6×25 + 0.4×(−10) = 11 → B
    expect(designLetter({ lineupDeltaPerWeek: 5, lineupBeforePerWeek: 100, packageGapPct: -10 })).toBe('B')
    // Even package, lineup unchanged → C
    expect(designLetter({ lineupDeltaPerWeek: 0, lineupBeforePerWeek: 100, packageGapPct: 0 })).toBe('C')
  })
})

describe('computeTeamBenefit — the whole model', () => {
  const seats: LineupSlotSpec[] = [{ slot: 'RB', eligible: ['RB'], count: 1 }, { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }]
  const players = new Map([
    ['star', P('star', { perGame: 20, marketValue: 8000 })],
    ['mid1', P('mid1', { perGame: 12, marketValue: 3000 })],
    ['mid2', P('mid2', { perGame: 11, marketValue: 2800 })],
    ['bench', P('bench', { perGame: 4, marketValue: 100 })],
    ['fa', P('fa', { perGame: 8, marketValue: 200 })],
  ])
  const base = (over: Partial<TeamBenefitInput> = {}): TeamBenefitInput => ({
    horizon: H,
    seats,
    rosterCapacity: 3,
    players,
    leaguePlayerIds: ['star', 'mid1', 'mid2', 'bench'],
    freeAgentIds: ['fa'],
    sides: [
      { teamId: 'me', activeIds: ['mid1', 'mid2', 'bench'], givesPlayerIds: ['mid1', 'mid2'], givesOther: [] },
      { teamId: 'them', activeIds: ['star'], givesPlayerIds: ['star'], givesOther: [] },
    ],
    ...over,
  })

  it('2-for-1: the consolidating side wins its lineup; the other side must DROP to fit, and that value is subtracted', () => {
    const r = computeTeamBenefit(base())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [me, them] = r.benefit.sides
    expect(r.benefit.model).toBe(TEAM_BENEFIT_MODEL)
    expect(me.receives.map((x) => x.playerId)).toEqual(['star'])
    expect(me.forcedDrops).toEqual([])
    // them: capacity 3, roster 1 − 1 + 2 = 2, no drop
    expect(them.forcedDrops).toEqual([])
    expect(me.lineupDeltaPerWeek).toBeGreaterThan(0) // star + bench beat mid1 + mid2
    expect(r.benefit.horizon.approximation).toMatch(/per-game projection/)
  })

  it('forced drop: the lowest-valued player on the post-trade roster is named and his value subtracted', () => {
    const r = computeTeamBenefit(base({
      rosterCapacity: 3,
      sides: [
        { teamId: 'me', activeIds: ['mid1', 'mid2', 'bench'], givesPlayerIds: ['mid1'], givesOther: [] },
        { teamId: 'them', activeIds: ['star', 'fa'], givesPlayerIds: ['star', 'fa'], givesOther: [] },
      ],
    }))
    if (!r.ok) throw new Error(r.reason)
    // me: 3 − 1 + 2 = 4 > 3 → one drop, the lowest-valued (bench or fa)
    expect(r.benefit.sides[0].forcedDrops).toHaveLength(1)
    expect(['bench', 'fa']).toContain(r.benefit.sides[0].forcedDrops[0]!.playerId)
  })

  it('a capacity smaller than a roster that already exists is distrusted — no drops invented', () => {
    const r = computeTeamBenefit(base({ rosterCapacity: 2 }))
    if (!r.ok) throw new Error(r.reason)
    expect(r.benefit.sides.every((s) => s.forcedDrops.length === 0)).toBe(true)
    expect(r.benefit.notes.join(' ')).toMatch(/not trusted/)
  })

  it('picks or FAAB: lineup numbers, but NO design letter — named, never priced at a placeholder', () => {
    const r = computeTeamBenefit(base({
      sides: [
        { teamId: 'me', activeIds: ['mid1', 'mid2', 'bench'], givesPlayerIds: ['mid1'], givesOther: ['2027 1st'] },
        { teamId: 'them', activeIds: ['star'], givesPlayerIds: ['star'], givesOther: [] },
      ],
    }))
    if (!r.ok) throw new Error(r.reason)
    expect(r.benefit.sides.map((s) => s.grade)).toEqual([null, null])
    expect(r.benefit.notes.join(' ')).toMatch(/2027 1st.*outside the team-benefit model/)
  })

  it('a traded player with no projection refuses the model, by name', () => {
    const r = computeTeamBenefit(base({ players: new Map([...players, ['star', P('star', { perGame: null })]]) }))
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/no projection/), missingAssets: ['STAR'] })
  })

  it('mirror: the two sides’ gaps are opposite', () => {
    const r = computeTeamBenefit(base())
    if (!r.ok) throw new Error(r.reason)
    expect(r.benefit.gapPct).toBe(-computeTeamBenefit({ ...base(), sides: [base().sides[1], base().sides[0]] } as TeamBenefitInput).benefit!.gapPct)
  })
})

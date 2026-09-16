/**
 * Item #8 — ranking the league's managers as trade partners.
 *
 * The fixture is worked by hand (numbers in the comments) so the order and the reasons are
 * asserted as facts, not as "whatever the function returned".
 */
import { describe, expect, it } from 'vitest'

import {
  normalizePosition,
  rankTradePartners,
  type RankingRoster,
  type RankingTradeHistory,
} from '@/lib/trade-intel/partnerRanking'

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN']

let seq = 0
const pl = (position: string | null, value: number | null, name?: string) => {
  seq += 1
  return { id: `p${seq}`, name: name ?? `${position}-${value}`, position, value }
}

/*
 * V (viewer): weakest RB 800 — the league's clear hole. Spare WR 4000 (FLEX already holds WR 4200).
 * A: RB-rich (FLEX = RB 4800, spare RB 4600), weakest WR 1500.
 * B: balanced, nothing spare worth having.
 * C: thin but nothing V can fill; one unpriced player.
 *
 * Baselines (median of each team's weakest starter): RB 2600, WR 2950, TE 1900, QB 5250.
 */
function league(): RankingRoster[] {
  seq = 0
  return [
    {
      rosterId: 'V', ownerName: 'You',
      players: [pl('QB', 6000), pl('RB', 3000), pl('RB', 800), pl('WR', 5000), pl('WR', 4500), pl('WR', 4200), pl('WR', 4000, 'Spare Receiver'), pl('TE', 2000)],
      picks: [{ pickId: 'v-2027-1', label: '2027 1st', value: 1800 }],
    },
    {
      rosterId: 'A', ownerName: 'Alpha',
      players: [pl('QB', 5000), pl('RB', 6000), pl('RB', 5500), pl('RB', 4800), pl('RB', 4600, 'Spare Runner'), pl('WR', 2000), pl('WR', 1500), pl('TE', 2500)],
      picks: [],
    },
    {
      rosterId: 'B', ownerName: 'Bravo',
      players: [pl('QB', 5500), pl('RB', 3500), pl('RB', 3200), pl('RB', 500), pl('WR', 3800), pl('WR', 3600), pl('WR', 3000), pl('TE', 1800)],
      picks: [],
    },
    {
      rosterId: 'C', ownerName: 'Charlie',
      players: [pl('QB', 4000), pl('RB', 2500), pl('RB', 2400), pl('RB', 2000), pl('WR', 3000), pl('WR', 2900), pl('WR', 900), pl('TE', 1500), pl('K', null, 'Unpriced Kicker')],
      picks: [],
    },
  ]
}

const HISTORY: RankingTradeHistory = {
  tradesByRoster: new Map([['A', 3], ['B', 5], ['C', 0], ['V', 1]]),
  tradesWithViewer: new Map([['A', 1]]),
}

describe('rankTradePartners', () => {
  it('ranks the team that has what you lack AND wants what you have first', () => {
    const r = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: SLOTS, history: HISTORY })
    expect(r.partners.map((p) => p.rosterId)).toEqual(['A', 'B', 'C'])
    expect(r.partners.map((p) => p.rank)).toEqual([1, 2, 3])
    // Never offers you your own team.
    expect(r.partners.some((p) => p.rosterId === 'V')).toBe(false)

    const a = r.partners[0]!
    // availability 0.692, need 0.417, package 0.629, history 0.76 -> 62
    expect(a.score).toBe(62)
    expect(a.label).toBe('Good fit')
    expect(a.components.availability).toBeCloseTo(0.692, 3)
    expect(a.components.need).toBeCloseTo(0.4165, 3)
    expect(a.components.package).toBeCloseTo(1 - 0.13 / 0.35, 3)
    expect(a.components.history).toBeCloseTo(0.76, 3)
  })

  it('explains the ranking in manager terms', () => {
    const a = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: SLOTS, history: HISTORY }).partners[0]!
    expect(a.reasons[0]).toBe('Has a spare RB: Spare Runner (4,600) would start over your weakest RB (800).')
    expect(a.reasons[1]).toBe('Thin at WR — your Spare Receiver would start for them.')
    expect(a.reasons[2]).toBe('A realistic opening: Spare Receiver for Spare Runner (13% apart).')
    expect(a.reasons[3]).toBe('Has traded with you once in this league.')
  })

  it('🛑 suggests only SPARE players — never a starter from either lineup', () => {
    const a = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: SLOTS, history: HISTORY }).partners[0]!
    expect(a.suggestion).toEqual({
      give: [{ id: expect.any(String), name: 'Spare Receiver', position: 'WR', value: 4000, kind: 'player' }],
      get: [{ id: expect.any(String), name: 'Spare Runner', position: 'RB', value: 4600, kind: 'player' }],
      percentApart: 13,
    })
  })

  it('scores a partner with nothing to offer and nothing to gain on history alone', () => {
    const r = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: SLOTS, history: HISTORY })
    const b = r.partners.find((p) => p.rosterId === 'B')!
    expect(b.components).toEqual({ availability: 0, need: 0, package: 0, history: 0.6 })
    expect(b.score).toBe(9)
    expect(b.suggestion).toBeNull()
    expect(b.reasons).toEqual(['Active trader: 5 completed trades in this league.'])
    const c = r.partners.find((p) => p.rosterId === 'C')!
    expect(c.score).toBe(0)
    expect(c.label).toBe('Weak fit')
    expect(c.reasons).toEqual(['No completed trades on file in this league.'])
  })

  it('discloses unpriced players rather than scoring them as worthless', () => {
    const r = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: SLOTS, history: HISTORY })
    expect(r.gaps).toContain('1 rostered player has no market value and was left out.')
  })

  it('🛑 does not guess a lineup: with none on file, need/availability/package are unmeasured', () => {
    const r = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: null, history: HISTORY })
    expect(r.gaps[0]).toMatch(/starting lineup is not on file/)
    for (const p of r.partners) {
      expect(p.components.availability).toBeNull()
      expect(p.components.need).toBeNull()
      expect(p.components.package).toBeNull()
      expect(p.suggestion).toBeNull()
    }
    // History alone decides, and the score is over the measured weight only (0.76 -> 76).
    expect(r.partners[0]!.rosterId).toBe('A')
    expect(r.partners[0]!.score).toBe(76)
  })

  it('says when trade history is missing, and scores without it', () => {
    const r = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: SLOTS, history: null })
    expect(r.gaps).toContain('Trade history is not on file for this league, so past dealing did not count.')
    const a = r.partners[0]!
    expect(a.components.history).toBeNull()
    // (0.35*0.692 + 0.25*0.4165 + 0.25*0.6286) / 0.85 = 0.5924 -> 59
    expect(a.score).toBe(59)
    expect(a.reasons.some((s) => /trade/.test(s) && /league\.$/.test(s) && /completed|traded/.test(s))).toBe(false)
  })

  it('names lineup slots it cannot model instead of silently skipping them', () => {
    const r = rankTradePartners({ viewerRosterId: 'V', rosters: league(), starterSlots: [...SLOTS, 'OP'], history: HISTORY })
    expect(r.gaps).toContain('Lineup slot OP is not modelled and did not count toward needs.')
  })

  it('tops up a light side with ONE spare asset (a pick counts)', () => {
    const rosters = league()
    // Make V's only spare receiver cheap: 2,500 against A's 4,600 is 46% apart.
    const v = rosters[0]!
    v.players = v.players.map((p) => (p.name === 'Spare Receiver' ? { ...p, value: 2500 } : p))
    const a = rankTradePartners({ viewerRosterId: 'V', rosters, starterSlots: SLOTS, history: HISTORY }).partners
      .find((p) => p.rosterId === 'A')!
    // Shortfall 2,100 -> the 1,800 pick brings it to 4,300 v 4,600: 7% apart.
    expect(a.suggestion?.give.map((x) => x.name)).toEqual(['Spare Receiver', '2027 1st'])
    expect(a.suggestion?.give[1]?.kind).toBe('pick')
    expect(a.suggestion?.percentApart).toBe(7)
  })

  it('offers no package when even a top-up cannot bring the sides within reach', () => {
    const rosters = league()
    const v = rosters[0]!
    v.players = v.players.map((p) => (p.name === 'Spare Receiver' ? { ...p, value: 1000 } : p))
    v.picks = []
    const a = rankTradePartners({ viewerRosterId: 'V', rosters, starterSlots: SLOTS, history: HISTORY }).partners
      .find((p) => p.rosterId === 'A')!
    expect(a.suggestion).toBeNull()
    expect(a.components.package).toBe(0)
    expect(a.reasons.some((s) => s.startsWith('A realistic opening'))).toBe(false)
  })

  it('reports a viewer it cannot find instead of ranking against nobody', () => {
    const r = rankTradePartners({ viewerRosterId: 'nope', rosters: league(), starterSlots: SLOTS, history: HISTORY })
    expect(r.partners).toEqual([])
    expect(r.gaps).toEqual(['Your team could not be identified in this league.'])
  })

  it('breaks ties deterministically', () => {
    const rosters: RankingRoster[] = [
      { rosterId: 'V', ownerName: 'You', players: [], picks: [] },
      { rosterId: 'z', ownerName: 'Zed', players: [], picks: [] },
      { rosterId: 'm', ownerName: 'Em', players: [], picks: [] },
    ]
    const r = rankTradePartners({ viewerRosterId: 'V', rosters, starterSlots: SLOTS, history: null })
    expect(r.partners.map((p) => p.rosterId)).toEqual(['m', 'z'])
  })
})

describe('normalizePosition', () => {
  it('trims and upper-cases, and KEEPS the detailed position (5H-b2: no broad-collapse map)', () => {
    expect(normalizePosition(' de ')).toBe('DE')
    expect(normalizePosition('cb')).toBe('CB')
    expect(normalizePosition(' wr ')).toBe('WR')
    expect(normalizePosition('')).toBeNull()
    expect(normalizePosition(null)).toBeNull()
  })
})

describe('IDP slots accept detailed positions through the governed buckets', () => {
  it('weighs a CB and an S as DB starters, and offers a spare corner for a DB hole', () => {
    const slots = ['DB', 'DB', 'LB', 'BN']
    const rosters: RankingRoster[] = [
      // Viewer: one real DB, the second DB slot is a weak safety.
      { rosterId: 'V', ownerName: 'You', players: [
        { id: 'v1', name: 'Good Corner', position: 'CB', value: 900 },
        { id: 'v2', name: 'Weak Safety', position: 'S', value: 100 },
        { id: 'v3', name: 'Linebacker', position: 'OLB', value: 700 },
        { id: 'v4', name: 'Spare Backer', position: 'ILB', value: 650 },
      ], picks: [] },
      // Partner: two starting DBs plus a spare corner, and a weak linebacker.
      { rosterId: 'P', ownerName: 'Partner', players: [
        { id: 'p1', name: 'Safety One', position: 'FS', value: 800 },
        { id: 'p2', name: 'Corner Two', position: 'CB', value: 750 },
        { id: 'p3', name: 'Spare Corner', position: 'CB', value: 700 },
        { id: 'p4', name: 'Thin Backer', position: 'MLB', value: 150 },
      ], picks: [] },
      { rosterId: 'X', ownerName: 'Other', players: [
        { id: 'x1', name: 'X1', position: 'SS', value: 600 },
        { id: 'x2', name: 'X2', position: 'DB', value: 600 },
        { id: 'x3', name: 'X3', position: 'LB', value: 600 },
      ], picks: [] },
    ]
    const p = rankTradePartners({ viewerRosterId: 'V', rosters, starterSlots: slots, history: null }).partners
      .find((x) => x.rosterId === 'P')!
    expect(p.reasons[0]).toBe('Has a spare DB: Spare Corner (700) would start over your weakest DB (100).')
    expect(p.reasons[1]).toBe('Thin at LB — your Spare Backer would start for them.')
    // The detailed position survives onto the suggested asset.
    expect(p.suggestion?.get[0]).toMatchObject({ name: 'Spare Corner', position: 'CB' })
    expect(p.suggestion?.give[0]).toMatchObject({ name: 'Spare Backer', position: 'ILB' })
  })
})

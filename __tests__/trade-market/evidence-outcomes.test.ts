import { describe, expect, it } from 'vitest'

import { evidenceKindsOf } from '@/lib/trade-market/evidenceKinds'
import { letterHeld, outcomesByEvidence, tradeLedgerRow, yourTeamVsMarket, type TradeLedgerRow } from '@/lib/decision-os/trade/tradeLedger'

/* The outcome check (owner's call, 2026-11-22): the ledger's held-up record, split by the evidence a grade rested on. */

const PICK = 'AllFantasy pick market +15%: what managers paid for picks like this (next draft) across 88 completed trades, against the standard pick curve'
const MARKET = 'AllFantasy trade market +6%: what managers actually paid for him across 41 completed Dynasty · 1QB trades in AllFantasy-connected leagues'
const POSTURE = 'teams at .600 or better paid +8% for players 27 or older over middle-of-the-table teams across 210 completed trades'
const NEED = 'you cannot fill 1 TE slot; teams short at TE paid +11% over normal-depth teams across 140 completed trades'
const LINEUP = 'Lineup +9%: in leagues that start more tight ends than usual (this one: 2 TE), tight ends trade 9% higher — measured across 260 trades in 31 leagues'

describe('evidenceKindsOf', () => {
  it('reads each kind from its fixed opening, once, in order; scoring and the hand-set rule are not evidence', () => {
    expect(evidenceKindsOf({ moves: [{ reasons: [LINEUP, PICK, 'Half-PPR scoring'] }], rosterFit: { moves: [{ reasons: [NEED, POSTURE, MARKET] }] } }))
      .toEqual(['trade_market', 'pick_market', 'posture', 'need', 'lineup'])
    expect(evidenceKindsOf({ moves: [{ reasons: ['you cannot fill 1 TE slot and there is no TE available on waivers'] }] })).toEqual([])
    // The "this week" premium is need evidence too.
    expect(evidenceKindsOf({ moves: [{ reasons: ['teams short at TE this week (a starter ruled out) paid +14% over normal-depth teams across 60 completed trades'] }] })).toEqual(['need'])
    expect(evidenceKindsOf(null)).toEqual([])
  })
})

describe('the ledger row', () => {
  const receipt = (grade: Record<string, unknown>) => ({
    grade: { graded: true, letter: 'B', leagueType: { type: 'redraft' }, ...grade },
    canonical: { proposerRosterId: 'r1', moves: [{ playerId: 'p1', fromRosterId: 'r2', toRosterId: 'r1' }] },
    assets: [],
  })
  it('carries the evidence and, under a your-team headline, a market letter that differs', () => {
    const r = tradeLedgerRow({ receipt: receipt({ letterBasis: 'your_team', market: { letter: 'C' }, rosterFit: { moves: [{ reasons: [POSTURE] }] } }), surface: 's', isTrade: true, fromWeek: 3 }) as TradeLedgerRow
    expect(r.evidence).toEqual(['posture'])
    expect(r.marketLetter).toBe('C')
    const same = tradeLedgerRow({ receipt: receipt({ letterBasis: 'your_team', market: { letter: 'B' } }), surface: 's', isTrade: true, fromWeek: 3 }) as TradeLedgerRow
    expect(same.marketLetter).toBeNull()
    expect(same.evidence).toEqual([])
  })
})

describe('the outcome split', () => {
  const row = (letter: string, evidence: TradeLedgerRow['evidence'], marketLetter: string | null = null): TradeLedgerRow =>
    ({ surface: 's', letter, format: 'redraft', fromWeek: 1, getPlayerIds: [], givePlayerIds: [], nonPlayerAssets: false, isTrade: true, evidence, marketLetter })

  it('held up = A/B came out ahead, D/F came out behind; C and a tie decide nothing', () => {
    expect([letterHeld('A', 2), letterHeld('B', -1), letterHeld('F', -3), letterHeld('D', 1), letterHeld('C', 5), letterHeld('A', 0)]).toEqual([true, false, true, false, null, null])
  })

  it('groups by kind (a two-kind grade in both), plus "none" and "any"', () => {
    const out = outcomesByEvidence([
      { row: row('A', []), netPerWeek: 3 },
      { row: row('A', []), netPerWeek: -1 },
      { row: row('B', ['pick_market', 'posture']), netPerWeek: 2 },
      { row: row('F', ['posture']), netPerWeek: 1 },
      { row: row('C', ['need']), netPerWeek: 4 },
    ])
    expect(out.map((o) => o.group)).toEqual(['none', 'any', 'pick_market', 'posture', 'need'])
    expect(out.find((o) => o.group === 'none')).toMatchObject({ scored: 2, decided: 2, held: 1, heldPct: 50, netPerWeek: 1 })
    expect(out.find((o) => o.group === 'posture')).toMatchObject({ scored: 2, decided: 2, held: 1, heldPct: 50 })
    expect(out.find((o) => o.group === 'need')).toMatchObject({ scored: 1, decided: 0, heldPct: null })
    expect(out.find((o) => o.group === 'any')).toMatchObject({ scored: 3, decided: 2, held: 1 })
  })

  it('your-team vs market: same deal, two letters, which held up', () => {
    const vs = yourTeamVsMarket([
      { row: row('B', ['need'], 'D'), netPerWeek: 2 },
      { row: row('B', ['need'], 'D'), netPerWeek: -2 },
      { row: row('B', ['need'], 'C'), netPerWeek: 2 },
      { row: row('A', [], null), netPerWeek: 2 },
    ])
    expect(vs).toEqual({ deals: 3, yourTeamHeld: 1, marketHeld: 1, bothDecided: 2 })
  })
})

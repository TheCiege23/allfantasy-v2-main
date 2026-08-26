/**
 * The value ledger's last open factor — manager positional premium.
 *
 * `LEDGER-FACTORS.md` carried this as ⬜ with the blocker "needs per-manager
 * trade history by position; LeagueTradeHistory is ingestion-progress, NOT
 * trades." That was true about the wrong table. `TransactionFact` payloads
 * carry playersInIds / playersOutIds / pickDetail per side — the same rows
 * scripts/probe-manager-tendencies.ts already pools to fill
 * manager_trade_tendencies.
 *
 * The estimator is the whole risk here, so most of this file is about it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  computePositionPremium,
  managerPremiumNotes,
  DOMINANT_SHARE,
  MIN_SIDES_PER_POSITION,
  PREMIUM_FLOOR,
  type ManagerProfile,
  type PricedSide,
} from '@/lib/trade-intel/managerPremium'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')
const SRC = read('lib/trade-intel/managerPremium.ts')
const NOTES = read('lib/trade-intel/tradeContextNotes.ts')
const LEDGER = read('lib/trade-intel/LEDGER-FACTORS.md')

/** A side where one position is all of what they received. */
function side(i: number, position: string, received: number, given: number): PricedSide {
  return {
    transactionId: `t${i}`,
    valueReceived: received,
    valueGiven: given,
    receivedByPosition: { [position]: received },
  }
}

const profile = (over: Partial<ManagerProfile> = {}): ManagerProfile => ({
  overpayRatio: null,
  prefersPicks: null,
  prefersYouth: null,
  riskTolerance: null,
  tradesAccepted: null,
  positions: [],
  ...over,
})

describe('⚠ the estimator has to be symmetric, because trades are zero-sum', () => {
  it('a mirrored pair cancels to 1 — an arithmetic mean would say 1.083', () => {
    /*
     * One side gives 1,500 for 1,000; the other gives 1,000 for 1,500. The
     * ratios are 1.5 and 0.667 and the population MUST centre on 1. Averaged
     * arithmetically that pair reads 1.083, the bias compounds across every
     * trade, and every manager comes out an overpayer — measured on the first
     * cut of the tendencies writer: median 1.56, 224 of 285 managers "high
     * risk".
     */
    const sides = [
      side(1, 'RB', 1000, 1500),
      side(2, 'RB', 1500, 1000),
      side(3, 'RB', 1000, 1500),
      side(4, 'RB', 1500, 1000),
    ]
    const [rb] = computePositionPremium(sides)
    expect(rb!.position).toBe('RB')
    expect(rb!.factor).toBeCloseTo(1, 3)
    expect(rb!.factor).not.toBeCloseTo(1.083, 2)
  })

  it('reports a real premium as a real premium', () => {
    const sides = [1, 2, 3, 4].map((i) => side(i, 'RB', 1000, 1200))
    const [rb] = computePositionPremium(sides)
    expect(rb!.factor).toBeCloseTo(1.2, 3)
    expect(rb!.sides).toBe(4)
  })

  it('one blockbuster does not define a manager the way a total would', () => {
    // Three even trades and one enormous overpay: the log mean moves, but not
    // to where a sum-of-values ratio (7000/5500 ≈ 1.27) would put it.
    const sides = [
      side(1, 'WR', 1000, 1000),
      side(2, 'WR', 1000, 1000),
      side(3, 'WR', 1000, 1000),
      side(4, 'WR', 2500, 4000),
    ]
    const [wr] = computePositionPremium(sides)
    expect(wr!.factor).toBeLessThan(1.15)
  })
})

describe('⚠ attribution without an allocation model', () => {
  it('skips a balanced two-position trade rather than splitting the blame', () => {
    /*
     * Splitting a mixed trade's overpay across positions by value share would
     * invent a rule about how managers price bundles. A 50/50 trade tells you
     * about neither position.
     */
    const mixed: PricedSide[] = [1, 2, 3, 4, 5].map((i) => ({
      transactionId: `m${i}`,
      valueReceived: 1000,
      valueGiven: 1400,
      receivedByPosition: { RB: 500, WR: 500 },
    }))
    expect(computePositionPremium(mixed)).toEqual([])
  })

  it('counts a side once the position clears the dominant share', () => {
    const dominant: PricedSide[] = [1, 2, 3, 4].map((i) => ({
      transactionId: `d${i}`,
      valueReceived: 1000,
      valueGiven: 1300,
      receivedByPosition: { RB: 1000 * DOMINANT_SHARE + 1, WR: 1000 * (1 - DOMINANT_SHARE) - 1 },
    }))
    const out = computePositionPremium(dominant)
    expect(out).toHaveLength(1)
    expect(out[0]!.position).toBe('RB')
  })
})

describe('⚠ a thin sample gets nothing, not a small number', () => {
  it('stays silent one side below the minimum', () => {
    const sides = Array.from({ length: MIN_SIDES_PER_POSITION - 1 }, (_, i) =>
      side(i, 'TE', 1000, 1400),
    )
    expect(computePositionPremium(sides)).toEqual([])
  })

  it('speaks at exactly the minimum', () => {
    const sides = Array.from({ length: MIN_SIDES_PER_POSITION }, (_, i) => side(i, 'TE', 1000, 1400))
    expect(computePositionPremium(sides)).toHaveLength(1)
  })

  it('drops a side that could not be priced on one end', () => {
    // A zero side is not a free side — it is an unpriced one, and log(0) is not
    // a number anybody should see.
    const sides = [
      ...Array.from({ length: MIN_SIDES_PER_POSITION }, (_, i) => side(i, 'QB', 1000, 1100)),
      side(99, 'QB', 0, 1200),
      side(98, 'QB', 1200, 0),
    ]
    const [qb] = computePositionPremium(sides)
    expect(qb!.sides).toBe(MIN_SIDES_PER_POSITION)
    expect(Number.isFinite(qb!.factor)).toBe(true)
  })

  it('⚠ never prices an unpriceable player at zero', () => {
    // Treating an unpriceable defender as worthless mechanically makes whoever
    // received him look like a genius. The loader drops the side instead.
    expect(SRC).toContain('A HALF-PRICED SIDE IS NOT A CHEAP SIDE')
    expect(SRC).toContain('if (!fullyPriced) continue')
  })

  it('ranks the strongest premium first', () => {
    const sides = [
      ...Array.from({ length: 4 }, (_, i) => side(i, 'RB', 1000, 1100)),
      ...Array.from({ length: 4 }, (_, i) => side(i + 10, 'WR', 1000, 1400)),
    ]
    expect(computePositionPremium(sides).map((p) => p.position)).toEqual(['WR', 'RB'])
  })
})

describe('⚠ only a premium, only in this deal, and always with its sample size', () => {
  const withRb = profile({ positions: [{ position: 'RB', factor: 1.24, sides: 6 }] })

  it('says nothing about a position that is not in the trade', () => {
    expect(managerPremiumNotes({ who: 'Kev', profile: withRb, givePositions: ['WR'] })).toEqual([])
  })

  it('speaks when you hold the position they overpay for', () => {
    const [note] = managerPremiumNotes({ who: 'Kev', profile: withRb, givePositions: ['RB'] })
    expect(note).toContain('Kev')
    expect(note).toContain('24%')
    // The reader is owed the n, every time.
    expect(note).toContain('6 trades')
  })

  it('stays quiet inside the noise floor', () => {
    const thin = profile({ positions: [{ position: 'RB', factor: PREMIUM_FLOOR - 0.01, sides: 9 }] })
    expect(managerPremiumNotes({ who: 'Kev', profile: thin, givePositions: ['RB'] })).toEqual([])
  })

  it('never reports a discipline as a finding', () => {
    // That they are hard-nosed about backs is true, unactionable, and — listed
    // beside every other non-finding — why people stop reading a panel.
    const cheap = profile({ positions: [{ position: 'RB', factor: 0.82, sides: 11 }] })
    expect(managerPremiumNotes({ who: 'Kev', profile: cheap, givePositions: ['RB'] })).toEqual([])
  })

  it('surfaces a pick preference only when it is true', () => {
    expect(managerPremiumNotes({ who: 'Kev', profile: profile({ prefersPicks: true }), givePositions: [] })).toHaveLength(1)
    expect(managerPremiumNotes({ who: 'Kev', profile: profile({ prefersPicks: false }), givePositions: [] })).toEqual([])
    expect(managerPremiumNotes({ who: 'Kev', profile: profile({ prefersPicks: null }), givePositions: [] })).toEqual([])
  })
})

describe('⚠ the two rules this factor cannot be built without', () => {
  it('is reported, never folded into the counterparty price', () => {
    /*
     * `counterpartyPriceDelta` already moves the price for their roster need. A
     * manager overpays for backs largely BECAUSE they are short at back, so
     * applying both counts one shortage twice — the same trap age is kept out
     * of.
     */
    expect(SRC).toContain('REPORTED, NEVER APPLIED TO THE PRICE')
    /* Asserted on the machinery, not the word — the rationale above names it. */
    expect(SRC).not.toContain('counterpartyPriceDelta(')
    expect(SRC).not.toContain("from './rosterNeed'")
  })

  it('reads null as null, never as the column default', () => {
    // prefers_youth/prefers_picks default to false and risk_tolerance to
    // "medium". Reading a default as an answer asserts we looked.
    expect(SRC).toContain('NULL IS NOT THE COLUMN DEFAULT')
    expect(SRC).toContain('tendency?.prefers_picks ?? null')
  })

  it('pairs league and roster id, because a roster id is not unique across leagues', () => {
    expect(SRC).toContain('mine.has(`${f.leagueId}:${String(f.rosterId)}`)')
  })

  it('does not read a dynasty habit off redraft prices', () => {
    expect(SRC).toContain('Boolean(l.isDynasty) === args.isDynasty')
  })

  it('counts picks into the totals but never as a position', () => {
    // A first traded for a back must not read as paying nothing for the back.
    expect(SRC).toContain('FIRST_ROUND_IN_MARKET_UNITS * pickRoundShare(round)')
    expect(SRC).toContain('a pick is not something a manager can')
  })
})

describe('⚠ wired, not merely written', () => {
  it('is reachable from the notes aggregator', () => {
    // This repo has a documented history of built-and-never-called modules.
    expect(NOTES).toContain("from './managerPremium'")
    expect(NOTES).toContain('loadManagerProfile({')
    expect(NOTES).toContain('...managerPremiumNotes({')
  })

  it('is ticked in the ledger, with the blocker marked cleared', () => {
    expect(LEDGER).toContain('| **Manager positional premium** | ✅ |')
    expect(LEDGER).toContain('**CLEARED.**')
  })
})

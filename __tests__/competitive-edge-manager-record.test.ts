/**
 * One manager's record (2026-11-16, re-score item 11 — Manager Psychology as facts only, paid).
 * Every line is an existing builder's own; the record adds the trade lines that are not bound to a
 * deal. Facts only: no labels, no predictions.
 */
import { describe, expect, it } from 'vitest'

import { buildManagerRecord, type ManagerRecordInput } from '@/lib/competitive-edge/managerRecord'
import { buildTradeRecord, TRADE_FLOOR, type EdgeTrade } from '@/lib/competitive-edge/tradeEdge'

function trade(id: string, season: string, sides: EdgeTrade['sides']): EdgeTrade {
  return { id, season, week: 3, createdIso: `${season}-10-0${id.slice(-1)}T12:00:00Z`, sides }
}
const p = (position: string) => ({ position })

/** Mike: 4 trades. Sold an RB in 3, took a WR in 3, took picks in 1. One trade with the viewer. */
const MIKE_TRADES: EdgeTrade[] = [
  trade('t1', '2025', [
    { ownerId: 'mike', playersIn: [p('WR')], playersOut: [p('RB')], picksIn: [], picksOut: [] },
    { ownerId: 'viewer', playersIn: [p('RB')], playersOut: [p('WR')], picksIn: [], picksOut: [] },
  ]),
  trade('t2', '2025', [
    { ownerId: 'mike', playersIn: [p('WR'), p('TE')], playersOut: [p('RB')], picksIn: [{}], picksOut: [] },
    { ownerId: 'sam', playersIn: [p('RB')], playersOut: [p('WR'), p('TE')], picksIn: [], picksOut: [{}] },
  ]),
  trade('t3', '2026', [
    { ownerId: 'mike', playersIn: [p('WR')], playersOut: [p('RB'), p('RB')], picksIn: [], picksOut: [] },
    { ownerId: 'sam', playersIn: [p('RB'), p('RB')], playersOut: [p('WR')], picksIn: [], picksOut: [] },
  ]),
  trade('t4', '2026', [
    { ownerId: 'mike', playersIn: [p('QB')], playersOut: [p('WR')], picksIn: [], picksOut: [] },
    { ownerId: 'sam', playersIn: [p('WR')], playersOut: [p('QB')], picksIn: [], picksOut: [] },
  ]),
  // Not Mike's: must not count.
  trade('t5', '2026', [
    { ownerId: 'sam', playersIn: [p('K')], playersOut: [p('DEF')], picksIn: [], picksOut: [] },
    { ownerId: 'viewer', playersIn: [p('DEF')], playersOut: [p('K')], picksIn: [], picksOut: [] },
  ]),
]

const tradeInput = {
  trades: MIKE_TRADES,
  managerOwnerId: 'mike',
  managerName: 'Mike',
  teamExternalId: '3',
  viewerOwnerId: 'viewer',
  seasonsScanned: ['2025', '2026'],
  historyGaps: [],
  asOf: '2026-11-15T00:00:00Z',
  stale: false,
}

describe('buildTradeRecord', () => {
  it('states what they took on and sent away, by position, across ALL their trades', () => {
    const r = buildTradeRecord(tradeInput)
    const text = r.facts.map((f) => f.text)
    expect(r.coverage.trades).toBe(4)
    expect(text).toContain('Mike took on a WR in 3 of their 4 trades and sent one away in 1.')
    expect(text).toContain('Mike sent away a RB in 3 of their 4 trades and took one on in none.')
    expect(text).toContain('Mike took on a TE in 1 of their 4 trades and sent one away in none.')
    expect(text).toContain('Mike took on draft picks in 1 of their 4 trades and gave picks up in 0.')
    // A trade counts once per position however many RBs moved in it (t3 sent two).
    expect(text.join(' ')).not.toMatch(/sent away a RB in 4/)
    // Someone else's trade is not Mike's record.
    expect(text.join(' ')).not.toMatch(/\bK\b|DEF/)
  })

  it('keeps the shared record lines: volume and trades with you', () => {
    const text = buildTradeRecord(tradeInput).facts.map((f) => f.text)
    expect(text.some((t) => t.startsWith('Mike has made 4 trades in this league since 2025'))).toBe(true)
    expect(text).toContain('1 of them was with you.')
  })

  it(`shows no position pattern below ${TRADE_FLOOR} trades — two trades are an anecdote`, () => {
    const r = buildTradeRecord({ ...tradeInput, trades: MIKE_TRADES.slice(0, 2) })
    expect(r.coverage.sufficient).toBe(false)
    expect(r.facts.some((f) => f.key.startsWith('trade.record.'))).toBe(false)
    expect(r.coverage.shortfall).toMatch(/fewer than 3/)
  })

  it('no line is bound to a deal, and none is a label or a prediction', () => {
    const r = buildTradeRecord(tradeInput)
    expect(r.facts.every((f) => f.bearsOnDeal === false)).toBe(true)
    const all = r.facts.map((f) => f.text).join(' ')
    expect(all).not.toMatch(/\b(likes?|loves?|prefers?|tends?|usually|always|will|likely|probably|buyer|seller|shark|aggressive)\b/i)
  })
})

function input(overrides: Partial<ManagerRecordInput> = {}): ManagerRecordInput {
  return {
    manager: { name: 'Mike', teamExternalId: '3', ownerId: 'mike' },
    viewerOwnerId: 'viewer',
    trades: {
      available: true,
      data: { trades: MIKE_TRADES, seasonsScanned: ['2025', '2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false },
    },
    waivers: {
      available: true,
      data: {
        season: 2026,
        usesFaab: true,
        claims: [
          { teamExternalId: '3', position: 'RB', bid: 22, atIso: '2026-10-01T00:00:00Z' },
          { teamExternalId: '3', position: 'RB', bid: 0, atIso: '2026-10-08T00:00:00Z' },
          { teamExternalId: '3', position: 'WR', bid: 5, atIso: '2026-10-15T00:00:00Z' },
          { teamExternalId: '9', position: 'QB', bid: 40, atIso: '2026-10-15T00:00:00Z' },
        ],
        faabRemaining: 73,
        asOf: '2026-11-15T00:00:00Z',
        stale: false,
      },
    },
    drafts: {
      available: true,
      data: {
        picks: [
          { season: 2024, round: 1, position: 'RB', ownerSleeperId: 'mike' },
          { season: 2025, round: 1, position: 'RB', ownerSleeperId: 'mike' },
          { season: 2025, round: 1, position: 'WR', ownerSleeperId: 'sam' },
        ],
        unattributedSeasons: [2023],
      },
    },
    ...overrides,
  }
}

describe('buildManagerRecord', () => {
  it('assembles trades, waivers and drafts for one manager from the shared builders', () => {
    const r = buildManagerRecord(input())
    expect(r.manager).toEqual({ name: 'Mike', teamExternalId: '3' })

    expect(r.trades.available && r.trades.data.coverage.trades).toBe(4)

    expect(r.waivers.available).toBe(true)
    if (r.waivers.available) {
      expect(r.waivers.data.claims).toBe(3) // team 9's claim is not Mike's
      expect(r.waivers.data.faabRemaining).toBe(73)
      const w = r.waivers.data.facts.map((f) => f.text)
      expect(w).toContain('Mike has $73 of FAAB left.') // no "than yours": a record is not a waiver decision
      expect(w).toContain('Mike has won 3 waiver claims this season, spending $27 in all.')
    }

    expect(r.drafts.available).toBe(true)
    if (r.drafts.available) {
      expect(r.drafts.data.drafts).toBe(2)
      expect(r.drafts.data.picks).toBe(2)
      expect(r.drafts.data.unattributedSeasons).toEqual([2023])
      expect(r.drafts.data.facts.map((f) => f.text)).toContain('Their first-round pick was at RB in 2 of their 2 drafts.')
    }
  })

  it('a section that could not be read keeps its reason — never an empty, quiet-looking record', () => {
    const r = buildManagerRecord(
      input({ trades: { available: false, reason: "This league's trade history hasn't been read yet." } }),
    )
    expect(r.trades).toEqual({ available: false, reason: "This league's trade history hasn't been read yet." })
    expect(r.waivers.available).toBe(true)
  })

  it('a team matched to no person gets no trade or draft history, said in words', () => {
    const r = buildManagerRecord(input({ manager: { name: 'Mike', teamExternalId: '3', ownerId: null } }))
    expect(r.trades.available).toBe(false)
    expect(r.drafts.available).toBe(false)
    if (!r.trades.available) expect(r.trades.reason).toMatch(/can't match this team to one person/)
    // Waivers are keyed by team this season, so they still read.
    expect(r.waivers.available).toBe(true)
  })

  it('in a non-FAAB league there is no budget line', () => {
    const base = input()
    if (!base.waivers.available) throw new Error('fixture')
    const r = buildManagerRecord({ ...base, waivers: { available: true, data: { ...base.waivers.data, usesFaab: false } } })
    expect(r.waivers.available && r.waivers.data.faabRemaining).toBeNull()
    expect(r.waivers.available && r.waivers.data.facts.some((f) => /FAAB|\$/.test(f.text))).toBe(false)
  })
})

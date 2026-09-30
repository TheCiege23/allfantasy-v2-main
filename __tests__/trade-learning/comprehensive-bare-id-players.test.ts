/**
 * collectTradeMarketFacts must price the player arrays LeagueTrade actually stores.
 *
 * Measured in production 2026-09-30: every LeagueTrade row with players, in every season,
 * stores `playersGiven/Received` as bare Sleeper-id strings (`["8150", "11635"]`), because
 * lib/dynasty-import/normalize-historical.ts writes the keys of a Sleeper transaction's
 * adds/drops. Zero rows are shaped `{ id, name, position }`. The writer read `player.id` off
 * a string, got undefined, and refused every trade with a player in it as "unmatched" — the
 * only trades it ever valued were pick-only. These tests pin the shape the data has.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ getFantasyCalcValuesDbFirst: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: mocks.getFantasyCalcValuesDbFirst }))

import { collectTradeMarketFacts } from '@/lib/comprehensive-trade-learning'

function fc(sleeperId: string, name: string, value: number, position = 'WR') {
  return {
    player: { sleeperId, name, position, id: Number(sleeperId), maybeAge: 25 },
    value,
    overallRank: 50,
  } as any
}

const BOOK = [fc('8150', 'Ja\'Marr Chase', 9000), fc('11635', 'Rome Odunze', 4000), fc('12507', 'Xavier Worthy', 3500)]

const base = { id: 'trade-1', picksGiven: [], picksReceived: [], season: 2026, leagueFormat: 'dynasty', isSuperFlex: false, sport: 'nfl' }

describe('collectTradeMarketFacts — player arrays as LeagueTrade stores them', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getFantasyCalcValuesDbFirst.mockResolvedValue(BOOK)
  })

  it('prices bare Sleeper-id strings on both sides, and names the players from FantasyCalc', async () => {
    const out = await collectTradeMarketFacts({ ...base, playersGiven: ['8150'], playersReceived: ['11635', '12507'] })

    expect(out).not.toBeNull()
    expect(out!.valueGiven).toBe(9000)
    expect(out!.valueReceived).toBe(7500)
    expect(out!.playersWithEnrichment.map((p) => p.name)).toEqual(['Ja\'Marr Chase', 'Rome Odunze', 'Xavier Worthy'])
    expect(out!.playersWithEnrichment.every((p) => p.position === 'WR')).toBe(true)
  })

  it('still accepts the object shape, matching by id first and by name when there is no id', async () => {
    const out = await collectTradeMarketFacts({
      ...base,
      playersGiven: [{ id: '8150', name: 'Wrong Name On File', position: 'WR' }],
      playersReceived: [{ name: 'Rome Odunze', position: 'WR' }],
    })

    expect(out).not.toBeNull()
    expect(out!.valueGiven).toBe(9000)
    expect(out!.valueReceived).toBe(4000)
    // What the row carries is kept; only a MISSING name is filled from FantasyCalc.
    expect(out!.playersWithEnrichment[0]!.name).toBe('Wrong Name On File')
  })

  it('refuses a bare id FantasyCalc does not know — nothing is guessed', async () => {
    const out = await collectTradeMarketFacts({ ...base, playersGiven: ['8150'], playersReceived: ['999999'] })

    expect(out).toBeNull()
  })

  it('treats an empty string or a non-array as no players', async () => {
    const out = await collectTradeMarketFacts({ ...base, playersGiven: [''], playersReceived: 'not-an-array' })

    expect(out).toBeNull()
  })
})

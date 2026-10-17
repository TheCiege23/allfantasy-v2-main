/**
 * Trade OS helpers (design build-order step 5): recording a grade a screen already computed as an
 * `evaluateTrade()` receipt, the link back to its trade, the redraft input mapper, and the share
 * card's result mark (a result, never a letter).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { recordTradeGrade, storedTradeLink } from '@/lib/decision-os/trade/recordTradeGrade'
import { gradeInputsFromRedraftAssets } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { resultMark } from '@/lib/trade-intel/tradeResultMark'

const GRADE = {
  graded: true, letter: 'B', partnerLetter: 'D', percentDiff: 14, label: 'Slightly favors you', sideAdvantage: 'you',
  action: 'accept', recommendation: 'Accept.', giveValue: 4000, getValue: 4700, giveMarket: 4000, getMarket: 4700,
  basis: 'Redraft · 12 teams', scoringApplied: true, needApplied: false, needGap: null,
  lines: [
    { side: 'give', name: 'Alpha', marketValue: 4000, leagueValue: 4000 },
    { side: 'get', name: 'Bravo', marketValue: 4700, leagueValue: 4700 },
  ],
  moves: [],
} as unknown as TradeGradeView

const INPUT = {
  surface: 'trades-panel',
  leagueId: 'l1',
  userId: 'u1',
  give: { assets: [{ kind: 'player' as const, name: 'Alpha' }], unpriceable: [] },
  get: { assets: [{ kind: 'player' as const, name: 'Bravo' }], unpriceable: [] },
  viewerSide: true,
  grade: GRADE,
}

describe('recordTradeGrade', () => {
  it('the receipt holds EXACTLY the grade the screen shows — no second pricing', async () => {
    const saveReceipt = vi.fn(async () => ({ id: 'rcpt_1' }))
    const r = await recordTradeGrade(INPUT, { saveReceipt })
    expect(r.grade).toBe(GRADE)
    expect(r.partnerGrade).toMatchObject({ graded: true, letter: 'D', partnerLetter: 'B' })
    expect(r).toMatchObject({ receiptId: 'rcpt_1', persisted: true, surface: 'trades-panel', leagueId: 'l1', userId: 'u1' })
    expect(r.assets.map((a) => `${a.side}:${a.name}:${a.leagueValue}`)).toEqual(['give:Alpha:4000', 'get:Bravo:4700'])
    expect(r.canonical).toBeNull()
  })

  it('a failed save keeps the grade and says the receipt was not saved', async () => {
    const r = await recordTradeGrade(INPUT, { saveReceipt: async () => { throw new Error('not migrated') } })
    expect(r).toMatchObject({ receiptId: null, persisted: false, grade: GRADE })
  })

  it('carries the stored-trade link when given one', async () => {
    const stored = storedTradeLink({ kind: 'af', tradeId: 't1' }, { source: 'af', platform: 'allfantasy', status: 'pending' })
    const r = await recordTradeGrade({ ...INPUT, stored }, { saveReceipt: async () => ({ id: 'x' }) })
    expect(r.stored).toEqual(stored)
  })
})

describe('storedTradeLink', () => {
  it('uses the same ref shape evaluateStoredTrade records, and admits it did not re-check rosters', () => {
    expect(storedTradeLink({ kind: 'redraft', proposalId: 'rp1' }, { source: 'redraft', platform: 'allfantasy', status: 'pending' })).toEqual({
      ref: { kind: 'redraft', proposalId: 'rp1' },
      tradeId: 'rp1',
      source: 'redraft',
      platform: 'allfantasy',
      status: 'pending',
      rawStatus: 'pending',
      deepLink: null,
      rostersSyncedAt: null,
      rostersStale: false,
      rosterCheck: 'unverified',
    })
    expect(storedTradeLink({ kind: 'provider', provider: 'sleeper', providerTradeId: '99' }, { source: 'provider', platform: 'sleeper', status: 'pending' }).tradeId).toBe('sleeper:99')
  })
})

describe('gradeInputsFromRedraftAssets', () => {
  it('reads the redraft columns: player names, pick season/round, FAAB from metadata', () => {
    expect(gradeInputsFromRedraftAssets([
      { assetType: 'player', playerId: 'p1', playerName: 'Star Runner' },
      { assetType: 'draft_pick', pickSeason: 2027, pickRound: 2 },
      { assetType: 'faab', metadata: { amount: 15 } },
      { assetType: 'player', playerId: 'p2', playerName: null },
    ])).toEqual({
      assets: [
        { kind: 'player', name: 'Star Runner' },
        { kind: 'pick', year: 2027, round: 2 },
        { kind: 'faab', amount: 15 },
      ],
      unpriceable: ['a player with no name on file'],
    })
  })
})

describe('the share card result mark', () => {
  const side = (cumulativeNet: number, trend = 'steady') => ({ cumulativeNet, trend }) as never

  it('is a word from the points, never a letter', () => {
    expect(resultMark(side(84, 'improving'), { provisional: false, tie: false })).toMatchObject({ mark: 'WON', caption: 'result so far · improving' })
    expect(resultMark(side(-12), { provisional: false, tie: false }).mark).toBe('LOST')
    expect(resultMark(side(0), { provisional: false, tie: false }).mark).toBe('EVEN')
    expect(resultMark(side(30), { provisional: false, tie: true }).mark).toBe('EVEN')
    for (const net of [-500, -1, 0, 1, 500]) {
      expect(resultMark(side(net), { provisional: false, tie: false }).mark).not.toMatch(/^[A-F][+-]?$/)
    }
  })

  it('says nothing has scored yet rather than calling it even', () => {
    expect(resultMark(side(0), { provisional: true, tie: true })).toMatchObject({ mark: '—', caption: 'no points scored yet' })
  })
})

// @vitest-environment node
/**
 * Chimmy's trade take: who won it on paper, with the market numbers — folded into the trade card as
 * ONE message, valued from the DATABASE only.
 *
 * The valuations below are mocked FantasyCalc rows as `readFantasyCalcValuesFromDb` returns them; the
 * vendor fetch is mocked to throw, and asserted never to be reached.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

const h = vi.hoisted(() => ({
  readValues: vi.fn(),
  vendorFetch: vi.fn(async () => {
    throw new Error('a request path must never call FantasyCalc')
  }),
  post: vi.fn(async () => ({ posted: true, messageId: 'm1' })),
  tradeFindUnique: vi.fn(),
  leagueFindUnique: vi.fn(),
}))

vi.mock('@/lib/fantasycalc-db', () => ({ readFantasyCalcValuesFromDb: h.readValues }))
vi.mock('@/lib/fantasycalc-fetch', () => ({ fetchFantasyCalcValues: h.vendorFetch }))
vi.mock('@/lib/league-chat/chimmyMoments', () => ({ postChimmyMoment: h.post }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findUnique: h.tradeFindUnique },
    league: { findUnique: h.leagueFindUnique },
    roster: {
      findMany: async () => [
        { id: 'rA', platformUserId: 'uA' },
        { id: 'rB', platformUserId: 'uB' },
      ],
    },
    appUser: {
      findMany: async () => [
        { id: 'uA', displayName: 'Casey', username: 'casey' },
        { id: 'uB', displayName: null, username: 'jordan' },
      ],
    },
    leagueTeam: { findMany: async () => [] },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: '8148', name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
        { sleeperId: '6813', name: 'Travis Kelce', position: 'TE', team: 'KC' },
        { sleeperId: '9999', name: 'Nobody Known', position: 'RB', team: 'FA' },
      ],
    },
  },
}))

import { buildChimmyTradeTake, priceTradeSides } from '@/lib/league-chat/chimmyTradeTake'
import { getPickValue } from '@/lib/fantasycalc'
import { MAX_VALUE_AGE_MS, postNativeTradeMoment } from '@/lib/league-chat/chimmyTradeMoment'

const NOW = new Date('2026-09-25T18:00:00.000Z')

function fc(sleeperId: string, name: string, position: string, value: number): FantasyCalcPlayer {
  return {
    player: {
      id: Number(sleeperId),
      name,
      mflId: '',
      sleeperId,
      position,
      maybeBirthday: null,
      maybeHeight: null,
      maybeWeight: null,
      maybeCollege: null,
      maybeTeam: null,
      maybeAge: null,
      maybeYoe: null,
      espnId: null,
      fleaflickerId: null,
    },
    value,
    overallRank: 1,
    positionRank: 1,
    trend30Day: 0,
    redraftDynastyValueDifference: 0,
    redraftDynastyValuePercDifference: 0,
    redraftValue: value,
    combinedValue: value,
    maybeMovingStandardDeviation: null,
    maybeMovingStandardDeviationPerc: null,
    maybeMovingStandardDeviationAdjusted: null,
    displayTrend: false,
    maybeOwner: null,
    starter: false,
    maybeTier: null,
    maybeAdp: null,
    maybeTradeFrequency: null,
  }
}

/** Mocked market: Chase 8,800 · Kelce 3,560 · Nacua 5,000 · Pacheco 4,900 · Higgins 5,300 · Kamara 4,400. */
const MARKET = [
  fc('8148', "Ja'Marr Chase", 'WR', 8800),
  fc('6813', 'Travis Kelce', 'TE', 3560),
  fc('9493', 'Puka Nacua', 'WR', 5000),
  fc('8205', 'Isiah Pacheco', 'RB', 4900),
  fc('7564', 'Tee Higgins', 'WR', 5300),
  fc('4035', 'Alvin Kamara', 'RB', 4400),
]

const oneForOne = (aGets: string, bGets: string, seed = 't') =>
  buildChimmyTradeTake({
    sides: [
      { manager: 'Casey', receives: [{ kind: 'player', sleeperId: aGets }] },
      { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: bGets }] },
    ],
    players: MARKET,
    isDynasty: true,
    seed,
    now: NOW,
  })!

describe('the take (pure)', () => {
  it('names the winner with both numbers and the gap', () => {
    const take = buildChimmyTradeTake({
      sides: [
        { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '8148' }] },
        { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: '6813' }] },
      ],
      players: MARKET,
      isDynasty: true,
      seed: 't1',
      now: NOW,
    })!
    expect(take.verdict).toBe('win')
    expect(take.winner).toBe('Casey')
    expect(take.text).toMatch(
      /^On paper, Casey wins this one, and it isn't close: 8,800 of market value coming in, 3,560 going out \(\+5,240\)\. /,
    )
    expect(take.text).toMatch(/Jordan/)
    expect(take.sides).toEqual([
      { manager: 'Casey', received: 8800, sent: 3560, grade: 'A' },
      { manager: 'Jordan', received: 3560, sent: 8800, grade: 'F' },
    ])
  })

  it('says it as strongly as the grading helper grades the winner — and never quotes the loser’s F', () => {
    // 5,000 for 4,400 grades the winner a B; 5,300 for 5,000 (6% apart) only a C.
    expect(oneForOne('9493', '4035').text).toMatch(/^On paper, Casey wins this one: 5,000 of market value coming in, 4,400 going out \(\+600\)\./)
    expect(oneForOne('7564', '9493').text).toMatch(/^On paper, Casey gets the edge: 5,300 of market value coming in, 5,000 going out \(\+300\)\./)
    for (const t of [oneForOne('8148', '6813'), oneForOne('9493', '4035'), oneForOne('7564', '9493')]) {
      expect(t.text).not.toMatch(/\b[A-F]\b(?!')/)
    }
  })

  it('calls a trade inside 5% even, with both numbers', () => {
    const take = buildChimmyTradeTake({
      sides: [
        { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '9493' }] },
        { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: '8205' }] },
      ],
      players: MARKET,
      isDynasty: true,
      seed: 't2',
      now: NOW,
    })!
    expect(take.verdict).toBe('even')
    expect(take.winner).toBeNull()
    expect(take.text).toMatch(/^Dead even on paper: Casey takes in 5,000 of market value, Jordan takes in 4,900 \(2% apart\)\./)
  })

  it('prices a draft pick with the repo’s pick model', () => {
    const totals = priceTradeSides(
      [
        { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '6813' }] },
        { manager: 'Jordan', receives: [{ kind: 'pick', season: 2027, round: 1 }] },
      ],
      MARKET,
      { isDynasty: true, now: NOW },
    )
    expect(totals).toEqual([3560, getPickValue(2027, 1, true)])
  })

  it('🛑 numbers or nothing: one unpriced asset on either side means no take', () => {
    const base = { players: MARKET, isDynasty: true, seed: 't3', now: NOW }
    expect(
      buildChimmyTradeTake({
        ...base,
        sides: [
          { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '8148' }] },
          { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: '9999', name: 'Nobody Known' }] },
        ],
      }),
    ).toBeNull()
    expect(
      buildChimmyTradeTake({
        ...base,
        sides: [
          { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '8148' }] },
          { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: '6813' }, { kind: 'other', label: '$10 FAAB' }] },
        ],
      }),
    ).toBeNull()
    expect(buildChimmyTradeTake({ ...base, players: [], sides: [{ manager: 'a', receives: [{ kind: 'player', sleeperId: '8148' }] }, { manager: 'b', receives: [{ kind: 'player', sleeperId: '6813' }] }] })).toBeNull()
  })

  it('stays on brand', () => {
    const texts = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((seed) => [
      buildChimmyTradeTake({
        sides: [
          { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '8148' }] },
          { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: '6813' }] },
        ],
        players: MARKET,
        isDynasty: true,
        seed,
      })!.text,
      buildChimmyTradeTake({
        sides: [
          { manager: 'Casey', receives: [{ kind: 'player', sleeperId: '9493' }] },
          { manager: 'Jordan', receives: [{ kind: 'player', sleeperId: '8205' }] },
        ],
        players: MARKET,
        isDynasty: true,
        seed,
      })!.text,
    ])
    for (const t of texts) {
      expect(t).not.toMatch(/\b(leverage|synergy|disrupt|revolutionary|game-changing)\b/i)
      expect(t).not.toMatch(/\bAI\b/)
    }
  })
})

const tradeRow = (items: Array<Record<string, unknown>>) => ({
  id: 't1',
  leagueId: 'L1',
  proposedByUserId: 'uA',
  proposerRosterId: 'rA',
  receiverRosterId: 'rB',
  items,
})

describe('an accepted AllFantasy trade becomes one Chimmy trade card with the take in it', () => {
  beforeEach(() => {
    h.readValues.mockReset()
    h.vendorFetch.mockClear()
    h.post.mockClear()
    h.leagueFindUnique.mockResolvedValue({
      id: 'L1',
      sport: 'NFL',
      isDynasty: true,
      scoring: 'PPR',
      leagueSize: 12,
      settings: { roster_positions: ['QB', 'RB', 'WR', 'SUPER_FLEX'] },
      season: 2026,
    })
    h.tradeFindUnique.mockResolvedValue(
      tradeRow([
        // Casey (rA) sends Kelce, receives Chase.
        { itemType: 'player', itemReference: '6813', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: {} },
        { itemType: 'player', itemReference: '8148', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: {} },
      ]),
    )
    h.readValues.mockResolvedValue({ players: MARKET, stale: false, syncedAt: new Date(NOW.getTime() - 3600_000).toISOString(), expiresAt: null })
  })

  it('posts the take as the text and the numbers on the card — from the database, never the vendor', async () => {
    const out = await postNativeTradeMoment({ tradeId: 't1', note: 'Accepted. It goes to commissioner review before it processes.', now: NOW })
    expect(out).toEqual({ posted: true, messageId: 'm1' })
    expect(h.vendorFetch).not.toHaveBeenCalled()
    // The league's own profile first: dynasty, superflex, 12 teams, full PPR.
    expect(h.readValues.mock.calls[0][0]).toEqual({ isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 })

    expect(h.post).toHaveBeenCalledTimes(1)
    const input = h.post.mock.calls[0][0] as Record<string, any>
    expect(input).toMatchObject({ leagueId: 'L1', kind: 'trade', dedupeKey: 'native:t1', messageType: 'trade' })
    expect(input.text).toMatch(/^On paper, Casey wins this one, and it isn't close: 8,800 of market value coming in, 3,560 going out \(\+5,240\)/)
    expect(input.card.tradeCard).toMatchObject({
      manager: 'Casey',
      partner: 'jordan',
      gave: [{ id: '6813', name: 'Travis Kelce' }],
      got: [{ id: '8148', name: "Ja'Marr Chase" }],
      valueGave: 3560,
      valueGot: 8800,
      note: 'Accepted. It goes to commissioner review before it processes.',
    })
  })

  it('with values older than two weeks, posts the card without a verdict', async () => {
    h.readValues.mockResolvedValue({
      players: MARKET,
      stale: true,
      syncedAt: new Date(NOW.getTime() - MAX_VALUE_AGE_MS - 1000).toISOString(),
      expiresAt: null,
    })
    await postNativeTradeMoment({ tradeId: 't1', now: NOW })
    const input = h.post.mock.calls[0][0] as Record<string, any>
    expect(input.text).toBe("Casey traded Travis Kelce to jordan for Ja'Marr Chase.")
    expect(input.card.tradeCard.valueGave).toBeNull()
    expect(h.vendorFetch).not.toHaveBeenCalled()
  })

  it('carries FAAB on the card, and a trade with FAAB in it gets no verdict', async () => {
    h.tradeFindUnique.mockResolvedValue(
      tradeRow([
        { itemType: 'player', itemReference: '6813', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: {} },
        { itemType: 'faab', itemReference: null, fromRosterId: 'rB', toRosterId: 'rA', faabAmount: 12, metadata: {} },
      ]),
    )
    await postNativeTradeMoment({ tradeId: 't1', now: NOW })
    const input = h.post.mock.calls[0][0] as Record<string, any>
    expect(input.text).toBe('Casey traded Travis Kelce to jordan for $12 FAAB.')
    expect(input.card.tradeCard.extrasGot).toEqual(['$12 FAAB'])
  })

  it('skips a three-team trade, which has no single other side', async () => {
    h.tradeFindUnique.mockResolvedValue(
      tradeRow([
        { itemType: 'player', itemReference: '6813', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: {} },
        { itemType: 'player', itemReference: '8148', fromRosterId: 'rB', toRosterId: 'rC', faabAmount: null, metadata: {} },
      ]),
    )
    expect(await postNativeTradeMoment({ tradeId: 't1', now: NOW })).toEqual({ posted: false, reason: 'not_two_team' })
    expect(h.post).not.toHaveBeenCalled()
  })

  it('reads no values at all for a non-NFL league', async () => {
    h.leagueFindUnique.mockResolvedValue({ id: 'L1', sport: 'NBA', isDynasty: false, scoring: null, leagueSize: 10, settings: null, season: 2026 })
    await postNativeTradeMoment({ tradeId: 't1', now: NOW })
    expect(h.readValues).not.toHaveBeenCalled()
    expect((h.post.mock.calls[0][0] as { text: string }).text).toMatch(/^Casey traded/)
  })
})

// @vitest-environment node
/**
 * NFL redraft trades get Chimmy's take too: the same take builder (chimmyTradeTake.ts), the same
 * DATABASE-only values (`readFantasyCalcValuesFromDb`), one Chimmy trade card per executed proposal —
 * and no verdict at all when any asset cannot be priced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FantasyCalcPlayer } from '@/lib/fantasycalc'

const h = vi.hoisted(() => ({
  readValues: vi.fn(),
  vendorFetch: vi.fn(async () => {
    throw new Error('a request path must never call FantasyCalc')
  }),
  post: vi.fn(async () => ({ posted: true, messageId: 'm1' })),
  proposal: null as null | Record<string, unknown>,
}))

vi.mock('@/lib/fantasycalc-db', () => ({ readFantasyCalcValuesFromDb: h.readValues }))
vi.mock('@/lib/fantasycalc-fetch', () => ({ fetchFantasyCalcValues: h.vendorFetch }))
vi.mock('@/lib/league-chat/chimmyMoments', () => ({ postChimmyMoment: h.post }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftTradeProposal: { findUnique: async () => h.proposal },
    league: {
      findUnique: async () => ({ id: 'L1', sport: 'NFL', isDynasty: false, scoring: 'PPR', leagueSize: 12, settings: null, season: 2026 }),
    },
    redraftRoster: {
      findMany: async () => [
        { id: 'alpha', ownerId: 'u-casey', ownerName: 'casey@example.com', teamName: 'Alpha Dogs' },
        { id: 'beta', ownerId: null, ownerName: 'Jordan', teamName: 'Beta Blockers' },
      ],
    },
    redraftRosterPlayer: {
      findMany: async () => [
        { playerId: 'draft:s1:12:travis-kelce:te', playerName: 'Travis Kelce', position: 'TE', team: 'KC' },
        { playerId: '8148', playerName: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
      ],
    },
    appUser: { findMany: async () => [{ id: 'u-casey', displayName: 'Casey', username: 'casey' }] },
  },
}))

import { postRedraftTradeMoment } from '@/lib/league-chat/chimmyTradeMoment'

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

const MARKET = [fc('8148', "Ja'Marr Chase", 'WR', 8800), fc('6813', 'Travis Kelce', 'TE', 3560)]

const asset = (from: string, to: string, over: Record<string, unknown>) => ({
  fromRosterId: from,
  toRosterId: to,
  assetType: 'player',
  playerId: null,
  playerName: null,
  pickSeason: null,
  pickRound: null,
  metadata: {},
  ...over,
})

/**
 * Casey (alpha) sends Kelce and receives Chase. Kelce's id is the draft pool's own, not a Sleeper id,
 * so the take has to price him by name — as it must for any redraft league.
 */
const kelceForChase = () => [
  asset('alpha', 'beta', { playerId: 'draft:s1:12:travis-kelce:te', playerName: 'Travis Kelce' }),
  asset('beta', 'alpha', { playerId: '8148', playerName: "Ja'Marr Chase" }),
]

beforeEach(() => {
  h.post.mockClear()
  h.vendorFetch.mockClear()
  h.readValues.mockReset().mockResolvedValue({ players: MARKET, stale: false, syncedAt: new Date(NOW.getTime() - 3600_000).toISOString(), expiresAt: null })
  h.proposal = { id: 'p1', leagueId: 'L1', status: 'accepted', proposerRosterId: 'alpha', receiverRosterId: 'beta', assets: kelceForChase() }
})

describe('an executed redraft trade becomes one Chimmy trade card with the take in it', () => {
  it('posts the take — who won it on paper, with the numbers — from the database, never the vendor', async () => {
    expect(await postRedraftTradeMoment({ proposalId: 'p1', now: NOW })).toEqual({ posted: true, messageId: 'm1' })
    expect(h.vendorFetch).not.toHaveBeenCalled()
    // A redraft league prices on its redraft profile: 1QB, 12 teams, full PPR, not dynasty.
    expect(h.readValues.mock.calls[0][0]).toEqual({ isDynasty: false, numQbs: 1, numTeams: 12, ppr: 1 })

    expect(h.post).toHaveBeenCalledTimes(1)
    const input = h.post.mock.calls[0][0] as Record<string, any>
    expect(input).toMatchObject({ leagueId: 'L1', kind: 'trade', dedupeKey: 'redraft:p1', messageType: 'trade' })
    expect(input.text).toMatch(/^On paper, Casey wins this one, and it isn't close: 8,800 of market value coming in, 3,560 going out \(\+5,240\)\./)
    expect(input.text).not.toContain('@')
    expect(input.card.tradeCard).toMatchObject({
      transactionId: 'p1',
      manager: 'Casey',
      partner: 'Jordan',
      gave: [{ name: 'Travis Kelce', position: 'TE', team: 'KC' }],
      got: [{ id: '8148', name: "Ja'Marr Chase" }],
      valueGave: 3560,
      valueGot: 8800,
    })
  })

  it('no take when any asset cannot be priced — FAAB here — but the card still posts', async () => {
    h.proposal = {
      ...h.proposal!,
      assets: [
        asset('alpha', 'beta', { playerId: 'draft:s1:12:travis-kelce:te', playerName: 'Travis Kelce' }),
        asset('beta', 'alpha', { assetType: 'faab', metadata: { amount: 30 } }),
      ],
    }
    await postRedraftTradeMoment({ proposalId: 'p1', now: NOW })
    const input = h.post.mock.calls[0][0] as Record<string, any>
    expect(input.text).toBe('Casey traded Travis Kelce to Jordan for $30 FAAB.')
    expect(input.card.tradeCard).toMatchObject({ valueGave: null, valueGot: null, extrasGot: ['$30 FAAB'] })
    expect(h.vendorFetch).not.toHaveBeenCalled()
  })

  it('no take for an unknown player either, and none from stale values', async () => {
    h.proposal = {
      ...h.proposal!,
      assets: [asset('alpha', 'beta', { playerId: 'x-1', playerName: 'Nobody Known' }), asset('beta', 'alpha', { playerId: '8148', playerName: "Ja'Marr Chase" })],
    }
    await postRedraftTradeMoment({ proposalId: 'p1', now: NOW })
    expect((h.post.mock.calls[0][0] as { text: string }).text).toBe("Casey traded Nobody Known to Jordan for Ja'Marr Chase.")

    h.post.mockClear()
    h.proposal = { ...h.proposal!, assets: kelceForChase() }
    h.readValues.mockResolvedValue({ players: MARKET, stale: true, syncedAt: new Date(NOW.getTime() - 30 * 86_400_000).toISOString(), expiresAt: null })
    await postRedraftTradeMoment({ proposalId: 'p1', now: NOW })
    expect((h.post.mock.calls[0][0] as { text: string }).text).toMatch(/^Casey traded Travis Kelce to Jordan for Ja'Marr Chase\.$/)
  })

  it('only a trade that went through: a pending proposal posts nothing', async () => {
    h.proposal = { ...h.proposal!, status: 'pending' }
    expect(await postRedraftTradeMoment({ proposalId: 'p1', now: NOW })).toEqual({ posted: false, reason: 'not_processed' })
    expect(h.post).not.toHaveBeenCalled()
  })
})

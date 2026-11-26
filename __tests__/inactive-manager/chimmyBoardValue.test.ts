/**
 * Chimmy prices NBA, college basketball and NHL deals on the league's value board — the board the Trade
 * Center grades on — and every player gets a value (lib/inactive-manager/chimmyBoardValue.ts).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-value/captureSnapshot', () => ({ computeRedraftTradeValueSnapshot: vi.fn() }))
vi.mock('@/lib/sport-values/leagueValueBoard', () => ({ loadLeagueValueBoard: vi.fn() }))

import type { BoardPlayer, SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import { indexBoard } from '@/lib/decision-os/trade/sportPointsValue'
import { boardRateFor, pricePlayer, priceDealOnBoard, sampleWeight } from '@/lib/inactive-manager/chimmyBoardValue'
import { priceChimmyDeal } from '@/lib/inactive-manager/chimmyBoardPricing'
import { decideTradeOffer } from '@/lib/inactive-manager/autopilotTrades'
import { resolveManagerProfile } from '@/lib/inactive-manager/managerProfile'

const player = (id: string, ri: string, position: string, perGame: number, sampleGames: number): BoardPlayer => ({
  id, name: `Player ${id}`, position, perGame, sampleGames, aliases: [ri],
})

function ctx(over: Partial<SportPointsContext> = {}): SportPointsContext {
  return {
    sport: 'NBA',
    board: [
      player('reg-star', '612', 'PG', 50, 20),     // 50/game, full sample
      player('reg-thin', '833', 'PG', 40, 5),      // 40/game on 5 games
      player('reg-fa', '999', 'PG', 30, 20),       // the best free agent at PG
    ],
    replacementByPosition: new Map([['PG', { name: 'Player reg-fa', perGame: 30 }]]),
    window: { season: 2026, seasonLabel: '2026-27', gamesRemaining: 60 },
    scoringBasis: 'league',
    teams: 12,
    ...over,
  }
}

describe('a value for every player', () => {
  const c = ctx()
  const index = indexBoard(c.board)

  it('projection: exactly the grade value (per game over replacement x games left)', () => {
    expect(pricePlayer(c, index, '612', undefined)).toMatchObject({ basis: 'projection', value: (50 - 30) * 60 })
  })

  it('thin sample: the rate pulled toward the free agent by games played', () => {
    expect(sampleWeight({ sampleGames: 5 })).toBe(0.5)
    // 30 + (40 - 30) * 0.5 = 35 per game, 5 over replacement, x 60 games
    expect(pricePlayer(c, index, '833', undefined)).toMatchObject({ basis: 'thin_sample', value: 5 * 60 })
  })

  it('a known player with no games is worth a free agent: priced, not refused', () => {
    expect(pricePlayer(c, index, '4513', { name: 'Adam Gajan', position: 'G' })).toMatchObject({ basis: 'replacement', value: 0 })
  })

  it('an NHL TheSportsDB id prices as the same player\'s Rolling Insights number', () => {
    expect(pricePlayer(c, index, 'tsdb_34154597', { alias: '612' })).toMatchObject({ basis: 'projection', value: 1200 })
  })

  it('an id nobody knows stays unpriced', () => {
    expect(pricePlayer(c, index, '123456', undefined)).toMatchObject({ basis: 'none' })
  })
})

describe('Chimmy decides on board values', () => {
  const profile = { ...resolveManagerProfile({ rosterId: 'chimmy', style: 'balanced' }), fairness: 0.05, positionBias: {} }
  const snap = (assets: Parameters<typeof priceDealOnBoard>[0]['assets'], identities = new Map()) =>
    priceDealOnBoard({ ctx: ctx(), assets, identities, proposerRosterId: 'them', receiverRosterId: 'chimmy' })

  it('accepts a star for a replaceable player — the deal that used to be cannot_value', () => {
    const s = snap(
      [
        { fromRosterId: 'chimmy', toRosterId: 'them', assetType: 'player', playerId: '4513' },
        { fromRosterId: 'them', toRosterId: 'chimmy', assetType: 'player', playerId: '612' },
      ],
      new Map([['4513', { name: 'Adam Gajan', position: 'PG' }]]),
    )
    expect(decideTradeOffer({ profile, snapshot: s, rosterId: 'chimmy', multiTeam: false, starterIds: [] }).code).toBe('accepted')
  })

  it('never gives away a player it cannot identify', () => {
    const s = snap([
      { fromRosterId: 'chimmy', toRosterId: 'them', assetType: 'player', playerId: '123456' },
      { fromRosterId: 'them', toRosterId: 'chimmy', assetType: 'player', playerId: '612' },
    ])
    expect(decideTradeOffer({ profile, snapshot: s, rosterId: 'chimmy', multiTeam: false, starterIds: [] }).code).toBe('cannot_value')
  })

  it('declines giving its star for a thin-sample player', () => {
    const s = snap([
      { fromRosterId: 'chimmy', toRosterId: 'them', assetType: 'player', playerId: '612' },
      { fromRosterId: 'them', toRosterId: 'chimmy', assetType: 'player', playerId: '833' },
    ])
    expect(decideTradeOffer({ profile, snapshot: s, rosterId: 'chimmy', multiTeam: false, starterIds: [] }).code).toBe('not_enough')
  })

  it('outside a dynasty league a pick is refused, as the screen refuses it, so Chimmy declines', () => {
    const s = snap([
      { fromRosterId: 'chimmy', toRosterId: 'them', assetType: 'player', playerId: '833' },
      { fromRosterId: 'them', toRosterId: 'chimmy', assetType: 'draft_pick', pickSeason: 2027, pickRound: 1 },
    ])
    expect(s?.coverage?.status).toBe('blocked')
    expect(decideTradeOffer({ profile, snapshot: s, rosterId: 'chimmy', multiTeam: false, starterIds: [] }).code).toBe('cannot_value')
  })

  it('in a dynasty league a pick is priced on the same points curve', () => {
    const dynastyCtx = ctx({ dynasty: { ages: new Map([['reg-star', 22], ['reg-thin', 21], ['reg-fa', 23]]), nextDraftYear: 2027 } })
    const s = priceDealOnBoard({
      ctx: dynastyCtx,
      assets: [{ fromRosterId: 'them', toRosterId: 'chimmy', assetType: 'draft_pick', pickSeason: 2027, pickRound: 1 }],
      identities: new Map(), proposerRosterId: 'them', receiverRosterId: 'chimmy',
    })
    const pick = s?.sides.flatMap((x) => x.assets)[0]
    expect(pick?.kind).toBe('draft_pick')
    expect(pick?.internalValue).toBeGreaterThan(0)
  })
})

describe('priceChimmyDeal', () => {
  const input = {
    seasonId: 's', leagueId: 'L', proposerRosterId: 'them', receiverRosterId: 'chimmy', sport: 'NBA',
    scoring: 'ppr', rosterFormat: 'standard', currentSeason: 2026,
    assets: [{ fromRosterId: 'them', toRosterId: 'chimmy', assetType: 'player', playerId: '612' }],
  } as never

  it('prices on the board when the league has one', async () => {
    const fallback = vi.fn()
    const s = await priceChimmyDeal(input, {
      board: async () => ({ kind: 'ok', sport: 'NBA', ctx: ctx(), byId: new Map() }),
      identities: async () => new Map(),
      fallback,
    })
    expect(fallback).not.toHaveBeenCalled()
    expect(s.sides.flatMap((x) => x.assets)[0]?.internalValue).toBe(1200)
  })

  it('keeps the older pricing for a league with no board', async () => {
    const fallback = vi.fn(async () => ({ sides: [] }) as never)
    await priceChimmyDeal(input, { board: async () => ({ kind: 'not_board_sport' }), identities: async () => new Map(), fallback })
    expect(fallback).toHaveBeenCalledOnce()
  })
})

describe('waiver rates', () => {
  it('reads the board rate, pulled toward replacement when thin, by Rolling Insights number', () => {
    const c = ctx()
    const index = indexBoard(c.board)
    expect(boardRateFor(c, index, ['612'])).toBe(50)
    expect(boardRateFor(c, index, ['833'])).toBe(35)
    expect(boardRateFor(c, index, ['tsdb_x', '612'])).toBe(50)
    expect(boardRateFor(c, index, ['nobody'])).toBeNull()
  })
})

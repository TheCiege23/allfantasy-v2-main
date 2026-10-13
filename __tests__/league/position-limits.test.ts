/**
 * Position limits. The rule that matters beyond "too many QBs is refused":
 *   - a move is refused only when it RAISES a position above its limit — a team left over by a
 *     mid-season limit can still drop, trade away and swap like-for-like;
 *   - DST / D/ST count as DEF, PK as K;
 *   - an unresolvable position is not counted (never blocks);
 *   - with no limits set, no position lookup runs at all.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeLimitPosition,
  parsePositionLimits,
  positionLimitBreaches,
  positionLimitMessage,
  readPositionLimits,
} from '@/lib/league/positionLimits'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  rosters: [] as Array<{ id: string; playerData: unknown; redraftRosterId: string | null }>,
  rrp: [] as Array<{ rosterId: string; playerId: string; position: string; droppedAt: null }>,
  sportsPlayers: [] as Array<{ id: string; externalId: string; sleeperId: string | null; position: string | null }>,
  identity: [] as Array<{ sleeperId: string; position: string | null }>,
  calls: { sportsPlayer: 0, redraftRosterPlayer: 0 },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: h.settings, sport: 'NFL' })) },
    roster: { findMany: vi.fn(async () => h.rosters) },
    redraftRosterPlayer: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; playerId?: { in: string[] } } }) => {
        h.calls.redraftRosterPlayer += 1
        return h.rrp.filter((r) => where.rosterId.in.includes(r.rosterId) && (!where.playerId || where.playerId.in.includes(r.playerId)))
      }),
    },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'rA', teamName: 'Aces', ownerName: 'a' }, { id: 'rB', teamName: null, ownerName: 'Bee' }]) },
    sportsPlayer: {
      // Evaluates the OR the way Postgres would: each clause is `<column> IN (...)`.
      findMany: vi.fn(async ({ where }: { where: { OR: Array<Record<string, { in: string[] }>> } }) => {
        h.calls.sportsPlayer += 1
        return h.sportsPlayers.filter((p) =>
          where.OR.some((clause) => Object.entries(clause).every(([col, cond]) => cond.in.includes((p as Record<string, any>)[col]))),
        )
      }),
    },
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) => h.identity.filter((r) => where.sleeperId.in.includes(r.sleeperId))),
    },
  },
}))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map([['A', 'Aces'], ['B', 'Bees']])) }))

import {
  positionLimitRefusal,
  redraftTradePositionLimitRefusal,
  resolvePlayerPositions,
  tradePositionLimitRefusal,
} from '@/lib/league/positionLimitsServer'
import { templatePositions } from '@/app/api/leagues/[leagueId]/position-limits/handler'

beforeEach(() => {
  h.settings = { position_limits: { QB: 2 } }
  h.calls = { sportsPlayer: 0, redraftRosterPlayer: 0 }
  h.rosters = [
    { id: 'A', redraftRosterId: 'rA', playerData: { players: ['qb1', 'qb2', 'rb1'], lineup_sections: { starters: [{ id: 'qb1', position: 'QB' }], bench: ['qb2', 'rb1'] } } },
    { id: 'B', redraftRosterId: 'rB', playerData: { players: ['qb3', 'k1'] } },
  ]
  h.rrp = [
    { rosterId: 'rA', playerId: 'qb2', position: 'QB', droppedAt: null },
    { rosterId: 'rA', playerId: 'rb1', position: 'RB', droppedAt: null },
    { rosterId: 'rB', playerId: 'qb3', position: 'QB', droppedAt: null },
    { rosterId: 'rB', playerId: 'k1', position: 'PK', droppedAt: null },
  ]
  h.sportsPlayers = [
    { id: 'sp-qb9', externalId: 'sleeper:9999', sleeperId: null, position: 'QB' },
    // A Rolling Insights row whose OWN number collides with Sleeper id 4046 — a different person.
    { id: 'ri-ot', externalId: '4046', sleeperId: null, position: 'OT' },
  ]
  h.identity = [{ sleeperId: '4046', position: 'QB' }]
})

describe('the rule', () => {
  it('parses limits: upper-cases, aliases, drops "no limit", refuses junk', () => {
    expect(parsePositionLimits({ qb: 3, dst: '1', K: 0, TE: null, WR: '' })).toEqual({ QB: 3, DEF: 1 })
    expect(parsePositionLimits(null)).toEqual({})
    expect(parsePositionLimits({ QB: 1.5 })).toBeNull()
    expect(parsePositionLimits({ QB: 100 })).toBeNull()
    expect(parsePositionLimits({ 'Q B!': 2 })).toBeNull()
    expect(parsePositionLimits([1, 2])).toBeNull()
    expect(readPositionLimits({ position_limits: 'garbage' })).toEqual({})
    expect(normalizeLimitPosition('d/st')).toBe('DEF')
  })

  it('refuses a move that raises a position above its limit', () => {
    expect(positionLimitBreaches({ QB: 2 }, ['QB', 'QB'], ['QB', 'QB', 'QB'])).toEqual([{ position: 'QB', limit: 2, before: 2, after: 3 }])
    expect(positionLimitBreaches({ QB: 2 }, ['QB'], ['QB', 'QB'])).toEqual([])
  })

  it('a team already over may still drop or swap like-for-like, but not add more', () => {
    expect(positionLimitBreaches({ QB: 2 }, ['QB', 'QB', 'QB', 'QB'], ['QB', 'QB', 'QB'])).toEqual([])
    expect(positionLimitBreaches({ QB: 2 }, ['QB', 'QB', 'QB'], ['QB', 'QB', 'QB'])).toEqual([])
    expect(positionLimitBreaches({ QB: 2 }, ['QB', 'QB', 'QB'], ['QB', 'QB', 'QB', 'QB'])).toHaveLength(1)
  })

  it('aliases count together and unknown positions are not counted', () => {
    expect(positionLimitBreaches({ DEF: 1 }, ['DST'], ['DST', 'D/ST'])).toHaveLength(1)
    expect(positionLimitBreaches({ QB: 1 }, ['QB'], ['QB', null, undefined])).toEqual([])
  })

  it('says what was refused', () => {
    expect(positionLimitMessage({ position: 'K', limit: 1, before: 1, after: 2 }, 'Your team')).toBe(
      'Your team can roster at most 1 K; this move would make it 2.',
    )
  })
})

describe('position lookup', () => {
  it('uses scoring rows, then lineup rows, then self-describing ids, then SportsPlayer and the identity map', async () => {
    const m = await resolvePlayerPositions({
      leagueId: 'L1',
      sport: 'NFL',
      playerIds: ['qb1', 'qb2', 'k1', 'name:Josh Allen:QB:BUF', '9999', 'sp-qb9', '4046', 'ghost'],
    })
    expect(Object.fromEntries(m)).toEqual({
      qb2: 'QB', // RedraftRosterPlayer
      k1: 'K', // PK normalized
      qb1: 'QB', // lineup row
      'name:Josh Allen:QB:BUF': 'QB',
      '9999': 'QB', // SportsPlayer by `sleeper:9999`
      'sp-qb9': 'QB', // SportsPlayer by our row id
      '4046': 'QB', // identity map — NOT the colliding RI tackle
    })
  })
})

describe('positionLimitRefusal', () => {
  it('with no limits set, refuses nothing and looks nothing up', async () => {
    h.settings = {}
    expect(await positionLimitRefusal('L1', [{ rosterId: 'A', before: ['qb1'], after: ['qb1', '9999'] }])).toBeNull()
    expect(h.calls).toEqual({ sportsPlayer: 0, redraftRosterPlayer: 0 })
  })

  it('refuses a third QB, allows an RB', async () => {
    const before = ['qb1', 'qb2', 'rb1']
    expect(await positionLimitRefusal('L1', [{ rosterId: 'A', before, after: [...before, '9999'], teamLabel: 'Your team' }])).toBe(
      'Your team can roster at most 2 QBs; this move would make it 3.',
    )
    h.sportsPlayers.push({ id: 'rb9', externalId: 'sleeper:rb9', sleeperId: null, position: 'RB' })
    expect(await positionLimitRefusal('L1', [{ rosterId: 'A', before, after: [...before, 'rb9'] }])).toBeNull()
  })

  it('a trade is checked on every side and names the team that would go over', async () => {
    const rosters = h.rosters.map((r) => ({ id: r.id, playerData: r.playerData }))
    // B sends its QB to A: A goes to 3 QBs.
    expect(await tradePositionLimitRefusal('L1', rosters, [{ itemType: 'player', itemReference: 'qb3', fromRosterId: 'B', toRosterId: 'A' }])).toMatch(/^Aces can roster at most 2 QBs/)
    // QB for QB: nobody's count rises.
    expect(
      await tradePositionLimitRefusal('L1', rosters, [
        { itemType: 'player', itemReference: 'qb3', fromRosterId: 'B', toRosterId: 'A' },
        { itemType: 'player', itemReference: 'qb2', fromRosterId: 'A', toRosterId: 'B' },
      ]),
    ).toBeNull()
  })

  it('the redraft trade system gets the same rule from its own rows', async () => {
    h.settings = { position_limits: { K: 1 } }
    h.rrp.push({ rosterId: 'rA', playerId: 'k2', position: 'K', droppedAt: null })
    const assets = [{ assetType: 'player', playerId: 'k2', fromRosterId: 'rA', toRosterId: 'rB' }]
    expect(await redraftTradePositionLimitRefusal({ leagueId: 'L1', rosterIds: ['rA', 'rB'], assets })).toBe(
      'Bee can roster at most 1 K; this move would make it 2.',
    )
    expect(await redraftTradePositionLimitRefusal({ leagueId: 'L1', rosterIds: ['rA', 'rB'], assets: [{ ...assets[0]!, assetType: 'pick' }] })).toBeNull()
  })
})

describe('positions the editor offers', () => {
  it('come from the roster template, in order, without wildcards or duplicates', () => {
    expect(
      templatePositions([
        { allowedPositions: ['RB', 'WR', 'TE'], slotOrder: 3 },
        { allowedPositions: ['QB'], slotOrder: 1 },
        { allowedPositions: ['DST'], slotOrder: 5 },
        { allowedPositions: ['*'], slotOrder: 6 },
        { allowedPositions: ['RB'], slotOrder: 2 },
      ]),
    ).toEqual(['QB', 'RB', 'WR', 'TE', 'DEF'])
  })
})

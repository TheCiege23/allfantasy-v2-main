// @vitest-environment node
/**
 * A held free_trade_token (A's reward ledger) lets ONE trade skip the Survivor trade rules through C's
 * bypass registry, and is spent when that trade executes — only if the trade needed it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorTribalCouncil: { findFirst: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
  },
  tokens: vi.fn(),
  redeem: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: async () => ({ byTeam: new Map(), firstKickoff: null, warnings: [] }),
  lockTeamLookupKeys: (_sport: string, team: string | null | undefined) => (team ? [team.toUpperCase()] : []),
}))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ getActiveEffectsForRoster: async () => [], getSurvivorTradeTokens: h.tokens, redeemSurvivorTradeToken: h.redeem }))

import { checkSurvivorTradeRules } from '@/lib/survivor/survivorTradeRuleHook'
import { redeemSurvivorTradeBypass } from '@/lib/survivor/survivorTradeRuleBypass'

const THURSDAY_NIGHT = new Date('2026-11-06T00:30:00Z') // cross-tribe window closed
const trade = (positions: [string, string]) => {
  h.db.redraftRosterPlayer.findMany.mockResolvedValue([
    { playerId: 'p1', playerName: 'A', team: 'PHI', position: positions[0], rosterId: 'rd-a', droppedAt: null },
    { playerId: 'p2', playerName: 'B', team: 'DAL', position: positions[1], rosterId: 'rd-b', droppedAt: null },
  ])
  return {
    leagueId: 'L1', rosterIds: ['rd-a', 'rd-b'], rosterIdSpace: 'redraft' as const, now: THURSDAY_NIGHT,
    players: [{ playerId: 'p1', playerName: null, fromRosterId: 'rd-a' }, { playerId: 'p2', playerName: null, fromRosterId: 'rd-b' }],
  }
}
const token = (samePositionOnly: boolean) => ({ rewardId: 'tok1', type: 'free_trade_token', status: 'available', spec: { type: 'free_trade_token', rosterId: 'rb', samePositionOnly }, holderRosterIds: ['rb'] })

beforeEach(() => {
  vi.clearAllMocks()
  h.db.league.findUnique.mockResolvedValue({ survivorMode: true, sport: 'NFL', season: 2026, language: 'en', settings: { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', survivorGovernance: { tradeRulesEnabled: true, crossTribeTrades: 'window', withinTribeUnplayedOnly: false, playedLockUntilTribal: false } } })
  h.db.roster.findMany.mockResolvedValue([{ id: 'ra', redraftRosterId: 'rd-a', platformUserId: 'ua' }, { id: 'rb', redraftRosterId: 'rd-b', platformUserId: 'ub' }])
  h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'ua', redraftRosterId: 'ra', tribeId: 'scorps' }, { userId: 'ub', redraftRosterId: 'rb', tribeId: 'shrooms' }])
  h.db.survivorGameState.findUnique.mockResolvedValue({ currentWeek: 9, phase: 'pre_merge', mergeTriggeredAt: null })
  h.db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
  h.tokens.mockImplementation(async (_l: string, rosterId: string) => (rosterId === 'rb' ? [token(false)] : []))
  h.redeem.mockResolvedValue({ ok: true, rewardId: 'tok1', status: 'consumed', duplicate: false, changes: [], note: 'trade:x' })
})

describe('free trade token bypass', () => {
  it('without a token the closed cross-tribe window refuses the trade', async () => {
    h.tokens.mockResolvedValue([])
    expect(await checkSurvivorTradeRules(trade(['RB', 'RB']))).toMatchObject({ ok: false, code: 'SURVIVOR_CROSS_TRIBE_CLOSED' })
  })

  it('a held token lets the trade through and names the roster that must spend it', async () => {
    expect(await checkSurvivorTradeRules(trade(['RB', 'WR']))).toMatchObject({ ok: true, bypassed: true, bypassRequired: true, bypassSource: 'free_trade_token:rb', week: 9 })
  })

  it('a same-position-only token: RB for WR is refused, RB for RB passes', async () => {
    h.tokens.mockImplementation(async (_l: string, rosterId: string) => (rosterId === 'rb' ? [token(true)] : []))
    expect(await checkSurvivorTradeRules(trade(['RB', 'WR']))).toMatchObject({ ok: false })
    expect(await checkSurvivorTradeRules(trade(['RB', 'RB']))).toMatchObject({ ok: true, bypassRequired: true })
  })

  it('a trade that would pass anyway does not spend the token', async () => {
    h.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'ua', redraftRosterId: 'ra', tribeId: 'scorps' }, { userId: 'ub', redraftRosterId: 'rb', tribeId: 'scorps' }])
    const check = await checkSurvivorTradeRules(trade(['RB', 'WR']))
    expect(check).toMatchObject({ ok: true, bypassed: true, bypassRequired: false, bypassSource: null })
  })

  it('the trade that needed it redeems one token from that roster, keyed on the trade, and never throws', async () => {
    const check = await checkSurvivorTradeRules(trade(['RB', 'WR']))
    if (!check.ok) throw new Error('expected a pass')
    expect(await redeemSurvivorTradeBypass({ leagueId: 'L1', week: check.week ?? 0, tradeRef: 'redraft:prop-1', source: check.bypassSource })).toBe(true)
    expect(h.redeem).toHaveBeenCalledWith({ leagueId: 'L1', rosterId: 'rb', tradeRef: 'redraft:prop-1', week: 9, actorUserId: null })
    h.redeem.mockRejectedValueOnce(new Error('ledger down'))
    expect(await redeemSurvivorTradeBypass({ leagueId: 'L1', week: 9, tradeRef: 'redraft:prop-2', source: 'free_trade_token:rb' })).toBe(false)
    // A source with no registered redeemer (an effect-engine free trade) is not "spent" here.
    expect(await redeemSurvivorTradeBypass({ leagueId: 'L1', week: 9, tradeRef: 'x', source: 'free_trade' })).toBe(false)
  })
})

// @vitest-environment node
/**
 * 🛑 THE TRADES BOARD NAMES EACH TRADE'S PLAYERS IN THAT TRADE'S OWN SPORT.
 *
 * The board spans every league a user holds, and its one `SportsPlayer` read was keyed on `sleeperId`
 * alone. Sleeper numbers its NFL and NBA pools independently, so one id can be two players — and an
 * unscoped read named the NBA trade's player with the NFL man (or the other way round), whichever row
 * composed first. The prisma double honours a `sport` filter, as Postgres would, and ignores a query
 * that does not send one — so only an unscoped read lets the stranger in.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const league = (id: string, sport: string) => ({
    leagueId: id,
    league: {
      id, name: `${sport} League`, platform: 'sleeper', sport, settings: {}, leagueType: 'dynasty', platformLeagueId: `S-${id}`,
      logoUrl: null, avatarUrl: null, userId: 'u1', updatedAt: new Date('2026-09-30T00:00:00Z'), season: 2026,
    },
  })
  const trade = (id: string, historyId: string, sport: string) => ({
    transactionId: id, historyId, season: 2026, week: 4, tradeDate: new Date('2026-09-30T12:00:00Z'),
    playersGiven: ['2002'], playersReceived: ['3003'], picksGiven: [], picksReceived: [],
    partnerName: null, partnerRosterId: null, platform: 'sleeper', sport,
  })
  const players = [
    { sleeperId: '2002', sport: 'NFL', source: 'sleeper', name: 'NFL Namesake', position: 'RB', team: 'KC', imageUrl: null, fetchedAt: new Date(0) },
    { sleeperId: '2002', sport: 'NBA', source: 'sleeper', name: 'NBA Guard', position: 'PG', team: 'BOS', imageUrl: null, fetchedAt: new Date(0) },
    { sleeperId: '3003', sport: 'NFL', source: 'sleeper', name: 'NFL Receiver', position: 'WR', team: 'BUF', imageUrl: null, fetchedAt: new Date(0) },
    { sleeperId: '3003', sport: 'NBA', source: 'sleeper', name: 'NBA Center', position: 'C', team: 'DEN', imageUrl: null, fetchedAt: new Date(0) },
  ]
  type Where = { sport?: string; sleeperId?: { in: string[] }; OR?: Where[] }
  const matches = (p: (typeof players)[number], w: Where): boolean =>
    w.OR
      ? w.OR.some((c) => matches(p, c))
      : (w.sleeperId == null || w.sleeperId.in.includes(p.sleeperId)) && (w.sport == null || w.sport === p.sport)
  const rows: Record<string, (args: { where?: Record<string, unknown> }) => unknown[]> = {
    leagueTeam: (args) => (args.where?.claimedByUserId ? [league('L1', 'NFL'), league('L2', 'NBA')] : []),
    leagueTradeHistory: () => [
      { id: 'H1', sleeperLeagueId: 'S-L1', sleeperUsername: '111' },
      { id: 'H2', sleeperLeagueId: 'S-L2', sleeperUsername: '111' },
    ],
    leagueTrade: () => [trade('T1', 'H1', 'nfl'), trade('T2', 'H2', 'nba')],
    sportsPlayer: (args) => players.filter((p) => matches(p, (args.where ?? {}) as Where)),
  }
  const model = (name: string) => {
    const fn = (args: { where?: Record<string, unknown> }) => Promise.resolve(rows[name]?.(args) ?? [])
    return new Proxy({}, {
      get: (_t, op) => (op === 'findMany' ? fn : op === 'findFirst' || op === 'findUnique' ? () => Promise.resolve(null) : () => Promise.resolve([])),
    })
  }
  const prisma = new Proxy({}, { get: (_t, name) => (name === '$queryRaw' || name === '$queryRawUnsafe' ? () => Promise.resolve([]) : model(String(name))) })
  return { prisma }
})

import { getTradesBoard } from '@/lib/core-app/tradesBoard'

/** Every player asset's name, by the league it was printed under. */
function namesByLeague(data: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const walk = (o: unknown, leagueId: string | null): void => {
    if (Array.isArray(o)) return o.forEach((x) => walk(x, leagueId))
    if (!o || typeof o !== 'object') return
    const r = o as Record<string, unknown>
    const here = typeof r.leagueId === 'string' ? r.leagueId : leagueId
    if (r.kind === 'player' && typeof r.name === 'string' && here) {
      const set = out.get(here) ?? new Set<string>()
      set.add(r.name)
      out.set(here, set)
    }
    Object.values(r).forEach((v) => walk(v, here))
  }
  walk(data, null)
  return out
}

describe('Trades board — identity read scoped to each trade’s sport', () => {
  it('names the NFL trade with NFL players and the NBA trade with NBA players', async () => {
    const names = namesByLeague(await getTradesBoard('u1', 4))
    expect([...(names.get('L1') ?? [])].sort()).toEqual(['NFL Namesake', 'NFL Receiver'])
    expect([...(names.get('L2') ?? [])].sort()).toEqual(['NBA Center', 'NBA Guard'])
  })
})

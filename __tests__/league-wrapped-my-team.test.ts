/**
 * The season recap's "My team" figures — Trades and Drafted — must be the VIEWING manager's, for
 * the recap's season. They were the whole league's: trades summed every trade fact row in the
 * league (two rows per Sleeper trade) plus every native trade of any status from any season, and
 * Drafted counted every pick the league made.
 *
 * Prisma is faked over in-memory fixtures that honour each query's `where`, so the old and new
 * reads are both answered from the same league-wide data and the test shows which one filters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

/* ── A where-matcher just wide enough for the queries this route makes ── */
function matchValue(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    const c = cond as Record<string, unknown>
    if ('in' in c) return (c.in as unknown[]).includes(value)
    if ('not' in c) return value !== c.not
    const v = value instanceof Date ? value.getTime() : (value as number)
    const t = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number))
    if (value == null) return false
    if ('gt' in c && !(v > t(c.gt))) return false
    if ('gte' in c && !(v >= t(c.gte))) return false
    if ('lt' in c && !(v < t(c.lt))) return false
    if ('lte' in c && !(v <= t(c.lte))) return false
    return true
  }
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime()
  return value === cond
}
function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Record<string, unknown>[]).some((w) => matches(row, w))
    if (key === 'AND') return (cond as Record<string, unknown>[]).every((w) => matches(row, w))
    return matchValue(row[key], cond)
  })
}

const db = vi.hoisted(() => ({
  leagues: [] as Row[],
  teams: [] as Row[],
  rosters: [] as Row[],
  seasons: [] as Row[],
  tradeFacts: [] as Row[],
  draftFacts: [] as Row[],
  nativeTrades: [] as Row[],
}))

vi.mock('@/lib/prisma', () => {
  const where = (args: { where?: Record<string, unknown> } | undefined) => args?.where
  const prisma = {
    league: { findMany: async (a: { where?: Row }) => db.leagues.filter((r) => matches(r, where(a))) },
    leagueTeam: { findFirst: async (a: { where?: Row }) => db.teams.find((r) => matches(r, where(a))) ?? null },
    roster: { findFirst: async (a: { where?: Row }) => db.rosters.find((r) => matches(r, where(a))) ?? null },
    leagueSeason: { findMany: async (a: { where?: Row }) => db.seasons.filter((r) => matches(r, where(a))) },
    transactionFact: {
      // The old read: rows grouped by type. Facts here are all trades, `type: 'trade'`.
      groupBy: async (a: { where?: Row }) => {
        const rows = db.tradeFacts.filter((r) => matches(r, where(a)))
        return rows.length ? [{ type: 'trade', _count: { _all: rows.length } }] : []
      },
    },
    /*
     * `loadTradeFacts` reads in SQL. Answer it from the same fixture, filtered by the values the
     * query actually carried: the league id array and the season.
     */
    $queryRaw: async (sql: { values: unknown[] }) => {
      const ids = sql.values.find((v) => Array.isArray(v)) as string[] | undefined
      const season = sql.values.find((v) => typeof v === 'number' && v > 1900 && v < 3000)
      return db.tradeFacts
        .filter((r) => ids?.includes(r.leagueId as string) && (season == null || r.season === season))
        .map((r) => ({ factId: r.factId, rosterId: r.rosterId, tradeKey: r.tradeKey, rosterIds: r.rosterIds, status: r.status }))
    },
    draftFact: {
      count: async (a: { where?: Row }) => db.draftFacts.filter((r) => matches(r, where(a))).length,
      findMany: async (a: { where?: Row }) => db.draftFacts.filter((r) => matches(r, where(a))),
    },
    afLeagueTrade: {
      count: async (a: { where?: Row }) => db.nativeTrades.filter((r) => matches(r, where(a))).length,
      findMany: async (a: { where?: Row }) => db.nativeTrades.filter((r) => matches(r, where(a))),
    },
    afRosterMoveHistory: { count: async () => 0 },
    seasonStandingFact: { findMany: async () => [] },
    userProfile: { findUnique: async () => null },
    leagueTradeHistory: { findUnique: async () => null },
  }
  return { prisma, default: prisma }
})

const session = vi.hoisted(() => ({ userId: 'user-me' }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: session.userId } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const LEAGUE = {
  id: 'L1',
  userId: 'someone-else',
  platform: 'sleeper',
  platformLeagueId: 'P900',
  season: 2025,
  leagueSize: 12,
  isDynasty: false,
}
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: async () => ({ ok: true, league: LEAGUE }),
}))

import { GET } from '@/app/api/league/wrapped/route'

const ME = '3'

/** One Sleeper trade = one fact row PER SIDE, keyed `${txId}:${rosterId}`. */
function sleeperTrade(leagueId: string, txId: string, season: number, a: string, b: string): Row[] {
  return [a, b].map((rosterId) => ({
    factId: `${txId}:${rosterId}`,
    leagueId,
    season,
    rosterId,
    tradeKey: txId,
    rosterIds: [a, b],
    status: 'complete',
  }))
}

function seed() {
  db.leagues = [
    { id: 'L1', platform: 'sleeper', platformLeagueId: 'P900' },
    // A league-mate imported the same Sleeper league: a sibling row.
    { id: 'L2', platform: 'sleeper', platformLeagueId: 'P900' },
    // Same digits on another provider is NOT a sibling.
    { id: 'L9', platform: 'espn', platformLeagueId: 'P900' },
  ]
  db.teams = [{ leagueId: 'L1', claimedByUserId: 'user-me', platformUserId: 'sleeper-me', externalId: ME, legacyRosterId: null, currentRank: null, wins: 0, losses: 0, ties: 0, isCommissioner: false, isCoCommissioner: false }]
  db.rosters = [{ id: 'roster-me', leagueId: 'L1', platformUserId: 'user-me' }]
  // The league finished 2024 on 2025-01-20; 2025 is the current season.
  db.seasons = [{ leagueId: 'L1', season: 2024, status: 'complete', createdAt: new Date('2025-01-20T00:00:00Z') }]

  db.tradeFacts = [
    // 2025: three trades in the league, one of them mine. Mine sits under the SIBLING row.
    ...sleeperTrade('L2', 'tx-mine', 2025, ME, '5'),
    ...sleeperTrade('L1', 'tx-other-a', 2025, '1', '2'),
    // A mine from 2024 — not this recap's season.
    ...sleeperTrade('L1', 'tx-mine-2024', 2024, ME, '7'),
    // Same digits under the ESPN league — not this league.
    ...sleeperTrade('L9', 'tx-espn', 2025, ME, '8'),
  ]

  db.nativeTrades = [
    // The third league trade of 2025, not mine.
    { id: 'n-other', leagueId: 'L1', status: 'processed', proposerRosterId: 'roster-4', receiverRosterId: 'roster-6', processedAt: new Date('2025-10-01T00:00:00Z'), updatedAt: new Date('2025-10-01T00:00:00Z') },
    // Mine, but an offer that never went through.
    { id: 'n-pending', leagueId: 'L1', status: 'pending', proposerRosterId: 'roster-me', receiverRosterId: 'roster-6', processedAt: null, updatedAt: new Date('2025-10-02T00:00:00Z') },
    // Mine and processed — in the 2024 season, before the league finished it.
    { id: 'n-last-year', leagueId: 'L1', status: 'processed', proposerRosterId: 'roster-me', receiverRosterId: 'roster-6', processedAt: new Date('2024-11-01T00:00:00Z'), updatedAt: new Date('2024-11-01T00:00:00Z') },
  ]

  // 2025 draft: 12 teams x 15 rounds = 180 picks. Mine: 12 (three of my picks were traded away),
  // one of them a keeper. Then the same 12 copied under the sibling importer, and a 2024 draft.
  db.draftFacts = []
  let n = 0
  for (let round = 1; round <= 15; round++) {
    for (let slot = 1; slot <= 12; slot++) {
      n += 1
      const owner = slot === 3 && round > 12 ? '9' : String(slot)
      db.draftFacts.push({
        leagueId: 'L1', season: 2025, round, pickNumber: n, managerId: owner,
        metadata: owner === ME && round === 1 ? { isKeeper: true } : null,
      })
    }
  }
  const mine2025 = db.draftFacts.filter((d) => d.managerId === ME)
  db.draftFacts.push(...mine2025.map((d) => ({ ...d, leagueId: 'L2' })))
  db.draftFacts.push(...mine2025.map((d) => ({ ...d, season: 2024 })))
}

async function recap() {
  const res = await GET({ nextUrl: new URL('http://x/api/league/wrapped?leagueId=L1') } as never)
  expect(res.status).toBe(200)
  return (await res.json()) as { manager: { trades: number; draftPicks: number } }
}

describe('/api/league/wrapped — My team counts', () => {
  beforeEach(() => {
    session.userId = 'user-me'
    seed()
  })

  it('fixture sanity: the league made 180 picks in 2025, 12 of them mine', () => {
    const league2025 = db.draftFacts.filter((d) => d.leagueId === 'L1' && d.season === 2025)
    expect(league2025).toHaveLength(180)
    expect(league2025.filter((d) => d.managerId === ME)).toHaveLength(12)
  })

  it('Trades counts the manager’s own completed trades this season, once each, sibling importers included', async () => {
    const body = await recap()
    expect(body.manager.trades).toBe(1)
  })

  it('a native trade of mine processed this season counts', async () => {
    db.nativeTrades.push({
      id: 'n-mine', leagueId: 'L1', status: 'processed', proposerRosterId: 'roster-6', receiverRosterId: 'roster-me',
      processedAt: new Date('2025-09-15T00:00:00Z'), updatedAt: new Date('2025-09-15T00:00:00Z'),
    })
    const body = await recap()
    expect(body.manager.trades).toBe(2)
  })

  it('Drafted counts the manager’s own picks this season — keeper included, sibling copies once', async () => {
    const body = await recap()
    expect(body.manager.draftPicks).toBe(12)
  })

  it('a viewer with no team in the league has no trades or picks of their own', async () => {
    session.userId = 'user-stranger'
    db.rosters = []
    const body = await recap()
    expect(body.manager.trades).toBe(0)
    expect(body.manager.draftPicks).toBe(0)
  })
})

/*
 * The commissioner edition's Trades is the LEAGUE's, for the recap's season — and a trade is a trade
 * once, however many fact rows or importer copies carry it. It summed every trade fact row under
 * this row only (two per Sleeper trade, and none of a sibling importer's) plus every native trade of
 * any status from any season: 5 for a league that made 3.
 */
describe('/api/league/wrapped — commissioner edition Trades', () => {
  async function commissionerTrades() {
    const res = await GET({ nextUrl: new URL('http://x/api/league/wrapped?leagueId=L1') } as never)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { commissioner: { trades: number } | null }
    expect(body.commissioner).not.toBeNull()
    return body.commissioner!.trades
  }

  beforeEach(() => {
    session.userId = 'user-me'
    seed()
    db.teams[0].isCommissioner = true
  })

  it('counts each completed league trade this season once — sibling importer included, last season and pending offers not', async () => {
    // tx-mine (under the sibling L2), tx-other-a, and the native n-other.
    expect(await commissionerTrades()).toBe(3)
  })

  it('a copy of one trade under a sibling importer still counts once', async () => {
    db.tradeFacts.push(...sleeperTrade('L2', 'tx-other-a', 2025, '1', '2'))
    expect(await commissionerTrades()).toBe(3)
  })

  it('a trade the provider never completed does not count', async () => {
    db.tradeFacts.push(...sleeperTrade('L1', 'tx-vetoed', 2025, '4', '6').map((r) => ({ ...r, status: 'vetoed' })))
    expect(await commissionerTrades()).toBe(3)
  })

  it('a manager who is not a commissioner gets no commissioner edition', async () => {
    db.teams[0].isCommissioner = false
    const res = await GET({ nextUrl: new URL('http://x/api/league/wrapped?leagueId=L1') } as never)
    expect(((await res.json()) as { commissioner: unknown }).commissioner).toBeNull()
  })
})

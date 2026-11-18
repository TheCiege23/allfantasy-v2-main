// @vitest-environment node
/**
 * Draft-pick trades from Fantrax's trade-history CSV export.
 *
 * Fantrax's API publishes future picks for rounds 1-4 only, so a later-round pick
 * trade exists nowhere but this export. The fixture is a real export (public NFL
 * player names and the league's team names only).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => ({ snapshot: null as Record<string, unknown> | null, updates: [] as unknown[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    fantraxLeague: {
      findUnique: vi.fn(async () => h.snapshot),
      findMany: vi.fn(async (args: { select?: { transactions?: boolean } }) =>
        args?.select?.transactions ? (h.snapshot ? [h.snapshot] : []) : []),
      update: vi.fn(async (args: { data: { transactions: unknown } }) => {
        h.updates.push(args.data.transactions)
        if (h.snapshot) h.snapshot.transactions = args.data.transactions
        return {}
      }),
    },
  },
}))

import {
  mergeFantraxPickTrades,
  parseFantraxExportDate,
  parseFantraxPickLabel,
  parseFantraxTradeCsv,
  readStoredFantraxPickTrades,
  resolveFantraxCsvPickOwnership,
  type FantraxCsvPickTrade,
} from '@/lib/league-import/fantrax/fantraxPickTrades'
import { attachFantraxTradeCsv } from '@/lib/league-import/fantrax/attachFantraxTradeCsv'
import { fetchFantraxLeagueForImport } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
import { FantraxAdapter } from '@/lib/league-import/adapters/fantrax/FantraxAdapter'

const CSV = readFileSync('__tests__/fixtures/fantrax-trade-history.csv', 'utf8')

const trade = (over: Partial<FantraxCsvPickTrade>): FantraxCsvPickTrade => ({
  season: 2029, round: 5, originalTeam: 'A', fromTeam: 'A', toTeam: 'B', tradedAt: '2026-11-01T10:00', fileOrder: 1, ...over,
})

describe('reading the export', () => {
  it('finds the ten pick trades among 22 rows, and nothing else', () => {
    const out = parseFantraxTradeCsv(CSV)
    expect(out.recognised).toBe(true)
    expect(out.rows).toBe(22)
    expect(out.pickTrades).toHaveLength(10)
    expect(out.unreadablePickRows).toBe(0)
  })

  /** The one the API cannot see. */
  it('reads the round 5 pick with its original team, sender and receiver', () => {
    const r5 = parseFantraxTradeCsv(CSV).pickTrades.find((t) => t.round === 5)
    expect(r5).toMatchObject({
      season: 2029,
      round: 5,
      originalTeam: '#18 Miami Dolphins',
      fromTeam: '#18 Miami Dolphins',
      toTeam: '#9 New York Jets',
      tradedAt: '2026-11-16T16:26',
    })
  })

  /**
   * "# Obj" sits between To and Date. A reader that takes columns by position
   * reads "0" as the date; this one finds them by header name.
   */
  it('takes the date from the Date column, not the column after To', () => {
    const out = parseFantraxTradeCsv(CSV)
    expect(out.pickTrades.every((t) => /^2026-11-\d{2}T\d{2}:\d{2}$/.test(t.tradedAt ?? ''))).toBe(true)
  })

  it('does not mistake a budget row or a player for a pick', () => {
    expect(parseFantraxPickLabel('Budget Amount: $5000.00')).toBeNull()
    expect(parseFantraxPickLabel('Joe Milton')).toBeNull()
    expect(parseFantraxPickLabel('2028 Draft Pick, Round 4 (#27 Houston Oilers)')).toEqual({
      season: 2028, round: 4, originalTeam: '#27 Houston Oilers',
    })
  })

  it('refuses a file that is not a trade export', () => {
    expect(parseFantraxTradeCsv('"Rank","Team","W","L"\n"1","X","9","1"').recognised).toBe(false)
    expect(parseFantraxTradeCsv('').recognised).toBe(false)
  })

  it('counts a pick row it cannot read instead of guessing', () => {
    const out = parseFantraxTradeCsv('"Player","From","To"\n"Draft Pick, sometime","A","B"')
    expect(out.pickTrades).toHaveLength(0)
    expect(out.unreadablePickRows).toBe(1)
  })

  it('parses the export date by hand', () => {
    expect(parseFantraxExportDate('Mon Nov 16, 2026, 7:57PM')).toBe('2026-11-16T19:57')
    expect(parseFantraxExportDate('Sun Jan 3, 2027, 12:05AM')).toBe('2027-01-03T00:05')
    expect(parseFantraxExportDate('Sun Jan 3, 2027, 12:05PM')).toBe('2027-01-03T12:05')
    expect(parseFantraxExportDate('0')).toBeNull()
  })
})

describe('who holds a pick after the trades', () => {
  it('follows a pick through two trades to its last holder, whatever the file order', () => {
    const chain = [
      trade({ fromTeam: 'B', toTeam: 'C', tradedAt: '2026-11-10T09:00', fileOrder: 1 }),
      trade({ fromTeam: 'A', toTeam: 'B', tradedAt: '2026-11-01T09:00', fileOrder: 2 }),
    ]
    expect(resolveFantraxCsvPickOwnership(chain)).toEqual([{ season: 2029, round: 5, originalTeam: 'A', currentTeam: 'C' }])
    expect(resolveFantraxCsvPickOwnership([...chain].reverse())[0]?.currentTeam).toBe('C')
  })

  it('reports a pick traded back home as home', () => {
    const out = resolveFantraxCsvPickOwnership([
      trade({ fromTeam: 'A', toTeam: 'B', tradedAt: '2026-11-01T09:00' }),
      trade({ fromTeam: 'B', toTeam: 'A', tradedAt: '2026-11-05T09:00' }),
    ])
    expect(out).toEqual([{ season: 2029, round: 5, originalTeam: 'A', currentTeam: 'A' }])
  })

  it('keeps picks of different teams, rounds and seasons apart', () => {
    const out = resolveFantraxCsvPickOwnership(parseFantraxTradeCsv(CSV).pickTrades)
    expect(out).toHaveLength(10)
    expect(out.find((p) => p.round === 5)).toEqual({
      season: 2029, round: 5, originalTeam: '#18 Miami Dolphins', currentTeam: '#9 New York Jets',
    })
  })
})

describe('storing uploads', () => {
  it('keeps a trade once when the same export is uploaded twice', () => {
    const picks = parseFantraxTradeCsv(CSV).pickTrades
    expect(mergeFantraxPickTrades(picks, picks)).toHaveLength(10)
    expect(mergeFantraxPickTrades(picks, [trade({})])).toHaveLength(11)
  })

  it('reads back only well-formed stored rows', () => {
    expect(readStoredFantraxPickTrades(null)).toEqual([])
    expect(readStoredFantraxPickTrades({ trades: [] })).toEqual([])
    expect(
      readStoredFantraxPickTrades({ pickTrades: [trade({}), { season: 2029 }, null, { ...trade({}), toTeam: '' }] }),
    ).toHaveLength(1)
  })
})

/* A live two-team snapshot. Fantrax publishes rounds 1-4, all at home. */
const liveSnapshot = () => ({
  id: 'snap-1',
  sourceLeagueId: 'tau9a8fomvmq84sx',
  appUserId: 'af-user',
  leagueName: 'Road To Glory NFL',
  season: 2026,
  sport: 'nfl',
  teamCount: 2,
  userTeam: '#9 New York Jets',
  isDevy: false,
  standings: [
    { team: '#9 New York Jets', fantraxTeamId: 'fx-jets', rank: 1 },
    { team: '#18 Miami Dolphins', fantraxTeamId: 'fx-dol', rank: 2 },
  ],
  roster: [],
  matchups: [],
  transactions: null as unknown,
  draftPicks: {
    version: 1,
    current: [],
    futureRaw: [2027, 2028, 2029].flatMap((year) =>
      [1, 2, 3, 4].flatMap((round) =>
        ['fx-jets', 'fx-dol'].map((team) => ({ year, round, originalOwnerTeamId: team, currentOwnerTeamId: team })),
      ),
    ),
  },
  user: { id: 'snapshot-user', fantraxUsername: 'fantrax-team:tau9a8fomvmq84sx:fx-jets' },
})

const TWO_TEAM_CSV = [
  '"Player","Team","Position","From","To","# Obj","Date (EST)","Week"',
  '"2029 Draft Pick, Round 5 (#18 Miami Dolphins)","","","#18 Miami Dolphins","#9 New York Jets","0","Mon Nov 16, 2026, 4:26PM","11"',
  /* The API lists round 2 and says this pick is home, so the export must not move it. */
  '"2027 Draft Pick, Round 2 (#18 Miami Dolphins)","","","#18 Miami Dolphins","#9 New York Jets","0","Mon Nov 16, 2026, 4:26PM","11"',
  /* A draft already held is history, not an asset. */
  '"2026 Draft Pick, Round 6 (#18 Miami Dolphins)","","","#18 Miami Dolphins","#9 New York Jets","0","Mon Mar 2, 2026, 1:00PM","0"',
  /* A team that is not in this league places nothing. */
  '"2028 Draft Pick, Round 7 (#27 Houston Oilers)","","","#27 Houston Oilers","#9 New York Jets","0","Mon Nov 16, 2026, 7:57PM","10"',
].join('\n')

describe('attaching an export to an imported league', () => {
  beforeEach(() => {
    h.snapshot = liveSnapshot()
    h.updates = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true, status: 200,
        text: async () => JSON.stringify({ leagueName: 'Road To Glory NFL', seasonYear: 2026, teamInfo: {} }),
      }),
    )
  })

  it('stores the pick trades under their own key and reports what it could not place', async () => {
    const res = await attachFantraxTradeCsv({ appUserId: 'af-user', sourceLeagueId: 'tau9a8fomvmq84sx', csv: TWO_TEAM_CSV })
    expect(res).toMatchObject({ ok: true, pickTradesInFile: 4, added: 4, stored: 4, rounds: [2, 5, 6, 7] })
    if (!res.ok) return
    expect(res.unknownTeams).toEqual(['#27 Houston Oilers'])
    const stored = h.updates[0] as Record<string, unknown>
    expect(Array.isArray(stored.pickTrades)).toBe(true)
    /* Not in `trades`, which the importer turns into transaction history. */
    expect(stored.trades).toBeUndefined()

    const again = await attachFantraxTradeCsv({ appUserId: 'af-user', sourceLeagueId: 'tau9a8fomvmq84sx', csv: TWO_TEAM_CSV })
    expect(again).toMatchObject({ ok: true, added: 0, stored: 4 })
  })

  it('refuses a file that is not a trade export, and a league the caller has not imported', async () => {
    const bad = await attachFantraxTradeCsv({ appUserId: 'af-user', sourceLeagueId: 'tau9a8fomvmq84sx', csv: 'hello' })
    expect(bad).toMatchObject({ ok: false, code: 'not_a_trade_export' })
    h.snapshot = null
    const none = await attachFantraxTradeCsv({ appUserId: 'af-user', sourceLeagueId: 'tau9a8fomvmq84sx', csv: TWO_TEAM_CSV })
    expect(none).toMatchObject({ ok: false, code: 'league_not_found' })
    expect(h.updates).toHaveLength(0)
  })

  /** End to end: the round 5 pick reaches the import, and only that one. */
  it('the next import carries the round 5 pick and nothing the API already covers', async () => {
    await attachFantraxTradeCsv({ appUserId: 'af-user', sourceLeagueId: 'tau9a8fomvmq84sx', csv: TWO_TEAM_CSV })
    const raw = await fetchFantraxLeagueForImport('af-user', 'id:snap-1')
    const jets = raw.teams.find((t) => t.teamName === '#9 New York Jets')!.teamId
    const dolphins = raw.teams.find((t) => t.teamName === '#18 Miami Dolphins')!.teamId

    expect(raw.tradedPicks).toEqual([{ season: 2029, round: 5, originalTeamId: dolphins, currentOwnerTeamId: jets }])
    expect(raw.futurePicks).toMatchObject({ total: 24, traded: 1, unmapped: 1, fromTradeExport: 1 })
    /* The API's round 2 pick stays home. */
    expect(raw.returnedPicks).toContainEqual({ season: 2027, round: 2, originalTeamId: dolphins })

    const normalized = await FantraxAdapter.normalize(raw)
    expect(normalized.traded_picks).toEqual([
      { season: 2029, round: 5, original_roster_id: dolphins, current_owner_roster_id: jets },
    ])
    /* And the export added no transaction history. */
    expect(raw.transactions).toEqual([])
  })
})

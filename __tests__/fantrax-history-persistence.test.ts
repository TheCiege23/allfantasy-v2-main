/**
 * Fantrax draft and (derived) transaction history are PERSISTED, not just returned.
 *
 * 🛑 WHAT WAS WRONG: a live (league-id) import fetched the draft board (`getFantraxDraftResults`)
 * and returned it on the outcome — "returned rather than stored" — so `FantraxLeagueFetchService`
 * built every payload with `draftPicks: []` and `DraftFact` never received a Fantrax pick. And
 * `deriveFantraxTransactions` existed with no caller, so a league-id import carried no transaction
 * history at all.
 *
 * Both now live in the snapshot's EXISTING `FantraxLeague.transactions` JSON column (no migration),
 * beside whatever an uploaded CSV export put there, and flow through the same payload →
 * `FantraxHistoricalBackfillService` → `DraftFact` / `TransactionFact` path every other source uses.
 *
 * The draft board is the committed Cream Bowl fixture (`__tests__/fixtures/fantrax-draft-results.json`).
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FantraxDraftResults } from '@/lib/league-import/fantrax/fantraxApi'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), userUpsert: vi.fn(),
  info: vi.fn(), rosters: vi.fn(), standings: vi.fn(), players: vi.fn(), schedule: vi.fn(), draft: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  fantraxLeague: { findUnique: h.findUnique, findMany: h.findMany, updateMany: h.updateMany, upsert: h.upsert },
  fantraxUser: { upsert: h.userUpsert },
} }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (original) => ({
  ...await original<object>(),
  getFantraxLeagueInfo: h.info, getFantraxTeamRosters: h.rosters,
  getFantraxStandings: h.standings, getFantraxPlayerIds: h.players,
  fetchFantraxScheduleWithScores: h.schedule, getFantraxDraftResults: h.draft,
}))
import { importFantraxLeague } from '@/lib/league-import/fantrax/importFantraxLeague'
import {
  buildStoredFantraxDraft,
  deriveFantraxMovesBetweenSnapshots,
  mergeFantraxSnapshotHistory,
  readStoredFantraxDerived,
  readStoredFantraxDraft,
} from '@/lib/league-import/fantrax/fantraxSnapshotHistory'

const raw = JSON.parse(readFileSync('__tests__/fixtures/fantrax-draft-results.json', 'utf8')) as {
  draftPicks: Array<Record<string, unknown>>; draftState: string; draftType: string; draftOrder: string[]
}
const board: FantraxDraftResults = {
  picks: raw.draftPicks.map((p) => ({
    round: Number(p.round), pick: Number(p.pick), pickInRound: Number(p.pickInRound), teamId: String(p.teamId),
    time: typeof p.time === 'number' ? p.time : null, playerId: typeof p.playerId === 'string' ? p.playerId : null,
  })),
  draftState: raw.draftState, draftType: raw.draftType, draftOrder: raw.draftOrder, draftDate: null, startDate: null, endDate: null,
}
const firstMade = board.picks.find((p) => p.playerId)!

const args = { leagueId: 'vendor-id', teamName: 'My team', appUserId: 'owner', refreshSnapshotId: 'stable-uuid' }
const roster = (ids: string[]) => ids.map((id) => ({ id, position: 'WR', status: 'ACTIVE' }))

function snapshot(over: Record<string, unknown> = {}) {
  return { id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026, sport: 'nfl', ...over }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.findUnique.mockResolvedValue(snapshot())
  h.updateMany.mockResolvedValue({ count: 1 })
  h.info.mockResolvedValue({ ok: true, data: { leagueName: 'L', seasonYear: 2026, rosterInfo: {} } })
  h.rosters.mockResolvedValue({ ok: true, data: {
    team1: { teamName: 'My team', rosterItems: roster(['p1', 'p3']) },
    team2: { teamName: 'Other', rosterItems: roster(['p4']) },
  } })
  h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'NFL' ? {
    p1: { fantraxId: 'p1', name: 'One, Player', position: 'WR', team: 'KC' },
    p2: { fantraxId: 'p2', name: 'Two, Player', position: 'WR', team: 'KC' },
    p3: { fantraxId: 'p3', name: 'Three, Player', position: 'WR', team: 'KC' },
    p4: { fantraxId: 'p4', name: 'Four, Player', position: 'WR', team: 'BUF' },
    [firstMade.playerId!]: { fantraxId: firstMade.playerId!, name: 'Drafted, First', position: 'QB', team: 'BUF' },
  } : {} }))
  h.standings.mockResolvedValue({ ok: true, data: [] })
  h.schedule.mockResolvedValue({ rows: [], position: { state: 'in_progress', period: 5 }, periodsRead: 0, periodsFailed: 0 })
  h.draft.mockResolvedValue(null)
})

describe('stored draft board', () => {
  it('keeps every MADE pick with its overall and in-round number, team and the player map name', () => {
    const stored = buildStoredFantraxDraft(board, { [firstMade.teamId]: 'Team A' }, {
      [firstMade.playerId!]: { fantraxId: firstMade.playerId!, name: 'Drafted, First', position: 'QB', team: 'BUF' },
    })
    expect(stored.slots).toBe(192)
    expect(stored.picks).toHaveLength(156)
    expect(stored.draftState).toBe(raw.draftState)
    expect(stored.picks[0]).toEqual({
      round: firstMade.round, pick: firstMade.pick, pickInRound: firstMade.pickInRound, teamId: firstMade.teamId,
      teamName: 'Team A', playerId: firstMade.playerId, playerName: 'Drafted, First', position: 'QB', team: 'BUF',
    })
  })

  it('is written into the snapshot on a refresh, beside an uploaded export, and read back', async () => {
    h.draft.mockResolvedValue({ ok: true, data: board })
    h.findUnique.mockResolvedValue(snapshot({ transactions: { claims: [{ type: 'claim', player: 'Kept Export' }] } }))
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    const written = h.updateMany.mock.calls[0][0].data.transactions
    expect(written.claims).toEqual([{ type: 'claim', player: 'Kept Export' }])
    const draft = readStoredFantraxDraft(written)
    expect(draft?.picks).toHaveLength(156)
    expect(draft?.picks[0]).toMatchObject({ playerId: firstMade.playerId, playerName: 'Drafted, First' })
  })

  it('a draft read that FAILED keeps the board already on file instead of erasing it', async () => {
    const kept = buildStoredFantraxDraft(board, {}, null)
    h.findUnique.mockResolvedValue(snapshot({ transactions: mergeFantraxSnapshotHistory(null, { draft: kept, moves: [], suspectedTrades: [], period: 1, observedAt: '2026-10-01T00:00:00.000Z' }) }))
    h.draft.mockResolvedValue({ ok: false, failure: { kind: 'unavailable', message: 'later' } })
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(readStoredFantraxDraft(h.updateMany.mock.calls[0][0].data.transactions)?.picks).toHaveLength(156)
  })
})

describe('derived transactions between refreshes', () => {
  const prior = [
    { fantraxId: 'p1', teamName: 'My team' }, { fantraxId: 'p2', teamName: 'My team' },
    { fantraxId: 'p4', teamName: 'Other' },
  ]
  const standings = [{ team: 'My team', fantraxTeamId: 'team1' }, { team: 'Other', fantraxTeamId: 'team2' }]

  it('records the roster change since the last refresh as an inferred move, and is idempotent', async () => {
    h.findUnique.mockResolvedValue(snapshot({ roster: prior, standings }))
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    const first = h.updateMany.mock.calls[0][0].data.transactions
    const { moves } = readStoredFantraxDerived(first)
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ teamId: 'team1', teamName: 'My team', adds: ['p3'], drops: ['p2'], period: 5 })

    // The next refresh sees the roster it just wrote: nothing changed, nothing is appended or duplicated.
    h.findUnique.mockResolvedValue(snapshot({ roster: h.updateMany.mock.calls[0][0].data.roster, standings, transactions: first }))
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    const second = readStoredFantraxDerived(h.updateMany.mock.calls[1][0].data.transactions)
    expect(second.moves).toEqual(moves)

    // Merging the same move twice keeps one copy.
    const again = mergeFantraxSnapshotHistory(first, { draft: null, moves, suspectedTrades: [], period: 5, observedAt: '2026-10-02T00:00:00.000Z' })
    expect(readStoredFantraxDerived(again).moves).toHaveLength(1)
  })

  it('a pre-draft prior snapshot (no rostered players) is not read as everyone being added', () => {
    const out = deriveFantraxMovesBetweenSnapshots({
      previousRoster: [], previousStandings: standings,
      current: [{ teamId: 'team1', teamName: 'My team', players: [{ fantraxId: 'p1', name: null, team: null, position: 'WR', status: 'ACTIVE' }], resolved: 0, total: 1 }],
      period: 1, observedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(out.moves).toEqual([])
  })

  it('players taken in the draft by that team are not reported as adds', () => {
    const out = deriveFantraxMovesBetweenSnapshots({
      previousRoster: [{ fantraxId: 'p1', teamName: 'My team' }], previousStandings: standings,
      current: [{ teamId: 'team1', teamName: 'My team', players: ['p1', 'rookie'].map((fantraxId) => ({ fantraxId, name: null, team: null, position: 'WR', status: 'ACTIVE' })), resolved: 0, total: 2 }],
      draftedBy: new Map([['rookie', 'team1']]),
      period: 2, observedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(out.moves).toEqual([])
  })

  it('a two-way exchange is a SUSPECTED trade, and its players are not also counted as moves', () => {
    const out = deriveFantraxMovesBetweenSnapshots({
      previousRoster: [{ fantraxId: 'a', teamName: 'My team' }, { fantraxId: 'b', teamName: 'Other' }], previousStandings: standings,
      current: [
        { teamId: 'team1', teamName: 'My team', players: [{ fantraxId: 'b', name: null, team: null, position: 'WR', status: 'ACTIVE' }], resolved: 0, total: 1 },
        { teamId: 'team2', teamName: 'Other', players: [{ fantraxId: 'a', name: null, team: null, position: 'WR', status: 'ACTIVE' }], resolved: 0, total: 1 },
      ],
      period: 3, observedAt: '2026-10-01T00:00:00.000Z',
    })
    expect(out.moves).toEqual([])
    expect(out.suspectedTrades).toHaveLength(1)
    expect(out.suspectedTrades[0]).toMatchObject({ teamAId: 'team1', teamBId: 'team2', aSent: ['a'], bSent: ['b'] })
  })
})

describe('the fetch service reads the stored history into the import payload', () => {
  /* `sourceLeagueId: null` — a stored snapshot read, so no live refresh is attempted. */
  it('turns the stored board into draft picks and derived moves into flagged transactions', async () => {
    const { fetchFantraxLeagueForImport } = await import('@/lib/league-import/fantrax/FantraxLeagueFetchService')
    const { FantraxAdapter } = await import('@/lib/league-import/adapters/fantrax/FantraxAdapter')
    const transactions = mergeFantraxSnapshotHistory({ claims: [] }, {
      draft: { draftState: 'completed', slots: 2, picks: [
        { round: 1, pick: 1, pickInRound: 1, teamId: 'team1', teamName: 'My team', playerId: 'p1', playerName: 'One, Player', position: 'WR', team: 'KC' },
      ] },
      moves: [{ id: 'm1', period: 4, observedAt: '2026-10-01T00:00:00.000Z', teamId: 'team1', teamName: 'My team', adds: ['p3'], drops: ['p2'] }],
      suspectedTrades: [{ id: 't1', period: 4, observedAt: '2026-10-01T00:00:00.000Z', teamAId: 'team1', teamAName: 'My team', teamBId: 'team2', teamBName: 'Other', aSent: ['x'], bSent: ['y'] }],
      period: 4, observedAt: '2026-10-01T00:00:00.000Z',
    })
    const record = {
      id: 'snap', appUserId: 'owner', sourceLeagueId: null, season: 2026, userId: 'u', user: { id: 'u', fantraxUsername: 'Me' },
      userTeam: 'My team', sport: 'nfl', isDevy: false, leagueName: 'L', teamCount: 2,
      roster: [{ fantraxId: 'p1', name: 'One, Player', teamName: 'My team', status: 'ACTIVE' }],
      standings: [{ team: 'My team', fantraxTeamId: 'team1' }, { team: 'Other', fantraxTeamId: 'team2' }],
      matchups: [], transactions,
    }
    h.findUnique.mockResolvedValue(record)
    h.findMany.mockResolvedValue([])
    const payload = await fetchFantraxLeagueForImport('owner', 'id:snap')
    const mine = payload.teams.find((t) => t.teamName === 'My team')!.teamId
    const other = payload.teams.find((t) => t.teamName === 'Other')!.teamId

    expect(payload.draftPicks).toEqual([
      { round: 1, pickNumber: 1, teamId: mine, playerId: 'p1', playerName: 'One, Player', position: 'WR', team: 'KC' },
    ])
    const move = payload.transactions.find((t) => t.transactionId.endsWith(':derived:m1'))!
    expect(move).toMatchObject({ status: 'inferred', adds: { p3: mine }, drops: { p2: mine }, teamIds: [mine] })
    const trade = payload.transactions.find((t) => t.transactionId.endsWith(':derived:t1'))!
    expect(trade).toMatchObject({ type: 'trade', status: 'suspected', adds: { x: other, y: mine }, drops: { x: mine, y: other } })

    const coverage = (await FantraxAdapter.normalize(payload)).coverage!
    expect(coverage.draftHistory).toMatchObject({ count: 1 })
    expect(coverage.draftHistory.note).toMatch(/draft board is stored/i)
    expect(coverage.tradeHistory.note).toMatch(/inferred/i)
  })
})

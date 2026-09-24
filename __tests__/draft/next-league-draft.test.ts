import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A league's second draft. Before this there was no way to create one: a dynasty league never
 * held a rookie draft and a keeper league never drafted for year two.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  draftSessionFindFirst: vi.fn(),
  draftSessionCreate: vi.fn(),
  seasonFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  redraftRosterFindMany: vi.fn(),
  dynastyFindUnique: vi.fn(),
  playoffRoundFindFirst: vi.fn(),
  keeperFindMany: vi.fn(),
  leagueUpdate: vi.fn(),
  buildSlotOrder: vi.fn(),
  ensureShell: vi.fn(),
  carry: vi.fn(),
  logAction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => {
  const tx = {
    draftSession: { create: m.draftSessionCreate },
    league: { update: m.leagueUpdate },
  }
  return {
    prisma: {
      league: { findUnique: m.leagueFindUnique },
      draftSession: { findFirst: m.draftSessionFindFirst },
      redraftSeason: { findMany: m.seasonFindMany },
      roster: { findMany: m.rosterFindMany },
      redraftRoster: { findMany: m.redraftRosterFindMany },
      dynastyLeagueConfig: { findUnique: m.dynastyFindUnique },
      redraftPlayoffRound: { findFirst: m.playoffRoundFindFirst },
      keeperRecord: { findMany: m.keeperFindMany },
      $transaction: async (cb: (t: typeof tx) => unknown) => cb(tx),
    },
  }
})
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSlotOrderForLeague: m.buildSlotOrder }))
vi.mock('@/lib/redraft/offseason/ensureNextRedraftSeasonShell', () => ({ ensureNextRedraftSeasonShell: m.ensureShell }))
vi.mock('@/lib/redraft/offseason/carryDynastyRosters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/offseason/carryDynastyRosters')>()),
  carryDynastyRostersForward: m.carry,
}))
vi.mock('@/server/services/auditService', () => ({ logAction: m.logAction }))

import {
  createNextLeagueDraft,
  draftRosterIdForOwner,
  placeKeeperRounds,
  rookieOrderFromStandings,
} from '@/lib/live-draft-engine/createNextLeagueDraft'

const completedDraft = {
  id: 'draft-1',
  status: 'completed',
  rounds: 15,
  teamCount: 4,
  draftType: 'snake',
  thirdRoundReversal: false,
  timerSeconds: 90,
  aiAutoPick: false,
  cpuAutoPick: true,
  alphabeticalSort: false,
  sportType: 'NFL',
  auctionBudgetPerTeam: null,
  devyConfig: null,
  c2cConfig: null,
  onClockTradeTimerBehavior: 'inherit_remaining',
  inDraftPlayerTradesEnabled: true,
  customRankingsEnabled: true,
}

const draftRosters = [
  { id: 'R-a', platformUserId: 'user-a' },
  { id: 'R-b', platformUserId: 'user-b' },
  { id: 'R-c', platformUserId: 'user-c' },
  { id: 'R-d', platformUserId: 'orphan-d' },
]

// Last season: b worst (2-11), then d (orphan), then c; a won the title over c... c lost the final.
const lastSeason = [
  { id: 's-a', ownerId: 'user-a', ownerName: 'A', teamName: 'Team A', wins: 9, losses: 4, ties: 0, pointsFor: 1500 },
  { id: 's-b', ownerId: 'user-b', ownerName: 'B', teamName: 'Team B', wins: 2, losses: 11, ties: 0, pointsFor: 1100 },
  { id: 's-c', ownerId: 'user-c', ownerName: 'C', teamName: 'Team C', wins: 10, losses: 3, ties: 0, pointsFor: 1600 },
  { id: 's-d', ownerId: 'roster:R-d', ownerName: 'D', teamName: 'Team D', wins: 5, losses: 8, ties: 0, pointsFor: 1300 },
]

function league(overrides: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    sport: 'NFL',
    leagueType: 'dynasty',
    isDynasty: true,
    keeperCount: 0,
    leagueSize: 4,
    lifecycleState: 'offseason',
    lifecycleMetadata: {},
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  m.draftSessionFindFirst.mockResolvedValue(completedDraft)
  m.rosterFindMany.mockResolvedValue(draftRosters)
  m.draftSessionCreate.mockResolvedValue({ id: 'draft-2' })
  m.leagueUpdate.mockResolvedValue({})
  m.logAction.mockResolvedValue({ id: 'audit' })
  m.carry.mockResolvedValue({ rostersMatched: 4, playersCopied: 60, playersAlreadyPresent: 0, unmatchedOwnerIds: [] })
  m.buildSlotOrder.mockResolvedValue(
    draftRosters.map((r, i) => ({ slot: i + 1, rosterId: r.id, displayName: `Team ${i + 1}` })),
  )
  m.dynastyFindUnique.mockResolvedValue(null)
  m.playoffRoundFindFirst.mockResolvedValue({
    matchups: [{ homeRosterId: 's-a', awayRosterId: 's-c', winnerRosterId: 's-a', nextMatchupId: null }],
  })
  m.keeperFindMany.mockResolvedValue([])
})

describe('rookie order', () => {
  const rows = lastSeason.map(({ id, wins, losses, ties, pointsFor }) => ({ id, wins, losses, ties, pointsFor }))

  it('reverse standings: worst record first, champion last, runner-up second to last', () => {
    expect(rookieOrderFromStandings(rows, { method: 'reverse_standings', championId: 's-a', runnerUpId: 's-c' })).toEqual([
      's-b',
      's-d',
      's-c',
      's-a',
    ])
  })

  it('max_pf ranks the non-finalists on points alone', () => {
    const tanker = { id: 's-t', wins: 1, losses: 12, ties: 0, pointsFor: 1400 }
    expect(rookieOrderFromStandings([...rows, tanker], { method: 'max_pf', championId: 's-a', runnerUpId: 's-c' })).toEqual([
      's-b',
      's-d',
      's-t',
      's-c',
      's-a',
    ])
  })

  it('maps a season owner to the draft roster a pick is made for', () => {
    expect(draftRosterIdForOwner('user-b', draftRosters)).toBe('R-b')
    expect(draftRosterIdForOwner('roster:R-d', draftRosters)).toBe('R-d')
    expect(draftRosterIdForOwner('roster:gone', draftRosters)).toBeNull()
    expect(draftRosterIdForOwner('nobody', draftRosters)).toBeNull()
  })
})

describe('keeper rounds', () => {
  it('two keepers costing the same round do not claim the same pick', () => {
    const placed = placeKeeperRounds(
      [
        { rosterId: 'R-a', roundCost: 3 },
        { rosterId: 'R-a', roundCost: 3 },
        { rosterId: 'R-b', roundCost: 3 },
      ],
      15,
    )
    expect(placed.map((k) => `${k.rosterId}:${k.roundCost}`)).toEqual(['R-a:3', 'R-a:4', 'R-b:3'])
  })

  it('a cost beyond the last round takes the last round instead of vanishing', () => {
    expect(placeKeeperRounds([{ rosterId: 'R-a', roundCost: 20 }], 15)[0]!.roundCost).toBe(15)
  })
})

describe('createNextLeagueDraft', () => {
  it('refuses while the current draft is still open, and creates nothing', async () => {
    m.leagueFindUnique.mockResolvedValue(league())
    m.draftSessionFindFirst.mockResolvedValue({ ...completedDraft, status: 'in_progress' })
    const r = await createNextLeagueDraft('L1', 'commish')
    expect(r).toMatchObject({ ok: false, code: 'DRAFT_STILL_OPEN' })
    expect(m.draftSessionCreate).not.toHaveBeenCalled()
  })

  it('refuses while the season is still being played', async () => {
    m.leagueFindUnique.mockResolvedValue(league())
    m.seasonFindMany.mockResolvedValue([{ id: 'season-1', season: 2026, status: 'active' }])
    const r = await createNextLeagueDraft('L1', 'commish')
    expect(r).toMatchObject({ ok: false, code: 'SEASON_IN_PROGRESS' })
    expect(m.ensureShell).not.toHaveBeenCalled()
    expect(m.draftSessionCreate).not.toHaveBeenCalled()
  })

  it('dynasty: carries rosters into next season and creates a worst-to-first rookie draft', async () => {
    m.leagueFindUnique.mockResolvedValue(league())
    m.seasonFindMany.mockResolvedValue([{ id: 'season-1', season: 2026, status: 'complete' }])
    m.ensureShell.mockResolvedValue({ id: 'season-2', season: 2027 })
    m.redraftRosterFindMany.mockResolvedValue(lastSeason)
    m.dynastyFindUnique.mockResolvedValue({ rookieDraftRounds: 4, rookieDraftType: 'linear', rookiePickOrderMethod: 'reverse_standings' })

    const r = await createNextLeagueDraft('L1', 'commish')

    expect(r).toMatchObject({ ok: true, kind: 'rookie', seasonId: 'season-2', season: 2027, rounds: 4, orderSource: 'standings' })
    expect(m.ensureShell).toHaveBeenCalledWith('L1', 'season-1')
    expect(m.carry).toHaveBeenCalledWith('L1', 'season-1', 'season-2')
    const data = m.draftSessionCreate.mock.calls[0]![0].data
    expect(data).toMatchObject({
      status: 'pre_draft',
      draftType: 'linear',
      rounds: 4,
      teamCount: 4,
      playerPool: 'rookies_only',
      draftModeLabel: 'rookie',
    })
    expect(data.slotOrder.map((e: { rosterId: string }) => e.rosterId)).toEqual(['R-b', 'R-d', 'R-c', 'R-a'])
    // The offseason refuses every draft action; the league moves to pre_draft with the new draft.
    expect(m.leagueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lifecycleState: 'pre_draft' }) }),
    )
  })

  it('keeper: a full draft with last draft settings and every locked keeper on the board', async () => {
    m.leagueFindUnique.mockResolvedValue(league({ leagueType: 'keeper', isDynasty: false, keeperCount: 2 }))
    // Next season's shell already exists (the keeper window opened in it).
    m.seasonFindMany.mockResolvedValue([
      { id: 'season-2', season: 2027, status: 'setup' },
      { id: 'season-1', season: 2026, status: 'complete' },
    ])
    m.keeperFindMany.mockResolvedValue([
      { rosterId: 'n-a', playerId: 'p1', playerName: 'Player One', position: 'RB', team: 'DAL', costRound: 2 },
      { rosterId: 'n-d', playerId: 'p2', playerName: 'Player Two', position: 'WR', team: 'KC', costRound: 5 },
      { rosterId: 'n-a', playerId: 'p3', playerName: 'Auction Keeper', position: 'TE', team: 'SF', costRound: null },
    ])
    m.redraftRosterFindMany.mockResolvedValue([
      { id: 'n-a', ownerId: 'user-a' },
      { id: 'n-d', ownerId: 'roster:R-d' },
    ])

    const r = await createNextLeagueDraft('L1', 'commish')

    expect(r).toMatchObject({ ok: true, kind: 'standard', seasonId: 'season-2', keepersPlaced: 2, orderSource: 'default' })
    expect(m.ensureShell).not.toHaveBeenCalled()
    expect(m.carry).not.toHaveBeenCalled()
    const data = m.draftSessionCreate.mock.calls[0]![0].data
    expect(data).toMatchObject({ rounds: 15, draftType: 'snake', playerPool: 'all', draftModeLabel: 'standard' })
    expect(data.keeperConfig).toEqual({ maxKeepers: 2 })
    expect(data.keeperSelections).toEqual([
      { rosterId: 'R-a', roundCost: 2, playerName: 'Player One', position: 'RB', team: 'DAL', playerId: 'p1' },
      { rosterId: 'R-d', roundCost: 5, playerName: 'Player Two', position: 'WR', team: 'KC', playerId: 'p2' },
    ])
  })

  it('reports a database that still allows one draft per league, instead of a server error', async () => {
    m.leagueFindUnique.mockResolvedValue(league({ leagueType: 'redraft', isDynasty: false }))
    m.seasonFindMany.mockResolvedValue([{ id: 'season-1', season: 2026, status: 'complete' }])
    m.ensureShell.mockResolvedValue({ id: 'season-2', season: 2027 })
    m.draftSessionCreate.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }))
    m.draftSessionFindFirst.mockResolvedValueOnce(completedDraft).mockResolvedValueOnce(null)

    const r = await createNextLeagueDraft('L1', 'commish')

    expect(r).toMatchObject({ ok: false, code: 'NEEDS_DATABASE_UPDATE' })
  })
})

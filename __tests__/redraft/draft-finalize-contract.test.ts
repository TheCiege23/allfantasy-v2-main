import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Draft-completion → playable-season CONTRACT (G12).
 *
 * The finalization bridge `syncCompletedDraftToRedraftSeason` reads DraftPick rows
 * (`overall`, `rosterId`, `playerId`, `playerName`, `position`, …) and never branches
 * on `DraftSession.draftType`. That is the architecture guarantee that one draft
 * engine serves every draft type (snake / linear / auction / auto / offline) and every
 * future league concept: completion behavior depends only on the picks, not on how
 * they were produced.
 *
 * These tests pin that contract:
 *  1. Identical picks → identical RedraftRosterPlayer materialization for snake,
 *     linear, AND auction sessions (auction `amount` does not change roster sync).
 *  2. A DEF/ST pick materializes with its READABLE name ("KC Defense") — the raw
 *     `nfl:def:KC` id is stored only in the playerId field, never leaked as the name.
 *  3. Only drafted players are materialized — undrafted players are never created
 *     (the free-agent pool is a computed ADP-minus-rostered view, not a write).
 *  4. Cleared/empty pick rows are skipped (commissioner pick-editor "EMPTY").
 */

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  redraftSeasonFindFirst: vi.fn(),
  redraftSeasonUpdate: vi.fn(),
  redraftRosterFindFirst: vi.fn(),
  redraftRosterCreate: vi.fn(),
  redraftRosterUpdate: vi.fn(),
  redraftRosterFindMany: vi.fn(),
  redraftRosterPlayerFindFirst: vi.fn(),
  redraftRosterPlayerCreate: vi.fn(),
  rosterFindFirst: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  redraftMatchupCount: vi.fn(),
  redraftMatchupCreateMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    draftSession: { findUnique: mocks.draftSessionFindUnique },
    redraftSeason: {
      findFirst: mocks.redraftSeasonFindFirst,
      update: mocks.redraftSeasonUpdate,
    },
    redraftRoster: {
      findFirst: mocks.redraftRosterFindFirst,
      create: mocks.redraftRosterCreate,
      update: mocks.redraftRosterUpdate,
      findMany: mocks.redraftRosterFindMany,
    },
    redraftRosterPlayer: {
      findFirst: mocks.redraftRosterPlayerFindFirst,
      create: mocks.redraftRosterPlayerCreate,
    },
    roster: { findFirst: mocks.rosterFindFirst },
    leagueTeam: { findFirst: mocks.leagueTeamFindFirst },
    redraftMatchup: {
      count: mocks.redraftMatchupCount,
      createMany: mocks.redraftMatchupCreateMany,
    },
  },
}))

import { syncCompletedDraftToRedraftSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'

type Pick = {
  id: string
  overall: number
  round: number
  rosterId: string
  playerId: string | null
  playerName: string
  position: string
  team: string | null
  byeWeek: number | null
  amount?: number | null
  pickMetadata?: unknown | null
}

// One QB to GR1, one DEF/ST to GR2. The DEF pick carries the canonical raw id in
// playerId and the readable name in playerName (exactly how the draft board stores it).
const PICKS: Pick[] = [
  {
    id: 'P1', overall: 1, round: 1, rosterId: 'GR1',
    playerId: 'player-qb', playerName: 'Patrick Mahomes', position: 'QB',
    team: 'KC', byeWeek: 10, pickMetadata: null,
  },
  {
    id: 'P2', overall: 2, round: 1, rosterId: 'GR2',
    playerId: 'nfl:def:KC', playerName: 'KC Defense', position: 'DEF',
    team: 'KC', byeWeek: 10, pickMetadata: null,
  },
]

function setup(opts: { draftType: string; picks?: Pick[] } = { draftType: 'snake' }) {
  const picks = opts.picks ?? PICKS

  mocks.leagueFindUnique.mockResolvedValue({ id: 'L1', leagueType: 'redraft', isDynasty: false })
  mocks.draftSessionFindUnique.mockResolvedValue({
    id: 'DS1', status: 'completed', sportType: 'NFL', draftType: opts.draftType, picks,
  })
  mocks.redraftSeasonFindFirst.mockResolvedValue({
    id: 'SEASON1', sport: 'NFL', status: 'active', currentWeek: 1,
    totalWeeks: 14, playoffStartWeek: 14, medianGame: false,
  })

  // Generic roster + team lookups per unique rosterId, in pick order (GR1, GR2).
  mocks.rosterFindFirst
    .mockResolvedValueOnce({ id: 'GR1', platformUserId: 'U1', playerData: null, faabRemaining: 100, waiverPriority: 1 })
    .mockResolvedValueOnce({ id: 'GR2', platformUserId: 'U2', playerData: null, faabRemaining: 100, waiverPriority: 2 })
  mocks.leagueTeamFindFirst
    .mockResolvedValueOnce({ ownerName: 'Owner 1', teamName: 'Team 1', avatarUrl: null, claimedByUserId: 'U1', platformUserId: 'U1' })
    .mockResolvedValueOnce({ ownerName: 'Owner 2', teamName: 'Team 2', avatarUrl: null, claimedByUserId: 'U2', platformUserId: 'U2' })

  // RedraftRosters already exist (refresh path); ownerId matches → plain update.
  mocks.redraftRosterFindFirst
    .mockResolvedValueOnce({ id: 'RR1', ownerId: 'U1', ownerName: 'Owner 1', teamName: 'Team 1', avatarUrl: null, faabBalance: 100, waiverPriority: 1 })
    .mockResolvedValueOnce({ id: 'RR2', ownerId: 'U2', ownerName: 'Owner 2', teamName: 'Team 2', avatarUrl: null, faabBalance: 100, waiverPriority: 2 })
  mocks.redraftRosterUpdate
    .mockResolvedValueOnce({ id: 'RR1', ownerId: 'U1' })
    .mockResolvedValueOnce({ id: 'RR2', ownerId: 'U2' })

  // No players on rosters yet → every drafted pick is created.
  mocks.redraftRosterPlayerFindFirst.mockResolvedValue(null)
  mocks.redraftRosterPlayerCreate.mockResolvedValue({ id: 'RRP' })

  // Schedule already exists → schedule section is a no-op (covered separately).
  mocks.redraftMatchupCount.mockResolvedValue(14)
}

function createdPlayers(): Array<Record<string, unknown>> {
  return mocks.redraftRosterPlayerCreate.mock.calls.map(
    (c) => (c as [{ data: Record<string, unknown> }])[0].data,
  )
}

describe('draft finalize contract: draft-type agnostic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('materializes identical roster players for snake, linear, and auction sessions', async () => {
    const runs: Array<Array<Record<string, unknown>>> = []
    for (const draftType of ['snake', 'linear', 'auction']) {
      vi.clearAllMocks()
      setup({ draftType })
      const result = await syncCompletedDraftToRedraftSeason('L1')
      expect(result.skipped).toBe(false)
      expect(result.redraftPlayersCreated).toBe(2)
      // Normalize for comparison (order is overall-asc and deterministic).
      runs.push(
        createdPlayers().map((d) => ({
          rosterId: d.rosterId, playerId: d.playerId, playerName: d.playerName,
          position: d.position, acquisitionType: d.acquisitionType,
        })),
      )
    }
    // Draft type does not change what gets written to the season roster.
    expect(runs[0]).toEqual(runs[1])
    expect(runs[1]).toEqual(runs[2])
  })

  it('does not branch on auction amount — auction picks sync the same as snake', async () => {
    setup({
      draftType: 'auction',
      picks: PICKS.map((p, i) => ({ ...p, amount: i === 0 ? 55 : 3 })),
    })
    const result = await syncCompletedDraftToRedraftSeason('L1')
    expect(result.redraftPlayersCreated).toBe(2)
    const players = createdPlayers()
    // amount is an auction-only board concept; it is not part of the roster player row.
    expect(players.every((p) => !('amount' in p))).toBe(true)
  })
})

describe('draft finalize contract: DEF/ST + undrafted handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('materializes a DEF/ST pick with its readable name, never the raw nfl:def id', async () => {
    setup({ draftType: 'snake' })
    await syncCompletedDraftToRedraftSeason('L1')

    const def = createdPlayers().find((p) => p.position === 'DEF')
    expect(def).toBeDefined()
    // Readable display name is stored as the name…
    expect(def!.playerName).toBe('KC Defense')
    // …and the raw canonical id lives only in playerId (legitimate), never the name.
    expect(def!.playerId).toBe('nfl:def:KC')
    expect(String(def!.playerName)).not.toContain('nfl:def')
  })

  it('only materializes drafted players (no undrafted/free-agent writes)', async () => {
    setup({ draftType: 'snake' })
    const result = await syncCompletedDraftToRedraftSeason('L1')
    // Exactly the two drafted picks — the free-agent pool is a computed view, not written here.
    expect(result.redraftPlayersCreated).toBe(2)
    expect(mocks.redraftRosterPlayerCreate).toHaveBeenCalledTimes(2)
  })

  it('skips cleared/empty pick rows (commissioner pick-editor EMPTY)', async () => {
    setup({
      draftType: 'snake',
      picks: [
        PICKS[0]!,
        { ...PICKS[1]!, playerName: '', position: 'EMPTY', pickMetadata: { pickEditorEmpty: true } },
      ],
    })
    const result = await syncCompletedDraftToRedraftSeason('L1')
    expect(result.skippedPicks).toBe(1)
    expect(result.redraftPlayersCreated).toBe(1)
    expect(mocks.redraftRosterPlayerCreate).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment node
/**
 * Guards the commissioner's cross-league standings board.
 *
 * 🛑 THIS SCREEN DECIDES WHO LOOKS LIKE THEY ARE OUT. In a 240-manager
 * tournament the cut is conference-wide, so the number that matters is not a
 * manager's rank in their own twelve-team league but their rank against ~120
 * others — and the two disagree constantly. Getting that wrong shows someone
 * they are eliminated when they are not.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const shellFindFirst = vi.fn()
const conferenceFindMany = vi.fn()
const tournamentLeagueFindMany = vi.fn()
const participantFindMany = vi.fn()
const leagueTeamFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tournamentShell: { findFirst: (...a: unknown[]) => shellFindFirst(...a) },
    tournamentConference: { findMany: (...a: unknown[]) => conferenceFindMany(...a) },
    tournamentLeague: { findMany: (...a: unknown[]) => tournamentLeagueFindMany(...a) },
    tournamentLeagueParticipant: { findMany: (...a: unknown[]) => participantFindMany(...a) },
    leagueTeam: { findMany: (...a: unknown[]) => leagueTeamFindMany(...a) },
  },
}))

import { getTournamentStandingsBoard } from '@/lib/tournament/standingsBoard'

const SHELL = {
  id: 't1',
  name: 'King Buffalo Invitational',
  currentRoundNumber: 1,
  advancersPerLeague: 0,
  wildcardCount: 2,
  bubbleEnabled: true,
  bubbleSize: 1,
  tiebreakerMode: 'points_for',
}

function leagueTeam(over: Record<string, unknown>) {
  return {
    externalId: 'x',
    platformUserId: null,
    ownerName: '',
    teamName: '',
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    lastUpdatedAt: new Date('2025-09-01T00:00:00Z'),
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  shellFindFirst.mockResolvedValue(SHELL)
  conferenceFindMany.mockResolvedValue([{ id: 'c1', name: 'BLACK', colorHex: null }])
  tournamentLeagueFindMany.mockResolvedValue([
    { id: 'tl1', leagueId: 'lg1', name: 'BEAST', conferenceId: 'c1' },
  ])
  participantFindMany.mockResolvedValue([])
  leagueTeamFindMany.mockResolvedValue([])
})

/** ⚠ A franchise-shaped read: not yours and not existing answer the same way. */
it('returns null for a tournament this user does not commission', async () => {
  shellFindFirst.mockResolvedValue(null)
  expect(await getTournamentStandingsBoard('t1', 'someone-else')).toBeNull()
})

describe('the conference cut', () => {
  beforeEach(() => {
    participantFindMany.mockResolvedValue([
      { id: 'p1', tournamentLeagueId: 'tl1', participantId: 'P1', userId: 's-1', participant: { displayName: 'TyT1' } },
      { id: 'p2', tournamentLeagueId: 'tl1', participantId: 'P2', userId: 's-2', participant: { displayName: 'emmae' } },
      { id: 'p3', tournamentLeagueId: 'tl1', participantId: 'P3', userId: 's-3', participant: { displayName: 'Spokee' } },
      { id: 'p4', tournamentLeagueId: 'tl1', participantId: 'P4', userId: 's-4', participant: { displayName: 'zedlav' } },
    ])
    leagueTeamFindMany.mockResolvedValue([
      leagueTeam({ externalId: '1', platformUserId: 's-1', wins: 7, losses: 2, pointsFor: 1300 }),
      leagueTeam({ externalId: '2', platformUserId: 's-2', wins: 6, losses: 3, pointsFor: 1200 }),
      leagueTeam({ externalId: '3', platformUserId: 's-3', wins: 5, losses: 4, pointsFor: 1100 }),
      leagueTeam({ externalId: '4', platformUserId: 's-4', wins: 4, losses: 5, pointsFor: 1000 }),
    ])
  })

  /**
   * 🛑 THE BOTTOM OF THE CUT IS NOT SAFE. With a cut of 2 and a bubble of 1,
   * `emmae` is inside the cut and DEFENDING that place against the highest
   * scorer below the line — the commissioner's own rule is "seeds 59-64 plus the
   * top 6 scorers from 65-120", so six inside the cut are at risk. The earlier
   * behaviour advanced `emmae` outright and put the next manager by RANK in a
   * bubble of their own, which is a different contest between different people.
   */
  it('puts the bottom of the cut at risk and the top scorer below it in the bubble', async () => {
    const board = await getTournamentStandingsBoard('t1', 'commish')
    const rows = board!.conferences[0].leagues[0].rows
    expect(rows.map((r) => [r.displayName, r.standing])).toEqual([
      ['TyT1', 'in'],
      ['emmae', 'bubble'],
      ['Spokee', 'bubble'],
      ['zedlav', 'out'],
    ])
  })

  /**
   * 🛑 CHALLENGERS ARE PICKED BY POINTS, NOT BY RANK, and that is the half of the
   * rule a rank-window gets wrong. Rank is wins-first, so a losing team that
   * outscored the conference is not the next name in the standings — but it is
   * exactly who "top scorers from 65-120" means.
   */
  it('takes the highest scorer below the line, not the next by rank', async () => {
    leagueTeamFindMany.mockResolvedValue([
      leagueTeam({ externalId: '1', platformUserId: 's-1', wins: 9, losses: 0, pointsFor: 1300 }),
      leagueTeam({ externalId: '2', platformUserId: 's-2', wins: 8, losses: 1, pointsFor: 1200 }),
      /* Ranks 3rd on record, scored least. */
      leagueTeam({ externalId: '3', platformUserId: 's-3', wins: 7, losses: 2, pointsFor: 500 }),
      /* Ranks last on record, outscored everyone below the line. */
      leagueTeam({ externalId: '4', platformUserId: 's-4', wins: 0, losses: 9, pointsFor: 1400 }),
    ])
    const board = await getTournamentStandingsBoard('t1', 'commish')
    const rows = board!.conferences[0].leagues[0].rows
    const standing = Object.fromEntries(rows.map((r) => [r.displayName, r.standing]))
    expect(standing).toMatchObject({ TyT1: 'in', emmae: 'bubble', zedlav: 'bubble', Spokee: 'out' })
  })

  it('ranks against the whole conference, not within the league', async () => {
    const board = await getTournamentStandingsBoard('t1', 'commish')
    const rows = board!.conferences[0].leagues[0].rows
    expect(rows.map((r) => r.conferenceRank)).toEqual([1, 2, 3, 4])
  })

  /** ⚠ Points-for is the first tiebreaker, so the hundredths decide the cut. */
  it('breaks a tied record on points for', async () => {
    leagueTeamFindMany.mockResolvedValue([
      leagueTeam({ externalId: '1', platformUserId: 's-1', wins: 5, losses: 4, pointsFor: 1000.5 }),
      leagueTeam({ externalId: '2', platformUserId: 's-2', wins: 5, losses: 4, pointsFor: 1000.51 }),
      leagueTeam({ externalId: '3', platformUserId: 's-3', wins: 1, losses: 8, pointsFor: 10 }),
      leagueTeam({ externalId: '4', platformUserId: 's-4', wins: 0, losses: 9, pointsFor: 5 }),
    ])
    const board = await getTournamentStandingsBoard('t1', 'commish')
    expect(board!.conferences[0].leagues[0].rows[0].displayName).toBe('emmae')
  })
})

describe('a manager whose team row could not be matched', () => {
  beforeEach(() => {
    participantFindMany.mockResolvedValue([
      { id: 'p1', tournamentLeagueId: 'tl1', participantId: 'P1', userId: 's-1', participant: { displayName: 'TyT1' } },
      { id: 'p2', tournamentLeagueId: 'tl1', participantId: 'P2', userId: 'no-match', participant: { displayName: 'ghost' } },
    ])
    leagueTeamFindMany.mockResolvedValue([
      leagueTeam({ externalId: '1', platformUserId: 's-1', wins: 7, losses: 2, pointsFor: 1300 }),
    ])
  })

  /**
   * 🛑 UNKNOWN IS NOT ZERO. Letting an unmatched row compete on a 0-0 record
   * makes a ranking claim about a manager whose season we could not read — and
   * in this format that claim ends it.
   */
  it('sorts last on unknown rather than competing on a zero, and is flagged', async () => {
    const board = await getTournamentStandingsBoard('t1', 'commish')
    const rows = board!.conferences[0].leagues[0].rows
    expect(rows[1].displayName).toBe('ghost')
    expect(rows[1].unmatched).toBe(true)
    expect(board!.unmatchedTotal).toBe(1)
  })

  /** ⚠ And it must not drag the conference's combined points down either. */
  it('is excluded from the conference points total', async () => {
    const board = await getTournamentStandingsBoard('t1', 'commish')
    expect(board!.conferences[0].conferencePoints).toBe(1300)
  })

  it('is never marked as in or on the bubble', async () => {
    const board = await getTournamentStandingsBoard('t1', 'commish')
    expect(board!.conferences[0].leagues[0].rows[1].standing).toBe('out')
  })
})

/**
 * ⚠ THE BOARD IS ONLY AS CURRENT AS ITS STALEST LEAGUE. Reporting the newest
 * timestamp lets one re-synced league present the whole tournament as fresh,
 * while the league that did not sync is the one whose managers get cut on last
 * week's points.
 */
it('reports the OLDEST team row as the board’s freshness', async () => {
  tournamentLeagueFindMany.mockResolvedValue([
    { id: 'tl1', leagueId: 'lg1', name: 'BEAST', conferenceId: 'c1' },
    { id: 'tl2', leagueId: 'lg2', name: 'GOAT', conferenceId: 'c1' },
  ])
  participantFindMany.mockResolvedValue([
    { id: 'p1', tournamentLeagueId: 'tl1', participantId: 'P1', userId: 's-1', participant: { displayName: 'a' } },
    { id: 'p2', tournamentLeagueId: 'tl2', participantId: 'P2', userId: 's-2', participant: { displayName: 'b' } },
  ])
  leagueTeamFindMany
    .mockResolvedValueOnce([
      leagueTeam({ externalId: '1', platformUserId: 's-1', lastUpdatedAt: new Date('2025-11-01T00:00:00Z') }),
    ])
    .mockResolvedValueOnce([
      leagueTeam({ externalId: '2', platformUserId: 's-2', lastUpdatedAt: new Date('2025-10-01T00:00:00Z') }),
    ])

  const board = await getTournamentStandingsBoard('t1', 'commish')
  expect(board!.oldestUpdatedAt?.toISOString()).toBe('2025-10-01T00:00:00.000Z')
})

/** A tournament still being set up has no conferences — a state, not a failure. */
it('returns an empty conference list rather than throwing during setup', async () => {
  conferenceFindMany.mockResolvedValue([])
  tournamentLeagueFindMany.mockResolvedValue([])
  const board = await getTournamentStandingsBoard('t1', 'commish')
  expect(board?.conferences).toEqual([])
})

/**
 * 🛑 THE BOARD MUST SHOW ONE ROUND, AND IT DID NOT UNTIL THE REDRAFT EXISTED.
 * Reading every `TournamentLeague` in the tournament was harmless while there
 * was only ever one round of them. The moment a redraft commits round-2 slots,
 * an unscoped read returns the old leagues AND the new ones — the same manager
 * appearing twice and ranked against himself, in the table that decides who
 * goes home.
 */
describe('which round the board shows', () => {
  it('asks only for leagues in the tournament’s current round', async () => {
    shellFindFirst.mockResolvedValue({ ...SHELL, currentRoundNumber: 3 })
    await getTournamentStandingsBoard('t1', 'commish')
    expect(tournamentLeagueFindMany.mock.calls[0][0].where).toEqual({
      tournamentId: 't1',
      round: { roundNumber: 3 },
    })
  })

  /** ⚠ A tournament that has not stamped a round yet is round 1, not round 0. */
  it('treats an unset round as the first one', async () => {
    shellFindFirst.mockResolvedValue({ ...SHELL, currentRoundNumber: 0 })
    await getTournamentStandingsBoard('t1', 'commish')
    expect(tournamentLeagueFindMany.mock.calls[0][0].where.round).toEqual({ roundNumber: 1 })
  })
})

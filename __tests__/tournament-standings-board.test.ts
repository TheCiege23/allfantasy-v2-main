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

  it('marks the top N as in, then the bubble, then out', async () => {
    const board = await getTournamentStandingsBoard('t1', 'commish')
    const rows = board!.conferences[0].leagues[0].rows
    expect(rows.map((r) => [r.displayName, r.standing])).toEqual([
      ['TyT1', 'in'],
      ['emmae', 'in'],
      ['Spokee', 'bubble'],
      ['zedlav', 'out'],
    ])
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

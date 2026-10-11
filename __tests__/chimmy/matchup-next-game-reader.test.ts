import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: vi.fn(), team: vi.fn(), teams: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { weeklyMatchup: { findMany: h.rows }, leagueTeam: { findFirst: h.team, findMany: h.teams } } }))

import { loadNextGameFromSchedule, loadNextGamesFromSchedule } from '@/lib/chimmy/matchupPreviewGrounding'

const league = { id: 'L1', name: 'HailShiva', platform: 'sleeper', platformLeagueId: '1313536441829068800' }
const q = { league, season: 2026, week: 4, yourRosterId: '1' }
const row = (rosterId: string, matchupId: number) => ({ rosterId, matchupId })

beforeEach(() => {
  vi.clearAllMocks()
  h.team.mockResolvedValue({ teamName: 'Rittnasty', ownerName: 'ritt' })
})

describe('loadNextGameFromSchedule', () => {
  it('pairs the user on matchupId in the week after the board week', async () => {
    h.rows.mockResolvedValue([row('1', 3), row('9', 3), row('2', 1), row('5', 1)])
    expect(await loadNextGameFromSchedule(q)).toEqual({ week: 5, opponentRosterId: '9', opponentName: 'Rittnasty' })
    expect(h.rows.mock.calls[0][0].where).toEqual({ leagueId: league.platformLeagueId, seasonYear: 2026, week: 5, matchupId: { not: null } })
    expect(h.team.mock.calls[0][0].where).toEqual({ leagueId: 'L1', externalId: '9' })
  })

  it('falls back to the shared roster label when no real name is stored', async () => {
    h.rows.mockResolvedValue([row('1', 3), row('9', 3)])
    h.team.mockResolvedValue({ teamName: 'Unknown', ownerName: 'Unknown' })
    expect((await loadNextGameFromSchedule(q))?.opponentName).toBe('Team 9')
  })

  it('names nobody for an unpaired week, a missing row, or a hosted league', async () => {
    h.rows.mockResolvedValue([row('1', 3)])
    expect(await loadNextGameFromSchedule(q)).toBeNull()
    h.rows.mockResolvedValue([row('1', 3), row('9', 3), row('4', 3)])
    expect(await loadNextGameFromSchedule(q)).toBeNull()
    h.rows.mockResolvedValue([row('2', 1), row('5', 1)])
    expect(await loadNextGameFromSchedule(q)).toBeNull()
    h.rows.mockClear()
    expect(await loadNextGameFromSchedule({ ...q, league: { ...league, platform: 'allfantasy', platformLeagueId: null } })).toBeNull()
    expect(h.rows).not.toHaveBeenCalled()
  })
})

describe('loadNextGamesFromSchedule — every league at once', () => {
  const l2 = { id: 'L2', name: 'Redraft', platform: 'sleeper', platformLeagueId: 'p-2' }
  const l3 = { id: 'L3', name: 'Two teams', platform: 'sleeper', platformLeagueId: 'p-3' }
  const hosted = { id: 'L4', name: 'Hosted', platform: 'allfantasy', platformLeagueId: null }
  const at = (leagueId: string, rosterId: string, matchupId: number) => ({ leagueId, seasonYear: 2026, week: 5, rosterId, matchupId })

  it('resolves each league’s own roster from the claimed team and pairs it, in three reads', async () => {
    h.teams.mockImplementation(async (args: { where: { claimedByUserId?: string } }) =>
      args.where.claimedByUserId
        ? [{ leagueId: 'L1', externalId: '1' }, { leagueId: 'L2', externalId: '6' }, { leagueId: 'L3', externalId: '2' }, { leagueId: 'L3', externalId: '8' }]
        : [{ leagueId: 'L1', externalId: '5', teamName: 'Rittnasty', ownerName: 'Rittnasty' }, { leagueId: 'L2', externalId: '3', teamName: 'Unknown', ownerName: 'Unknown' }],
    )
    h.rows.mockResolvedValue([at(league.platformLeagueId, '1', 3), at(league.platformLeagueId, '5', 3), at('p-2', '6', 2), at('p-2', '3', 2), at('p-3', '2', 1), at('p-3', '7', 1)])
    const out = await loadNextGamesFromSchedule('u1', [l2, league, l3, hosted].map((l) => ({ league: l, season: 2026, week: 4 })))
    expect([...out]).toEqual([
      ['L2', { week: 5, opponentRosterId: '3', opponentName: 'Team 3' }],
      ['L1', { week: 5, opponentRosterId: '5', opponentName: 'Rittnasty' }],
    ])
    // Two claimed teams in one league is ambiguous; a hosted league is never read.
    expect(out.has('L3')).toBe(false)
    expect(h.teams.mock.calls[0][0].where).toEqual({ leagueId: { in: ['L2', 'L1', 'L3'] }, claimedByUserId: 'u1' })
    expect(h.rows).toHaveBeenCalledTimes(1)
    expect(h.teams).toHaveBeenCalledTimes(2)
  })

  it('reads nothing past a league with no claimed team', async () => {
    h.teams.mockResolvedValue([])
    expect((await loadNextGamesFromSchedule('u1', [{ league, season: 2026, week: 4 }])).size).toBe(0)
    expect(h.rows).not.toHaveBeenCalled()
  })
})

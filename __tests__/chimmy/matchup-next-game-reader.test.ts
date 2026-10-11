import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rows: vi.fn(), team: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { weeklyMatchup: { findMany: h.rows }, leagueTeam: { findFirst: h.team } } }))

import { loadNextGameFromSchedule } from '@/lib/chimmy/matchupPreviewGrounding'

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

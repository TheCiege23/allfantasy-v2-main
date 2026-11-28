/**
 * Rule 2 of a switching league: once the league is official on AllFantasy, a trade here needs every team in it
 * to have switched. A team still on the old platform has its roster copied in from there, so a trade made here
 * would be undone by the next copy. Before the league is official nothing changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  redraftRosterFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    leagueTeam: { findMany: h.leagueTeamFindMany },
    roster: { findMany: h.rosterFindMany },
    redraftRoster: { findMany: h.redraftRosterFindMany },
  },
}))

import { leagueTradeTeamsNotOnAllFantasy, tradeTeamsNotOnAllFantasy } from '@/lib/league/switching/switchedTeamsServer'
import { tradeTeamNotSwitchedMessage } from '@/lib/league/switching/switchingLeague'

const stamp = { at: '2026-11-27T00:00:00.000Z', byUserId: 'commish' }
const settings = (official: boolean) => ({ switching: { official: official ? stamp : null, teams: { 'team-1': stamp } } })

beforeEach(() => {
  vi.resetAllMocks()
  h.leagueTeamFindMany.mockResolvedValue([
    { id: 'team-1', externalId: '1', teamName: 'Switched Squad' },
    { id: 'team-2', externalId: '2', teamName: 'Still On Sleeper' },
  ])
  h.rosterFindMany.mockResolvedValue([
    { id: 'roster-1', redraftRosterId: 'rr-1', playerData: { source_team_id: '1' } },
    { id: 'roster-2', redraftRosterId: 'rr-2', playerData: { source_team_id: '2' } },
  ])
  h.redraftRosterFindMany.mockResolvedValue([{ id: 'rr-2', teamName: 'Still On Sleeper', ownerName: 'b' }])
})

describe('trades in a switching league', () => {
  it('official: a redraft trade with a team that has not switched names that team', async () => {
    h.leagueFindUnique.mockResolvedValue({ settings: settings(true) })
    expect(await tradeTeamsNotOnAllFantasy('L1', ['rr-1', 'rr-2'])).toEqual([{ rosterId: 'rr-2', name: 'Still On Sleeper' }])
  })

  it('official: a league trade engine trade with a team that has not switched names that team', async () => {
    h.leagueFindUnique.mockResolvedValue({ settings: settings(true) })
    expect(await leagueTradeTeamsNotOnAllFantasy('L1', ['roster-1', 'roster-2'])).toEqual([
      { rosterId: 'roster-2', name: 'Still On Sleeper' },
    ])
  })

  it('official: two switched teams may trade', async () => {
    h.leagueFindUnique.mockResolvedValue({
      settings: { switching: { official: stamp, teams: { 'team-1': stamp, 'team-2': stamp } } },
    })
    expect(await tradeTeamsNotOnAllFantasy('L1', ['rr-1', 'rr-2'])).toEqual([])
    expect(await leagueTradeTeamsNotOnAllFantasy('L1', ['roster-1', 'roster-2'])).toEqual([])
  })

  it('control, not official: nothing is refused and no team is read', async () => {
    h.leagueFindUnique.mockResolvedValue({ settings: settings(false) })
    expect(await tradeTeamsNotOnAllFantasy('L1', ['rr-1', 'rr-2'])).toEqual([])
    expect(await leagueTradeTeamsNotOnAllFantasy('L1', ['roster-1', 'roster-2'])).toEqual([])
    expect(h.leagueTeamFindMany).not.toHaveBeenCalled()
  })

  it('says which team and where to trade instead', () => {
    expect(tradeTeamNotSwitchedMessage(['Still On Sleeper'], 'Sleeper')).toBe(
      "Still On Sleeper hasn't switched to AllFantasy yet, so this trade has to happen on Sleeper. Trades here need every team to have switched.",
    )
    expect(tradeTeamNotSwitchedMessage(['A', 'B'], null)).toMatch(/^A and B haven't switched/)
  })
})

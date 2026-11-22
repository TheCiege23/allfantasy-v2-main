import { describe, expect, it } from 'vitest'

import { activeTeamsCookieAfterSwitch, chooseActingTeam, requestedRosterIdFrom } from '@/lib/league/viewerTeams'
import { isOwnTeamTrade } from '@/lib/league-trade-engine/ownTeamTrade'

const A = { rosterId: 'rA', redraftRosterId: 'seasonA' }
const B = { rosterId: 'rB', redraftRosterId: null }

describe('which team a manager is acting as', () => {
  it('one team: that team, whether or not it is named', () => {
    expect(chooseActingTeam([A], null)).toMatchObject({ ok: true, rosterId: 'rA', heldCount: 1 })
    expect(chooseActingTeam([A], 'rA')).toMatchObject({ ok: true, rosterId: 'rA' })
  })

  it('several teams and none named is refused, never guessed', () => {
    expect(chooseActingTeam([A, B], null)).toMatchObject({ ok: false, code: 'TEAM_REQUIRED', status: 409, rosterIds: ['rA', 'rB'] })
    expect(chooseActingTeam([A, B], '  ')).toMatchObject({ ok: false, code: 'TEAM_REQUIRED' })
  })

  it('several teams: the named one, by roster id or by its season roster id', () => {
    expect(chooseActingTeam([A, B], 'rB')).toMatchObject({ ok: true, rosterId: 'rB', heldCount: 2 })
    expect(chooseActingTeam([A, B], 'seasonA')).toMatchObject({ ok: true, rosterId: 'rA' })
  })

  it('a team the manager does not hold is refused, even with only one team', () => {
    expect(chooseActingTeam([A], 'someone-elses')).toMatchObject({ ok: false, code: 'NOT_YOUR_TEAM', status: 403 })
    expect(chooseActingTeam([A, B], 'someone-elses')).toMatchObject({ ok: false, code: 'NOT_YOUR_TEAM' })
  })

  it('no team at all', () => {
    expect(chooseActingTeam([], null)).toMatchObject({ ok: false, code: 'NO_TEAM', status: 404 })
  })

  it('reads the named team from the header, then the query, then the body', () => {
    const req = (header: string | null, query: string | null) => ({
      headers: { get: (name: string) => (name === 'x-af-roster-id' ? header : null) },
      nextUrl: { searchParams: new URLSearchParams(query ? { rosterId: query } : {}) },
    })
    expect(requestedRosterIdFrom(req('h', 'q'), { rosterId: 'b' })).toBe('h')
    expect(requestedRosterIdFrom(req(null, 'q'), { rosterId: 'b' })).toBe('q')
    expect(requestedRosterIdFrom(req(null, null), { rosterId: 'b' })).toBe('b')
    expect(requestedRosterIdFrom(req(null, null), {})).toBeNull()
  })
})

describe('trading between your own teams', () => {
  const me = new Set(['me', 'my-second-account'])
  it('is a trade whose two teams belong to one manager, under one account or two linked ones', () => {
    expect(isOwnTeamTrade([{ id: 'r1', platformUserId: 'me' }, { id: 'r2', platformUserId: 'me' }], me)).toBe(true)
    expect(isOwnTeamTrade([{ id: 'r1', platformUserId: 'me' }, { id: 'r2', platformUserId: 'my-second-account' }], me)).toBe(true)
  })
  it('is not a trade with another manager, or a three-team trade with two other managers', () => {
    expect(isOwnTeamTrade([{ id: 'r1', platformUserId: 'me' }, { id: 'r2', platformUserId: 'someone' }], me)).toBe(false)
    expect(isOwnTeamTrade([{ id: 'r1', platformUserId: 'me' }, { id: 'r2', platformUserId: 'x' }, { id: 'r3', platformUserId: 'y' }], me)).toBe(false)
  })
  it('catches two of one other manager\'s teams in a multi-team trade', () => {
    expect(isOwnTeamTrade([{ id: 'r1', platformUserId: 'me' }, { id: 'r2', platformUserId: 'x' }, { id: 'r3', platformUserId: 'x' }], me)).toBe(true)
  })
})

import { multiTeamManagersSupported, readAllowMultiTeamManagers } from '@/lib/league/multiTeamManagers'

describe('which leagues can let a manager run several teams', () => {
  it('standard leagues can', () => {
    expect(multiTeamManagersSupported({ leagueType: 'dynasty', leagueVariant: null, settings: {} })).toBe(true)
    expect(readAllowMultiTeamManagers({ allow_multi_team_managers: true, league_type: 'redraft' })).toBe(true)
  })
  it('one-seat-per-person formats cannot, even if the setting was stored', () => {
    expect(multiTeamManagersSupported({ leagueVariant: 'survivor_guillotine' })).toBe(false)
    expect(multiTeamManagersSupported({ leagueType: 'big_brother' })).toBe(false)
    expect(readAllowMultiTeamManagers({ allow_multi_team_managers: true, league_type: 'zombie' })).toBe(false)
  })
  it('is off unless stored true', () => {
    expect(readAllowMultiTeamManagers({ league_type: 'dynasty' })).toBe(false)
    expect(readAllowMultiTeamManagers({ allow_multi_team_managers: 'yes' })).toBe(false)
  })
})

describe('the active team a manager switched to', () => {
  const req = (cookie: string | null, header: string | null = null) => ({
    headers: { get: (name: string) => (name === 'x-af-roster-id' ? header : null) },
    nextUrl: { searchParams: new URLSearchParams() },
    cookies: { get: (name: string) => (name === 'af_active_teams' && cookie ? { value: cookie } : undefined) },
  })
  const held = [{ rosterId: 'roster-a1', redraftRosterId: null }, { rosterId: 'roster-b2', redraftRosterId: null }]

  it('is used when nothing is named, so a manager with several teams is not refused', () => {
    expect(chooseActingTeam(held, requestedRosterIdFrom(req('other-league-team.roster-b2')))).toMatchObject({ ok: true, rosterId: 'roster-b2' })
  })
  it('a remembered team that is no longer held is ignored, not refused: with several teams one must still be named', () => {
    expect(chooseActingTeam(held, requestedRosterIdFrom(req('roster-gone9')))).toMatchObject({ ok: false, code: 'TEAM_REQUIRED' })
    expect(chooseActingTeam([held[0]!], requestedRosterIdFrom(req('roster-gone9')))).toMatchObject({ ok: true, rosterId: 'roster-a1' })
  })
  it('a team named on the request wins over the remembered one, and is refused when not held', () => {
    expect(chooseActingTeam(held, requestedRosterIdFrom(req('roster-b2', 'roster-a1')))).toMatchObject({ ok: true, rosterId: 'roster-a1' })
    expect(chooseActingTeam(held, requestedRosterIdFrom(req('roster-b2', 'someone-elses')))).toMatchObject({ ok: false, code: 'NOT_YOUR_TEAM' })
  })
  it('switching replaces the league\'s other team in the remembered list and keeps other leagues', () => {
    expect(activeTeamsCookieAfterSwitch('roster-a1.other-league-team', 'roster-b2', ['roster-a1', 'roster-b2'])).toBe('roster-b2.other-league-team')
    expect(activeTeamsCookieAfterSwitch('not a valid id!.x', 'roster-a1', ['roster-a1'])).toBe('roster-a1')
  })
})

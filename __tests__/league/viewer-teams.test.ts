import { describe, expect, it } from 'vitest'

import { chooseActingTeam, requestedRosterIdFrom } from '@/lib/league/viewerTeams'
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

import { describe, expect, it } from 'vitest'

import { chooseDraftRosterId } from '@/lib/live-draft-engine/onClockRoster'

describe('which of a manager\'s teams the draft room is about', () => {
  const mine = ['team-a', 'team-b', 'team-c']

  it('one team is that team, whatever is on the clock', () => {
    expect(chooseDraftRosterId({ rosterIds: ['team-a'], onClockRosterId: 'someone-else' })).toBe('team-a')
  })
  it('no team is no team', () => {
    expect(chooseDraftRosterId({ rosterIds: [], onClockRosterId: 'team-a' })).toBeNull()
  })
  it('the team on the clock wins, so a manager is up whenever any of their teams is', () => {
    expect(chooseDraftRosterId({ rosterIds: mine, onClockRosterId: 'team-b', rememberedRosterIds: ['team-c'] })).toBe('team-b')
  })
  it('when another manager is on the clock, it is the team they last switched to, else their first', () => {
    expect(chooseDraftRosterId({ rosterIds: mine, onClockRosterId: 'someone-else', rememberedRosterIds: ['other-league', 'team-c'] })).toBe('team-c')
    expect(chooseDraftRosterId({ rosterIds: mine, onClockRosterId: 'someone-else' })).toBe('team-a')
    expect(chooseDraftRosterId({ rosterIds: mine, onClockRosterId: null, rememberedRosterIds: ['gone'] })).toBe('team-a')
  })
  it('a team named on the request wins over the clock, but only if the manager holds it', () => {
    expect(chooseDraftRosterId({ rosterIds: mine, requestedRosterId: 'team-c', onClockRosterId: 'team-b' })).toBe('team-c')
    expect(chooseDraftRosterId({ rosterIds: mine, requestedRosterId: 'someone-else', onClockRosterId: 'team-b' })).toBe('team-b')
  })
})

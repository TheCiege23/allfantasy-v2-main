import { describe, expect, it } from 'vitest'

import { extraTeamOwnerKey, isExtraTeamOwnerKey, isRosterManagedBy, managedRosterWhere, rosterManagerKey } from '@/lib/league/rosterManager'
import { isOwnTeamTrade } from '@/lib/league-trade-engine/ownTeamTrade'

describe('who runs a team', () => {
  const first = { platformUserId: 'u1', managerUserId: null }
  const second = { platformUserId: extraTeamOwnerKey('u1', 'roster-2'), managerUserId: 'u1' }

  it('a further team has a key of its own that is not a user id', () => {
    expect(second.platformUserId).toBe('mgr:u1:roster-2')
    expect(isExtraTeamOwnerKey(second.platformUserId)).toBe(true)
    expect(isExtraTeamOwnerKey('u1')).toBe(false)
    expect(extraTeamOwnerKey('u1', 'roster-3')).not.toBe(second.platformUserId)
  })

  it('both the first team and a further team are run by the manager, and by nobody else', () => {
    expect(isRosterManagedBy(first, 'u1')).toBe(true)
    expect(isRosterManagedBy(second, 'u1')).toBe(true)
    expect(isRosterManagedBy(second, 'u2')).toBe(false)
    expect(isRosterManagedBy(second, null)).toBe(false)
    expect(isRosterManagedBy(null, 'u1')).toBe(false)
  })

  it('compares managers by the named manager, else the owner key', () => {
    expect(rosterManagerKey(first)).toBe('u1')
    expect(rosterManagerKey(second)).toBe('u1')
    expect(rosterManagerKey({ platformUserId: 'sleeper-123' })).toBe('sleeper-123')
  })

  it('finds every team a manager runs in a league', () => {
    expect(managedRosterWhere('L1', 'u1')).toEqual({ leagueId: 'L1', OR: [{ platformUserId: 'u1' }, { managerUserId: 'u1' }] })
  })

  it('a trade between a manager\'s first and second team is an own-team trade', () => {
    expect(isOwnTeamTrade([{ id: 'r1', ...first }, { id: 'r2', ...second }], new Set(['someone-else']))).toBe(true)
    expect(isOwnTeamTrade([{ id: 'r1', ...first }, { id: 'r2', platformUserId: 'u2', managerUserId: null }], new Set(['u1']))).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { chooseKeptCopy, planDuplicateLeagueMerge, type MergeCopy } from '@/lib/league-import/duplicateLeagueMerge'
import {
  IMPORT_CO_COMMISSIONERS_KEY,
  isTournamentCoCommissioner,
  teamlessCoCommissionerIds,
  TOURNAMENT_CO_COMMISSIONERS_KEY,
  tournamentCoCommissionerIds,
} from '@/lib/league/tournamentCoCommissioners'

/** Shape of the KBI duplicates (2026-11-17): a deleted account's copy holds the live draft, a commissioner's re-import does not. */
function copy(over: Partial<MergeCopy> & { id: string; userId: string }): MergeCopy {
  return {
    ownerDeleted: false,
    createdAt: new Date('2026-09-15'),
    hasMirroredDraft: false,
    teams: [
      { id: `${over.id}-t1`, externalId: '1', claimedByUserId: null },
      { id: `${over.id}-t2`, externalId: '2', claimedByUserId: null },
      { id: `${over.id}-t3`, externalId: '3', claimedByUserId: null },
    ],
    rosters: [
      { id: `${over.id}-r1`, sourceTeamId: '1', platformUserId: 'sleeper-1' },
      { id: `${over.id}-r2`, sourceTeamId: '2', platformUserId: 'sleeper-2' },
      { id: `${over.id}-r3`, sourceTeamId: '3', platformUserId: 'sleeper-3' },
    ],
    chatMessageCount: 0,
    blockingRowCount: 0,
    teamlessCoCommissionerIds: [],
    ...over,
  }
}

const withClaim = (c: MergeCopy, ext: string, userId: string): MergeCopy => ({
  ...c,
  teams: c.teams.map((t) => (t.externalId === ext ? { ...t, claimedByUserId: userId } : t)),
})

describe('chooseKeptCopy', () => {
  it('keeps the copy with the mirrored draft even when it is not the oldest', () => {
    const older = copy({ id: 'a', userId: 'u-a', createdAt: new Date('2026-08-01') })
    const live = copy({ id: 'b', userId: 'u-b', hasMirroredDraft: true })
    expect(chooseKeptCopy([older, live]).id).toBe('b')
  })
  it('then prefers a deleted owner (nobody can manage it otherwise), then the oldest', () => {
    const mine = copy({ id: 'a', userId: 'u-a', createdAt: new Date('2026-08-01') })
    const orphan = copy({ id: 'b', userId: 'gone', ownerDeleted: true })
    expect(chooseKeptCopy([mine, orphan]).id).toBe('b')
    expect(chooseKeptCopy([copy({ id: 'x', userId: 'u', createdAt: new Date('2026-10-01') }), mine]).id).toBe('a')
  })
})

describe('planDuplicateLeagueMerge', () => {
  const keep = copy({ id: 'keep', userId: 'deleted-owner', ownerDeleted: true, hasMirroredDraft: true })
  const reimport = copy({ id: 'dup', userId: 'kingb', createdAt: new Date('2026-10-06'), chatMessageCount: 2 })

  it('hands a deleted owner’s league to the named commissioner and moves chat', () => {
    const plan = planDuplicateLeagueMerge([keep, reimport], { commissionerUserId: 'kingb' })
    expect(plan.keepId).toBe('keep')
    expect(plan.removeIds).toEqual(['dup'])
    expect(plan.transferOwnerTo).toBe('kingb')
    expect(plan.addCoCommissioner).toBeNull()
    expect(plan.chatMessagesToMove).toBe(2)
    expect(plan.losesAccess).toEqual([])
  })

  it('moves a claim that exists only in the removed copy onto the same team', () => {
    const plan = planDuplicateLeagueMerge([keep, withClaim(reimport, '2', 'manager-m')], { commissionerUserId: 'kingb' })
    expect(plan.claimMoves).toEqual([{ userId: 'manager-m', externalId: '2', keepTeamId: 'keep-t2', keepRosterId: 'keep-r2' }])
  })

  it('never takes a team someone else holds, nor gives one person two teams', () => {
    const kept = withClaim(withClaim(keep, '1', 'holder'), '3', 'manager-m')
    const removed = withClaim(withClaim(reimport, '1', 'manager-x'), '2', 'manager-m')
    const plan = planDuplicateLeagueMerge([kept, removed])
    expect(plan.claimMoves).toEqual([])
    expect(plan.conflicts.map((c) => c.reason)).toEqual([
      'team already claimed by someone else in the kept copy',
      'already holds team 3 in the kept copy',
    ])
  })

  it('a claim already in place in the kept copy is not a move', () => {
    const plan = planDuplicateLeagueMerge([withClaim(keep, '2', 'manager-m'), withClaim(reimport, '2', 'manager-m')])
    expect(plan.claimMoves).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('adds the commissioner as co-commissioner where the kept copy has a live owner', () => {
    const liveOwner = copy({ id: 'keep', userId: 'owner-o', hasMirroredDraft: true })
    const plan = planDuplicateLeagueMerge([liveOwner, reimport], { commissionerUserId: 'kingb' })
    expect(plan.transferOwnerTo).toBeNull()
    expect(plan.addCoCommissioner).toBe('kingb')
  })

  it('reports, never fixes, an owner of a removed copy left with no way in', () => {
    const third = copy({ id: 'dup2', userId: 'stranded', createdAt: new Date('2026-09-01') })
    const plan = planDuplicateLeagueMerge([keep, reimport, third], { commissionerUserId: 'kingb' })
    expect(plan.losesAccess).toEqual(['stranded'])
  })

  it('refuses a group whose removed copy has a LeagueSafe connection', () => {
    const plan = planDuplicateLeagueMerge([keep, { ...reimport, blockingRowCount: 1 }])
    expect(plan.blocked).toMatch(/LeagueSafe/)
    expect(plan.claimMoves).toEqual([])
  })
})

describe('teamless co-commissioners: tournament and import keys', () => {
  const settings = { [TOURNAMENT_CO_COMMISSIONERS_KEY]: ['t-1'], [IMPORT_CO_COMMISSIONERS_KEY]: ['i-1', 'i-1'] }
  it('permission check reads both lists', () => {
    expect(isTournamentCoCommissioner(settings, 't-1')).toBe(true)
    expect(isTournamentCoCommissioner(settings, 'i-1')).toBe(true)
    expect(isTournamentCoCommissioner(settings, 'nobody')).toBe(false)
    expect(teamlessCoCommissionerIds(settings)).toEqual(['t-1', 'i-1'])
  })
  it('the tournament list stays tournament-only, because the tournament sync diffs against it', () => {
    expect(tournamentCoCommissionerIds(settings)).toEqual(['t-1'])
  })
})

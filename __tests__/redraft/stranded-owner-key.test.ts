/**
 * The evidence rule that authorises re-keying a redraft roster.
 *
 * 🛑 THIS IS THE ONLY THING STANDING BETWEEN "THIS KEY BELONGS TO NOBODY HERE" AND A WRITE THAT
 * MOVES A TEAM'S ROSTER. `RedraftRoster.ownerId` is written once, at season materialization, and
 * nothing re-keys it when a team changes manager; `reconcileRosterRedraftLinks` may repoint such a
 * row at the team that demonstrably owns it, but only because these two functions say the key is
 * carried by no team in the league. A false "stranded" is a write against a live manager's row.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isStrandedRedraftOwnerId, liveTeamOwnerKeys } from '@/lib/redraft/redraftRosterIdentity'

const team = (over: Partial<{ id: string; platformUserId: string | null; claimedByUserId: string | null }> = {}) => ({
  id: 'team-1',
  platformUserId: null,
  claimedByUserId: null,
  ...over,
})

describe('liveTeamOwnerKeys — every key a league currently answers to', () => {
  it('collects the team row id, the platform manager id and the claimant', () => {
    const keys = liveTeamOwnerKeys([team({ platformUserId: '111', claimedByUserId: 'af-uuid' })])
    expect([...keys].sort()).toEqual(['111', 'af-uuid', 'team-1'])
  })

  it('🛑 counts a CLAIMED team, whose manager id moved to the claimant', () => {
    // Claiming rewrites the key on the roster side; the redraft row may still hold either. Both are
    // live, and treating the old one as forgotten would re-key a row somebody is using.
    const keys = liveTeamOwnerKeys([team({ platformUserId: null, claimedByUserId: 'af-uuid' })])
    expect(keys.has('af-uuid')).toBe(true)
  })

  it('ignores null and blank keys rather than storing them', () => {
    const keys = liveTeamOwnerKeys([team({ platformUserId: '   ', claimedByUserId: null })])
    expect([...keys]).toEqual(['team-1'])
  })

  it('spans every team it is given', () => {
    const keys = liveTeamOwnerKeys([team(), team({ id: 'team-2', platformUserId: '222' })])
    expect([...keys].sort()).toEqual(['222', 'team-1', 'team-2'])
  })
})

describe('isStrandedRedraftOwnerId', () => {
  const live = liveTeamOwnerKeys([team({ platformUserId: '111' }), team({ id: 'team-2', claimedByUserId: 'af' })])

  it('a key no team carries is stranded', () => {
    expect(isStrandedRedraftOwnerId('999', live)).toBe(true)
  })

  it('a key a team carries is not', () => {
    expect(isStrandedRedraftOwnerId('111', live)).toBe(false)
    expect(isStrandedRedraftOwnerId('team-2', live)).toBe(false)
    expect(isStrandedRedraftOwnerId('af', live)).toBe(false)
  })

  it('🛑 an EMPTY key is not stranded — it identifies nobody, so nothing can be concluded', () => {
    /*
     * The tempting reading is that a blank owner belongs to no team and is therefore safe to
     * overwrite. It is the opposite: "stranded" is a claim about a REAL id that the league has
     * forgotten, and a blank is not a real id. Answering true here would let the reconciler re-key
     * any empty-owner row it found beside an unlinked roster, on no evidence at all.
     */
    expect(isStrandedRedraftOwnerId('', live)).toBe(false)
    expect(isStrandedRedraftOwnerId('   ', live)).toBe(false)
    expect(isStrandedRedraftOwnerId(null, live)).toBe(false)
    expect(isStrandedRedraftOwnerId(undefined, live)).toBe(false)
  })

  it('compares after trimming, so a padded key is still recognised as live', () => {
    expect(isStrandedRedraftOwnerId('  111  ', live)).toBe(false)
  })
})

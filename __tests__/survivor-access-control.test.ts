import { describe, expect, it } from 'vitest'
import { buildSurvivorAccessContextFromSnapshot, canSeeSurvivorChannel } from '@/lib/survivor/survivorAccessControl'

describe('Survivor access control', () => {
  it('allows a non-playing commissioner to operate the council while sealed information stays private', () => {
    const access = buildSurvivorAccessContextFromSnapshot({
      leagueId: 'league-1',
      userId: 'commish',
      role: 'commissioner',
      settings: { commissionerParticipationMode: 'non_participating_host' },
      player: null,
      roster: null,
    })

    expect(access.isNonParticipatingCommissionerHost).toBe(true)
    expect(access.isParticipatingCommissioner).toBe(false)
    expect(access.decisions.canSeeHiddenIdolAssignments).toBe(false)
    expect(access.decisions.canSeePrivateVotes).toBe(false)
    expect(access.decisions.canPerformSensitiveHostAction).toBe(true)
  })

  it('treats a playing commissioner as a normal player for hidden information', () => {
    const access = buildSurvivorAccessContextFromSnapshot({
      leagueId: 'league-1',
      userId: 'commish',
      role: 'commissioner',
      settings: { commissionerParticipationMode: 'participating_player' },
      player: {
        userId: 'commish',
        playerState: 'active',
        tribeId: 'tribe-a',
        redraftRosterId: 'roster-a',
        canAccessTribeChat: true,
      },
      roster: { id: 'roster-a' },
    })

    expect(access.isCommissionerParticipating).toBe(true)
    expect(access.isParticipatingCommissioner).toBe(true)
    expect(access.decisions.canSeeHiddenIdolAssignments).toBe(false)
    expect(access.decisions.canSeePrivateVotes).toBe(false)
    expect(access.decisions.canPerformAdminAction).toBe(true)
    expect(access.decisions.canPerformSensitiveHostAction).toBe(false)
    expect(access.privacyWarnings.join(' ')).toContain('Playing commissioners')
  })

  it('never grants private DMs to hosts unless they are channel members', () => {
    const access = buildSurvivorAccessContextFromSnapshot({
      leagueId: 'league-1',
      userId: 'host',
      role: 'commissioner',
      settings: {},
    })

    expect(access.decisions.canSeePrivateUserDm).toBe(false)
  })
})

describe('Survivor blind-mode bypass prevention', () => {
  it.each(['commissioner', 'co_commissioner'] as const)('a %s with a roster cannot promote themselves to hidden host visibility', role => {
    const access = buildSurvivorAccessContextFromSnapshot({ leagueId: 'l', userId: 'u', role,
      settings: { commissionerParticipationMode: 'non_participating_host', coCommissionerMode: 'non_participating_host' }, roster: { id: 'r' } })
    expect(access.isParticipatingCommissioner).toBe(true)
    expect(access.decisions.canSeePrivateVotes).toBe(false)
    expect(access.decisions.canSeeHiddenIdolAssignments).toBe(false)
    expect(access.decisions.canPerformSensitiveHostAction).toBe(false)
    expect(access.decisions.canUpdateSettings).toBe(true)
  })
  it('elimination does not grant a playing commissioner host access or stale tribe membership', () => {
    const access = buildSurvivorAccessContextFromSnapshot({ leagueId: 'l', userId: 'u', role: 'commissioner',
      player: { userId: 'u', playerState: 'exile', tribeId: 'old', canAccessTribeChat: false, canAccessMergeChat: false } })
    expect(access.decisions.canSeePrivateVotes).toBe(false)
    expect(canSeeSurvivorChannel(access, { channelType: 'tribe', tribeId: 'old', memberUserIds: ['u'] })).toBe(false)
    expect(canSeeSurvivorChannel(access, { channelType: 'merge', memberUserIds: ['u'] })).toBe(false)
  })
  it('null tribe ids cannot accidentally grant private tribe access', () => {
    const access = buildSurvivorAccessContextFromSnapshot({ leagueId: 'l', userId: 'u', role: 'member', roster: { id: 'r' } })
    expect(canSeeSurvivorChannel(access, { channelType: 'tribe', tribeId: null })).toBe(false)
  })
})

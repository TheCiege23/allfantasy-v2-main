import { describe, expect, it } from 'vitest'
import { resolveViewerLeagueCommissioner } from '@/lib/dashboard/get-dashboard-league-list'

describe('resolveViewerLeagueCommissioner', () => {
  const owner = 'owner-id'
  const member = 'member-id'

  it('returns true when viewer owns a manual league row', () => {
    expect(
      resolveViewerLeagueCommissioner({
        platform: 'manual',
        leagueRowOwnerId: owner,
        viewerUserId: owner,
        leagueIsCommissionerFlag: true,
      }),
    ).toBe(true)
  })

  it('returns true when viewer is COMMISSIONER via RedraftLeagueMember (not league row owner)', () => {
    expect(
      resolveViewerLeagueCommissioner({
        platform: 'manual',
        leagueRowOwnerId: owner,
        viewerUserId: member,
        leagueIsCommissionerFlag: false,
        membershipRole: 'COMMISSIONER',
      }),
    ).toBe(true)
  })

  it('returns false for unrelated member without commissioner role', () => {
    expect(
      resolveViewerLeagueCommissioner({
        platform: 'manual',
        leagueRowOwnerId: owner,
        viewerUserId: member,
        leagueIsCommissionerFlag: false,
        membershipRole: 'MEMBER',
      }),
    ).toBe(false)
  })

  it('returns true when viewer team row is commissioner', () => {
    expect(
      resolveViewerLeagueCommissioner({
        platform: 'sleeper',
        leagueRowOwnerId: owner,
        viewerUserId: member,
        leagueIsCommissionerFlag: false,
        membershipRole: 'MEMBER',
        team: { isCommissioner: true, isCoCommissioner: false },
      }),
    ).toBe(true)
  })

  it('returns true for co-commissioner team row', () => {
    expect(
      resolveViewerLeagueCommissioner({
        platform: 'manual',
        leagueRowOwnerId: owner,
        viewerUserId: member,
        leagueIsCommissionerFlag: false,
        team: { isCommissioner: false, isCoCommissioner: true },
      }),
    ).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'

import {
  buildFranchiseView,
  describeCrossPlatformTrade,
  settleCrossPlatformTrade,
  type FranchiseMember,
  type TradeLeg,
} from '@/lib/franchise/franchiseLink'

/**
 * The setup this exists for: one manager, NFL side on Sleeper, college side on
 * Fantrax, one franchise in his head. He agrees a deal that moves a player on
 * each platform.
 *
 * ⚠ Neither platform can enforce the other's half — Sleeper's API is read-only
 * and Fantrax arrives as a CSV upload. So the deal can land on one side and not
 * the other, and NEITHER PLATFORM WILL FLAG IT: each one only ever saw a legal,
 * complete trade of its own. We are the only party holding both halves.
 */

const PRO: FranchiseMember = {
  role: 'pro',
  platform: 'sleeper',
  leagueId: 'league-nfl',
  teamExternalId: 'team-7',
  leaguePresent: true,
}
const COLLEGE: FranchiseMember = {
  role: 'college',
  platform: 'fantrax',
  leagueId: 'fantrax-cfb',
  teamExternalId: 'Dynasty Warriors',
  leaguePresent: true,
}

describe('the combined franchise view', () => {
  it('reports complete when both halves resolve to a league and a team', () => {
    const v = buildFranchiseView({ linkId: 'l1', name: 'My Franchise', members: [PRO, COLLEGE] })
    expect(v.complete).toBe(true)
    expect(v.gaps).toEqual([])
    expect(v.basis).toMatch(/one franchise across/)
  })

  it('says which half is missing rather than showing a one-sided view as whole', () => {
    const v = buildFranchiseView({ linkId: 'l1', name: 'My Franchise', members: [PRO] })
    expect(v.complete).toBe(false)
    expect(v.gaps.join(' ')).toMatch(/no college league is linked/)
  })

  /**
   * ⚠ There is no foreign key from the link to a league — the pro side lives in
   * `leagues` and the college side in `FantraxLeague`, so the reference is loose
   * and a league can vanish underneath a link.
   */
  it('treats a vanished league as absence rather than assuming it is live', () => {
    const v = buildFranchiseView({
      linkId: 'l1',
      name: 'My Franchise',
      members: [PRO, { ...COLLEGE, leaguePresent: false }],
    })
    expect(v.complete).toBe(false)
    expect(v.gaps.join(' ')).toMatch(/no longer exists/)
  })

  /**
   * ⚠ Defaulting to the first roster would attribute a stranger's players to him
   * and then grade trades against them.
   */
  it('refuses to guess which team is his when unmatched', () => {
    const v = buildFranchiseView({
      linkId: 'l1',
      name: 'My Franchise',
      members: [PRO, { ...COLLEGE, teamExternalId: null }],
    })
    expect(v.complete).toBe(false)
    expect(v.gaps.join(' ')).toMatch(/it is not assumed/)
  })
})

const leg = (role: 'pro' | 'college', status: TradeLeg['status']): TradeLeg => ({
  role,
  platform: role === 'pro' ? 'sleeper' : 'fantrax',
  sends: role === 'pro' ? ['Bijan Robinson'] : ['Jeremiah Smith'],
  receives: role === 'pro' ? ['Puka Nacua'] : ['Arch Manning'],
  status,
})

describe('settlement — the half-landed deal is the point', () => {
  it('both halves seen is settled', () => {
    const s = settleCrossPlatformTrade([leg('pro', 'observed'), leg('college', 'observed')])
    expect(s.status).toBe('settled')
    expect(s.unbalanced).toBe(false)
    expect(s.outstanding).toEqual([])
  })

  it('neither half seen is pending, and not yet a problem', () => {
    const s = settleCrossPlatformTrade([leg('pro', 'pending'), leg('college', 'pending')])
    expect(s.status).toBe('pending')
    expect(s.unbalanced).toBe(false)
  })

  /**
   * ⚠ THE STATE THE WHOLE FEATURE EXISTS FOR. One side has what it wanted, the
   * other has half, and both platforms think everything is fine.
   */
  it('one half landed and the other not is PARTIAL and flagged unbalanced', () => {
    const s = settleCrossPlatformTrade([leg('pro', 'observed'), leg('college', 'pending')])

    expect(s.status).toBe('partial')
    expect(s.unbalanced).toBe(true)
    expect(s.observed).toEqual(['pro'])
    expect(s.outstanding).toEqual(['college'])
    expect(s.basis).toMatch(/franchises are unbalanced/)
    expect(s.basis).toMatch(/neither platform will flag it/)
  })

  /**
   * ⚠ `contradicted` is not `pending`. Pending means we have not looked;
   * contradicted means we looked and it did not happen. Collapsing them lets an
   * abandoned deal sit forever as "still waiting".
   */
  it('a leg we checked and found undone is contradicted, not pending', () => {
    const s = settleCrossPlatformTrade([leg('pro', 'pending'), leg('college', 'contradicted')])
    expect(s.status).toBe('contradicted')
    expect(s.unbalanced).toBe(false)
    expect(s.basis).toMatch(/did not go through/)
  })

  it('a contradicted leg alongside a landed one is the urgent case', () => {
    const s = settleCrossPlatformTrade([leg('pro', 'observed'), leg('college', 'contradicted')])
    expect(s.status).toBe('contradicted')
    expect(s.unbalanced).toBe(true)
    expect(s.basis).toMatch(/now unbalanced/)
  })

  it('always says we cannot execute either half', () => {
    const s = settleCrossPlatformTrade([leg('pro', 'observed'), leg('college', 'observed')])
    expect(s.gaps.join(' ')).toMatch(/cannot execute either half/)
  })

  it('no legs settles to pending rather than claiming success', () => {
    const s = settleCrossPlatformTrade([])
    expect(s.status).toBe('pending')
    expect(s.basis).toMatch(/nothing to settle/)
  })
})

describe('a cross-platform trade is never one number', () => {
  /**
   * ⚠ Belonging to one franchise does not create an exchange rate between a
   * market-priced NFL asset and a college player nobody prices. Same rule as
   * refuseMixedScaleGrade, at franchise scope.
   */
  it('reports each leg separately and returns no combined verdict', () => {
    const d = describeCrossPlatformTrade([leg('pro', 'pending'), leg('college', 'pending')])

    expect(d.combinedVerdict).toBeNull()
    expect(d.perLeg).toHaveLength(2)
    expect(d.perLeg.map((l) => l.role).sort()).toEqual(['college', 'pro'])
    expect(d.basis).toMatch(/no single number/)
    expect(d.basis).toMatch(/exchange rate nobody has measured/)
  })

  it('an empty side reads as nothing rather than being omitted', () => {
    const d = describeCrossPlatformTrade([
      { role: 'pro', platform: 'sleeper', sends: [], receives: ['Puka Nacua'], status: 'pending' },
    ])
    expect(d.perLeg[0].summary).toMatch(/sends nothing/)
  })
})

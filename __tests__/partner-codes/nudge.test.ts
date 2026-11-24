import { describe, expect, it } from 'vitest'
import { buildPartnerNudge } from '@/lib/partner-codes/nudgeCopy'
import { DEFAULT_PARTNER_SETTINGS } from '@/lib/partner-codes/settings'

const settings = DEFAULT_PARTNER_SETTINGS
const code = (over: Partial<Parameters<typeof buildPartnerNudge>[0]['code'] & object> = {}) => ({
  code: 'TheCiege',
  status: 'active',
  paidSubsCount: 0,
  activeUsersCount: 0,
  cashUnlockedAt: null,
  freePlan: 'none',
  ...over,
})

describe('Partner Code home card and menu line', () => {
  it('shows nothing to a player who commissions no league and has no code', () => {
    expect(buildPartnerNudge({ code: null, isCommissioner: false, settings })).toEqual({ show: false })
  })

  it('invites a commissioner with no code yet', () => {
    const n = buildPartnerNudge({ code: null, isCommissioner: true, settings })
    expect(n).toMatchObject({ show: true, claimed: false, action: 'Make my code', menuHint: 'earn' })
    if (n.show) expect(n.body).toContain('10% for 3 months')
  })

  it('counts down to cash once they have a code', () => {
    const n = buildPartnerNudge({ code: code({ paidSubsCount: 7 }), isCommissioner: false, settings })
    expect(n).toMatchObject({ show: true, claimed: true, title: '3 more paid subscribers to start earning 10% cash', menuHint: 'TheCiege' })
  })

  it('says one, not ones', () => {
    const n = buildPartnerNudge({ code: code({ paidSubsCount: 9 }), isCommissioner: true, settings })
    if (n.show) expect(n.title).toBe('1 more paid subscriber to start earning 10% cash')
  })

  it('names the free plan they already have', () => {
    const n = buildPartnerNudge({ code: code({ freePlan: 'commissioner' }), isCommissioner: true, settings })
    if (n.show) expect(n.body).toBe('You have AF Commissioner free. Keep sharing TheCiege.')
  })

  it('switches to earnings once cash is on', () => {
    const n = buildPartnerNudge({ code: code({ paidSubsCount: 12, cashUnlockedAt: new Date() }), isCommissioner: true, settings })
    expect(n).toMatchObject({ show: true, title: 'Your code TheCiege is earning', action: 'See earnings' })
  })

  it('does not advertise a suspended code on the home page', () => {
    expect(buildPartnerNudge({ code: code({ status: 'suspended' }), isCommissioner: true, settings })).toEqual({ show: false })
  })
})

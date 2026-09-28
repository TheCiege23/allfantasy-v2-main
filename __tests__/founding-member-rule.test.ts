import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The founding-member rule (lib/monetization/foundingMember.ts) and the per-viewer view the
 * pricing layouts build from it (lib/monetization/foundingMemberServer.ts). Prisma is mocked.
 */

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { appUser: { findUnique } } }))

import {
  foundingOfferBeforeLaunch,
  getFoundingCouponId,
  getFoundingOfferLabel,
  isFoundingMemberAccount,
  resolveFoundingOfferView,
} from '@/lib/monetization/foundingMember'
import { isFoundingMemberUser, resolveLaunchOfferForViewer } from '@/lib/monetization/foundingMemberServer'
import { DEFAULT_PAYWALL_STARTS_AT } from '@/lib/monetization/paywallLaunch'

const START = DEFAULT_PAYWALL_STARTS_AT.getTime()
const ON = { STRIPE_FOUNDING_COUPON_ID: 'coupon_founding' }

beforeEach(() => {
  findUnique.mockReset()
})

describe('who is a founding member', () => {
  it('an account created strictly before the paywall start', () => {
    expect(isFoundingMemberAccount(new Date(START - 1), {})).toBe(true)
    expect(isFoundingMemberAccount(new Date(START), {})).toBe(false)
    expect(isFoundingMemberAccount(new Date(START + 1), {})).toBe(false)
    expect(isFoundingMemberAccount(new Date(START - 1).toISOString(), {})).toBe(true)
  })

  it('never on missing or unparseable evidence', () => {
    expect(isFoundingMemberAccount(null, {})).toBe(false)
    expect(isFoundingMemberAccount(undefined, {})).toBe(false)
    expect(isFoundingMemberAccount('yesterday-ish', {})).toBe(false)
  })

  it('follows AF_PAYWALL_STARTS_AT when the launch moves', () => {
    const later = { AF_PAYWALL_STARTS_AT: new Date(START + 86_400_000).toISOString() }
    expect(isFoundingMemberAccount(new Date(START + 1), later)).toBe(true)
  })
})

describe('switched on only by STRIPE_FOUNDING_COUPON_ID', () => {
  it('reads and trims the coupon id; blank is off', () => {
    expect(getFoundingCouponId({})).toBeNull()
    expect(getFoundingCouponId({ STRIPE_FOUNDING_COUPON_ID: '   ' })).toBeNull()
    expect(getFoundingCouponId({ STRIPE_FOUNDING_COUPON_ID: ' abc ' })).toBe('abc')
  })

  it('reads the optional display label, collapsed and capped', () => {
    expect(getFoundingOfferLabel({})).toBeNull()
    expect(getFoundingOfferLabel({ FOUNDING_OFFER_LABEL: '  50% off   AF Pro  ' })).toBe('50% off AF Pro')
    const long = getFoundingOfferLabel({ FOUNDING_OFFER_LABEL: 'x'.repeat(200) })!
    expect(long.length).toBeLessThanOrEqual(80)
  })

  it('says nothing about founding pricing while it is off', () => {
    expect(resolveFoundingOfferView({ signedIn: false, env: {} })).toBeNull()
    expect(resolveFoundingOfferView({ signedIn: true, accountCreatedAt: new Date(START - 1), env: {} })).toBeNull()
    expect(foundingOfferBeforeLaunch({ signedIn: true, env: {} })).toBeNull()
  })
})

describe('what a pricing page may say to whom', () => {
  it('member: signed in and created before launch — before AND after launch', () => {
    const created = new Date(START - 1)
    expect(resolveFoundingOfferView({ signedIn: true, accountCreatedAt: created, now: new Date(START - 5), env: ON })).toEqual({ audience: 'member', label: null })
    expect(resolveFoundingOfferView({ signedIn: true, accountCreatedAt: created, now: new Date(START + 5), env: ON })).toEqual({ audience: 'member', label: null })
  })

  it('nothing for a signed-in account created after launch, or one whose date is unknown', () => {
    expect(resolveFoundingOfferView({ signedIn: true, accountCreatedAt: new Date(START + 1), env: ON })).toBeNull()
    expect(resolveFoundingOfferView({ signedIn: true, accountCreatedAt: null, env: ON })).toBeNull()
  })

  it('prospect: signed out before launch; nothing for a signed-out visitor after launch', () => {
    expect(resolveFoundingOfferView({ signedIn: false, now: new Date(START - 5), env: ON })).toEqual({ audience: 'prospect', label: null })
    expect(resolveFoundingOfferView({ signedIn: false, now: new Date(START + 5), env: ON })).toBeNull()
  })
})

describe('server: the checkout and layout lookups', () => {
  it('isFoundingMemberUser reads nothing while founding pricing is off', async () => {
    await expect(isFoundingMemberUser('u1', {})).resolves.toBe(false)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('isFoundingMemberUser reads the creation date when it is on', async () => {
    findUnique.mockResolvedValueOnce({ createdAt: new Date(START - 1) })
    await expect(isFoundingMemberUser('u1', ON)).resolves.toBe(true)
    findUnique.mockResolvedValueOnce({ createdAt: new Date(START + 1) })
    await expect(isFoundingMemberUser('u1', ON)).resolves.toBe(false)
    findUnique.mockResolvedValueOnce(null)
    await expect(isFoundingMemberUser('ghost', ON)).resolves.toBe(false)
  })

  it('resolveLaunchOfferForViewer: signed-out costs no read, signed-in costs one only while on', async () => {
    const before = new Date(START - 60_000)
    const out = await resolveLaunchOfferForViewer(null, { now: before, env: ON })
    expect(out).toEqual({ startsAt: DEFAULT_PAYWALL_STARTS_AT.toISOString(), prelaunch: true, founding: { audience: 'prospect', label: null } })
    expect(findUnique).not.toHaveBeenCalled()

    await resolveLaunchOfferForViewer('u1', { now: before, env: {} })
    expect(findUnique).not.toHaveBeenCalled()

    findUnique.mockResolvedValueOnce({ createdAt: new Date(START - 1) })
    const member = await resolveLaunchOfferForViewer('u1', { now: new Date(START + 60_000), env: ON })
    expect(member).toMatchObject({ prelaunch: false, founding: { audience: 'member' } })
    expect(findUnique).toHaveBeenCalledTimes(1)
  })
})

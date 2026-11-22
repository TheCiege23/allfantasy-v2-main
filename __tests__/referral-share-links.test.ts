// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Shares that bring people in (2026-11-15): every share carries the sharer's referral link, the public
 * share page sends visitors to sign up instead of a sign-in wall, and nothing is sent when there is no
 * valid link.
 */

import { isReferralLink, referralLinkLabel, shareLandingHref, withShareLink } from '@/lib/referral/referralShareLink'
import { weeklySocialPost, WEEK_PUBLIC_URL } from '@/lib/core-app/weeklyShare'

const LINK = 'https://allfantasy.ai/?ref=ABCD2345XY'

describe('the referral share link', () => {
  it('only a well-formed https link with a ref code goes into a share', () => {
    expect(isReferralLink(LINK)).toBe(true)
    expect(isReferralLink('https://www.allfantasy.ai/?ref=abc9k2fx')).toBe(true)
    expect(isReferralLink('http://allfantasy.ai/?ref=ABCD2345XY')).toBe(false)
    expect(isReferralLink('https://allfantasy.ai/')).toBe(false)
    expect(isReferralLink('https://allfantasy.ai/?ref=<script>')).toBe(false)
    expect(isReferralLink(null)).toBe(false)
  })

  it('adds the link once, on its own line — and leaves the text alone without one', () => {
    expect(withShareLink('AllFantasy saved me +6.2 pts', LINK)).toBe(`AllFantasy saved me +6.2 pts\n${LINK}`)
    expect(withShareLink(`already has it ${LINK}`, LINK)).toBe(`already has it ${LINK}`)
    expect(withShareLink('no link', null)).toBe('no link')
    expect(withShareLink('bad link', 'javascript:alert(1)')).toBe('bad link')
    expect(withShareLink('', LINK)).toBe(LINK)
  })

  it('prints short on an image', () => {
    expect(referralLinkLabel(LINK)).toBe('allfantasy.ai/?ref=ABCD2345XY')
    expect(referralLinkLabel('https://www.allfantasy.ai/?ref=ABCD2345XY')).toBe('allfantasy.ai/?ref=ABCD2345XY')
    expect(referralLinkLabel(undefined)).toBeNull()
  })

  it('🛑 the share page’s "Try AllFantasy" goes to the sharer’s landing, or to sign-up — never /app', () => {
    expect(shareLandingHref('ABCD2345XY')).toBe('/?ref=ABCD2345XY')
    expect(shareLandingHref(null)).toBe('/signup')
    expect(shareLandingHref('../evil')).toBe('/signup')
  })
})

describe('the weekly post', () => {
  const data = { teamName: 'Tank Squad', actions: [], sports: [] } as never

  it('carries the sharer’s link in place of the signed-in-only week page', () => {
    expect(weeklySocialPost(data, 'X', false, LINK)).toContain(LINK)
    expect(weeklySocialPost(data, 'X', false, LINK)).not.toContain(WEEK_PUBLIC_URL)
    expect(weeklySocialPost(data, 'Facebook', false, LINK)).toContain(LINK)
  })

  it('without a link it is exactly as before', () => {
    expect(weeklySocialPost(data, 'X', false)).toContain(WEEK_PUBLIC_URL)
  })
})

describe('card shares (Trade Center, H2H, ledger, Guillotine, moments)', () => {
  const share = vi.fn(async () => undefined)
  beforeEach(async () => {
    share.mockClear()
    const { resetMyReferralLink } = await import('@/lib/referral/myReferralLink')
    resetMyReferralLink()
    Object.defineProperty(window.navigator, 'canShare', { value: () => true, configurable: true })
    Object.defineProperty(window.navigator, 'share', { value: share, configurable: true })
  })
  afterEach(() => vi.unstubAllGlobals())

  const stubFetch = (referral: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/api/referral/link')
          ? { ok: referral != null, json: async () => referral }
          : { ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) },
      ),
    )

  it('the card goes out with the sharer’s link as its text', async () => {
    stubFetch({ ok: true, code: 'ABCD2345XY', link: LINK })
    const { shareCardImage } = await import('@/components/decide/shareCard')
    expect(await shareCardImage('/api/card.png', 'card.png', 'My trade')).toBe('shared')
    const payload = share.mock.calls[0]![0] as { text?: string; title?: string }
    expect(payload.text).toBe(`My trade\n${LINK}`)
    expect(payload.title).toBe('My trade')
  })

  it('signed out (or no link): the card goes alone, exactly as before', async () => {
    stubFetch(null)
    const { shareCardImage } = await import('@/components/decide/shareCard')
    await shareCardImage('/api/card.png', 'card.png', 'My trade')
    expect((share.mock.calls[0]![0] as { text?: string }).text).toBeUndefined()
  })
})

describe('🛑 OAuth sign-ups are credited to the friend who referred them (source-level)', () => {
  // The create branch is a deep NextAuth path with no unit harness here; like
  // notify-owner-new-signup.test.ts, the property is WHERE the call sits, so the source is asserted.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { resolve } = require('node:path') as typeof import('node:path')
  const src = readFileSync(resolve(__dirname, '..', 'lib/auth/SocialAccountLinkingService.ts'), 'utf8')

  it('the OAuth create branch reads af_ref and attributes the signup, after the signup funnel event', () => {
    const funnel = src.indexOf('event: ACQUISITION.SIGNUP_COMPLETED')
    const cookie = src.indexOf('.get("af_ref")')
    const attribute = src.indexOf('attributeSignup(user.id, code)')
    expect(funnel).toBeGreaterThan(0)
    expect(cookie).toBeGreaterThan(funnel)
    expect(attribute).toBeGreaterThan(cookie)
  })

  it('the live sign-up page sends a ?ref= code from its own URL', () => {
    const auth = readFileSync(resolve(__dirname, '..', 'components/core-app/screens/AuthV4.tsx'), 'utf8')
    expect(auth).toMatch(/\.\.\.\(referralFromUrl\(\) \? \{ referralCode: referralFromUrl\(\) \} : \{\}\)/)
  })
})

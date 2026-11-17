import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'

/*
 * Leaguemate invites that count (2026-11-15). Every invite link carries the inviter's referral code, the
 * code survives the sign-in redirect and is recorded on the auth page (so an OAuth sign-up is credited
 * too), joining a league through an invite earns the free week as importing one does, and the invite
 * shows on the league home while teams are still missing a manager.
 */

import { isReferralCode, referralCodeOf, withReferralCode } from '@/lib/referral/referralShareLink'

describe('putting the code on a link', () => {
  it('adds ref to a site path or an absolute URL, keeping every other param', () => {
    expect(withReferralCode('/import?provider=sleeper&leagueId=123', 'ABCD2345XY')).toBe('/import?provider=sleeper&leagueId=123&ref=ABCD2345XY')
    expect(withReferralCode('https://allfantasy.ai/join/tok123', 'ABCD2345XY')).toBe('https://allfantasy.ai/join/tok123?ref=ABCD2345XY')
    // An old code is replaced, not doubled.
    expect(withReferralCode('/join/t?ref=OLDCODE1', 'NEWCODE22')).toBe('/join/t?ref=NEWCODE22')
  })

  it('no code, or a malformed one, leaves the link exactly as it was', () => {
    for (const bad of [null, undefined, '', 'x', 'has space', '<script>', 'A'.repeat(17)]) {
      expect(withReferralCode('/import?provider=sleeper', bad as string)).toBe('/import?provider=sleeper')
    }
  })

  it('reads the code back out of a referral link', () => {
    expect(referralCodeOf('https://allfantasy.ai/?ref=ABCD2345XY')).toBe('ABCD2345XY')
    expect(referralCodeOf('https://allfantasy.ai/')).toBeNull()
    expect(referralCodeOf(null)).toBeNull()
    expect(isReferralCode('ABCD2345XY')).toBe(true)
    expect(isReferralCode('no')).toBe(false)
  })
})

describe('the sign-in redirect keeps the code', () => {
  const redirect = vi.hoisted(() => vi.fn((url: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }) }))
  beforeEach(() => {
    vi.resetModules()
    redirect.mockClear()
    vi.doMock('next/navigation', () => ({ redirect }))
    vi.doMock('next-auth', () => ({ getServerSession: async () => null }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/components/core-app/screens/ImportV4', () => ({ ImportV4: () => null }))
  })
  const landAt = async (sp: Record<string, string>) => {
    const { default: ImportPage } = await import('@/app/import/page')
    await ImportPage({ searchParams: sp } as never).catch(() => undefined)
    return redirect.mock.calls[0]?.[0] as string
  }

  it('🛑 a signed-out visitor with an invite code goes to SIGN-UP with the code and the league', async () => {
    const url = await landAt({ provider: 'sleeper', leagueId: '987', ref: 'ABCD2345XY' })
    expect(url.startsWith('/signup?ref=ABCD2345XY&callbackUrl=')).toBe(true)
    expect(decodeURIComponent(url.split('callbackUrl=')[1])).toBe('/import?provider=sleeper&leagueId=987')
  })

  it('CONTROL: without a code nothing changes — sign-in, as before', async () => {
    const url = await landAt({ provider: 'sleeper', leagueId: '987' })
    expect(url.startsWith('/login?callbackUrl=')).toBe(true)
  })

  it('a malformed code is ignored, never echoed into the redirect', async () => {
    const url = await landAt({ provider: 'sleeper', ref: '"><script>' })
    expect(url.startsWith('/login?callbackUrl=')).toBe(true)
  })
})

describe('the invite components', () => {
  const link = vi.hoisted(() => ({ value: null as string | null }))
  const offer = vi.hoisted(() => ({ value: { days: 7, cap: 4, earnedInWindow: 0 } }))
  beforeEach(() => {
    vi.resetModules()
    link.value = 'https://allfantasy.ai/?ref=ABCD2345XY'
    offer.value = { days: 7, cap: 4, earnedInWindow: 0 }
    vi.doMock('@/lib/referral/myReferralLink', () => ({ useMyReferralLink: () => link.value }))
    vi.doMock('@/lib/referral/useProWeekOffer', () => ({ useProWeekOffer: () => offer.value }))
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('the post-import card: the link carries the code, and says what bringing a team earns', async () => {
    const { ImportInviteCard } = await import('@/components/core-app/import/ImportInviteCard')
    render(<ImportInviteCard provider={'sleeper' as never} providerLabel="Sleeper" sourceId="987" leagueName="Sunday Sweat" />)
    expect(screen.getByTestId('import-invite-url').textContent).toMatch(/\/import\?provider=sleeper&leagueId=987&ref=ABCD2345XY$/)
    expect(screen.getByTestId('invite-pro-week-line').textContent).toBe('When they bring their team, you both get 7 days of AF Pro, free.')
  })

  it('without a referral code the card is exactly as before, and with the offer off it says nothing of it', async () => {
    link.value = null
    offer.value = { days: 0, cap: 0, earnedInWindow: null as never }
    const { ImportInviteCard } = await import('@/components/core-app/import/ImportInviteCard')
    render(<ImportInviteCard provider={'sleeper' as never} providerLabel="Sleeper" sourceId="987" leagueName="Sunday Sweat" />)
    expect(screen.getByTestId('import-invite-url').textContent).toMatch(/\/import\?provider=sleeper&leagueId=987$/)
    expect(screen.queryByTestId('invite-pro-week-line')).toBeNull()
  })

  it('🛑 the offer line is never shown in the iOS app', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: `${navigator.userAgent} AllFantasyiOS` })
    const { ImportInviteCard } = await import('@/components/core-app/import/ImportInviteCard')
    render(<ImportInviteCard provider={'sleeper' as never} providerLabel="Sleeper" sourceId="987" leagueName="Sunday Sweat" />)
    expect(screen.queryByTestId('invite-pro-week-line')).toBeNull()
  })

  const stubJoin = (claim: { teamCount: number; claimedCount: number } | null) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: claim !== null,
      json: async () => (claim ? { inviteLink: 'https://allfantasy.ai/join/tok123', claim } : {}),
    })))

  it('the league invite: the link (copy, text, WhatsApp) carries the code', async () => {
    stubJoin({ teamCount: 12, claimedCount: 3 })
    const { LeagueInvitePanel } = await import('@/components/core-app/LeagueInvitePanel')
    render(<LeagueInvitePanel leagueId="L1" leagueName="Sunday Sweat" compact hideWhenFull />)
    await waitFor(() => expect(screen.getByLabelText('League invite link')).toBeTruthy())
    expect((screen.getByLabelText('League invite link') as HTMLInputElement).value).toBe('https://allfantasy.ai/join/tok123?ref=ABCD2345XY')
    const share = screen.getByTestId('league-invite-share')
    for (const a of share.querySelectorAll('a')) expect(decodeURIComponent(a.getAttribute('href') ?? '')).toContain('join/tok123?ref=ABCD2345XY')
    expect(screen.getByText('9 teams still need a manager.')).toBeTruthy()
  })

  it('on the league home it says nothing once every team is claimed, or when the read fails', async () => {
    stubJoin({ teamCount: 12, claimedCount: 12 })
    const { LeagueInvitePanel } = await import('@/components/core-app/LeagueInvitePanel')
    const full = render(<LeagueInvitePanel leagueId="L1" hideWhenFull />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(full.container.innerHTML).toBe('')
    cleanup()
    stubJoin(null)
    const failed = render(<LeagueInvitePanel leagueId="L1" hideWhenFull />)
    await new Promise((r) => setTimeout(r, 0))
    expect(failed.container.innerHTML).toBe('')
  })

  it('CONTROL: the settings panel (no hideWhenFull) still says when the read failed', async () => {
    stubJoin(null)
    const { LeagueInvitePanel } = await import('@/components/core-app/LeagueInvitePanel')
    render(<LeagueInvitePanel leagueId="L1" />)
    await waitFor(() => expect(screen.getByText(/We could not load an invite link/)).toBeTruthy())
  })
})

describe('wiring', () => {
  it('the league home shows the invite while teams are missing a manager', () => {
    expect(readFileSync('components/core-app/screens/LeagueHome.tsx', 'utf8')).toMatch(/<LeagueInvitePanel leagueId=\{league\.id\} leagueName=\{league\.name\} compact hideWhenFull \/>/)
  })

  it('joining through an invite earns the free week, after the join and on a verified team claim', () => {
    const src = readFileSync('app/api/leagues/join/route.ts', 'utf8')
    expect(src).toMatch(/if \(!joinResult\.alreadyMember\) \{\n\s+rewardReferredJoin\(userId\)/)
    expect(src).toMatch(/if \(body\.action === 'sleeper_claim_verify'\) rewardReferredJoin\(userId\)/)
    expect(src).toMatch(/import\('@\/lib\/referral\/proWeekGrant'\)/)
  })

  it('the auth page records the click and keeps the code across sign-in ↔ sign-up', () => {
    const src = readFileSync('components/core-app/screens/AuthV4.tsx', 'utf8')
    expect(src).toMatch(/function SignIn\(\{ callbackUrl \}: \{ callbackUrl: string \}\) \{\n\s+useReferralClickFromUrl\(\)/)
    expect(src).toMatch(/fetch\('\/api\/referral\/track-click'/)
    expect(src).toMatch(/if \(\/\^\[A-Za-z0-9\]\{4,16\}\$\/\.test\(ref\)\) qs\.set\('ref', ref\)/)
  })
})

import { describe, expect, it, vi } from 'vitest'

import { isPostOAuthRedirectPreservedPath } from '@/lib/auth/postOAuthRedirectPolicy'
import { signupUrlWithIntent } from '@/lib/auth/auth-intent-resolver'
import { resolvePostAuthIntentDestination } from '@/lib/auth/PostAuthIntentRouter'
import { resolvePostSignupCallbackUrl } from '@/lib/auth/SignupFlowController'
import {
  isAllowedSignupPostAuthDestination,
  pickPostCredentialSignupNavigation,
} from '@/lib/auth/postSignupRedirectPolicy'
import { resolveUnifiedAuthDestinationForSignup } from '@/lib/auth/UnifiedAuthOrchestrator'
import { canonicalizeProductRoute } from '@/lib/routing/canonicalizeProductRoute'

const hm = vi.hoisted(() => ({
  ensureSharedAccountProfile: vi.fn().mockResolvedValue(undefined),
  appUserFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth/SharedAccountBootstrapService', () => ({
  ensureSharedAccountProfile: hm.ensureSharedAccountProfile,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: hm.appUserFindUnique },
  },
}))

describe('Slice 8 — OAuth redirect preservation', () => {
  it('preserves /invite/accept paths', () => {
    expect(isPostOAuthRedirectPreservedPath('/invite/accept')).toBe(true)
    expect(isPostOAuthRedirectPreservedPath('/invite/accept?code=x')).toBe(true)
  })

  it('preserves legacy /join/ token paths', () => {
    expect(isPostOAuthRedirectPreservedPath('/join/abc123token')).toBe(true)
  })

  it('preserves /verify email and phone flows', () => {
    expect(isPostOAuthRedirectPreservedPath('/verify/email')).toBe(true)
    expect(isPostOAuthRedirectPreservedPath('/verify?method=phone')).toBe(true)
  })

  it('does not preserve arbitrary marketing paths', () => {
    expect(isPostOAuthRedirectPreservedPath('/pricing')).toBe(false)
    expect(isPostOAuthRedirectPreservedPath('/login')).toBe(false)
  })
})

describe('Slice 8 — signup URL carries invite intent (next + callbackUrl)', () => {
  it('signupUrlWithIntent duplicates safe path on next and callbackUrl', () => {
    const invite = '/invite/accept?code=TOKEN123'
    const href = signupUrlWithIntent(invite)
    expect(href).toContain('next=')
    expect(href).toContain('callbackUrl=')
    expect(decodeURIComponent(href.split('next=')[1].split('&')[0])).toBe(invite)
    expect(decodeURIComponent(href.split('callbackUrl=')[1])).toBe(invite)
  })
})

describe('Slice 8 — post-auth intent for invites', () => {
  it('resolvePostAuthIntentDestination prefers callbackUrl for invite accept', () => {
    expect(
      resolvePostAuthIntentDestination({
        callbackUrl: '/invite/accept?code=ABC',
        next: '/dashboard',
      }),
    ).toBe('/invite/accept?code=ABC')
  })
})

describe('Slice 8 — post-signup callback preserves invite for email flow', () => {
  it('resolvePostSignupCallbackUrl returns invite URL for email verification path', () => {
    expect(
      resolvePostSignupCallbackUrl({
        redirectAfterSignup: '/invite/accept?code=XYZ',
        verificationMethod: 'EMAIL',
      }),
    ).toBe('/invite/accept?code=XYZ')
  })
})

describe('Slice 8 — post-signup routing (credential signup)', () => {
  it('defaults new signup to /dashboard when no invite or verify callback', () => {
    expect(resolveUnifiedAuthDestinationForSignup({})).toBe('/dashboard')
  })

  it('preserves invite accept URL from callbackUrl', () => {
    expect(
      resolveUnifiedAuthDestinationForSignup({
        callbackUrl: '/invite/accept?code=TOKEN123',
      }),
    ).toBe('/invite/accept?code=TOKEN123')
  })

  it('preserves /verify paths for verify-driven signup', () => {
    expect(
      resolveUnifiedAuthDestinationForSignup({
        next: '/verify/email?token=abc',
      }),
    ).toBe('/verify/email?token=abc')
  })

  it('falls back to /dashboard when callback is unsafe and no safe next', () => {
    expect(
      resolveUnifiedAuthDestinationForSignup({
        callbackUrl: 'https://evil.example/phish',
      }),
    ).toBe('/dashboard')
  })

  it('does not send successful signup to /login when login is the only callback', () => {
    expect(
      resolveUnifiedAuthDestinationForSignup({
        callbackUrl: '/login?callbackUrl=%2Fdashboard',
      }),
    ).toBe('/dashboard')
  })

  it('allows /join/ token paths', () => {
    expect(
      resolveUnifiedAuthDestinationForSignup({
        callbackUrl: '/join/abc123token',
      }),
    ).toBe('/join/abc123token')
  })

  it('pickPostCredentialSignupNavigation rejects sign-in shell URLs', () => {
    expect(
      pickPostCredentialSignupNavigation(
        'https://www.allfantasy.ai/login?callbackUrl=%2Fdashboard',
        '/dashboard',
      ),
    ).toBe('/dashboard')
  })

  it('pickPostCredentialSignupNavigation accepts invite URLs from NextAuth', () => {
    expect(
      pickPostCredentialSignupNavigation(
        'https://www.allfantasy.ai/invite/accept?code=Z',
        '/dashboard',
      ),
    ).toBe('/invite/accept?code=Z')
  })

  it('isAllowedSignupPostAuthDestination rejects /login and accepts /verify', () => {
    expect(isAllowedSignupPostAuthDestination('/login', undefined)).toBe(false)
    expect(isAllowedSignupPostAuthDestination('/verify?method=phone', undefined)).toBe(true)
  })

  it('isAllowedSignupPostAuthDestination accepts /league and rejects plural /leagues', () => {
    expect(isAllowedSignupPostAuthDestination('/league/abc', undefined)).toBe(true)
    expect(isAllowedSignupPostAuthDestination('/leagues/abc', undefined)).toBe(false)
  })

  it('pickPostCredentialSignupNavigation canonicalizes callback target', () => {
    expect(pickPostCredentialSignupNavigation(null, '/leagues/season-9')).toBe('/league/season-9')
  })

  it('pickPostCredentialSignupNavigation rejects /api/auth/session as NextAuth url', () => {
    expect(
      pickPostCredentialSignupNavigation(
        'https://www.allfantasy.ai/api/auth/session',
        '/invite/accept?code=Z',
      ),
    ).toBe('/invite/accept?code=Z')
  })
})

describe('Slice 8 — canonicalizeProductRoute', () => {
  it('maps /leagues/:id to /league/:id', () => {
    expect(canonicalizeProductRoute('/leagues/abc')).toBe('/league/abc')
  })

  // Bracket pool paths must NEVER be canonicalized to /league/[id].
  // /brackets/leagues/[id] is preserved as-is (bracket pools live at this route).
  it('preserves /brackets/leagues/:id — bracket pools must not route to /league/:id', () => {
    expect(canonicalizeProductRoute('/brackets/leagues/abc')).toBe('/brackets/leagues/abc')
  })

  // /bracket/leagues/:id (singular) normalizes to /brackets/leagues/:id via the /bracket→/brackets rewrite.
  it('normalizes /bracket/leagues/:id to /brackets/leagues/:id (not /league/:id)', () => {
    expect(canonicalizeProductRoute('/bracket/leagues/xyz')).toBe('/brackets/leagues/xyz')
  })

  it('sends external and /api paths to /dashboard', () => {
    expect(canonicalizeProductRoute('https://evil.example/x')).toBe('/dashboard')
    expect(canonicalizeProductRoute('/api/auth/session')).toBe('/dashboard')
  })
})

describe('Slice 8 — ensureUserProfileForUserId', () => {
  it('loads AppUser and calls ensureSharedAccountProfile', async () => {
    hm.ensureSharedAccountProfile.mockClear()
    hm.appUserFindUnique.mockResolvedValue({
      id: 'user-1',
      displayName: 'Pat',
      username: 'pat_af',
    })

    const { ensureUserProfileForUserId } = await import('@/lib/user-profile/ensureUserProfileForUserId')
    await ensureUserProfileForUserId('user-1')

    expect(hm.appUserFindUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { id: true, displayName: true, username: true },
    })
    expect(hm.ensureSharedAccountProfile).toHaveBeenCalledWith({ userId: 'user-1', displayName: 'Pat' })
  })
})

import { describe, expect, it } from 'vitest'

import { resolveLoginCallbackUrl } from '@/lib/auth/LoginFlowController'
import {
  resolvePostSignupCallbackUrl,
  resolveSignupRedirectPath,
} from '@/lib/auth/SignupFlowController'
import {
  isValidPhoneE164,
  normalizePhoneE164,
} from '@/lib/auth/ForgotPasswordFlowController'
import { getProviderFallbackMessage } from '@/lib/auth/ProviderFallbackFlowService'
import { resolveAuthSessionDestination } from '@/lib/auth/AuthSessionRouter'

describe('Unified auth flow controllers', () => {
  it('resolves safe login destination from callback or next', () => {
    expect(
      resolveLoginCallbackUrl({
        callbackUrl: '/brackets',
        next: '/dashboard',
      })
    ).toBe('/brackets')

    expect(
      resolveLoginCallbackUrl({
        callbackUrl: 'https://bad.site',
        next: '/dashboard',
      })
    ).toBe('/dashboard')
  })

  it('resolves signup destination from next or callback fallback', () => {
    expect(
      resolveSignupRedirectPath({
        next: '/dashboard',
      })
    ).toBe('/dashboard')

    expect(
      resolveSignupRedirectPath({
        callbackUrl: '/brackets',
      })
    ).toBe('/dashboard')
  })

  it('signup redirect skips /login and prefers a safe next', () => {
    expect(
      resolveSignupRedirectPath({
        callbackUrl: '/login?callbackUrl=%2Fdashboard',
        next: '/invite/accept?code=ABC',
      })
    ).toBe('/invite/accept?code=ABC')

    expect(
      resolveSignupRedirectPath({
        callbackUrl: '/login',
      })
    ).toBe('/dashboard')
  })

  it('routes post-signup to phone verify when method is phone', () => {
    const phoneHref = resolvePostSignupCallbackUrl({
      redirectAfterSignup: '/brackets',
      verificationMethod: 'PHONE',
    })
    expect(phoneHref).toContain('/verify?method=phone')
    expect(phoneHref).toContain(encodeURIComponent('/brackets'))

    expect(
      resolvePostSignupCallbackUrl({
        redirectAfterSignup: '/dashboard',
        verificationMethod: 'EMAIL',
      })
    ).toBe('/dashboard')
  })

  it('normalizes and validates phone values for SMS reset', () => {
    expect(normalizePhoneE164('(555) 123-4567')).toBe('+15551234567')
    expect(normalizePhoneE164('+14155551234')).toBe('+14155551234')
    expect(isValidPhoneE164('+15551234567')).toBe(true)
    expect(isValidPhoneE164('5551234567')).toBe(false)
  })

  it('returns provider fallback copy for pending providers', () => {
    // Facebook is manually suspended pending Meta platform review, not "unconfigured" —
    // see lib/auth/SocialProviderResolver.ts's MANUALLY_SUSPENDED_PROVIDERS.
    expect(getProviderFallbackMessage('facebook')).toContain('Meta platform review')
    expect(getProviderFallbackMessage('google')).toContain('not configured')
  })

  it('resolves auth session fallback destination', () => {
    expect(
      resolveAuthSessionDestination({
        callbackUrl: '/dashboard',
      })
    ).toBe('/dashboard')
    expect(
      resolveAuthSessionDestination({
        callbackUrl: 'https://evil.site',
        next: null,
        fallback: '/dashboard',
      })
    ).toBe('/dashboard')
  })
})

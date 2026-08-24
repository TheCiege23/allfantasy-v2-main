import { describe, expect, it } from 'vitest'

import { validateSignInInput } from '@/lib/auth/SignInFormController'
import {
  resolveLoginErrorMessage,
  resolvePasswordResetErrorMessage,
  resolveSocialOAuthErrorMessage,
} from '@/lib/auth/AuthErrorMessageResolver'
import { buildProviderPendingHref } from '@/lib/auth/ProviderPendingFlow'
import {
  getProviderDisplayName,
  getProviderFallbackMessage,
} from '@/lib/auth/ProviderFallbackFlowService'

describe('Sign-in and recovery controllers', () => {
  it('validates unified login identifier and password requirements', () => {
    expect(validateSignInInput({ login: '', password: 'x' })).toEqual({
      ok: false,
      error: 'Please enter your email, username, or phone.',
    })
    expect(validateSignInInput({ login: 'user', password: '' })).toEqual({
      ok: false,
      error: 'Please enter your password.',
    })
    expect(validateSignInInput({ login: 'user', password: '   ' })).toEqual({
      ok: false,
      error: 'Please enter your password.',
    })
    expect(validateSignInInput({ login: 'user', password: 'secret' })).toEqual({
      ok: true,
    })
  })

  it('maps auth and reset errors to user-friendly copy', () => {
    // PASSWORD_NOT_SET and SLEEPER_ONLY_ACCOUNT must NOT reveal account existence —
    // both collapse to the generic invalid-credentials message.
    expect(resolveLoginErrorMessage('PASSWORD_NOT_SET')).toBe('Invalid username, email, phone, or password.')
    expect(resolveLoginErrorMessage('SLEEPER_ONLY_ACCOUNT')).toBe('Invalid username, email, phone, or password.')
    expect(resolveSocialOAuthErrorMessage('access_denied')).toContain('cancelled')
    expect(resolveSocialOAuthErrorMessage('Missing OAuth callback code.')).toContain('callback')
    expect(resolvePasswordResetErrorMessage('EXPIRED_TOKEN')).toContain('expired')
    expect(resolvePasswordResetErrorMessage('UNKNOWN_ERROR')).toBe('UNKNOWN_ERROR')
  })

  it('builds provider-pending route with safe callback', () => {
    expect(
      buildProviderPendingHref({
        provider: 'google',
        callbackUrl: '/brackets',
      })
    ).toContain('provider=google')
    expect(
      buildProviderPendingHref({
        provider: 'x',
        callbackUrl: 'https://bad.site',
      })
    ).toContain(encodeURIComponent('/core'))
  })

  it('returns provider fallback metadata', () => {
    expect(getProviderDisplayName('tiktok')).toBe('TikTok')
    expect(getProviderFallbackMessage('apple')).toContain('configured')
  })
})

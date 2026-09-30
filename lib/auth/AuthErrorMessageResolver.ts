/** Shown when a suspended or banned account tries to sign in (lib/moderation/accountSuspension). */
export const ACCOUNT_SUSPENDED_MESSAGE =
  'This account has been suspended for violating the AllFantasy Terms of Use. If you think this is a mistake, email support@allfantasy.ai.'

export function resolveLoginErrorMessage(error: string | null | undefined): string {
  if (!error) return 'Unable to sign in. Please try again.'
  if (error.includes('SLEEPER_LOOKUP_UNAVAILABLE')) {
    return 'Sleeper sign-in is temporarily unavailable. Please try again in a moment.'
  }
  // Only reachable with the right password (lib/auth.ts checks it after bcrypt), so saying so
  // discloses nothing.
  if (error.includes('ACCOUNT_SUSPENDED')) return ACCOUNT_SUSPENDED_MESSAGE
  // NOTE: SLEEPER_ONLY_ACCOUNT and PASSWORD_NOT_SET intentionally return the
  // generic message below — revealing account existence or auth method is an
  // info-disclosure risk.  Users without a password can recover via reset.
  return 'Invalid username, email, phone, or password.'
}

export function resolveSocialOAuthErrorMessage(
  error: string | null | undefined
): string {
  if (!error) return 'Unable to complete social sign-in. Please try again.'
  const normalized = error.trim().toLowerCase()

  if (
    normalized.includes('access_denied') ||
    normalized.includes('user denied') ||
    normalized.includes('cancelled')
  ) {
    return 'Social sign-in was cancelled. Please try again when you are ready.'
  }

  if (normalized.includes('provider_not_enabled')) {
    return 'This social sign-in provider is not configured right now.'
  }

  if (normalized.includes('missing oauth callback code')) {
    return 'We could not complete social sign-in from the callback. Please try again.'
  }

  if (normalized.includes('supabase_not_configured')) {
    return 'Social sign-in is not configured right now.'
  }

  return error
}

export function resolveSleeperLoginErrorMessage(error: string | null | undefined): string {
  if (!error) return 'Unable to sign in with Sleeper. Please try again.'
  if (error.includes('SLEEPER_LOOKUP_UNAVAILABLE')) {
    return 'Sleeper sign-in is temporarily unavailable. Please try again in a moment.'
  }
  return 'We could not find that Sleeper account. Please check the username and try again.'
}

export function resolvePasswordResetErrorMessage(
  errorCode: string | null | undefined
): string {
  const map: Record<string, string> = {
    INVALID_OR_USED_TOKEN: 'Invalid or expired code. Request a new one.',
    EXPIRED_TOKEN: 'Code expired. Request a new one.',
    TOO_MANY_ATTEMPTS: 'Too many incorrect codes. Wait 15 minutes, then request a new one.',
    WEAK_PASSWORD: 'Password must be at least 8 characters with a letter and number.',
    RESET_FAILED: 'Something went wrong. Please try again.',
    MISSING_FIELDS: 'Please complete all required fields.',
  }
  if (!errorCode) return 'Something went wrong.'
  return map[errorCode] ?? errorCode
}

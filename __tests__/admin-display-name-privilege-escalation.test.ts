/**
 * Regression guard for a real privilege-escalation path that existed in
 * `hasAllFantasyTestAccess`.
 *
 * The bug: the helper accepted `user.name` as an admin credential
 * (`isAllFantasyTestUsername(user?.name)`). But `AppUser` has no `name` column —
 * `session.user.name` is populated from `token.name`, which `lib/auth.ts` sets from
 * `user.name`, i.e. the OAuth provider's profile name. That is freely editable by
 * the end user in their own Google/social account settings.
 *
 * Because `STATIC_ALL_ACCESS_USERNAMES` is a guessable literal ("theciege26"), any
 * attacker could rename their Google account to it, sign in, and be granted full
 * site-admin by `getAppSessionAdminAccessState` (lib/adminAuth.ts:129,132) — which
 * carries /admin access, token-spend bypass, and entitlement/paywall bypass.
 *
 * These tests assert the escalation is closed WITHOUT regressing either legitimate
 * grant path (founder email, real unique username).
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  hasAllFantasyTestAccess,
  isSiteAdmin,
  hasAiAccess,
  hasPoolAdminAccess,
  hasChatAdminAccess,
} from '@/lib/auth/admin'

const FOUNDER_EMAIL = 'cjabar.henson@gmail.com'
const STATIC_USERNAME = 'theciege26'

describe('display-name privilege escalation', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.ALL_ACCESS_EMAILS
    delete process.env.ADMIN_EMAILS
    delete process.env.ALL_ACCESS_USERNAMES
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('does NOT grant access from a display name matching the static username', () => {
    // The exact attack: attacker-controlled OAuth profile name, unrelated email,
    // no matching username.
    const attacker = {
      email: 'attacker@example.com',
      username: 'attacker',
      name: STATIC_USERNAME,
    }
    expect(hasAllFantasyTestAccess(attacker)).toBe(false)
    expect(isSiteAdmin(attacker)).toBe(false)
  })

  it('does NOT grant access from a display name when username is absent entirely', () => {
    // OAuth-only accounts can reach the gate before a username is assigned.
    expect(
      hasAllFantasyTestAccess({ email: 'attacker@example.com', name: STATIC_USERNAME }),
    ).toBe(false)
  })

  it('closes the escalation for every aliased entitlement helper', () => {
    // isSiteAdmin/hasAiAccess/hasPoolAdminAccess/hasChatAdminAccess all delegate to
    // the same predicate, so a regression in one is a regression in all.
    const attacker = { email: 'attacker@example.com', username: 'attacker', name: STATIC_USERNAME }
    for (const fn of [isSiteAdmin, hasAiAccess, hasPoolAdminAccess, hasChatAdminAccess]) {
      expect(fn(attacker)).toBe(false)
    }
  })

  it('is not bypassable via casing or surrounding whitespace on the display name', () => {
    for (const name of ['TheCiege26', '  theciege26  ', 'THECIEGE26']) {
      expect(hasAllFantasyTestAccess({ email: 'attacker@example.com', name })).toBe(false)
    }
  })

  it('still grants access to the founder email (legitimate path preserved)', () => {
    expect(hasAllFantasyTestAccess({ email: FOUNDER_EMAIL })).toBe(true)
    expect(isSiteAdmin({ email: FOUNDER_EMAIL, username: 'anything', name: 'Anything' })).toBe(true)
  })

  it('still grants access to the real static username (legitimate path preserved)', () => {
    expect(hasAllFantasyTestAccess({ email: 'someone@example.com', username: STATIC_USERNAME })).toBe(true)
  })

  it('still honours the ADMIN_EMAILS / ALL_ACCESS_USERNAMES allowlists', () => {
    process.env.ADMIN_EMAILS = 'ops@allfantasy.app'
    process.env.ALL_ACCESS_USERNAMES = 'opsuser'
    expect(hasAllFantasyTestAccess({ email: 'ops@allfantasy.app' })).toBe(true)
    expect(hasAllFantasyTestAccess({ username: 'opsuser' })).toBe(true)
    // ...but the allowlisted username must still not be honoured as a display name.
    expect(hasAllFantasyTestAccess({ email: 'attacker@example.com', name: 'opsuser' })).toBe(false)
  })

  it('denies an anonymous/empty user', () => {
    expect(hasAllFantasyTestAccess(null)).toBe(false)
    expect(hasAllFantasyTestAccess(undefined)).toBe(false)
    expect(hasAllFantasyTestAccess({})).toBe(false)
    expect(hasAllFantasyTestAccess({ email: '', username: '', name: '' })).toBe(false)
  })
})

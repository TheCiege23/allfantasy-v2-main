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
 * Because `STATIC_ALL_ACCESS_USERNAMES` was a guessable literal in a PUBLIC repo, any
 * attacker could rename their Google account to it, sign in, and be granted full
 * site-admin by `getAppSessionAdminAccessState` (lib/adminAuth.ts:129,132) — which
 * carries /admin access, token-spend bypass, and entitlement/paywall bypass.
 *
 * ⚠ THAT FIX WAS HALF A FIX. It stopped accepting `user.name` and kept accepting
 * `user.username`, reasoning that username was the app-owned unique column. The FIELD
 * was not app-owned: next-auth's session-update trigger wrote `session.user.username`
 * from a request body without ever writing a row, so `update({ username: "theciege26" })`
 * from any signed-in account still produced site admin. Two changes close it —
 * lib/auth.ts re-reads the username from the database on that trigger, and the static
 * username list is deleted. The tests below now cover both halves.
 *
 * These tests assert the escalation is closed WITHOUT regressing the legitimate grant
 * paths: founder email, and the env-configured (unpublished) ALL_ACCESS_USERNAMES.
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

  /*
   * This assertion used to read `.toBe(true)` — "the real static username is a
   * legitimate path". It is inverted deliberately, and that inversion IS the second
   * half of the fix.
   *
   * Keeping a hardcoded handle was only defensible while `username` could not be
   * self-assigned. It could: next-auth's session-update trigger wrote
   * `session.user.username` straight from a request body (lib/auth.ts), so the handle
   * published in this public repo was claimable by anyone with an account. The trigger
   * now re-reads from the database AND the static list is gone — either alone closes
   * the hole, and both are cheap.
   *
   * The founder is unaffected: that account is covered by STATIC_ALL_ACCESS_EMAILS,
   * verified against the production row before the list was removed.
   */
  it('does NOT grant access from the formerly-hardcoded username', () => {
    expect(hasAllFantasyTestAccess({ email: 'someone@example.com', username: STATIC_USERNAME })).toBe(false)
    expect(isSiteAdmin({ email: 'someone@example.com', username: STATIC_USERNAME })).toBe(false)
    for (const username of ['TheCiege26', '  theciege26  ', 'THECIEGE26']) {
      expect(hasAllFantasyTestAccess({ email: 'attacker@example.com', username })).toBe(false)
    }
  })

  it('still grants the founder access without any username at all', () => {
    // The email path is the one that has to keep working now that the username
    // literal is gone — if this fails, the owner is locked out of /admin.
    expect(hasAllFantasyTestAccess({ email: FOUNDER_EMAIL, username: null })).toBe(true)
    expect(isSiteAdmin({ email: FOUNDER_EMAIL, username: STATIC_USERNAME })).toBe(true)
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

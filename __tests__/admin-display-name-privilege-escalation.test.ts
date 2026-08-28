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
 * from any signed-in account still produced site admin.
 *
 * ✅ CLOSED AT THE WRITE PATHS, NOT HERE. lib/auth.ts re-reads the username from the
 * database on that trigger, and /api/auth/complete-profile probes case-insensitively
 * before writing one (the unique index is case-SENSITIVE btree, so the database alone
 * did not enforce it). The handle can no longer be self-assigned, which is what makes
 * matching on it safe — so a regression in EITHER of those re-opens this.
 *
 * These tests assert the escalation is closed WITHOUT regressing the legitimate grant
 * paths: founder email, the static handle, and env-configured ALL_ACCESS_USERNAMES.
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
   * ⚠ THIS ASSERTION IS `true` ON PURPOSE, AND I BRIEFLY INVERTED IT — WRONGLY.
   *
   * On 2026-08-28 the static handle was deleted as defence-in-depth and this flipped to
   * `.toBe(false)`. The suite caught the mistake: admin-access-state.test.ts covers the
   * founder signing in as `theciege@example.com`, an address deliberately NOT on
   * STATIC_ALL_ACCESS_EMAILS, where this handle is the ONLY thing granting access.
   * Deleting it locked that path out.
   *
   * Matching on a self-chosen handle is safe only while it cannot be self-ASSIGNED, and
   * that is what was actually fixed: lib/auth.ts re-reads username from the database on
   * the session-update trigger, and /api/auth/complete-profile probes case-insensitively
   * before writing one. If either regresses, this line becomes exploitable again.
   */
  it('still grants access to the real static username (legitimate path preserved)', () => {
    expect(hasAllFantasyTestAccess({ email: 'someone@example.com', username: STATIC_USERNAME })).toBe(true)
  })

  it('still grants the founder access by email with no username at all', () => {
    expect(hasAllFantasyTestAccess({ email: FOUNDER_EMAIL, username: null })).toBe(true)
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

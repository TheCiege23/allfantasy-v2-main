import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The avatar upload gate, and the copy shown when it refuses.
 *
 * ⚠ WHAT BROKE. A Play Store test user could not change their avatar. The settings page
 * uploaded through `/api/chat/upload`, gated by `requireVerifiedUser` — which requires
 * `ageConfirmedAt` as well as contact verification. `lib/auth.ts` never writes
 * `ageConfirmedAt` on an OAuth sign-in, so EVERY Google account that had not separately
 * confirmed its age was refused a profile picture with a raw `AGE_REQUIRED` string on
 * screen. Reported 2026-09-01.
 *
 * The fix is `requireContactVerifiedUser`: contact verification WITHOUT the age gate, which
 * is what a profile picture actually needs. Age confirmation stays mandatory on the
 * surfaces that are legally required to have it.
 *
 * ⚠ THE FIRST TEST BELOW IS THE POSITIVE CONTROL, and it is why both guards are exercised
 * on the SAME fixture. A test asserting only "the new guard allows this user" would pass
 * even if the guard were an alias for `requireAgeConfirmedUser`. Asserting that the strict
 * guard REFUSES the identical user is what pins the difference to the age check.
 */

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileUpsert: vi.fn(),
  appUserFindUnique: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { upsert: h.profileUpsert },
    appUser: { findUnique: h.appUserFindUnique },
  },
}))

import { requireContactVerifiedUser, requireVerifiedUser } from '@/lib/auth-guard'
import { describeAvatarUploadError } from '@/lib/avatar/AvatarUploadErrorCopy'
import {
  MAX_PROFILE_IMAGE_BYTES,
  MAX_PROFILE_IMAGE_MB,
  PROFILE_IMAGE_TOO_LARGE_MESSAGE,
  isAllowedProfileImageType,
} from '@/lib/avatar/profileImageLimits'

/** The Google sign-in shape: email verified by the provider, age never confirmed. */
function oauthProfile(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    displayName: null,
    phone: null,
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    ageConfirmedAt: null,
    profileComplete: true,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c' } })
  h.profileUpsert.mockResolvedValue(oauthProfile())
  // Google reports `email_verified`, so `lib/auth.ts` stamps this. Age is still null.
  h.appUserFindUnique.mockResolvedValue({ emailVerified: new Date('2026-01-01T00:00:00Z') })
})

describe('the avatar gate is contact verification WITHOUT the age check', () => {
  it('admits the Google sign-in that the old gate refused', async () => {
    const relaxed = await requireContactVerifiedUser()
    expect(relaxed.ok).toBe(true)
    expect(relaxed.ok && relaxed.userId).toBe('u1')

    // Positive control: the same fixture, through the gate the upload used to sit behind.
    const strict = await requireVerifiedUser()
    expect(strict.ok).toBe(false)
    if (!strict.ok) {
      expect(strict.response.status).toBe(403)
      await expect(strict.response.json()).resolves.toEqual({ error: 'AGE_REQUIRED' })
    }
  })

  it('still refuses an account with neither email nor phone verified', async () => {
    h.appUserFindUnique.mockResolvedValue({ emailVerified: null })
    const out = await requireContactVerifiedUser()
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.response.status).toBe(403)
      await expect(out.response.json()).resolves.toEqual({ error: 'VERIFICATION_REQUIRED' })
    }
  })

  it('accepts a phone-verified account with no verified email', async () => {
    h.appUserFindUnique.mockResolvedValue({ emailVerified: null })
    h.profileUpsert.mockResolvedValue(oauthProfile({ phoneVerifiedAt: new Date() }))
    expect((await requireContactVerifiedUser()).ok).toBe(true)
  })

  it('refuses a signed-out caller with 401, not 403', async () => {
    h.getServerSession.mockResolvedValue(null)
    const out = await requireContactVerifiedUser()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(401)
  })
})

describe('the refusal is rendered as a sentence, not a code', () => {
  /*
   * ⚠ THE USER-VISIBLE HALF OF THE BUG. Both editors did `setUploadError(data.error)`, so
   * the tester was shown the literal string `AGE_REQUIRED` and reported it as "nothing
   * happened". Every code the avatar path can emit must map to something actionable.
   */
  it.each([
    'AGE_REQUIRED',
    'VERIFICATION_REQUIRED',
    'UNAUTHENTICATED',
    'INTERNAL_ERROR',
    'Storage not configured',
  ])('maps %s to prose', (code) => {
    const copy = describeAvatarUploadError(code)
    expect(copy).not.toBe(code)
    expect(copy).toMatch(/[a-z]\s[a-z]/i) // more than one word
    expect(copy).not.toMatch(/_/) // no SCREAMING_SNAKE left in it
  })

  it('passes an already-human message through untouched', () => {
    // The routes also return prose; collapsing it would discard the useful detail.
    expect(describeAvatarUploadError(PROFILE_IMAGE_TOO_LARGE_MESSAGE)).toBe(
      PROFILE_IMAGE_TOO_LARGE_MESSAGE,
    )
  })

  it('falls back to something readable for an empty error', () => {
    expect(describeAvatarUploadError(null)).toMatch(/try again/i)
    expect(describeAvatarUploadError('')).toMatch(/try again/i)
  })
})

describe('one size limit, one allow-list', () => {
  /*
   * ⚠ THERE WERE THREE LIMITS: 2MB in a dead `/api/user/avatar`, 3MB on the server, and a
   * hardcoded 3MB in the client helper. A file between two of them passed one check and
   * failed the next, and the message named a size nothing enforced.
   */
  it('derives the byte count and the message from the same number', () => {
    expect(MAX_PROFILE_IMAGE_BYTES).toBe(MAX_PROFILE_IMAGE_MB * 1024 * 1024)
    expect(PROFILE_IMAGE_TOO_LARGE_MESSAGE).toContain(String(MAX_PROFILE_IMAGE_MB))
  })

  it('accepts the four supported types and nothing else', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(isAllowedProfileImageType(t)).toBe(true)
    }
    expect(isAllowedProfileImageType('image/svg+xml')).toBe(false)
    expect(isAllowedProfileImageType('application/pdf')).toBe(false)
  })
})

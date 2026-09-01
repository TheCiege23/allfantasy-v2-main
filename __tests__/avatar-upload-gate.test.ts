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
 * ⚠ AND CONTACT VERIFICATION ALONE WAS ALSO TOO STRICT — that was tried and reverted in the
 * same session. It fixed the Google population but shut out every account with no verified
 * email or phone, all of whom could upload from `/profile` before. A profile picture is
 * neither an age-restricted nor a deliverability-restricted action. The gate is a session.
 *
 * ⚠ THE SECOND TEST IS A POSITIVE CONTROL, and it is why two guards are exercised on the
 * SAME fixture. A test asserting only "the loose gate allows this user" would still pass if
 * the route were silently re-gated tomorrow. Asserting that the STRICT guard refuses the
 * identical user is what pins down which gate the avatar route must not drift back to.
 */

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  profileUpsert: vi.fn(),
  appUserFindUnique: vi.fn(),
  appUserUpdate: vi.fn(),
  profileUpdateMany: vi.fn(),
  transaction: vi.fn(),
  persistBytes: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProfile: { upsert: h.profileUpsert, updateMany: h.profileUpdateMany },
    appUser: { findUnique: h.appUserFindUnique, update: h.appUserUpdate },
    $transaction: h.transaction,
  },
}))
// Only the blob write is stubbed; the limit and type checks stay real.
vi.mock('@/lib/avatar/ProfileImageUploadStorageService', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  persistProfileImageBytes: h.persistBytes,
}))

import { requireAuth, requireVerifiedUser } from '@/lib/auth-guard'
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
  /*
   * The worst-case account on purpose: no age confirmation AND no verified contact. Every
   * stricter gate tried on this route refused someone, so the fixture is the union of both
   * refused populations. If this account can upload, everyone can.
   */
  h.appUserFindUnique.mockResolvedValue({ emailVerified: null })
})

describe('the avatar gate is a session and nothing more', () => {
  it('admits an account with no age confirmation and no verified contact', async () => {
    const out = await requireAuth()
    expect(out.ok).toBe(true)
    expect(out.ok && out.userId).toBe('u1')
  })

  it('is genuinely looser than the gate the settings page used to sit behind', async () => {
    /*
     * Positive control. The identical fixture through `requireVerifiedUser`, which is what
     * `/api/chat/upload` enforces and where this upload used to be routed. It must refuse,
     * and refuse on AGE first — that ordering is the bug the Play Store tester hit.
     */
    const strict = await requireVerifiedUser()
    expect(strict.ok).toBe(false)
    if (!strict.ok) {
      expect(strict.response.status).toBe(403)
      await expect(strict.response.json()).resolves.toEqual({ error: 'AGE_REQUIRED' })
    }
  })

  it('still refuses a signed-out caller', async () => {
    h.getServerSession.mockResolvedValue(null)
    const out = await requireAuth()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(401)
  })

  /*
   * ⚠ THE THREE ABOVE TEST THE GUARDS, NOT THE ROUTE, AND THAT IS NOT ENOUGH ON ITS OWN.
   * They would all still pass if someone swapped the route back onto `requireVerifiedUser`
   * tomorrow — which is precisely the regression this file exists to prevent. This one
   * drives the real POST handler, so the assertion is about the shipped gate.
   */
  it('the ROUTE itself uploads for the worst-case account', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token'
    h.persistBytes.mockResolvedValue({ url: 'https://blob.example/avatars/x.png' })
    h.transaction.mockResolvedValue([])

    /*
     * ⚠ `req.formData()` IS STUBBED RATHER THAN BUILT FROM A REAL File/Blob. undici's
     * FormData validates against ITS OWN File class, and neither the global `File` nor the
     * global `Blob` in this environment is that class — appending either trips an internal
     * webidl assert that the route's catch turns into an opaque 500, which reads exactly
     * like a gate refusal and sends you hunting the wrong bug. Multipart parsing belongs to
     * undici; what this test is for is the gate and the preset clear.
     */
    const file = {
      type: 'image/png',
      size: 3,
      name: 'a.png',
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }
    const req = {
      formData: async () => ({ get: (key: string) => (key === 'file' ? file : null) }),
    }

    const { POST } = await import('@/app/api/user/profile/avatar/route')
    const res = await POST(req as never)

    // Assert status and body together so a refusal shows WHICH refusal in the diff.
    expect({ status: res.status, body: await res.json() }).toEqual({
      status: 200,
      body: { url: 'https://blob.example/avatars/x.png' },
    })
    // An upload supersedes a preset, and the route owns that rather than each editor.
    expect(h.transaction).toHaveBeenCalledOnce()
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

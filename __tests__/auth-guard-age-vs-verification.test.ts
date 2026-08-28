import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { requireAgeConfirmedUser, requireVerifiedUser } from '@/lib/auth-guard'

const AGE_OK = new Date('2020-01-01T00:00:00Z')

function profile(over: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    displayName: null,
    phone: null,
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    ageConfirmedAt: AGE_OK,
    profileComplete: true,
    ...over,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  h.getServerSession.mockResolvedValue({ user: { id: 'u1', email: 'a@b.c' } })
  h.profileUpsert.mockResolvedValue(profile())
  /* Unverified email by default — the population this change is about. */
  h.appUserFindUnique.mockResolvedValue({ emailVerified: null })
})

describe('the two user guards differ ONLY on contact verification', () => {
  /*
   * ⚠ THE POINT OF THE CHANGE. 17 of 48 production accounts are unverified and
   * every one of them was answered with a raw VERIFICATION_REQUIRED code instead
   * of a Chimmy answer.
   */
  it('lets an unverified user through the relaxed guard', async () => {
    const out = await requireAgeConfirmedUser()
    expect(out.ok).toBe(true)
    expect(out.ok && out.userId).toBe('u1')
  })

  it('still blocks an unverified user on the strict guard', async () => {
    const out = await requireVerifiedUser()
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(403)
  })

  it('accepts a phone-verified user on the strict guard', async () => {
    h.profileUpsert.mockResolvedValue(profile({ phoneVerifiedAt: new Date() }))
    expect((await requireVerifiedUser()).ok).toBe(true)
  })
})

describe('what the relaxed guard still enforces', () => {
  /*
   * ⚠ AGE IS COMPLIANCE, NOT UX. It is the check most likely to be dropped by
   * accident when somebody relaxes a surface, which is why both guards share one
   * implementation.
   */
  it('still requires age confirmation', async () => {
    h.profileUpsert.mockResolvedValue(profile({ ageConfirmedAt: null }))

    const out = await requireAgeConfirmedUser()

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(403)
  })

  it('still requires a signed-in session', async () => {
    h.getServerSession.mockResolvedValue(null)

    const out = await requireAgeConfirmedUser()

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(401)
  })

  it('still fails closed when the profile cannot be loaded', async () => {
    h.profileUpsert.mockRejectedValue(new Error('db down'))

    const out = await requireAgeConfirmedUser()

    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.response.status).toBe(500)
  })
})

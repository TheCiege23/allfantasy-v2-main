// @vitest-environment node
/**
 * A suspended or banned account cannot sign in — on the password provider, and on every social
 * provider (they all go through `runSocialLink` in lib/auth.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  restriction: vi.fn(),
  resolveIdentity: vi.fn(),
  compare: vi.fn(),
  link: vi.fn(),
}))

vi.mock('@/lib/moderation/accountSuspension', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/moderation/accountSuspension')>()),
  activeAccountRestriction: h.restriction,
}))
vi.mock('@/lib/auth/AuthIdentityResolver', () => ({ resolveUnifiedAuthIdentity: h.resolveIdentity }))
vi.mock('bcryptjs', () => ({ default: { compare: h.compare }, compare: h.compare }))
vi.mock('@/lib/auth/SocialAccountLinkingService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/SocialAccountLinkingService')>()),
  linkSocialAccountToAppUser: h.link,
}))

const saved = process.env.NEXTAUTH_SECRET
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = 'test-nextauth-secret-not-a-real-credential'
})
afterAll(() => {
  if (saved === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = saved
})

const USER = { id: 'u-bad', email: 'bad@example.com', username: 'bad', displayName: null, avatarUrl: null, passwordHash: 'hash' }

async function passwordAuthorize() {
  const { authOptions } = await import('@/lib/auth')
  const p = authOptions.providers.find(
    (x) => ((x as { options?: { id?: string } }).options?.id ?? (x as { id?: string }).id) === 'credentials',
  ) as { options: { authorize: (c: Record<string, string>) => Promise<unknown> } }
  return (creds: Record<string, string>) => p.options.authorize(creds)
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolveIdentity.mockResolvedValue(USER)
  h.restriction.mockResolvedValue(null)
})

describe('password sign-in', () => {
  it('refuses a restricted account with ACCOUNT_SUSPENDED once the password matched', async () => {
    h.compare.mockResolvedValue(true)
    h.restriction.mockResolvedValue({ kind: 'ban', until: null, reason: null })
    const authorize = await passwordAuthorize()
    await expect(authorize({ login: 'bad', password: 'right' })).rejects.toThrow('ACCOUNT_SUSPENDED')
    expect(h.restriction).toHaveBeenCalledWith('u-bad')
  })

  it('never checks — so never reveals — the restriction on a wrong password', async () => {
    h.compare.mockResolvedValue(false)
    h.restriction.mockResolvedValue({ kind: 'ban', until: null, reason: null })
    const authorize = await passwordAuthorize()
    expect(await authorize({ login: 'bad', password: 'wrong' })).toBeNull()
    expect(h.restriction).not.toHaveBeenCalled()
  })

  it('signs in an unrestricted account (control)', async () => {
    h.compare.mockResolvedValue(true)
    const authorize = await passwordAuthorize()
    expect(await authorize({ login: 'bad', password: 'right' })).toMatchObject({ id: 'u-bad' })
  })
})

describe('social sign-in', () => {
  async function googleSignIn() {
    const { authOptions } = await import('@/lib/auth')
    const user: Record<string, unknown> = { id: 'google-sub', email: 'bad@example.com', name: 'Bad' }
    const result = await authOptions.callbacks!.signIn!({
      user: user as never,
      account: { provider: 'google', providerAccountId: 'g1', type: 'oauth' } as never,
      profile: { email: 'bad@example.com', email_verified: true } as never,
    } as never)
    return { result, user }
  }

  it('sends a restricted account to the error page instead of linking it in', async () => {
    h.link.mockResolvedValue({ id: 'u-bad', email: 'bad@example.com', displayName: null, username: 'bad', avatarUrl: null })
    h.restriction.mockResolvedValue({ kind: 'suspend', until: new Date('2026-10-07'), reason: null })
    const { result, user } = await googleSignIn()
    expect(result).toBe('/auth/error?error=ACCOUNT_SUSPENDED')
    expect(user.id).toBe('google-sub') // never switched to the app account
  })

  it('lets an unrestricted account through (control)', async () => {
    h.link.mockResolvedValue({ id: 'u-ok', email: 'ok@example.com', displayName: null, username: 'ok', avatarUrl: null })
    const { result, user } = await googleSignIn()
    expect(result).toBe(true)
    expect(user.id).toBe('u-ok')
  })
})

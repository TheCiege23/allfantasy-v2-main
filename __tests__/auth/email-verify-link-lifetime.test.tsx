import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * An email-confirmation link works for 7 days, everywhere one is mailed, and everything that tells
 * the user how long it works says the same thing. It was 1 hour: measured 2026-09-25, 39 of the 44
 * accounts that never confirmed held only expired links, while Resend showed the emails delivered.
 */

const mocks = vi.hoisted(() => ({
  getSessionAndProfile: vi.fn(),
  tokenCreate: vi.fn(),
  send: vi.fn(),
  params: new URLSearchParams(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: vi.fn(async () => ({ emailVerified: null, email: 'manager@gmail.com' })) },
    emailVerifyToken: {
      findFirst: vi.fn(async () => null),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => ({})),
      create: mocks.tokenCreate,
    },
  },
}))
vi.mock('@/lib/auth-guard', () => ({ getSessionAndProfile: mocks.getSessionAndProfile }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => '127.0.0.1' }))
vi.mock('@/lib/site-public-origin', () => ({ getDeploymentLinkOrigin: () => 'https://www.allfantasy.ai' }))
vi.mock('@/lib/auth/user-facing-site-origin', () => ({ USER_FACING_SITE_ORIGIN: 'https://www.allfantasy.ai' }))
vi.mock('@/lib/email/idempotency', () => ({ buildEmailIdempotencyKey: () => 'idem-key' }))
vi.mock('@/lib/resend-client', async (orig) => {
  const actual = await orig<typeof import('@/lib/resend-client')>()
  return {
    ...actual,
    getResendClient: async () => ({ client: { emails: { send: mocks.send } }, fromEmail: 'AllFantasy <noreply@allfantasy.ai>' }),
  }
})
vi.mock('next/navigation', () => ({
  useSearchParams: () => mocks.params,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next-auth/react', () => ({ signOut: vi.fn() }))

import { EMAIL_VERIFY_LINK_LIFETIME, EMAIL_VERIFY_LINK_TTL_MS, emailVerifyLinkExpiresAt } from '@/lib/auth/emailVerifyLink'
import { buildVerificationEmailHtml } from '@/lib/email/verification-email-html'
import { VerifyEmailV4 } from '@/components/core-app/screens/VerifyEmailV4'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSessionAndProfile.mockResolvedValue({ userId: 'user-1', email: 'manager@gmail.com' })
  mocks.tokenCreate.mockImplementation(async ({ data }: { data: { expiresAt: Date } }) => ({ id: 'tok-1', createdAt: new Date(), ...data }))
  mocks.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
  mocks.params = new URLSearchParams()
})
afterEach(() => cleanup())

describe('how long a confirmation link works', () => {
  it('is 7 days, and the words match the number', () => {
    expect(EMAIL_VERIFY_LINK_TTL_MS).toBe(7 * DAY)
    expect(EMAIL_VERIFY_LINK_LIFETIME).toBe('7 days')
    expect(emailVerifyLinkExpiresAt(1_000).getTime()).toBe(1_000 + 7 * DAY)
  })

  it('"send a new link" stores a link that works for 7 days', async () => {
    const { POST } = await import('@/app/api/auth/verify-email/send/route')
    const before = Date.now()
    const res = await POST(
      new Request('https://www.allfantasy.ai/api/auth/verify-email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnTo: '/import' }),
      }),
    )
    expect(res.status).toBe(200)
    const stored = mocks.tokenCreate.mock.calls[0]![0].data.expiresAt as Date
    expect(stored.getTime() - before).toBeGreaterThanOrEqual(7 * DAY)
    expect(stored.getTime() - Date.now()).toBeLessThanOrEqual(7 * DAY)
    // ...and the email it sends says so.
    expect(mocks.send.mock.calls[0]![0].html).toContain('This link works for 7 days.')
  })

  it('the confirmation email says 7 days, never 1 hour', () => {
    const html = buildVerificationEmailHtml({
      title: 'Verify',
      greeting: 'Hi',
      verifyUrl: 'https://allfantasy.ai/verify/email?token=t',
      footerNote: 'Not you? Ignore this.',
    })
    expect(html).toContain('This link works for 7 days.')
    expect(html).not.toMatch(/expires in 1 hour/i)
  })

  it('the /verify screen says 7 days, with and without an address to name', () => {
    const { rerender } = render(<VerifyEmailV4 email="manager@gmail.com" alreadyVerified={false} signedIn />)
    expect(screen.getByText(/It works for 7 days\./)).toBeTruthy()
    expect(screen.queryByText(/expires in an hour/i)).toBeNull()
    rerender(<VerifyEmailV4 email={null} alreadyVerified={false} signedIn />)
    expect(screen.getByText(/It works for 7 days\./)).toBeTruthy()
  })

  /*
   * Sign-up and an address change mail a link from inside large routes that are covered by their
   * own suites; this pins that both take the shared lifetime rather than a number of their own.
   * Anchored to the start of a statement, so a comment naming the old value cannot satisfy it.
   */
  it.each([
    'app/api/auth/register/route.ts',
    'app/api/auth/verify-email/send/route.ts',
    'app/api/user/contact/email/route.ts',
  ])('%s issues links with the shared lifetime', (file) => {
    const src = readFileSync(path.join(process.cwd(), file), 'utf8')
    expect(src).toMatch(/^\s*const expiresAt = emailVerifyLinkExpiresAt\(\)/m)
    expect(src).not.toMatch(/^\s*const expiresAt = new Date\(Date\.now\(\) \+/m)
  })

  it('the password-reset link is a different kind of link and keeps its 1 hour', () => {
    const src = readFileSync(path.join(process.cwd(), 'app/api/auth/password/reset/request/route.ts'), 'utf8')
    expect(src).not.toContain('emailVerifyLink')
    expect(src).toMatch(/^\s*const expiresAt = new Date\(Date\.now\(\) \+ 1000 \* 60 \* 60\)/m)
  })
})

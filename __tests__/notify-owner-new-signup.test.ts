// @vitest-environment node
/**
 * lib/notifications/notifyOwnerOfNewSignup.ts
 *
 * Guarantee under test: exactly 1 owner email per NEW account, 0 on login/update,
 * and the notification can NEVER block or fail the signup (fire-and-forget).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { sendNotificationEmailMock } = vi.hoisted(() => ({
  sendNotificationEmailMock: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('@/lib/resend-client', () => ({
  sendNotificationEmail: sendNotificationEmailMock,
}))

const { notifyOwnerOfNewSignup } = await import('@/lib/notifications/notifyOwnerOfNewSignup')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notifyOwnerOfNewSignup', () => {
  it('sends exactly one email to the owner address', async () => {
    await notifyOwnerOfNewSignup({
      email: 'new@example.com',
      method: 'email',
      userId: 'u1',
      username: 'newbie',
    })
    expect(sendNotificationEmailMock).toHaveBeenCalledTimes(1)
    const arg = sendNotificationEmailMock.mock.calls[0]![0]
    expect(arg.to).toBe('allfantasysportsapp@gmail.com')
    expect(arg.subject).toContain('email')
    expect(arg.subject).toContain('newbie')
  })

  it('labels each method distinctly', async () => {
    const methods = ['email', 'sleeper', 'oauth:google', 'oauth:discord'] as const
    for (const m of methods) {
      sendNotificationEmailMock.mockClear()
      await notifyOwnerOfNewSignup({ email: null, method: m, userId: 'u', username: 'n' })
      expect(sendNotificationEmailMock.mock.calls[0]![0].subject).toContain(m)
    }
  })

  it('NEVER throws even if the mailer rejects — signup must not be affected', async () => {
    sendNotificationEmailMock.mockRejectedValueOnce(new Error('resend down'))
    // If this rejected, an un-awaited caller would get an unhandled rejection; it must resolve.
    await expect(
      notifyOwnerOfNewSignup({ email: 'x@y.z', method: 'email', userId: 'u', username: 'n' })
    ).resolves.toBeUndefined()
  })

  it('escapes HTML in user-controlled fields (no injection into the owner email)', async () => {
    await notifyOwnerOfNewSignup({
      email: '<script>alert(1)</script>@x.z',
      method: 'email',
      userId: 'u',
      username: '<b>evil</b>',
    })
    const body = sendNotificationEmailMock.mock.calls[0]![0].bodyHtml
    expect(body).not.toContain('<script>')
    expect(body).not.toContain('<b>evil</b>')
    expect(body).toContain('&lt;script&gt;')
  })
})

describe('call-site guarantee (source-level): create branches only, exclude sites clean', () => {
  // Source-scan guards: the "exactly 1 per account, 0 on login" property is a property of
  // WHERE the helper is called, which a unit test of the helper alone cannot see. These assert
  // the include sites call it and the exclude sites do not — collect-all then assert.
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const { resolve } = require('node:path') as typeof import('node:path')
  const root = resolve(__dirname, '..')
  const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

  it('both include sites call notifyOwnerOfNewSignup', () => {
    // lib/auth.ts WAS a third include site: its Sleeper-username provider created accounts.
    // That provider is gone (it signed callers in with a public username as the only
    // credential), so lib/auth.ts now creates no real accounts — see the test below.
    const includes = [
      'app/api/auth/register/route.ts',
      'lib/auth/SocialAccountLinkingService.ts',
    ]
    const missing = includes.filter((f) => !read(f).includes('notifyOwnerOfNewSignup('))
    expect(missing).toEqual([])
  })

  it('none of the three exclude sites call it', () => {
    const excludes = [
      'app/api/admin/bootstrap/route.ts',
      'lib/admin-dashboard/DuplicateManagerVerificationService.ts',
    ]
    const offenders = excludes.filter((f) => read(f).includes('notifyOwnerOfNewSignup'))
    expect(offenders).toEqual([])
  })

  it('lib/auth.ts never invokes it — its only remaining account create is the dev bypass', () => {
    // The Sleeper-username create branch was the one include site in auth.ts; what remains is
    // ensureDevAuthUser (non-production only), an EXCLUDE site. Count invocations only —
    // `notifyOwnerOfNewSignup(` — so a stray import line would not change the answer.
    const invocations = read('lib/auth.ts').split('notifyOwnerOfNewSignup(').length - 1
    expect(invocations).toBe(0)
  })
})

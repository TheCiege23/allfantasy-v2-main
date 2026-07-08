/**
 * Locks the root cause of the core Playwright `/api/auth/login` 401 failure.
 *
 * The E2E admin helper (`e2e/helpers/admin-timezone-smoke.ts` → `loginAsAdmin`)
 * posts `password: process.env.ADMIN_PASSWORD ?? 'admin123'` to `/api/auth/login`.
 * That route only authenticates when `ADMIN_PASSWORD` (plaintext) or
 * `ADMIN_PASSWORD_HASH` (bcrypt) is configured on the SERVER — otherwise every
 * admin login returns 401 "Invalid password", which cascaded to ~40 @admin core
 * specs. The Playwright dev server had no `ADMIN_PASSWORD`, so the fix sets it in
 * `playwright.config.ts` `webServer.env`. This test proves both directions and
 * that production route behavior is unchanged (still purely env-driven).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (handler: unknown) => handler }))
vi.mock('@/lib/adminSession', () => ({ signAdminSessionCookie: () => 'signed-admin-cookie' }))

function post(body: unknown) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Unique IP per request so the route's in-memory rate-limit bucket never
      // bleeds across cases.
      'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250) + 1}-${Math.random()}`,
    },
    body: JSON.stringify(body),
  })
}

const SAVED = { pw: process.env.ADMIN_PASSWORD, hash: process.env.ADMIN_PASSWORD_HASH }

afterEach(() => {
  if (SAVED.pw === undefined) delete process.env.ADMIN_PASSWORD
  else process.env.ADMIN_PASSWORD = SAVED.pw
  if (SAVED.hash === undefined) delete process.env.ADMIN_PASSWORD_HASH
  else process.env.ADMIN_PASSWORD_HASH = SAVED.hash
})

describe('/api/auth/login admin route (E2E 401 root cause)', () => {
  it('401s when NO ADMIN_PASSWORD/HASH is configured (reproduces the E2E failure)', async () => {
    delete process.env.ADMIN_PASSWORD
    delete process.env.ADMIN_PASSWORD_HASH
    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(post({ password: 'admin123', next: '/admin?tab=audit' }))
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid password.' })
  })

  it('200s when ADMIN_PASSWORD is set and the password matches (the fix lever)', async () => {
    process.env.ADMIN_PASSWORD = 'admin123'
    delete process.env.ADMIN_PASSWORD_HASH
    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(post({ password: 'admin123', next: '/admin?tab=audit' }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })
  })

  it('401s when ADMIN_PASSWORD is set but the password is wrong (production behavior preserved)', async () => {
    process.env.ADMIN_PASSWORD = 'admin123'
    delete process.env.ADMIN_PASSWORD_HASH
    const { POST } = await import('@/app/api/auth/login/route')
    const res = await POST(post({ password: 'not-the-password', next: '/admin' }))
    expect(res.status).toBe(401)
  })
})

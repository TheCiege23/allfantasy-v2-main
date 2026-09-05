import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { resolveSnapshotMock } = vi.hoisted(() => ({ resolveSnapshotMock: vi.fn() }))

vi.mock('@/lib/adminAuth', () => ({
  isAdminRole: vi.fn(() => false),
  isAdminEmailAllowed: vi.fn(() => false),
}))
vi.mock('@/lib/dev-admin/access', () => ({
  isDevAdminUserId: vi.fn(() => false),
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveSnapshot = resolveSnapshotMock
  },
}))

import { canAccessFantasyOS, resolveFantasyOsAccess } from '@/lib/fantasy-os/access'
import { isAdminRole, isAdminEmailAllowed } from '@/lib/adminAuth'
import { isDevAdminUserId } from '@/lib/dev-admin/access'

const snapshot = (plans: string[], status = 'active') => ({
  plans,
  status,
  currentPeriodEnd: null,
  gracePeriodEnd: null,
})

describe('canAccessFantasyOS — enterprise workspace access boundary', () => {
  beforeEach(() => {
    vi.mocked(isAdminRole).mockReturnValue(false)
    vi.mocked(isAdminEmailAllowed).mockReturnValue(false)
    vi.mocked(isDevAdminUserId).mockReturnValue(false)
    resolveSnapshotMock.mockReset()
  })

  it('platform admin (role) is always allowed, without a subscription read', async () => {
    vi.mocked(isAdminRole).mockReturnValue(true)
    expect(await canAccessFantasyOS({ userId: 'u1', role: 'admin' })).toBe(true)
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
    expect((await resolveFantasyOsAccess({ userId: 'u1', role: 'admin' })).reason).toBe('admin')
  })

  it('owner (allowed admin email) is allowed', async () => {
    vi.mocked(isAdminEmailAllowed).mockReturnValue(true)
    const r = await resolveFantasyOsAccess({ userId: 'u1', email: 'owner@allfantasy.ai' })
    expect(r).toEqual({ allowed: true, reason: 'owner' })
  })

  it('dev-admin userId is allowed', async () => {
    vi.mocked(isDevAdminUserId).mockReturnValue(true)
    expect(await canAccessFantasyOS({ userId: 'dev-1' })).toBe(true)
  })

  it('active enterprise entitlement is allowed', async () => {
    resolveSnapshotMock.mockResolvedValue(snapshot(['enterprise'], 'active'))
    expect(await resolveFantasyOsAccess({ userId: 'u1', email: 'e@x.com' })).toEqual({
      allowed: true,
      reason: 'enterprise',
    })
  })

  it('grace-status enterprise entitlement is allowed', async () => {
    resolveSnapshotMock.mockResolvedValue(snapshot(['enterprise'], 'grace'))
    expect(await canAccessFantasyOS({ userId: 'u1' })).toBe(true)
  })

  it('non-enterprise plan (e.g. pro) is NOT allowed', async () => {
    resolveSnapshotMock.mockResolvedValue(snapshot(['pro'], 'active'))
    expect(await canAccessFantasyOS({ userId: 'u1' })).toBe(false)
  })

  it('unauthenticated (no userId) is NOT allowed and never reads subscriptions', async () => {
    expect(await canAccessFantasyOS({ userId: null })).toBe(false)
    expect(resolveSnapshotMock).not.toHaveBeenCalled()
  })

  it('expired enterprise entitlement is NOT allowed', async () => {
    resolveSnapshotMock.mockResolvedValue(snapshot(['enterprise'], 'expired'))
    expect(await canAccessFantasyOS({ userId: 'u1' })).toBe(false)
  })

  it('fails closed when the entitlement resolver throws', async () => {
    resolveSnapshotMock.mockRejectedValue(new Error('db down'))
    expect(await canAccessFantasyOS({ userId: 'u1' })).toBe(false)
  })
})

/**
 * Static wiring guard on the boundary itself.
 *
 * Until 2026-09-05 `app/fantasy-os/page.tsx` made ZERO calls into the access module and
 * `middleware.ts` named no fantasy-os path, so `executive/page.tsx` — whose own comment called its
 * check "defense in depth" — was the only lock, with nothing behind it. The unit tests above prove
 * the resolver decides correctly; they cannot prove anyone ASKS it. That is what these assert.
 *
 * ⚠ These read their SUBJECT with no `fs.existsSync` guard, deliberately. If a page is moved or
 * renamed this must fail loudly with ENOENT — a guard here would make it scan nothing and pass,
 * which is the exact failure mode that let the gap exist.
 */
describe('both /fantasy-os surfaces ask the resolver (static wiring)', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

  it.each([['app/fantasy-os/page.tsx'], ['app/fantasy-os/executive/page.tsx']])(
    '%s imports and calls canAccessFantasyOS',
    (file) => {
      const src = read(file)
      expect(src).toMatch(/from '@\/lib\/fantasy-os\/access'/)
      expect(src).toMatch(/canAccessFantasyOS\(/)
    },
  )

  it('the gateway redirects an authenticated viewer who is not entitled', () => {
    expect(read('app/fantasy-os/page.tsx')).toMatch(/if \(!allowed\) redirect\(/)
  })

  it('the gateway does NOT redirect a signed-out visitor — it is the sign-in funnel', () => {
    // The access call is nested inside `if (isAuthenticated)`, so a signed-out visitor still gets
    // the gateway's own signed-out branch and its callbackUrl instead of being bounced.
    expect(read('app/fantasy-os/page.tsx')).toMatch(/if \(isAuthenticated\) \{[\s\S]*?canAccessFantasyOS/)
    expect(read('app/fantasy-os/FantasyOsGateway.tsx')).toContain('/login?callbackUrl=/fantasy-os')
  })
})

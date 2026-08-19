import { describe, expect, it } from 'vitest'
import { authorizePlatformOsRequest, type RequireAdminFn } from '@/lib/decision-os/platformOsAuthorization'

function fakeRequireAdmin(result: Awaited<ReturnType<RequireAdminFn>>): RequireAdminFn {
  return (async () => result) as RequireAdminFn
}

describe('authorizePlatformOsRequest', () => {
  it('denies an unauthenticated caller with status 401', async () => {
    const result = await authorizePlatformOsRequest({
      requireAdmin: fakeRequireAdmin({ ok: false, res: Response.json({ error: 'Unauthorized' }, { status: 401 }) }),
    })
    expect(result).toEqual({ authorized: false, status: 401 })
  })

  it('denies a signed-in but non-admin caller with status 403', async () => {
    const result = await authorizePlatformOsRequest({
      requireAdmin: fakeRequireAdmin({ ok: false, res: Response.json({ error: 'Forbidden' }, { status: 403 }) }),
    })
    expect(result).toEqual({ authorized: false, status: 403 })
  })

  it('authorizes a real site admin, echoing their user id', async () => {
    const result = await authorizePlatformOsRequest({
      requireAdmin: fakeRequireAdmin({ ok: true, user: { id: 'admin-123', role: 'admin' } }),
    })
    expect(result).toEqual({ authorized: true, adminUserId: 'admin-123' })
  })

  it('falls back to email when the admin user has no id', async () => {
    const result = await authorizePlatformOsRequest({
      requireAdmin: fakeRequireAdmin({ ok: true, user: { email: 'admin@allfantasy.local', role: 'admin' } }),
    })
    expect(result).toEqual({ authorized: true, adminUserId: 'admin@allfantasy.local' })
  })

  it('never invents an authorization outcome when neither id nor email is present', async () => {
    const result = await authorizePlatformOsRequest({
      requireAdmin: fakeRequireAdmin({ ok: true, user: {} }),
    })
    expect(result).toEqual({ authorized: true, adminUserId: 'unknown-admin' })
  })
})

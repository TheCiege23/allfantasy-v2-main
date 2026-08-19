import { describe, expect, it, vi } from 'vitest'
import {
  authorizeLeagueContextMutation,
  type GetLeagueRoleFn,
  type LeagueContextAuthorizationDeps,
  type RequireAdminFn,
} from '@/lib/decision-os/leagueContextAuthorization'

function fakeGetLeagueRole(role: Awaited<ReturnType<GetLeagueRoleFn>>): GetLeagueRoleFn {
  return (async () => role) as GetLeagueRoleFn
}

function fakeRequireAdmin(result: Awaited<ReturnType<RequireAdminFn>>): RequireAdminFn {
  return (async () => result) as RequireAdminFn
}

const NEVER_ADMIN = fakeRequireAdmin({ ok: false, res: Response.json({ error: 'Forbidden' }, { status: 403 }) })
const IS_ADMIN = fakeRequireAdmin({ ok: true, user: { id: 'admin-1', role: 'admin' } })

function deps(overrides: Partial<LeagueContextAuthorizationDeps>): LeagueContextAuthorizationDeps {
  return {
    getLeagueRole: fakeGetLeagueRole(null),
    requireAdmin: NEVER_ADMIN,
    ...overrides,
  }
}

describe('authorizeLeagueContextMutation', () => {
  it('denies an unauthenticated caller with 401, before checking role or admin', async () => {
    const getLeagueRole = vi.fn()
    const result = await authorizeLeagueContextMutation('league-1', null, deps({ getLeagueRole }))
    expect(result).toEqual({ authorized: false, status: 401 })
    expect(getLeagueRole).not.toHaveBeenCalled()
  })

  it('authorizes the league commissioner', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'user-1',
      deps({ getLeagueRole: fakeGetLeagueRole('commissioner') }),
    )
    expect(result).toEqual({ authorized: true, via: 'commissioner' })
  })

  it('authorizes a co-commissioner', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'user-2',
      deps({ getLeagueRole: fakeGetLeagueRole('co_commissioner') }),
    )
    expect(result).toEqual({ authorized: true, via: 'co_commissioner' })
  })

  it('denies a plain member with 403 when not also a site admin', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'user-3',
      deps({ getLeagueRole: fakeGetLeagueRole('member'), requireAdmin: NEVER_ADMIN }),
    )
    expect(result).toEqual({ authorized: false, status: 403 })
  })

  it('denies a viewer with 403', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'user-4',
      deps({ getLeagueRole: fakeGetLeagueRole('viewer') }),
    )
    expect(result).toEqual({ authorized: false, status: 403 })
  })

  it('denies a caller with no relationship to the league (null role) when not a site admin', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'user-5',
      deps({ getLeagueRole: fakeGetLeagueRole(null) }),
    )
    expect(result).toEqual({ authorized: false, status: 403 })
  })

  it('authorizes a site admin even with no league relationship', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'admin-1',
      deps({ getLeagueRole: fakeGetLeagueRole(null), requireAdmin: IS_ADMIN }),
    )
    expect(result).toEqual({ authorized: true, via: 'site_admin' })
  })

  it('authorizes a site admin who is also just a plain member (admin path still applies)', async () => {
    const result = await authorizeLeagueContextMutation(
      'league-1',
      'admin-2',
      deps({ getLeagueRole: fakeGetLeagueRole('member'), requireAdmin: IS_ADMIN }),
    )
    expect(result).toEqual({ authorized: true, via: 'site_admin' })
  })
})

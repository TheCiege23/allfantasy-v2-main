/**
 * Fantasy OS Suite — Phase OS-C6.1: Backend Freeze Certification (Decision OS Read Authorization
 * Hardening).
 *
 * `authorizeLeagueRead` wraps `getLeagueRole` (the existing, already-real, already-tested per-league
 * role resolver) — this test mocks that one dependency and proves the wrapper's own allow/deny
 * decisions, deterministically, with no real Prisma call.
 */
import { describe, expect, it, vi } from 'vitest'
import { authorizeLeagueRead } from '@/lib/decision-os/leagueReadAuthorization'
import type { LeagueRole } from '@/lib/league/permissions'

function deps(role: LeagueRole) {
  return { getLeagueRole: vi.fn().mockResolvedValue(role) }
}

describe('authorizeLeagueRead', () => {
  it('denies an unauthenticated caller (401), never calling getLeagueRole', async () => {
    const d = deps('commissioner')
    const result = await authorizeLeagueRead('league-1', null, d)
    expect(result).toEqual({ authorized: false, status: 401 })
    expect(d.getLeagueRole).not.toHaveBeenCalled()
  })

  it('denies an authenticated caller with no relationship to the league (403) — the real cross-league leak this phase closes', async () => {
    const d = deps(null)
    const result = await authorizeLeagueRead('league-1', 'user-1', d)
    expect(result).toEqual({ authorized: false, status: 403 })
  })

  it.each<LeagueRole>(['commissioner', 'co_commissioner', 'member', 'viewer'])(
    'allows a real "%s" role',
    async (role) => {
      const d = deps(role)
      const result = await authorizeLeagueRead('league-1', 'user-1', d)
      expect(result).toEqual({ authorized: true, role })
    },
  )

  it('calls getLeagueRole with the real leagueId and userId, deterministically', async () => {
    const d = deps('member')
    await authorizeLeagueRead('league-42', 'user-7', d)
    expect(d.getLeagueRole).toHaveBeenCalledWith('league-42', 'user-7')
    expect(d.getLeagueRole).toHaveBeenCalledTimes(1)
  })
})

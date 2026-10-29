/**
 * Import carryover keeps the imported league's team count for redraft, dynasty, keeper and best
 * ball even when the native create list for that type lacks it (a 9- or 32-team dynasty import).
 * Native creation keeps today's lists, the requested count must still equal the import's, and the
 * special modes (Zombie here) stay on their lists.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeMock = vi.hoisted(() => vi.fn())
const leagueFindUnique = vi.hoisted(() => vi.fn())
const leagueTeamCount = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: leagueFindUnique },
    leagueTeam: { count: leagueTeamCount },
  },
}))
vi.mock('@/lib/league/permissions', () => ({
  getLeagueRole: vi.fn().mockResolvedValue('commissioner'),
  isCommissionerRole: (role: string) => role === 'commissioner' || role === 'co_commissioner',
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn(function EntitlementResolverMock(this: { resolveSnapshot?: unknown }) {
    this.resolveSnapshot = vi.fn().mockResolvedValue({ plans: [], status: 'none' })
  }),
}))
vi.mock('@/lib/meta-capi', () => ({ trackMetaServerEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/league-creation/canonical/executeCanonicalLeagueCreation', () => ({
  executeCanonicalLeagueCreation: executeMock,
}))
vi.mock('@/lib/redraft-creation/resolve-app-user-for-league', () => ({
  resolveAppUserIdForLeagueCreate: vi.fn().mockResolvedValue({ ok: true, appUserId: 'app-user-1', resolvedVia: 'id' as const }),
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'app-user-1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { postCreateLeague } from '@/lib/league-creation/canonical/createLeagueHandler'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

function body(teamCount: number, concept = 'dynasty', extra: Record<string, unknown> = {}) {
  return {
    concept,
    sport: 'NFL',
    scoringPreset: 'fb_half_ppr',
    teamCount,
    draftType: 'snake',
    leagueName: 'Carryover Test',
    ...extra,
  }
}

function post(payload: Record<string, unknown>) {
  return postCreateLeague(new Request('http://localhost/api/leagues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

function importedLeague(teams: number) {
  leagueFindUnique.mockResolvedValue({ id: 'imported-1', platform: 'sleeper', sport: 'NFL', leagueSize: teams })
  leagueTeamCount.mockResolvedValue(teams)
}

describe('import carryover keeps the imported team count', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeMock.mockResolvedValue({
      ok: true,
      response: { success: true, league: { id: 'league-new', concept: 'dynasty', sport: 'NFL' }, homepageUrl: '/league/league-new' },
    })
  })

  it.each([9, 32])('accepts a %i-team dynasty carryover', async (teams) => {
    importedLeague(teams)
    const res = await post(body(teams, 'dynasty', { sourceLeagueId: 'imported-1' }))
    expect(res.status).toBe(200)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      sourceLeagueId: 'imported-1',
      body: expect.objectContaining({ teamCount: teams }),
    }))
  })

  it('still refuses a native 9-team dynasty', async () => {
    const res = await post(body(9))
    expect(res.status).toBe(400)
    // Refused for its team count, not for some other field in the body.
    expect((await res.json()).error).toMatch(/team count/i)
    expect(executeMock).not.toHaveBeenCalled()
    expect(leagueFindUnique).not.toHaveBeenCalled()
  })

  it.each([
    [9, 10],
    [9, 32],
    [32, 31],
  ])('refuses a carryover of a %i-team import that asks for %i teams', async (imported, requested) => {
    importedLeague(imported)
    const res = await post(body(requested, 'dynasty', { sourceLeagueId: 'imported-1' }))
    expect(res.status).toBe(400)
    // Refused for its team count, not for some other field in the body.
    expect((await res.json()).error).toMatch(/team count/i)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('keeps Zombie on its own list even for a carryover', async () => {
    importedLeague(9)
    const res = await post(body(9, 'zombie', { sourceLeagueId: 'imported-1' }))
    expect(res.status).toBe(400)
    // Refused for its team count, not for some other field in the body.
    expect((await res.json()).error).toMatch(/team count/i)
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('validateCreatePayload and the imported team count', () => {
  it('refuses an off-list dynasty count unless it is the import carryover count', () => {
    expect(validateCreatePayload(body(9)).ok).toBe(false)
    expect(validateCreatePayload(body(9), { importedTeamCount: 9 }).ok).toBe(true)
    expect(validateCreatePayload(body(32), { importedTeamCount: 32 }).ok).toBe(true)
    // The allowance is for the import's own count only, and never past 32.
    expect(validateCreatePayload(body(32), { importedTeamCount: 9 }).ok).toBe(false)
    expect(validateCreatePayload(body(33), { importedTeamCount: 33 }).ok).toBe(false)
  })
})

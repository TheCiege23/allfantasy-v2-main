/**
 * POST /api/leagues no longer copies an imported league into a new one (the copy flow is retired,
 * docs/league-import/IN_PLACE_NATIVE_CONVERSION_PLAN.md §10): any `sourceLeagueId` is refused with
 * 410 before anything is read. The validator still has its imported-team-count option (the API
 * no longer passes it); its tests stay below. Dynasty takes every size from 4 to 250.
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

describe('POST /api/leagues no longer copies an imported league (plan §10)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    executeMock.mockResolvedValue({
      ok: true,
      response: { success: true, league: { id: 'league-new', concept: 'dynasty', sport: 'NFL' }, homepageUrl: '/league/league-new' },
    })
  })

  it.each([
    ['an imported league id', 'imported-1'],
    ['an empty id', ''],
    ['a non-string id', 42],
  ])('refuses a copy request with %s, before reading or writing anything', async (_label, sourceLeagueId) => {
    importedLeague(9)
    const res = await post(body(9, 'dynasty', { sourceLeagueId }))
    expect(res.status).toBe(410)
    const json = await res.json()
    expect(json.errors[0]).toMatchObject({ path: 'sourceLeagueId', code: 'IMPORT_COPY_RETIRED' })
    expect(json.error).toMatch(/Commissioner tab/)
    expect(leagueFindUnique).not.toHaveBeenCalled()
    expect(leagueTeamCount).not.toHaveBeenCalled()
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('refuses it for a test league too', async () => {
    const res = await post(body(9, 'dynasty', { sourceLeagueId: 'imported-1', testLeague: true }))
    expect(res.status).toBe(410)
    expect(executeMock).not.toHaveBeenCalled()
  })

  it('still creates a native 9-team dynasty, and never passes a copy source on', async () => {
    const res = await post(body(9))
    expect(res.status).toBe(200)
    expect(executeMock).toHaveBeenCalledTimes(1)
    expect(executeMock.mock.calls[0]?.[0]).not.toHaveProperty('sourceLeagueId')
  })

  it('an off-list best ball count is refused as a native create', async () => {
    const res = await post(body(9, 'best_ball'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/team count/i)
    expect(executeMock).not.toHaveBeenCalled()
  })
})

describe('validateCreatePayload and the imported team count', () => {
  it('refuses an off-list best ball count unless it is the import carryover count', () => {
    expect(validateCreatePayload(body(9, 'best_ball')).ok).toBe(false)
    expect(validateCreatePayload(body(9, 'best_ball'), { importedTeamCount: 9 }).ok).toBe(true)
    expect(validateCreatePayload(body(32, 'best_ball'), { importedTeamCount: 32 }).ok).toBe(true)
    // The allowance is for the import's own count only, and never past 250.
    expect(validateCreatePayload(body(32, 'best_ball'), { importedTeamCount: 9 }).ok).toBe(false)
    expect(validateCreatePayload(body(251, 'best_ball'), { importedTeamCount: 251 }).ok).toBe(false)
  })

  it('takes every dynasty size from 4 to 250 natively, and nothing past it', () => {
    // College: the whole native range. The owner's own college leagues run 140 and 180 teams.
    const college = { sport: 'NCAAF', scoringPreset: 'ncaaf_half_ppr' }
    for (const teams of [4, 9, 34, 36, 160, 250]) expect(validateCreatePayload(body(teams, 'dynasty', college)).ok, `NCAAF ${teams}`).toBe(true)
    // NFL: never more teams than the NFL has (owner's rule, 2026-11-22: lib/league/teamCountLimits.ts PRO_LEAGUE_TEAMS).
    for (const teams of [4, 9, 31, 32]) expect(validateCreatePayload(body(teams)).ok, `NFL ${teams}`).toBe(true)
    for (const teams of [33, 34, 36, 88, 160]) expect(validateCreatePayload(body(teams)).ok, `NFL ${teams}`).toBe(false)
    // An imported 34- or 36-team pro league (the owner's commissioner runs both on Fantrax) keeps its size.
    for (const teams of [34, 36]) expect(validateCreatePayload(body(teams), { importedTeamCount: teams }).ok, `NFL import ${teams}`).toBe(true)
    // An imported league keeps the size it has.
    expect(validateCreatePayload(body(160), { importedTeamCount: 160 }).ok).toBe(true)
    expect(validateCreatePayload(body(3)).ok).toBe(false)
    expect(validateCreatePayload(body(251)).ok).toBe(false)
    expect(validateCreatePayload(body(251), { importedTeamCount: 251 }).ok).toBe(false)
  })
})

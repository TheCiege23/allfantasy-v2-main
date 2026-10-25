import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Odd-team native leagues: who may create or resize to one, and the median default.
 *
 * Odd KEEPER sizes are an AF Commissioner option — refused at POST /api/leagues and on the pre-draft
 * resize without the plan. Odd REDRAFT sizes have always been free (2–32) and stay free; a resize
 * from an even to an odd size turns league median on, as a new odd league starts.
 */

const h = vi.hoisted(() => ({
  hasPlan: false,
  executeMock: vi.fn(),
  resizeMock: vi.fn(),
  prismaMock: {
    league: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    leagueTeam: { count: vi.fn() },
    userProfile: { findFirst: vi.fn() },
    leagueSettings: { upsert: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftPlayoffRound: { findFirst: vi.fn() },
    draftSession: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: h.prismaMock }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({
  hasAfCommissionerPlan: vi.fn(async () => h.hasPlan),
  AF_COMMISSIONER_PLAN_FEATURE: 'commissioner_ai_tools',
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn(async () => ({ hasAccess: h.hasPlan }))
    this.resolveSnapshot = vi.fn(async () => ({ plans: [], status: 'none' }))
  }),
}))
vi.mock('@/lib/league/permissions', () => ({
  requireCommissionerRole: vi.fn(async () => undefined),
  getLeagueRole: vi.fn(async () => 'commissioner'),
  isCommissionerRole: () => true,
}))
vi.mock('@/lib/league-creation/canonical/executeCanonicalLeagueCreation', () => ({
  executeCanonicalLeagueCreation: h.executeMock,
}))
vi.mock('@/lib/redraft-creation/resolve-app-user-for-league', () => ({
  resolveAppUserIdForLeagueCreate: vi.fn(async () => ({ ok: true, appUserId: 'app-user-1', resolvedVia: 'id' as const })),
}))
vi.mock('@/lib/meta-capi', () => ({ trackMetaServerEvent: vi.fn(async () => undefined) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'app-user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/resizeNativeLeague', () => ({ resizeNativeLeague: h.resizeMock }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn() }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/server/services/commissionerService', () => ({ assertSettingsEditAllowed: vi.fn() }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => undefined) }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: vi.fn(async () => undefined) }))

import { postCreateLeague } from '@/lib/league-creation/canonical/createLeagueHandler'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { getTeamCountOptions } from '@/lib/create-league-v2/rules-engine'
import {
  defaultMedianGameFor,
  lockedOddTeamCounts,
  oddTeamCountNeedsAfCommissioner,
  teamCountOptionsForPlan,
} from '@/lib/league/oddTeamLeagues'

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const
const SCORING: Record<(typeof SPORTS)[number], string> = {
  NFL: 'fb_half_ppr',
  NBA: 'nba_points',
  NHL: 'nhl_points',
  MLB: 'mlb_points',
}

function post(payload: Record<string, unknown>) {
  return postCreateLeague(new Request('http://localhost/api/leagues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }))
}

function body(concept: string, sport: (typeof SPORTS)[number], teamCount: number) {
  return { concept, sport, scoringPreset: SCORING[sport], teamCount, draftType: 'snake', leagueName: 'Odd Team Test' }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.hasPlan = false
  h.executeMock.mockResolvedValue({
    ok: true,
    response: { success: true, league: { id: 'league-new', concept: 'keeper', sport: 'NFL' }, homepageUrl: '/league/league-new' },
  })
})

describe('the odd-size policy', () => {
  it('locks odd keeper sizes and leaves redraft sizes free', () => {
    expect(oddTeamCountNeedsAfCommissioner('keeper', 7)).toBe(true)
    expect(oddTeamCountNeedsAfCommissioner('keeper', 8)).toBe(false)
    expect(oddTeamCountNeedsAfCommissioner('redraft', 7)).toBe(false)
    const keeper = getTeamCountOptions('NFL', 'keeper')
    expect(keeper).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
    expect(teamCountOptionsForPlan(keeper, 'keeper', false)).toEqual([4, 6, 8, 10, 12, 14, 16])
    expect(teamCountOptionsForPlan(keeper, 'keeper', true)).toEqual(keeper)
    expect(lockedOddTeamCounts(keeper, 'keeper', false)).toEqual([5, 7, 9, 11, 13, 15])
    expect(lockedOddTeamCounts(keeper, 'keeper', true)).toEqual([])
  })

  it('turns league median on for an odd league unless a choice was made', () => {
    expect(defaultMedianGameFor(7, null)).toBe(true)
    expect(defaultMedianGameFor(8, null)).toBe(false)
    expect(defaultMedianGameFor(7, false)).toBe(false)
    expect(defaultMedianGameFor(8, true)).toBe(true)
  })
})

describe('creating an odd-team league', () => {
  it.each(SPORTS)('%s: refuses a 7-team keeper league without AF Commissioner', async (sport) => {
    expect(validateCreatePayload(body('keeper', sport, 7)).ok).toBe(true)
    const res = await post(body('keeper', sport, 7))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.errors[0]).toMatchObject({ path: 'teamCount', code: 'ODD_TEAM_COUNT_REQUIRES_AF_COMMISSIONER' })
    expect(h.executeMock).not.toHaveBeenCalled()
  })

  it.each(SPORTS)('%s: creates a 7-team keeper league for a subscriber', async (sport) => {
    h.hasPlan = true
    const res = await post(body('keeper', sport, 7))
    expect(res.status).toBe(200)
    expect(h.executeMock).toHaveBeenCalledTimes(1)
  })

  it.each([5, 9, 15])('an even keeper size never asks for the plan; %i odd does', async (odd) => {
    expect((await post(body('keeper', 'NFL', odd - 1))).status).toBe(200)
    expect((await post(body('keeper', 'NFL', odd))).status).toBe(403)
  })

  it.each([5, 7, 9, 19])('a %i-team redraft league stays free', async (teams) => {
    const res = await post(body('redraft', 'NFL', teams))
    expect(res.status).toBe(200)
  })
})

function leagueRow(overrides: Record<string, unknown>) {
  return {
    id: 'league-1',
    platform: 'native',
    leagueType: 'keeper',
    sport: 'NFL',
    leagueSize: 8,
    medianGame: false,
    playoffTeams: 4,
    playoffStartWeek: 15,
    settings: {},
    teams: [],
    leagueSettings: null,
    ...overrides,
  }
}

describe('resizing a league to an odd size before the draft', () => {
  beforeEach(() => {
    h.prismaMock.league.findUnique.mockResolvedValue({ dynastyConfig: null, settings: {} })
    h.prismaMock.redraftSeason.findFirst.mockResolvedValue(null)
    h.prismaMock.redraftPlayoffRound.findFirst.mockResolvedValue(null)
    h.prismaMock.draftSession.findFirst.mockResolvedValue(null)
    h.prismaMock.draftSession.findMany.mockResolvedValue([])
    h.prismaMock.league.update.mockResolvedValue({})
    h.resizeMock.mockResolvedValue(undefined)
  })

  it('refuses a keeper league resized to 7 without AF Commissioner', async () => {
    h.prismaMock.league.findFirst.mockResolvedValue(leagueRow({}))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('app-user-1', { leagueId: 'league-1', leagueSize: 7 })
    expect(res.status).toBe(403)
    expect(h.resizeMock).not.toHaveBeenCalled()
  })

  it('resizes a keeper league to 7 for a subscriber, with league median on', async () => {
    h.hasPlan = true
    h.prismaMock.league.findFirst.mockResolvedValue(leagueRow({}))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('app-user-1', { leagueId: 'league-1', leagueSize: 7 })
    expect(res.status).toBe(200)
    expect(h.resizeMock).toHaveBeenCalledTimes(1)
    expect(h.resizeMock.mock.calls[0]?.[2]).toMatchObject({ medianGame: true })
  })

  it('resizes a redraft league to 7 without the plan, and turns league median on', async () => {
    h.prismaMock.league.findFirst.mockResolvedValue(leagueRow({ leagueType: 'redraft' }))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('app-user-1', { leagueId: 'league-1', leagueSize: 7 })
    expect(res.status).toBe(200)
    expect(h.resizeMock.mock.calls[0]?.[2]).toMatchObject({ medianGame: true })
  })

  it('keeps a median choice sent with the resize', async () => {
    h.prismaMock.league.findFirst.mockResolvedValue(leagueRow({ leagueType: 'redraft' }))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('app-user-1', { leagueId: 'league-1', leagueSize: 7, medianGame: false })
    expect(res.status).toBe(200)
    expect(h.resizeMock.mock.calls[0]?.[2]).toMatchObject({ medianGame: false })
  })

  it('an even resize leaves league median alone', async () => {
    h.prismaMock.league.findFirst.mockResolvedValue(leagueRow({ leagueType: 'redraft', leagueSize: 7 }))
    const { executeLeagueSettingsPatch } = await import('@/lib/league/execute-league-settings-patch')
    const res = await executeLeagueSettingsPatch('app-user-1', { leagueId: 'league-1', leagueSize: 10 })
    expect(res.status).toBe(200)
    expect(h.resizeMock.mock.calls[0]?.[2]).not.toHaveProperty('medianGame')
  })
})

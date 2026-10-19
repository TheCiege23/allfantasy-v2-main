import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 🛑 THE SCORING AND ROSTER EDITORS COMMISSIONERS ACTUALLY USE SKIPPED THE LIFECYCLE MATRIX.
 *
 * `ACTIONS` in server/services/leagueLifecycleService.ts says when `settings_edit_scoring` and
 * `settings_edit_roster` are allowed, and `assertSettingsEditAllowed` enforces it — but only on
 * `PATCH /api/leagues/[id]/settings` with a `section`. The per-sport scoring PUTs, the roster
 * settings PUT, and the section-less `PATCH /api/league/settings` (useAutosave) never asked, so a
 * commissioner could rewrite scoring in week 9 of the playoffs.
 *
 * These run the REAL gate chain (commissionerService → leagueActionGate → leagueLifecycleService)
 * against a mocked league row, so the matrix itself decides each case — nothing here restates it.
 */

const h = vi.hoisted(() => ({
  leagueRow: {} as Record<string, unknown>,
  saveScoring: vi.fn(),
  updateRoster: vi.fn(),
  resetRoster: vi.fn(),
  applyImportedRoster: vi.fn(),
  replaceOverrides: vi.fn(),
  leagueUpdate: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => h.leagueRow),
      findFirst: vi.fn(async () => ({ ...h.leagueRow, teams: [], leagueSettings: null })),
      update: h.leagueUpdate,
    },
    draftSession: { findFirst: vi.fn(async () => null) },
  },
}))

vi.mock('@/server/services/permissionService', () => ({
  isHeadCommissioner: vi.fn(async () => true),
  isElevatedCommissioner: vi.fn(async () => true),
  canViewLeague: vi.fn(async () => true),
  canDestructiveCommissionerAction: vi.fn(async () => true),
}))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ undoLastPick: vi.fn() }))
vi.mock('@/lib/waiver-wire/process-engine', () => ({ processWaiverClaimsForLeague: vi.fn() }))
vi.mock('@/server/services/standingsEngine', () => ({ recomputeStandingsForSeason: vi.fn() }))
vi.mock('@/lib/specialty-automation/orchestrator', () => ({ runSpecialtyAutomationOrchestrator: vi.fn() }))
vi.mock('@/lib/tournament/seasonDraftReleaseGate', () => ({ hasSeasonDraftRelease: vi.fn(async () => false) }))

vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    async evaluateUserFeatureAccess() {
      return { allowed: true }
    }
  },
}))
vi.mock('@/lib/category-scoring/nativeCategoryScoringContext', () => ({ nativeCategoryScoringContext: () => null }))

function scoringModule(prefix: string, buildName: string) {
  return {
    [`getLeague${prefix}ScoringConfig`]: vi.fn(async () => ({ presetKey: 'af_default' })),
    [`saveLeague${prefix}ScoringConfig`]: h.saveScoring,
    [`get${prefix}ScoringPresets`]: vi.fn(() => []),
    [buildName]: vi.fn(() => ({})),
  }
}
vi.mock('@/lib/nfl-scoring', () => scoringModule('Nfl', 'buildFullNflScoringConfig'))
vi.mock('@/lib/nba-scoring', () => scoringModule('Nba', 'buildFullScoringConfig'))
vi.mock('@/lib/nhl-scoring', () => scoringModule('Nhl', 'buildFullNhlScoringConfig'))
vi.mock('@/lib/mlb-scoring', () => scoringModule('Mlb', 'buildFullMlbScoringConfig'))
vi.mock('@/lib/ncaab-scoring', () => scoringModule('Ncaab', 'buildFullNcaabScoringConfig'))
vi.mock('@/lib/ncaaf-scoring', () => scoringModule('Ncaaf', 'buildFullNcaafScoringConfig'))
vi.mock('@/lib/soccer-scoring', () => scoringModule('Soccer', 'buildFullSoccerScoringConfig'))

vi.mock('@/lib/roster-engine', () => ({
  checkCommissionerPermission: vi.fn(async () => ({ isCommissioner: true })),
  resetLeagueRosterToDefault: h.resetRoster,
  mapImportedRosterToLeagueConfig: h.applyImportedRoster,
  previewImportedRosterForLeague: vi.fn(async () => ({})),
  getLeagueRosterConfig: vi.fn(async () => null),
  getRosterEngineRegistry: () => ({
    isSupported: () => true,
    getService: () => ({ getConfig: vi.fn(async () => ({})) }),
  }),
  updateLeagueRosterConfig: h.updateRoster,
}))
vi.mock('@/lib/commissioner/CommissionerChangeNotifier', () => ({ notifyCommissionerChange: vi.fn() }))
vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({ invalidateLeagueDraftCaches: vi.fn() }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn(async () => ({ ok: true })) }))

// Section-less PATCH pipeline: everything after the gate is mocked out so a pass reaches the write.
vi.mock('@/lib/league/permissions', () => ({ requireCommissionerRole: vi.fn(async () => undefined), getLeagueRole: vi.fn(async () => 'commissioner') }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn(async () => ({ ok: true })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/scoring-defaults/LeagueScoringConfigResolver', () => ({
  getLeagueScoringConfig: vi.fn(async () => ({ sport: 'NFL', categoryScoring: null, rules: [] })),
}))
vi.mock('@/lib/scoring-defaults/ScoringOverrideService', () => ({ replaceLeagueScoringOverrides: h.replaceOverrides }))
vi.mock('@/lib/scoring-defaults/ScoringKeyAliasResolver', () => ({ normalizeScoringStatKey: (k: string) => k }))
vi.mock('@/lib/scoring-defaults/queueLeagueScoringRecalc', () => ({ queueLeagueScoringRecalcAfterRulesChange: vi.fn() }))
vi.mock('@/lib/league/structuralSettingsLock', () => ({ structuralPatchRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    async resolveForUser() {
      return { hasAccess: true }
    }
  },
}))
vi.mock('@/lib/keeper/keeperRuleGate', () => ({ keeperRuleSettingsRefusal: vi.fn(async () => null) }))
vi.mock('@/lib/league/leagueChatThreadLink', () => ({ leagueChatThreadLinkRefusalInPatch: vi.fn(() => null) }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/tournament/divisions/leagueDraftTimeToTournament', () => ({ copyLeagueDraftTimeToTournament: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn(async () => null) }))
vi.mock('@/lib/league/commissioner-settings-derived-sync', () => ({ syncCommissionerDerivedLeagueState: vi.fn() }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ upsertLeagueWaiverSettings: vi.fn() }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ refreshLeagueWaiverNextRunAt: vi.fn() }))

import { PUT as nflPut } from '@/app/api/commissioner/leagues/[leagueId]/nfl-scoring/route'
import { PUT as nbaPut } from '@/app/api/commissioner/leagues/[leagueId]/nba-scoring/route'
import { PUT as nhlPut } from '@/app/api/commissioner/leagues/[leagueId]/nhl-scoring/route'
import { PUT as mlbPut } from '@/app/api/commissioner/leagues/[leagueId]/mlb-scoring/route'
import { PUT as ncaabPut } from '@/app/api/commissioner/leagues/[leagueId]/ncaab-scoring/route'
import { PUT as ncaafPut } from '@/app/api/commissioner/leagues/[leagueId]/ncaaf-scoring/route'
import { PUT as soccerPut } from '@/app/api/commissioner/leagues/[leagueId]/soccer-scoring/route'
import { PUT as rosterPut } from '@/app/api/commissioner/leagues/[leagueId]/roster-settings/route'
import { POST as rosterResetPost } from '@/app/api/commissioner/leagues/[leagueId]/roster-settings/reset-default/route'
import { POST as rosterImportPost } from '@/app/api/commissioner/leagues/[leagueId]/roster-settings/import/route'
import { PUT as genericScoringPut } from '@/app/api/commissioner/leagues/[leagueId]/scoring/route'
import { PATCH as sectionlessPatch } from '@/app/api/league/settings/route'

type Handler = (req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) => Promise<Response>

function setLeague(sport: string, lifecycleState: string) {
  h.leagueRow = {
    id: 'L1',
    userId: 'u1',
    sport,
    lifecycleState,
    locked: false,
    emergencyPaused: false,
    status: null,
    settings: { scoring_mode: 'points' },
    lifecycleMetadata: null,
  }
}

function put(handler: Handler, body: unknown) {
  const req = new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) })
  return handler(req, { params: Promise.resolve({ leagueId: 'L1' }) })
}

function patch(body: unknown) {
  const req = new NextRequest('http://localhost/api/league/settings', { method: 'PATCH', body: JSON.stringify(body) })
  return sectionlessPatch(req)
}

const SCORING_EDITORS: Array<[string, string, Handler]> = [
  ['NFL', 'nfl-scoring', nflPut as Handler],
  ['NBA', 'nba-scoring', nbaPut as Handler],
  ['NHL', 'nhl-scoring', nhlPut as Handler],
  ['MLB', 'mlb-scoring', mlbPut as Handler],
  ['NCAAB', 'ncaab-scoring', ncaabPut as Handler],
  ['NCAAF', 'ncaaf-scoring', ncaafPut as Handler],
  ['SOCCER', 'soccer-scoring', soccerPut as Handler],
]

beforeEach(() => {
  h.saveScoring.mockReset()
  h.updateRoster.mockReset()
  h.leagueUpdate.mockReset()
  h.resetRoster.mockReset()
  h.applyImportedRoster.mockReset()
  h.replaceOverrides.mockReset()
})

describe('per-sport scoring PUT obeys the lifecycle matrix', () => {
  for (const [sport, name, handler] of SCORING_EDITORS) {
    it(`${name}: accepts in pre_draft`, async () => {
      setLeague(sport, 'pre_draft')
      const res = await put(handler, { presetKey: 'af_default' })
      expect(res.status).toBe(200)
      expect(h.saveScoring).toHaveBeenCalledTimes(1)
    })

    for (const state of ['drafting', 'post_draft', 'in_season', 'playoffs', 'completed', 'offseason']) {
      it(`${name}: refuses in ${state} with 409 and saves nothing`, async () => {
        setLeague(sport, state)
        const res = await put(handler, { presetKey: 'af_default' })
        expect(res.status).toBe(409)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toMatch(/^Scoring can't be changed/)
        expect(h.saveScoring).not.toHaveBeenCalled()
      })
    }
  }

  it('the in-season message says why and where to go', async () => {
    setLeague('NFL', 'in_season')
    const res = await put(nflPut as Handler, { presetKey: 'af_default' })
    expect(await res.json()).toMatchObject({
      error: "Scoring can't be changed once the draft has started. Contact support if a rule is wrong.",
    })
  })
})

describe('roster-settings PUT obeys the lifecycle matrix', () => {
  const body = { slots: { QB: 1 }, templateKey: 'custom' }

  for (const state of ['setup', 'pre_draft', 'in_season', 'playoffs']) {
    it(`accepts in ${state} (matrix allows settings_edit_roster)`, async () => {
      setLeague('NFL', state)
      const res = await put(rosterPut as Handler, body)
      expect(res.status).toBe(200)
      expect(h.updateRoster).toHaveBeenCalledTimes(1)
    })
  }

  for (const state of ['drafting', 'post_draft', 'completed', 'offseason']) {
    it(`refuses in ${state} with 409 and writes nothing`, async () => {
      setLeague('NFL', state)
      const res = await put(rosterPut as Handler, body)
      expect(res.status).toBe(409)
      const json = (await res.json()) as { error?: string }
      expect(json.error).toMatch(/^Roster slots can't be changed/)
      expect(h.updateRoster).not.toHaveBeenCalled()
    })
  }
})

describe('section-less PATCH /api/league/settings gates the scoring and roster keys it touches', () => {
  it('accepts a scoring change in pre_draft', async () => {
    setLeague('NFL', 'pre_draft')
    const res = await patch({ leagueId: 'L1', scoring: 'ppr' })
    expect(res.status).toBe(200)
    expect(h.leagueUpdate).toHaveBeenCalled()
  })

  it('refuses a scoring change in_season with 409 and writes nothing', async () => {
    setLeague('NFL', 'in_season')
    const res = await patch({ leagueId: 'L1', scoring: 'ppr' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error?: string }).error).toMatch(/^Scoring can't be changed/)
    expect(h.leagueUpdate).not.toHaveBeenCalled()
  })

  it('refuses a roster-size change in post_draft with 409', async () => {
    setLeague('NFL', 'post_draft')
    const res = await patch({ leagueId: 'L1', rosterSize: 18 })
    expect(res.status).toBe(409)
    expect(h.leagueUpdate).not.toHaveBeenCalled()
  })

  it('still accepts a general change (name) in_season — keys outside scoring/roster are untouched', async () => {
    setLeague('NFL', 'in_season')
    const res = await patch({ leagueId: 'L1', name: 'New name' })
    expect(res.status).toBe(200)
    expect(h.leagueUpdate).toHaveBeenCalled()
  })
})

describe('the other scoring / roster writers obey the same gate', () => {
  it('generic scoring PUT: accepts in pre_draft, refuses in_season with 409', async () => {
    setLeague('NFL', 'pre_draft')
    expect((await put(genericScoringPut as Handler, { rules: [] })).status).toBe(200)
    expect(h.replaceOverrides).toHaveBeenCalledTimes(1)
    h.replaceOverrides.mockReset()
    setLeague('NFL', 'in_season')
    const res = await put(genericScoringPut as Handler, { rules: [] })
    expect(res.status).toBe(409)
    expect(h.replaceOverrides).not.toHaveBeenCalled()
  })

  it('roster reset-default: accepts in pre_draft, refuses in post_draft with 409', async () => {
    setLeague('NFL', 'pre_draft')
    expect((await put(rosterResetPost as Handler, {})).status).toBe(200)
    expect(h.resetRoster).toHaveBeenCalledTimes(1)
    h.resetRoster.mockReset()
    setLeague('NFL', 'post_draft')
    expect((await put(rosterResetPost as Handler, {})).status).toBe(409)
    expect(h.resetRoster).not.toHaveBeenCalled()
  })

  it('roster import apply: accepts in pre_draft, refuses in drafting; preview is never gated', async () => {
    const body = { action: 'apply', sourcePlatform: 'sleeper', importedConfig: { QB: 1 } }
    setLeague('NFL', 'pre_draft')
    expect((await put(rosterImportPost as Handler, body)).status).toBe(200)
    expect(h.applyImportedRoster).toHaveBeenCalledTimes(1)
    h.applyImportedRoster.mockReset()
    setLeague('NFL', 'drafting')
    expect((await put(rosterImportPost as Handler, body)).status).toBe(409)
    expect(h.applyImportedRoster).not.toHaveBeenCalled()
    expect((await put(rosterImportPost as Handler, { ...body, action: 'preview' })).status).toBe(200)
  })
})

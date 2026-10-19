import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * WHEN A COMMISSIONER MAY CHANGE SCORING OR ROSTER RULES — every editor that writes them.
 *
 * History: the lifecycle matrix only ever bound `PATCH /api/leagues/[id]/settings` with a
 * `section`; the per-sport scoring PUTs, the generic scoring PUT, the roster-settings writers and the
 * section-less `PATCH /api/league/settings` never asked. The owner's policy (2026-10-19) for these
 * editors, restated here independently of `SETTINGS_EDIT_POLICY` so the test can disagree with it:
 *
 *   setup, pre_draft, completed, offseason, renewal_pending   allowed, no question
 *   post_draft, in_season, playoffs                           only with `confirmMidSeasonChange: true`
 *   drafting, archived                                        refused (409)
 *
 * The real gate chain runs (settingsLifecycleGate → leagueActionGate → leagueLifecycleService)
 * against a mocked league row.
 */

const h = vi.hoisted(() => ({
  leagueRow: {} as Record<string, unknown>,
  saveScoring: vi.fn(),
  updateRoster: vi.fn(),
  resetRoster: vi.fn(),
  applyImportedRoster: vi.fn(),
  replaceOverrides: vi.fn(),
  leagueUpdate: vi.fn(),
  logAction: vi.fn(async () => undefined),
  publish: vi.fn(async () => undefined),
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
vi.mock('@/server/services/auditService', () => ({ logAction: h.logAction }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: h.publish }))
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
type Expect = 'allowed' | 'confirm' | 'refused'

const POLICY: Record<string, Expect> = {
  setup: 'allowed',
  pre_draft: 'allowed',
  drafting: 'refused',
  post_draft: 'confirm',
  in_season: 'confirm',
  playoffs: 'confirm',
  completed: 'allowed',
  offseason: 'allowed',
  renewal_pending: 'allowed',
  archived: 'refused',
}
const STATES = Object.keys(POLICY)

function setLeague(sport: string, lifecycleState: string | null) {
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

function call(handler: Handler, body: unknown) {
  const req = new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify(body) })
  return handler(req, { params: Promise.resolve({ leagueId: 'L1' }) })
}

function patch(body: unknown) {
  const req = new NextRequest('http://localhost/api/league/settings', { method: 'PATCH', body: JSON.stringify(body) })
  return sectionlessPatch(req)
}

type Editor = {
  name: string
  sport: string
  send: (body: Record<string, unknown>) => Promise<Response>
  base: Record<string, unknown>
  wrote: () => boolean
}

const sportEditor = (name: string, sport: string, handler: Handler): Editor => ({
  name,
  sport,
  send: (b) => call(handler, b),
  base: { presetKey: 'af_default' },
  wrote: () => h.saveScoring.mock.calls.length > 0,
})

const EDITORS: Editor[] = [
  sportEditor('nfl-scoring', 'NFL', nflPut as Handler),
  sportEditor('nba-scoring', 'NBA', nbaPut as Handler),
  sportEditor('nhl-scoring', 'NHL', nhlPut as Handler),
  sportEditor('mlb-scoring', 'MLB', mlbPut as Handler),
  sportEditor('ncaab-scoring', 'NCAAB', ncaabPut as Handler),
  sportEditor('ncaaf-scoring', 'NCAAF', ncaafPut as Handler),
  sportEditor('soccer-scoring', 'SOCCER', soccerPut as Handler),
  { name: 'generic scoring PUT', sport: 'NFL', send: (b) => call(genericScoringPut as Handler, b), base: { rules: [] }, wrote: () => h.replaceOverrides.mock.calls.length > 0 },
  { name: 'roster-settings PUT', sport: 'NFL', send: (b) => call(rosterPut as Handler, b), base: { slots: { QB: 1 }, templateKey: 'custom' }, wrote: () => h.updateRoster.mock.calls.length > 0 },
  { name: 'roster reset-default', sport: 'NFL', send: (b) => call(rosterResetPost as Handler, b), base: {}, wrote: () => h.resetRoster.mock.calls.length > 0 },
  { name: 'roster import apply', sport: 'NFL', send: (b) => call(rosterImportPost as Handler, b), base: { action: 'apply', sourcePlatform: 'sleeper', importedConfig: { QB: 1 } }, wrote: () => h.applyImportedRoster.mock.calls.length > 0 },
  { name: 'settings PATCH scoring key', sport: 'NFL', send: (b) => patch(b), base: { leagueId: 'L1', scoring: 'ppr' }, wrote: () => h.leagueUpdate.mock.calls.length > 0 },
  { name: 'settings PATCH rosterSize key', sport: 'NFL', send: (b) => patch(b), base: { leagueId: 'L1', rosterSize: 18 }, wrote: () => h.leagueUpdate.mock.calls.length > 0 },
]

const midSeasonAudits = () =>
  h.logAction.mock.calls.filter((c) => (c[0] as { actionType?: string }).actionType === 'settings_mid_season_change')

beforeEach(() => {
  h.saveScoring.mockReset()
  h.updateRoster.mockReset()
  h.leagueUpdate.mockReset()
  h.resetRoster.mockReset()
  h.applyImportedRoster.mockReset()
  h.replaceOverrides.mockReset()
  h.logAction.mockClear()
  h.publish.mockClear()
})

describe.each(EDITORS)('$name obeys the scoring/roster lifecycle policy', (editor) => {
  for (const state of STATES) {
    const expected = POLICY[state]
    if (expected === 'allowed') {
      it(`${state}: allowed with no confirmation, no mid-season audit`, async () => {
        setLeague(editor.sport, state)
        const res = await editor.send(editor.base)
        expect(res.status).toBe(200)
        expect(editor.wrote()).toBe(true)
        expect(midSeasonAudits()).toHaveLength(0)
      })
    } else if (expected === 'refused') {
      it(`${state}: refused with 409 even when confirmed, nothing written`, async () => {
        setLeague(editor.sport, state)
        const res = await editor.send({ ...editor.base, confirmMidSeasonChange: true })
        expect(res.status).toBe(409)
        const json = (await res.json()) as { code?: string; error?: string }
        expect(json.code).toBe('LIFECYCLE_BLOCKED')
        expect(json.error).toMatch(/can't be changed/)
        expect(editor.wrote()).toBe(false)
      })
    } else {
      it(`${state}: 409 mid_season_confirmation_required without the flag, nothing written`, async () => {
        setLeague(editor.sport, state)
        const res = await editor.send(editor.base)
        expect(res.status).toBe(409)
        expect(await res.json()).toMatchObject({
          code: 'mid_season_confirmation_required',
          message:
            "This league's season has started. Changing scoring/roster settings will recalculate scores and may make some lineups invalid. Confirm to continue.",
        })
        expect(editor.wrote()).toBe(false)
        expect(midSeasonAudits()).toHaveLength(0)
      })
      it(`${state}: applied with confirmMidSeasonChange, audited and announced`, async () => {
        setLeague(editor.sport, state)
        const res = await editor.send({ ...editor.base, confirmMidSeasonChange: true })
        expect(res.status).toBe(200)
        expect(editor.wrote()).toBe(true)
        const audits = midSeasonAudits()
        expect(audits).toHaveLength(1)
        expect(audits[0][0]).toMatchObject({
          leagueId: 'L1',
          userId: 'u1',
          metadata: { lifecycleState: state, confirmed: true },
        })
        await vi.waitFor(() =>
          expect(h.publish).toHaveBeenCalledWith(
            expect.objectContaining({
              eventType: 'settings_changed',
              category: 'league_announcements',
              title: expect.stringMatching(/mid-season/),
            }),
          ),
        )
      })
    }
  }
})

describe('details', () => {
  it('a league with no lifecycleState reads as in_season and needs confirmation, not a block', async () => {
    setLeague('NFL', null)
    const res = await call(nflPut as Handler, { presetKey: 'af_default' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code?: string }).code).toBe('mid_season_confirmation_required')
  })

  it('the confirmation flag is never written to the league row by the settings PATCH', async () => {
    setLeague('NFL', 'in_season')
    const res = await patch({ leagueId: 'L1', scoring: 'ppr', confirmMidSeasonChange: true })
    expect(res.status).toBe(200)
    const arg = h.leagueUpdate.mock.calls[0][0] as { data: Record<string, unknown> }
    expect(arg.data).toEqual({ scoring: 'ppr' })
  })

  it('a settings PATCH that touches neither scoring nor roster is not interrupted in_season', async () => {
    setLeague('NFL', 'in_season')
    const res = await patch({ leagueId: 'L1', name: 'New name' })
    expect(res.status).toBe(200)
    expect(midSeasonAudits()).toHaveLength(0)
  })

  it('roster import preview is never gated', async () => {
    setLeague('NFL', 'drafting')
    const res = await call(rosterImportPost as Handler, {
      action: 'preview',
      sourcePlatform: 'sleeper',
      importedConfig: { QB: 1 },
    })
    expect(res.status).toBe(200)
  })
})

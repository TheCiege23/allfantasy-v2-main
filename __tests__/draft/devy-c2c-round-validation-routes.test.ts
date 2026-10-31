/**
 * Devy / C2C college rounds, on every save path that writes them (2026-10-29):
 *
 *   - PATCH /draft/devy/config and /draft/c2c/config (the draft room's commissioner panel)
 *   - PATCH /draft/settings with `sessionVariant` (Settings › Draft), through the REAL
 *     validateLeagueSettings — only the settings hub's write is mocked here (the hub's own normalising
 *     write is covered in ./devy-c2c-round-validation.test.ts)
 *
 * The rule, the same on all three: rounds are whole, unique, ascending, 1..draft rounds; "on with no
 * round" is refused (the pick check would make every round pro-only); a devy / C2C league can save a
 * snake draft (the format's draft types are devy_snake…, the saved config carries the engine core).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => {
  const state = {
    session: null as Record<string, unknown> | null,
    leagueSettings: {} as Record<string, unknown>,
    leagueType: 'devy',
    variant: null as unknown,
  }
  return {
    state,
    updateVariant: vi.fn(async (_leagueId: string, _patch: Record<string, unknown>) => state.variant),
    getVariant: vi.fn(async () => state.variant),
    prisma: {
      league: {
        findUnique: vi.fn(async () => ({ leagueType: state.leagueType, timezone: 'UTC', leagueSize: 12, settings: structuredClone(state.leagueSettings) })),
      },
      leagueSettings: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({ draftDateUtc: null })) },
      leagueTeam: { findMany: vi.fn(async () => []) },
      draftSession: {
        findFirst: vi.fn(async () => (state.session ? structuredClone(state.session) : null)),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const { version: _v, updatedAt: _u, ...rest } = data
          state.session = { ...(state.session ?? {}), ...structuredClone(rest) }
          return state.session
        }),
      },
    },
  }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined), isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: vi.fn(async () => ({ id: 'S' })) }))
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/league-rules-explainer/loadDraftRules', () => ({
  loadDraftRulesSafe: vi.fn(async () => null),
  loadRookieLotteryRulesSafe: vi.fn(async () => null),
  draftRuleChanges: vi.fn(() => []),
}))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn(async () => null) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({ getDraftVariantSettings: m.getVariant, updateDraftVariantSettings: m.updateVariant }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn(async () => ({ draftOrderMode: 'randomize', lotteryConfig: null, lotteryLastSeed: null, lotteryLastRunAt: null })),
  setDraftOrderModeAndLotteryConfig: vi.fn(),
}))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/commissioner-ai-draft-manager', () => ({ buildApiResponse: vi.fn(), parseCommissionerAiManagers: vi.fn(() => ({ assignments: [] })) }))
vi.mock('@/lib/orphan-ai-manager/OrphanAIManagerService', () => ({ getRecentAuditEntries: vi.fn(async () => []) }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: vi.fn(() => ({ anyAi: true })) }))
vi.mock('@/lib/draft-notifications', () => ({ notifyOrphanAiManagerAssigned: vi.fn(async () => undefined) }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ triggerDraftPoolPrewarmBackground: vi.fn() }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: vi.fn(async () => true) }))
vi.mock('@/lib/draft/computedDraftRounds', () => ({ getComputedDraftRounds: vi.fn(async () => null) }))
vi.mock('@/lib/draft/syncDraftRoundsToRoster', () => ({ markDraftRoundsManual: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn(async () => ({ synced: true })) }))
vi.mock('@/lib/tournament/divisions/leagueDraftTimeToTournament', () => ({ copyLeagueDraftTimeToTournament: vi.fn(async () => undefined) }))

import { PATCH as devyPatch } from '@/app/api/leagues/[leagueId]/draft/devy/config/route'
import { PATCH as c2cPatch } from '@/app/api/leagues/[leagueId]/draft/c2c/config/route'
import { PATCH as settingsPatch } from '@/app/api/leagues/[leagueId]/draft/settings/route'

const ctx = { params: Promise.resolve({ leagueId: 'L' }) }
const room = (kind: 'devy' | 'c2c', body: unknown) =>
  (kind === 'devy' ? devyPatch : c2cPatch)(
    createMockNextRequest(`http://x/api/leagues/L/draft/${kind}/config`, { method: 'PATCH', body }) as never,
    ctx,
  )
const settings = (body: unknown) =>
  settingsPatch(createMockNextRequest('http://x/api/leagues/L/draft/settings', { method: 'PATCH', body }) as never, ctx)

const variant = (rounds = 15, draftType = 'snake') => ({
  config: { rounds, timer_seconds: 90, draft_type: draftType },
  draftUISettings: { timerMode: 'per_pick', orphanDrafterMode: 'cpu', orphanTeamAiManagerEnabled: false },
  leagueSize: 12,
  sessionVariant: { devyConfig: { enabled: true, devyRounds: [14, 15] }, c2cConfig: { enabled: true, collegeRounds: [1, 2] } },
})

beforeEach(() => {
  vi.clearAllMocks()
  m.state.session = { id: 'S', status: 'pre_draft', rounds: 15, devyConfig: { enabled: true, devyRounds: [14, 15] }, c2cConfig: null }
  m.state.leagueType = 'devy'
  m.state.leagueSettings = { league_type: 'devy', league_variant: 'devy_dynasty', devy_slots: 6, c2c_college_roster_size: 20 }
  m.state.variant = variant()
})

describe.each([
  ['devy', 'devyRounds', 'devyConfig'],
  ['c2c', 'collegeRounds', 'c2cConfig'],
] as const)('PATCH /draft/%s/config (draft room)', (kind, key, column) => {
  it('🛑 on with an EMPTY round list is refused with a clear 400, and nothing is written', async () => {
    const before = structuredClone(m.state.session)
    const res = await room(kind, { enabled: true, [key]: [] })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/no valid round is listed/)
    expect(body.error).toContain('1 to 15')
    expect(m.prisma.draftSession.update).not.toHaveBeenCalled()
    expect(m.state.session).toEqual(before)
  })

  it('🛑 on with only rounds that normalise away (0, past the last round, fractional, junk) is refused too', async () => {
    const res = await room(kind, { enabled: true, [key]: [0, 16, 99, 2.5, 'abc', null, true] })
    expect(res.status).toBe(400)
    expect(m.prisma.draftSession.update).not.toHaveBeenCalled()
  })

  it('🛑 duplicates and an unsorted list are stored de-duplicated, ascending, and bounded by the draft', async () => {
    const res = await room(kind, { enabled: true, [key]: [12, 3, 12, '7', 3, 0, 16, 2.5] })
    expect(res.status).toBe(200)
    expect(m.state.session![column]).toEqual({ enabled: true, [key]: [3, 7, 12] })
    expect((await res.json())[column]).toEqual({ enabled: true, [key]: [3, 7, 12] })
  })

  it('the bound is THIS draft session’s round count, not a fixed 50 or 15', async () => {
    m.state.session = { ...m.state.session!, rounds: 4 }
    await room(kind, { enabled: true, [key]: [5, 4, 1] })
    expect(m.state.session![column]).toEqual({ enabled: true, [key]: [1, 4] })
  })

  it('off with no rounds is still accepted (that is how the rule is turned off)', async () => {
    const res = await room(kind, { enabled: false, [key]: [] })
    expect(res.status).toBe(200)
    expect(m.state.session![column]).toEqual({ enabled: false, [key]: [] })
  })

  it('a valid list is stored exactly as sent', async () => {
    const res = await room(kind, { enabled: true, [key]: [10, 11, 12] })
    expect(res.status).toBe(200)
    expect(m.state.session![column]).toEqual({ enabled: true, [key]: [10, 11, 12] })
  })
})

describe('PATCH /draft/settings (Settings › Draft) — real validator', () => {
  const sent = () => m.updateVariant.mock.calls[0]?.[1] as { sessionVariant?: Record<string, unknown> } | undefined

  it('🛑 a devy league saves a SNAKE draft (no longer "snake draft is not valid for devy leagues")', async () => {
    const res = await settings({ timer_seconds: 60 })
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200)
  })

  it('🛑 a C2C league saves a snake draft too, and linear / auction stay valid for both', async () => {
    m.state.leagueType = 'c2c'
    m.state.leagueSettings = { ...m.state.leagueSettings, league_type: 'c2c', league_variant: 'merged_devy_c2c' }
    expect((await settings({ timer_seconds: 60 })).status).toBe(200)
    m.state.variant = variant(15, 'linear')
    expect((await settings({ timer_seconds: 60 })).status).toBe(200)
    m.state.leagueType = 'devy'
    // (an auction also needs its budget — a separate rule, satisfied here)
    m.state.leagueSettings = { ...m.state.leagueSettings, league_type: 'devy', league_variant: 'devy_dynasty', auction_budget_per_team: 200 }
    m.state.variant = variant(15, 'auction')
    expect((await settings({ timer_seconds: 60 })).status).toBe(200)
  })

  it('🛑 on with an empty devy / college list is refused — the same rule as the draft room', async () => {
    const devy = await settings({ sessionVariant: { devyConfig: { enabled: true, devyRounds: [] } } })
    expect(devy.status).toBe(400)
    expect((await devy.json()).error).toMatch(/at least one devy round/)
    const c2c = await settings({ sessionVariant: { c2cConfig: { enabled: true, collegeRounds: [] } } })
    expect(c2c.status).toBe(400)
    expect((await c2c.json()).error).toMatch(/at least one college round/)
    expect(m.updateVariant).not.toHaveBeenCalled()
  })

  it('🛑 a list that only LOOKS non-empty ([0], past the last round, junk) is refused, not stored as []', async () => {
    const res = await settings({ sessionVariant: { devyConfig: { enabled: true, devyRounds: [0, 16, 'x'] } } })
    expect(res.status).toBe(400)
    expect(m.updateVariant).not.toHaveBeenCalled()
  })

  it('🛑 the hub is handed the normalised list, bounded by the draft round count', async () => {
    const res = await settings({ sessionVariant: { devyConfig: { enabled: true, devyRounds: [12, 3, 12, 16, 2.5] } } })
    expect(res.status).toBe(200)
    expect(sent()?.sessionVariant?.devyConfig).toEqual({ enabled: true, devyRounds: [3, 12] })
  })

  it('a round count changed in the SAME save bounds the rounds', async () => {
    const res = await settings({ rounds: 10, sessionVariant: { c2cConfig: { enabled: true, collegeRounds: [11, 10, 1] } } })
    expect(res.status).toBe(200)
    expect(sent()?.sessionVariant?.c2cConfig).toEqual({ enabled: true, collegeRounds: [1, 10] })
  })
})

/**
 * The Settings › Draft panel's save (PATCH /draft/settings, DraftSettingsCommissionerPanel) and the
 * league settings patch's draft fields publish the main draft's before/after as ruleChanges. The
 * reads themselves are covered against a stateful league in ./draft-settings-rule-changes.test.ts;
 * here the loader is a sequence (before, after) so the wiring is what is under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const m = vi.hoisted(() => ({
  reads: [] as Array<Record<string, unknown> | null>,
  lotteryReads: [] as Array<Record<string, unknown> | null>,
  leagueSettings: {} as Record<string, unknown>,
  publish: vi.fn(async (_input: unknown) => undefined),
  variant: { config: { timer_seconds: 90, rounds: 15, draft_type: 'snake' }, draftUISettings: { timerMode: 'per_pick', orphanDrafterMode: 'cpu', orphanTeamAiManagerEnabled: false }, leagueSize: 12, sessionVariant: null },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn(async () => true) }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn(async () => undefined), isCommissioner: vi.fn(async () => true) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ leagueType: 'redraft', timezone: 'UTC', leagueSize: 12, settings: m.leagueSettings })) },
    draftSession: { findFirst: vi.fn(async () => ({ id: 'S', status: 'pre_draft', teamCount: 12 })) },
    leagueSettings: { upsert: vi.fn(async () => ({ draftDateUtc: null })) },
    leagueTeam: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn(async () => null) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({
  getDraftVariantSettings: vi.fn(async () => m.variant),
  updateDraftVariantSettings: vi.fn(async () => m.variant),
}))
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
vi.mock('@/lib/league-rules-explainer/publishRuleChanges', () => ({ publishRuleChangesEvent: m.publish }))
vi.mock('@/lib/league-rules-explainer/loadDraftRules', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/league-rules-explainer/loadDraftRules')>()
  return {
    ...actual,
    loadDraftRulesSafe: vi.fn(async () => m.reads.shift() ?? null),
    loadRookieLotteryRulesSafe: vi.fn(async () => m.lotteryReads.shift() ?? null),
  }
})

import { PATCH } from '@/app/api/leagues/[leagueId]/draft/settings/route'

const patch = (body: unknown) =>
  PATCH(createMockNextRequest('http://x/api/leagues/L/draft/settings', { method: 'PATCH', body }) as never, { params: Promise.resolve({ leagueId: 'L' }) })

const draft = (over: Record<string, unknown> = {}) => ({ draftStatus: 'scheduled', draftType: 'snake', draftRounds: 15, draftPickSeconds: 90, draftOnTimeout: 'autopick', ...over })

beforeEach(() => {
  vi.clearAllMocks()
  m.reads = []
  m.lotteryReads = []
  m.leagueSettings = {}
})

const lottery = (over: Record<string, unknown> = {}) => ({
  rookieDraftLottery: { teams: 6, picks: 6, pool: 'non_playoff', odds: 'record', rest: 'reverse_max_pf', ...over },
})

describe('PATCH /draft/settings (Settings › Draft)', () => {
  it('publishes the draft rules it changed, from the reads before and after the writes', async () => {
    m.reads = [draft(), draft({ draftPickSeconds: 28800 })]
    expect((await patch({ timer_seconds: 28800 })).status).toBe(200)
    expect(m.publish).toHaveBeenCalledWith({
      leagueId: 'L',
      actorUserId: 'commish',
      section: 'draft',
      changes: [{ key: 'draftPickSeconds', before: 90, after: 28800 }],
    })
  })

  it('a completed draft, or a read that failed, publishes no change', async () => {
    m.reads = [draft({ draftStatus: 'completed' }), draft({ draftStatus: 'completed', draftPickSeconds: 60 })]
    await patch({ timer_seconds: 60 })
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ changes: [] }))
    vi.clearAllMocks()
    m.reads = [null, draft({ draftPickSeconds: 60 })]
    await patch({ timer_seconds: 60 })
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ changes: [] }))
  })

  it('a lotteryConfig save diffs the rookie lottery keys too — even after the main draft is complete', async () => {
    m.reads = [draft({ draftStatus: 'completed' }), draft({ draftStatus: 'completed' })]
    m.lotteryReads = [lottery(), lottery({ picks: 4 })]
    expect((await patch({ lotteryConfig: { lotteryPickCount: 4 } })).status).toBe(200)
    expect(m.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [{ key: 'rookieDraftLottery', before: lottery().rookieDraftLottery, after: lottery({ picks: 4 }).rookieDraftLottery }],
      }),
    )
  })

  it('a devy / C2C rounds save (sessionVariant) publishes its college rounds on the same one card', async () => {
    // The draft settings validator wants a devy league's slots before it accepts devy rounds.
    m.leagueSettings = { league_type: 'dynasty', league_variant: 'devy_dynasty', devy_slots: 6 }
    m.reads = [draft({ draftDevyRounds: [11, 12], draftCollegeRounds: null }), draft({ draftDevyRounds: [10, 11, 12], draftCollegeRounds: null })]
    const res = await patch({ sessionVariant: { devyConfig: { enabled: true, devyRounds: [10, 11, 12] } } })
    expect(res.status).toBe(200)
    expect(m.publish).toHaveBeenCalledTimes(1)
    expect(m.publish).toHaveBeenCalledWith(
      expect.objectContaining({ section: 'draft', changes: [{ key: 'draftDevyRounds', before: [11, 12], after: [10, 11, 12] }] }),
    )
  })

  it('a save without lotteryConfig never reads the lottery', async () => {
    m.reads = [draft(), draft({ draftPickSeconds: 60 })]
    m.lotteryReads = [lottery(), lottery({ picks: 4 })]
    await patch({ timer_seconds: 60 })
    expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({ changes: [{ key: 'draftPickSeconds', before: 90, after: 60 }] }))
    expect(m.lotteryReads).toHaveLength(2)
  })
})

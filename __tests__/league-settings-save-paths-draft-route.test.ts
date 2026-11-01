/**
 * League Settings, part 2: the Draft sub-page (DraftSettingsCommissionerPanel) saves through
 * PATCH /api/leagues/:id/draft/settings — the ONE draft save path. It must write every copy:
 *
 * - `LeagueSettings.rounds` / `draftDateUtc` / `autostart` (the row the settings list reads back)
 * - `settings.draft_rounds` + pre-draft `DraftSession.rounds`, via updateDraftVariantSettings
 *   (that half is covered against a mocked Prisma in league-settings-save-paths-stores.test.ts)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    league: { findUnique: vi.fn() },
    draftSession: { findFirst: vi.fn() },
    leagueSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  },
  updateVariant: vi.fn(),
  getVariant: vi.fn(),
  copyBack: vi.fn(),
  notifyDraftTimeSet: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'commish' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn().mockResolvedValue(undefined), isCommissioner: vi.fn() }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn().mockResolvedValue(false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: vi.fn() }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ validateDraftRoundsFitRoster: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({ getDraftVariantSettings: m.getVariant, updateDraftVariantSettings: m.updateVariant }))
vi.mock('@/lib/draft-types/draftTypeRegistry', () => ({ isDraftTypeAllowedOnSettingsTab: vi.fn().mockReturnValue(true) }))
vi.mock('@/lib/leagues/leagueTeamLifecycle', () => ({ CURRENT_TEAMS: {} }))
vi.mock('@/lib/league-settings-validation', () => ({ validateLeagueSettings: vi.fn().mockReturnValue({ valid: true, errors: [] }) }))
vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn().mockResolvedValue({ draftOrderMode: 'randomize', lotteryConfig: null, lotteryLastSeed: null, lotteryLastRunAt: null }),
  setDraftOrderModeAndLotteryConfig: vi.fn(),
}))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: vi.fn() }))
vi.mock('@/lib/commissioner-ai-draft-manager', () => ({ buildApiResponse: vi.fn(), parseCommissionerAiManagers: vi.fn() }))
vi.mock('@/lib/orphan-ai-manager/OrphanAIManagerService', () => ({ getRecentAuditEntries: vi.fn() }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: vi.fn() }))
vi.mock('@/lib/draft-notifications', () => ({ notifyOrphanAiManagerAssigned: vi.fn(), notifyDraftTimeSet: m.notifyDraftTimeSet }))
vi.mock('@/lib/sport-scope', () => ({ supportsIdpLeagueSport: vi.fn() }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ triggerDraftPoolPrewarmBackground: vi.fn() }))
vi.mock('@/lib/draft-room/currentDraftSession', () => ({ CURRENT_DRAFT_SESSION_ORDER: [] }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  // An AF Commissioner may set rounds by hand; anyone else gets the computed count.
  EntitlementResolver: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.resolveForUser = vi.fn().mockResolvedValue({ hasAccess: true })
  }),
}))
vi.mock('@/lib/draft/computedDraftRounds', () => ({ getComputedDraftRounds: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/league/league-settings-draft-sync', () => ({ syncDraftSessionFromLeagueSettings: vi.fn() }))
vi.mock('@/lib/tournament/divisions/leagueDraftTimeToTournament', () => ({ copyLeagueDraftTimeToTournament: m.copyBack }))

import { PATCH } from '@/app/api/leagues/[leagueId]/draft/settings/route'

const variant = {
  config: { rounds: 15, timer_seconds: 90 },
  draftUISettings: { timerMode: 'per_pick' },
  sessionVariant: null,
  leagueSize: 12,
}

function patch(body: Record<string, unknown>) {
  const req = new Request('http://x/api/leagues/L/draft/settings', { method: 'PATCH', body: JSON.stringify(body) })
  return PATCH(req as never, { params: Promise.resolve({ leagueId: 'L' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.league.findUnique.mockResolvedValue({ leagueType: 'redraft', timezone: 'America/New_York', leagueSize: 12, settings: {} })
  m.prisma.draftSession.findFirst.mockResolvedValue({ id: 'ds1', status: 'pre_draft' })
  m.prisma.leagueSettings.findUnique.mockResolvedValue(null)
  m.prisma.leagueSettings.upsert.mockImplementation(async ({ update }: { update: Record<string, unknown> }) => ({ leagueId: 'L', ...update }))
  m.notifyDraftTimeSet.mockResolvedValue(undefined)
  m.getVariant.mockResolvedValue(variant)
  m.updateVariant.mockResolvedValue(variant)
  m.copyBack.mockResolvedValue('not_linked')
})

describe('PATCH draft/settings: one save, every copy', () => {
  it('🛑 rounds go to the LeagueSettings row AND to the config (settings.draft_rounds + DraftSession)', async () => {
    const res = await patch({ rounds: 13 })
    expect(res.status).toBe(200)
    expect(m.prisma.leagueSettings.upsert).toHaveBeenCalledTimes(1)
    expect(m.prisma.leagueSettings.upsert.mock.calls[0][0].update).toMatchObject({ rounds: 13 })
    expect(m.updateVariant).toHaveBeenCalledWith('L', expect.objectContaining({ config: expect.objectContaining({ rounds: 13 }) }))
  })

  it('draft date and autostart land on the LeagueSettings row the settings list reads', async () => {
    const res = await patch({ draftDate: '2026-10-20T00:00:00.000Z', autostart: true })
    expect(res.status).toBe(200)
    const update = m.prisma.leagueSettings.upsert.mock.calls[0][0].update
    expect(update.draftDateUtc).toEqual(new Date('2026-10-20T00:00:00.000Z'))
    expect(update.autostart).toBe(true)
    expect(m.notifyDraftTimeSet).toHaveBeenCalledWith('L', new Date('2026-10-20T00:00:00.000Z'))
  })

  it('🛑 a draft date saved here is copied back to a tournament conference record, as the saver', async () => {
    await patch({ draftDate: '2026-10-20T00:00:00.000Z' })
    expect(m.copyBack).toHaveBeenCalledWith('L', new Date('2026-10-20T00:00:00.000Z'), 'commish')
  })

  it('a save without a draft date copies nothing back', async () => {
    await patch({ autostart: true })
    expect(m.copyBack).not.toHaveBeenCalled()
  })

  it('an invalid draft date is refused before anything is written', async () => {
    const res = await patch({ draftDate: 'not-a-date' })
    expect(res.status).toBe(400)
    expect(m.prisma.leagueSettings.upsert).not.toHaveBeenCalled()
    expect(m.updateVariant).not.toHaveBeenCalled()
  })
})

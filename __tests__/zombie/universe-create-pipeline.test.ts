import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ transaction: vi.fn(), batch: vi.fn(), single: vi.fn(), bootstrap: vi.fn(), materialize: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: h.transaction, leagueSettings: { findUnique: vi.fn().mockResolvedValue(null) } } }))
vi.mock('@/lib/league-creation/canonical/createZombieUniverseInTransaction', () => ({ createZombieUniverseInTransaction: h.batch }))
vi.mock('@/lib/league-creation/canonical/createCanonicalLeagueInTransaction', () => ({ createCanonicalLeagueInTransaction: h.single }))
vi.mock('@/lib/league-defaults-orchestrator/LeagueDefaultsOrchestrator', () => ({ runPostCreateInitialization: h.bootstrap }))
vi.mock('@/lib/league-setup/autoMaterializeDraftForLeague', () => ({ autoMaterializeDraftForLeague: h.materialize }))
vi.mock('@/lib/league/league-draft-template-payload', () => ({ getLeagueDraftTemplatePayload: vi.fn().mockResolvedValue({ totalRosterSlots: 0 }) }))
vi.mock('@/server/services/auditService', () => ({ logLeagueCreated: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueCreatedNotice: vi.fn() }))
vi.mock('@/lib/league/format-artifact-service', () => ({ generateLeagueConstitutionArtifact: vi.fn() }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: vi.fn() }))
import { executeCanonicalLeagueCreation } from '@/lib/league-creation/canonical/executeCanonicalLeagueCreation'
import type { ValidatedCreateLeagueBody } from '@/lib/league-creation/canonical/validateCreateLeague'
const body: ValidatedCreateLeagueBody = { concept: 'zombie', sport: 'NFL', scoringPreset: 'fb_half_ppr', draftType: 'snake',
  teamCount: 20, leagueName: 'Shared Zombie rules', conceptSetup: { zombieLeagueCount: 6 } }

describe('canonical Zombie batch pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.transaction.mockImplementation(async callback => callback({}))
    h.batch.mockResolvedValue({ universeId: 'universe-6', leagues: Array.from({ length: 6 }, (_, i) => ({ leagueId: `l${i}`, homepageUrl: `/league/l${i}`, body: { ...body, leagueName: `Shared Zombie rules ${i}` } })) })
    h.materialize.mockResolvedValue({ ok: true })
    h.single.mockResolvedValue({ leagueId: 'solo', homepageUrl: '/league/solo' })
  })
  it('initializes all six children and returns the shared commissioner hub', async () => {
    const result = await executeCanonicalLeagueCreation({ appUserId: 'owner', body })
    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.batch).toHaveBeenCalledTimes(1)
    expect(h.single).not.toHaveBeenCalled()
    expect(h.bootstrap.mock.calls.map(call => call[0])).toEqual(['l0', 'l1', 'l2', 'l3', 'l4', 'l5'])
    expect(h.materialize.mock.calls.map(call => call[0])).toEqual(['l0', 'l1', 'l2', 'l3', 'l4', 'l5'])
    expect(result).toMatchObject({ ok: true, response: { universeId: 'universe-6', leagueIds: ['l0', 'l1', 'l2', 'l3', 'l4', 'l5'], homepageUrl: '/zombie/universe/universe-6' } })
  })
  it('retains ordinary single-league creation when count is one', async () => {
    const result = await executeCanonicalLeagueCreation({ appUserId: 'owner', body: { ...body, conceptSetup: { zombieLeagueCount: 1 } } })
    expect(h.batch).not.toHaveBeenCalled()
    expect(h.single).toHaveBeenCalledTimes(1)
    expect(h.bootstrap).toHaveBeenCalledWith('solo', 'NFL', 'zombie')
    expect(result).toMatchObject({ ok: true, response: { homepageUrl: '/league/solo' } })
  })
  it('rejects imported multi-league requests before any transaction', async () => {
    expect(await executeCanonicalLeagueCreation({ appUserId: 'owner', body, sourceLeagueId: 'imported' })).toMatchObject({ ok: false, status: 400 })
    expect(h.transaction).not.toHaveBeenCalled()
  })
  it('runs no post-create actions when the transaction fails', async () => {
    h.transaction.mockRejectedValueOnce(new Error('Synthetic transaction failure'))
    expect(await executeCanonicalLeagueCreation({ appUserId: 'owner', body })).toMatchObject({ ok: false, status: 500 })
    expect(h.bootstrap).not.toHaveBeenCalled()
    expect(h.materialize).not.toHaveBeenCalled()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), view: vi.fn(), session: vi.fn(), save: vi.fn(), limit: vi.fn() }))
vi.mock('@/lib/auth-guard', () => ({ requireAuth: mocks.auth }))
vi.mock('@/server/services/permissionService', () => ({ canViewLeague: mocks.view }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: mocks.session } } }))
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: mocks.limit }))
vi.mock('@/lib/core-app/draftPlanningPreferenceStore', () => ({ storeDraftPlanningPreference: mocks.save }))
import { saveDraftPlanningPreference } from '@/lib/core-app/draftPlanningActions'
import { draftPlanningPreference } from '@/lib/core-app/draftPlanningPreferenceModel'
const value = { version: 1, order: ['id:a'], spread: 'adp' }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, userId: 'viewer' })
  mocks.limit.mockReturnValue({ success: true })
  mocks.view.mockResolvedValue(true)
  mocks.session.mockResolvedValue({ customRankingsEnabled: true })
})
describe('private draft planning preferences', () => {
  it('binds writes to the authenticated viewer and exact authorized native session', async () => {
    expect(await saveDraftPlanningPreference('league', 'draft', value)).toEqual({ ok: true })
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'draft', leagueId: 'league', sessionKind: 'live', sleeperDraftId: null } }))
    expect(mocks.save).toHaveBeenCalledWith('viewer', 'league', 'draft', value)
  })
  it('rejects another league, unavailable session, disabled custom rankings and rate limits', async () => {
    mocks.view.mockResolvedValue(false)
    expect((await saveDraftPlanningPreference('other', 'draft', value)).ok).toBe(false)
    mocks.view.mockResolvedValue(true)
    mocks.session.mockResolvedValue(null)
    expect((await saveDraftPlanningPreference('league', 'draft', value)).ok).toBe(false)
    mocks.session.mockResolvedValue({ customRankingsEnabled: false })
    expect((await saveDraftPlanningPreference('league', 'draft', value)).ok).toBe(false)
    mocks.limit.mockReturnValue({ success: false })
    expect((await saveDraftPlanningPreference('league', 'draft', { ...value, order: [] })).ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('reports persistence failure instead of claiming a successful sync', async () => {
    mocks.save.mockRejectedValue(new Error('unavailable'))
    expect((await saveDraftPlanningPreference('league', 'draft', value)).ok).toBe(false)
  })
  it('bounds and validates canonical IDs, deduplicates, and rejects malformed payloads', () => {
    expect(draftPlanningPreference({ ...value, order: ['id:a', 'id:a'] })?.order).toEqual(['id:a'])
    expect(draftPlanningPreference({ ...value, order: Array(3001).fill('id:a') })).toBeNull()
    expect(draftPlanningPreference({ ...value, order: ['name:ambiguous'] })).toBeNull()
    expect(draftPlanningPreference({ ...value, spread: 'invented' })).toBeNull()
  })
})

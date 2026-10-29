/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ league: vi.fn(), season: vi.fn(), archive: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league }, redraftSeason: { findFirst: h.season }, $transaction: h.transaction } }))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({ enterRedraftOffseason: h.archive }))
import { renewNativeRedraft } from '@/lib/redraft/offseason/renewNativeRedraft'
const input = { leagueId: 'l1', userId: 'u1', expectedSeason: 2025 }
beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'l1', userId: 'u1', platform: 'allfantasy', season: 2025, lifecycleState: 'completed', settings: {} })
  h.season.mockResolvedValue({ id: 's1' })
  h.archive.mockResolvedValue({ ok: true, snapshotId: 'archive' })
})
describe('native renewal prerequisites', () => {
  it('does not reset players when archiving fails', async () => {
    h.archive.mockRejectedValue(new Error('archive failed'))
    await expect(renewNativeRedraft(input)).rejects.toThrow('archive failed')
    expect(h.transaction).not.toHaveBeenCalled()
  })
  it('does not reset players when a completed native season is missing', async () => {
    h.season.mockResolvedValue(null)
    await expect(renewNativeRedraft(input)).rejects.toThrow('completed native season')
    expect(h.archive).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })
  it('rejects an active season and unauthorized commissioners before touching history', async () => {
    h.league.mockResolvedValueOnce({ userId: 'u1', platform: 'allfantasy', season: 2025, lifecycleState: 'in_season' })
      .mockResolvedValueOnce({ userId: 'other', platform: 'allfantasy', season: 2025, lifecycleState: 'completed' })
    await expect(renewNativeRedraft(input)).rejects.toThrow('Finish the current season')
    await expect(renewNativeRedraft(input)).rejects.toThrow('Commissioner only')
    expect(h.transaction).not.toHaveBeenCalled()
  })
  it('returns the saved receipt on a retry without clearing the next season', async () => {
    h.league.mockResolvedValue({ userId: 'u1', platform: 'allfantasy', season: 2026, lifecycleState: 'pre_draft',
      settings: { redraft_renewal: { ok: true, completedSeason: 2025, nextSeason: 2026, seasonId: 'next' } } })
    expect(await renewNativeRedraft(input)).toMatchObject({ alreadyRenewed: true, seasonId: 'next' })
    expect(h.archive).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

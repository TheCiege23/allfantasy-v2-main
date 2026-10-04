import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ catalog: vi.fn(), detail: vi.fn(), current: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: db.current } } }))
vi.mock('@/lib/draft-archive/catalog', () => ({ draftArchiveCatalog: db.catalog }))
vi.mock('@/lib/draft-archive/detail', () => ({ draftArchiveDetail: db.detail }))
import { getDraftArchiveScreen } from '@/lib/draft-archive/screen'
beforeEach(() => {
  vi.resetAllMocks()
  db.catalog.mockResolvedValue({ choices: [{ key: 'native:past', createdAt: new Date(), total: 1 }], total: 1, page: 1, more: false })
  db.current.mockResolvedValue({ id: 'current', status: 'in_progress', sessionKind: 'live', sleeperDraftId: null })
  db.detail.mockResolvedValue({ choice: { key: 'native:past' } })
})
describe('archive selection isolation', () => {
  it('search and season filters select the matching archive and suppress current controls', async () => {
    const result = await getDraftArchiveScreen(['league'], 'league', 'viewer', { archiveSeason: '2025' })
    expect(db.detail).toHaveBeenCalledWith('league', 'viewer', 'native:past', 1)
    expect(result.showCurrent).toBe(false)
  })
  it('never falls back to the current draft for a missing explicit historical selection', async () => {
    db.detail.mockResolvedValue(null)
    const result = await getDraftArchiveScreen(['league'], 'league', 'viewer', { draft: 'native:missing' })
    expect(result.showCurrent).toBe(false)
    expect(result.error).toBeTruthy()
  })
  it('excludes unauthorized leagues before catalogue and detail reads', async () => {
    await getDraftArchiveScreen(['allowed'], 'other', 'viewer', { draft: 'native:secret' })
    expect(db.catalog).toHaveBeenCalledWith([], expect.anything())
    expect(db.current).not.toHaveBeenCalled()
    expect(db.detail).not.toHaveBeenCalled()
  })
})

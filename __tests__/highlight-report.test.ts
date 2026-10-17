import { beforeEach, describe, expect, it, vi } from 'vitest'
const query = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: query } }))
import { getHighlightReport } from '@/lib/analytics/highlightReport'
const now = new Date('2026-10-12T00:00:00Z')
const surface = { surface: 'my_team', views: 10n, users: 5n, withClips: 6n, empty: 2n, unavailable: 1n, errors: 1n, loadViews: 3n, readyViews: 2n, failedViews: 1n, sourceViews: 1n, lastEventAt: now }
function respond(surfaces: unknown[], returns: unknown) { query.mockResolvedValueOnce(surfaces).mockResolvedValueOnce([returns]) }
beforeEach(() => query.mockReset())
describe('highlight reporting truth', () => {
  it('keeps zero denominators blank and includes all surfaces even before activity', async () => {
    respond([], { cohort: 0n, matured: 0n, returned: 0n, scheduledDays: 0n })
    const report = await getHighlightReport(now)
    expect(report.surfaces).toHaveLength(3)
    for (const s of report.surfaces) expect([s.availabilityRate, s.loadRate, s.embedSuccessRate]).toEqual([null, null, null])
    expect(report.returns).toMatchObject({ status: 'no_data', rate: null }); expect(report.lastEventAt).toBeNull()
  })
  it('reports the correct distinct-exposure denominators and mature cohort only', async () => {
    respond([surface], { cohort: 20n, matured: 10n, returned: 4n, scheduledDays: 8n })
    const r = await getHighlightReport(now)
    expect(r.surfaces.find(s => s.surface === 'my_team')).toMatchObject({ availabilityRate: 0.6, loadRate: 0.5, embedSuccessRate: 2/3 })
    expect(r.returns).toEqual({ cohort: 20, matured: 10, pending: 10, returned: 4, scheduledDays: 8, rate: 0.4, status: 'measured' })
    expect(JSON.stringify(r)).not.toContain('userId')
  })
  it.each([
    [{ cohort: 3n, matured: 0n, returned: 0n, scheduledDays: 4n }, 'pending'],
    [{ cohort: 3n, matured: 3n, returned: 0n, scheduledDays: 0n }, 'schedule_unavailable'],
  ])('does not manufacture return rates from incomplete data', async (row, status) => {
    respond([], row); expect((await getHighlightReport(now)).returns).toMatchObject({ status, rate: null })
  })
  it('propagates a database failure instead of rendering a zero report', async () => {
    query.mockRejectedValueOnce(new Error('query failed')); query.mockResolvedValueOnce([])
    await expect(getHighlightReport(now)).rejects.toThrow('query failed')
  })
  it('bounds both queries by explicit event names and dates and converts UTC timestamps before ET dates', async () => {
    respond([], { cohort: 0n, matured: 0n, returned: 0n, scheduledDays: 0n }); await getHighlightReport(now)
    for (const [sql] of query.mock.calls) {
      expect(sql.values).toContain('engagement.highlights.surface_view'); expect(sql.values).toContain('af_product')
      expect(sql.values).toContainEqual(new Date('2026-09-14T00:00:00Z')); expect(sql.values).toContain(now)
      expect(sql.sql).toContain('"userId" IS NOT NULL')
    }
    const sql = query.mock.calls[1][0].sql
    expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York'")
    expect(sql).toContain("interval '7 days'"); expect(sql).toContain("'cancelled', 'canceled', 'postponed'")
    expect(sql).not.toContain('extract(dow')
  })
})

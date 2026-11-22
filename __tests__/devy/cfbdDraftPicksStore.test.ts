import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as unknown,
  upsert: vi.fn(async () => ({})),
  result: { ok: true, data: [] } as unknown,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { sportsDataCache: { findUnique: vi.fn(async () => h.row), upsert: h.upsert } },
}))
vi.mock('@/lib/cfb-player-data', () => ({ getCFBDraftPicksResult: vi.fn(async () => h.result) }))

import { inDraftWindow, latestDraftYear, refreshCfbdDraftPicks, toStoredPicks } from '@/lib/devy/cfbdDraftPicksStore'

const pick = (id: string | null, name = 'A Player') => ({
  collegeAthleteId: id, playerName: name, position: 'WR', collegeTeam: 'Texas', nflTeam: 'NYG', round: 1, pick: 5, overallPick: 5,
})

beforeEach(() => {
  h.row = null
  h.upsert.mockClear()
  h.result = { ok: true, data: [] }
})

describe('draft year', () => {
  it('is last year before May and this year from May', () => {
    expect(latestDraftYear(new Date('2026-11-21T00:00:00Z'))).toBe(2026)
    expect(latestDraftYear(new Date('2027-03-01T00:00:00Z'))).toBe(2026)
    expect(latestDraftYear(new Date('2027-05-01T00:00:00Z'))).toBe(2027)
  })

  it('the draft window is late April to mid-May', () => {
    expect(inDraftWindow(new Date('2027-04-24T00:00:00Z'))).toBe(true)
    expect(inDraftWindow(new Date('2027-05-10T00:00:00Z'))).toBe(true)
    expect(inDraftWindow(new Date('2026-11-21T00:00:00Z'))).toBe(false)
  })
})

describe('toStoredPicks', () => {
  it('keeps only picks with a college athlete id, never falling back to a school id', () => {
    const stored = toStoredPicks([pick('4432'), pick(null, 'No Id')])
    expect(stored).toEqual([{ collegeAthleteId: '4432', name: 'A Player', position: 'WR', collegeTeam: 'Texas', nflTeam: 'NYG', round: 1, pick: 5, overall: 5 }])
  })
})

describe('refreshCfbdDraftPicks', () => {
  const NOV = new Date('2026-11-21T12:00:00Z')

  it('stores the latest draft under its year', async () => {
    h.result = { ok: true, data: [pick('1'), pick('2'), pick(null)] }
    const r = await refreshCfbdDraftPicks(NOV)
    expect(r).toEqual({ year: 2026, stored: 2, droppedWithoutAthleteId: 1 })
    const call = (h.upsert.mock.calls[0] as unknown as [{ where: { cacheKey: string } }])[0]
    expect(call.where.cacheKey).toBe('cfbd:draft-picks:v1:2026')
  })

  it('a refused CFBD call writes nothing, so stored picks stand', async () => {
    h.result = { ok: false, failure: { kind: 'quota', status: 429, message: 'CFBD monthly call quota exceeded', path: '/draft/picks?year=2026' } }
    const r = await refreshCfbdDraftPicks(NOV)
    expect(r).toMatchObject({ year: 2026 })
    expect('error' in r).toBe(true)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('skips a fresh copy', async () => {
    h.row = { data: { fetchedAt: new Date(NOV.getTime() - 60 * 60 * 1000).toISOString() } }
    expect(await refreshCfbdDraftPicks(NOV)).toEqual({ year: 2026, skipped: 'within cadence' })
  })
})

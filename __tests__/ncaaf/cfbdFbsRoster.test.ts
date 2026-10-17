import { beforeEach, describe, expect, it, vi } from 'vitest'

const cfbdFetchMock = vi.hoisted(() => ({ cfbdGet: vi.fn() }))
// Spread the real module so its constants stay real; only the network call is replaced.
vi.mock('@/lib/cfbd-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cfbd-fetch')>()),
  cfbdGet: cfbdFetchMock.cfbdGet,
}))
vi.mock('@/lib/cfbd-env', () => ({ getCfbdApiKey: () => 'test-key' }))

import { getCFBFbsRosterResult } from '@/lib/cfb-player-data'

beforeEach(() => cfbdFetchMock.cfbdGet.mockReset())

describe('getCFBFbsRosterResult', () => {
  it('asks for every FBS roster of the season in one call', async () => {
    cfbdFetchMock.cfbdGet.mockResolvedValue({ ok: true, data: [] })
    await getCFBFbsRosterResult(2026)
    expect(cfbdFetchMock.cfbdGet).toHaveBeenCalledTimes(1)
    expect(cfbdFetchMock.cfbdGet.mock.calls[0][0]).toBe('/roster?year=2026&classification=fbs')
  })

  it("keeps each player's own school rather than stamping one team on all of them", async () => {
    cfbdFetchMock.cfbdGet.mockResolvedValue({
      ok: true,
      data: [
        { id: 1, firstName: 'Ada', lastName: 'One', team: 'Alabama', position: 'QB' },
        { id: 2, firstName: 'Bo', lastName: 'Two', team: 'Louisiana', position: 'WR' },
        { id: 3, firstName: 'No', lastName: 'School', position: 'RB' },
      ],
    })
    const res = await getCFBFbsRosterResult(2026)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.map((p) => [p.id, p.team])).toEqual([
      [1, 'Alabama'],
      [2, 'Louisiana'],
    ])
  })

  it('passes a refused request through as a failure, never as an empty roster', async () => {
    const failure = { kind: 'quota', status: 429, message: 'quota', path: '/roster' }
    cfbdFetchMock.cfbdGet.mockResolvedValue({ ok: false, failure })
    expect(await getCFBFbsRosterResult(2026)).toEqual({ ok: false, failure })
  })

  it('reports a non-array payload as a failure', async () => {
    cfbdFetchMock.cfbdGet.mockResolvedValue({ ok: true, data: { message: 'nope' } })
    const res = await getCFBFbsRosterResult(2026)
    expect(res.ok).toBe(false)
  })
})

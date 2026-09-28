/**
 * `getFantasyCalcChartDbFirst` returns the chart AND when it was synced from FantasyCalc, so a trade
 * grade can date every market value it was taken on (2026-09-28). Same freshness rule as
 * `getFantasyCalcValuesDbFirst`, which now delegates to it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())
const upsert = vi.hoisted(() => vi.fn())
const fetchFantasyCalcValues = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique, upsert } } }))
vi.mock('@/lib/fantasycalc-fetch', () => ({ fetchFantasyCalcValues }))

import { getFantasyCalcChartDbFirst, getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'

const SETTINGS = { isDynasty: true, numQbs: 1, numTeams: 12, ppr: 1 } as const
const players = [{ player: { name: 'Some Receiver', position: 'WR', sleeperId: '1' }, value: 3000 }]
const row = (syncedAt: string, expiresInMs: number) => ({
  data: { players, settings: SETTINGS, syncedAt },
  expiresAt: new Date(Date.now() + expiresInMs),
})

beforeEach(() => {
  findUnique.mockReset(); upsert.mockReset(); fetchFantasyCalcValues.mockReset()
  upsert.mockResolvedValue({})
})

describe('getFantasyCalcChartDbFirst', () => {
  it('a cached chart returns the time it was SYNCED, not the time it was read', async () => {
    const synced = new Date(Date.now() - 40 * 60_000).toISOString()
    findUnique.mockResolvedValue(row(synced, 5 * 3_600_000))
    const out = await getFantasyCalcChartDbFirst(SETTINGS, { maxStaleMs: 2 * 3_600_000 })
    expect(out).toEqual({ players, syncedAt: synced })
    expect(fetchFantasyCalcValues).not.toHaveBeenCalled()
  })

  it('a live fetch returns the moment it synced, and writes that same moment', async () => {
    findUnique.mockResolvedValue(null)
    fetchFantasyCalcValues.mockResolvedValue(players)
    const before = Date.now()
    const out = await getFantasyCalcChartDbFirst(SETTINGS)
    expect(out.players).toBe(players)
    expect(Date.parse(out.syncedAt!)).toBeGreaterThanOrEqual(before)
    const written = upsert.mock.calls[0]![0].create.data as { syncedAt: string }
    expect(written.syncedAt).toBe(out.syncedAt)
  })

  it('[parity] getFantasyCalcValuesDbFirst returns the same players, unchanged', async () => {
    findUnique.mockResolvedValue(row(new Date().toISOString(), 5 * 3_600_000))
    expect(await getFantasyCalcValuesDbFirst(SETTINGS)).toEqual(players)
  })
})

describe('maxStaleMs is an AGE LIMIT (2026-09-28)', () => {
  const HOUR = 3_600_000
  const fresher = [{ player: { name: 'Some Receiver', position: 'WR', sleeperId: '1' }, value: 3300 }]

  it('🛑 a row OLDER than the limit is refetched even though it has not expired — the bug', async () => {
    // Synced 3 h ago, expires in 3 h. The old test served it; the trade chart asks for 2 h.
    findUnique.mockResolvedValue(row(new Date(Date.now() - 3 * HOUR).toISOString(), 3 * HOUR))
    fetchFantasyCalcValues.mockResolvedValue(fresher)
    const out = await getFantasyCalcChartDbFirst(SETTINGS, { maxStaleMs: 2 * HOUR })
    expect(fetchFantasyCalcValues).toHaveBeenCalledTimes(1)
    expect(out.players).toBe(fresher)
    expect(Date.now() - Date.parse(out.syncedAt!)).toBeLessThan(60_000)
  })

  it('a row inside the limit is served without a vendor call', async () => {
    findUnique.mockResolvedValue(row(new Date(Date.now() - 1 * HOUR).toISOString(), 5 * HOUR))
    await getFantasyCalcChartDbFirst(SETTINGS, { maxStaleMs: 2 * HOUR })
    expect(fetchFantasyCalcValues).not.toHaveBeenCalled()
  })

  it('an outage serves the recent chart WITH its true sync time, rather than failing the request', async () => {
    const synced = new Date(Date.now() - 3 * HOUR).toISOString()
    findUnique.mockResolvedValue(row(synced, 3 * HOUR))
    fetchFantasyCalcValues.mockRejectedValue(new Error('vendor down'))
    expect(await getFantasyCalcChartDbFirst(SETTINGS, { maxStaleMs: 2 * HOUR })).toEqual({ players, syncedAt: synced })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('an outage with only an EXPIRED row still fails — an old chart is not served as if current', async () => {
    findUnique.mockResolvedValue(row(new Date(Date.now() - 8 * HOUR).toISOString(), -2 * HOUR))
    fetchFantasyCalcValues.mockRejectedValue(new Error('vendor down'))
    await expect(getFantasyCalcChartDbFirst(SETTINGS, { maxStaleMs: 2 * HOUR })).rejects.toThrow('vendor down')
  })

  it('a row with no sync time is an unknown age, and is refetched', async () => {
    findUnique.mockResolvedValue({ data: { players, settings: SETTINGS }, expiresAt: new Date(Date.now() + 5 * HOUR) })
    fetchFantasyCalcValues.mockResolvedValue(fresher)
    await getFantasyCalcChartDbFirst(SETTINGS)
    expect(fetchFantasyCalcValues).toHaveBeenCalledTimes(1)
  })

  it('[unchanged] callers without a limit keep the 6 h default: a 5 h row is still served', async () => {
    findUnique.mockResolvedValue(row(new Date(Date.now() - 5 * HOUR).toISOString(), 1 * HOUR))
    await getFantasyCalcValuesDbFirst(SETTINGS)
    expect(fetchFantasyCalcValues).not.toHaveBeenCalled()
  })
})

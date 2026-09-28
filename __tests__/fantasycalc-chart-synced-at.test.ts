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

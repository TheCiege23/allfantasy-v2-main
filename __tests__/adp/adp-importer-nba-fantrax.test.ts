import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The NBA branch of the ADP importer.
 *
 * 🛑 It must reach Fantrax ONLY when the scheduled cron asks (`allowProviderFetch`). The same importer
 * runs from request paths — the draft pool's "no ADP yet" fallback and `lib/data/adp.ts` — and those
 * must stay DB-first: left unset, they write nothing new for NBA and make no provider call.
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
  loadFantraxNbaAdp: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    adpDataRecord: { findMany: h.findMany, createMany: h.createMany },
    aiAdpSnapshot: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/adp/fantraxNbaAdp', () => ({ loadFantraxNbaAdp: h.loadFantraxNbaAdp }))
vi.mock('@/lib/ai-adp-engine/aiAdpConsumerFlag', () => ({ isAiAdpConsumerEnabled: () => false }))
vi.mock('@/lib/adp-data', () => ({ fetchAllFFCFormats: vi.fn() }))
vi.mock('@/lib/multi-platform-adp', () => ({ loadMultiPlatformADP: vi.fn() }))

import { runAdpImporter } from '@/lib/workers/adp-importer'

const loaded = {
  ok: true as const,
  priced: 351,
  result: {
    matched: [
      { identityId: 'id-jokic', playerName: 'Nikola Jokić', position: 'C', team: 'DEN', adp: 1.39 },
      { identityId: 'id-gordon', playerName: 'Aaron Gordon', position: 'C', team: 'DEN', adp: 132.4 },
    ],
    ambiguous: ['Dyson Daniels'],
    unmatched: ['Rienk Mast'],
    duplicates: 0,
  },
}

/** Provider rows are the first createMany of the sport; consensus rows the second. */
const providerRows = () => (h.createMany.mock.calls[0]?.[0] as { data: Array<Record<string, unknown>> } | undefined)?.data ?? []

beforeEach(() => {
  vi.clearAllMocks()
  h.findMany.mockResolvedValue([])
  h.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }))
  h.loadFantraxNbaAdp.mockResolvedValue(loaded)
})

describe('runAdpImporter — NBA from Fantrax', () => {
  it('without allowProviderFetch it never calls Fantrax and writes nothing for NBA', async () => {
    const r = await runAdpImporter({ sports: ['NBA'] })
    expect(h.loadFantraxNbaAdp).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
    expect(r.fantraxNba).toBeNull()
  })

  it('with allowProviderFetch it writes one redraft/standard fantrax row per matched player, in OUR position', async () => {
    const r = await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })

    expect(h.loadFantraxNbaAdp).toHaveBeenCalledTimes(1)
    expect(providerRows()).toHaveLength(2)
    expect(providerRows()[0]).toMatchObject({
      sport: 'NBA',
      format: 'redraft',
      scoring: 'standard',
      source: 'fantrax',
      playerId: 'NBA:af:id-jokic',
      playerName: 'Nikola Jokić',
      position: 'C',
      team: 'DEN',
      adp: 1.39,
      season: r.season,
      week: r.week,
    })
    // Gordon is PF on Fantrax and C here — the row carries C.
    expect(providerRows()[1]).toMatchObject({ playerName: 'Aaron Gordon', position: 'C' })
    expect(r.fantraxNba).toEqual({
      ok: true,
      priced: 351,
      matched: 2,
      ambiguous: 1,
      unmatched: 1,
      duplicates: 0,
      unmatchedSample: ['Rienk Mast', 'Dyson Daniels'],
    })
  })

  it('records the ADP change against the previous fantrax row for the same player', async () => {
    h.findMany.mockResolvedValue([
      { sport: 'NBA', format: 'redraft', scoring: 'standard', playerId: 'NBA:af:id-jokic', source: 'fantrax', adp: 2.0 },
    ])
    await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })
    expect(providerRows()[0]).toMatchObject({ adpChange: -0.61 })
  })

  it('a Fantrax failure is reported, not thrown, and writes nothing', async () => {
    h.loadFantraxNbaAdp.mockResolvedValue({ ok: false, reason: 'Fantrax returned no ADP for NBA' })
    const r = await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })
    expect(r.fantraxNba).toEqual({ ok: false, reason: 'Fantrax returned no ADP for NBA' })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('a thrown error from the loader is caught and reported the same way', async () => {
    h.loadFantraxNbaAdp.mockRejectedValue(new Error('socket hang up'))
    const r = await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })
    expect(r.fantraxNba).toEqual({ ok: false, reason: 'socket hang up' })
  })

  it('[control] another non-NFL sport is untouched by the flag', async () => {
    const r = await runAdpImporter({ sports: ['NHL'], allowProviderFetch: true })
    expect(h.loadFantraxNbaAdp).not.toHaveBeenCalled()
    expect(r.fantraxNba).toBeNull()
  })
})

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
  loadFantraxAdp: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    adpDataRecord: { findMany: h.findMany, createMany: h.createMany },
    aiAdpSnapshot: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/adp/fantraxNbaAdp', () => ({ loadFantraxAdp: h.loadFantraxAdp }))
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
  h.loadFantraxAdp.mockResolvedValue(loaded)
})

describe('runAdpImporter — NBA from Fantrax', () => {
  it('without allowProviderFetch it never calls Fantrax and writes nothing for NBA', async () => {
    const r = await runAdpImporter({ sports: ['NBA'] })
    expect(h.loadFantraxAdp).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
    expect(r.fantraxNba).toBeNull()
  })

  it('with allowProviderFetch it writes one redraft/standard fantrax row per matched player, in OUR position', async () => {
    const r = await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })

    expect(h.loadFantraxAdp).toHaveBeenCalledTimes(1)
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
    h.loadFantraxAdp.mockResolvedValue({ ok: false, reason: 'Fantrax returned no ADP for NBA' })
    const r = await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })
    expect(r.fantraxNba).toEqual({ ok: false, reason: 'Fantrax returned no ADP for NBA' })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('a thrown error from the loader is caught and reported the same way', async () => {
    h.loadFantraxAdp.mockRejectedValue(new Error('socket hang up'))
    const r = await runAdpImporter({ sports: ['NBA'], allowProviderFetch: true })
    expect(r.fantraxNba).toEqual({ ok: false, reason: 'socket hang up' })
  })

  it('[control] a non-Fantrax non-NFL sport is untouched by the flag', async () => {
    const r = await runAdpImporter({ sports: ['NCAAB'], allowProviderFetch: true })
    expect(h.loadFantraxAdp).not.toHaveBeenCalled()
    expect(r.fantraxNba).toBeNull()
    expect(r.fantraxBySport).toEqual({})
  })
})

describe('runAdpImporter — MLB and NHL from Fantrax', () => {
  const mlbLoad = {
    ok: true as const,
    priced: 600,
    result: {
      matched: [{ identityId: 'id-judge', playerName: 'Aaron Judge', position: 'OF', team: 'NYY', adp: 1.8 }],
      ambiguous: [],
      unmatched: [],
      duplicates: 0,
    },
  }

  it.each(['MLB', 'NHL'])('%s writes fantrax rows keyed by its own sport, only with allowProviderFetch', async (sport) => {
    h.loadFantraxAdp.mockResolvedValue(mlbLoad)
    const without = await runAdpImporter({ sports: [sport] })
    expect(h.loadFantraxAdp).not.toHaveBeenCalled()
    expect(without.fantraxBySport).toEqual({})

    const r = await runAdpImporter({ sports: [sport], allowProviderFetch: true })
    expect(h.loadFantraxAdp).toHaveBeenCalledWith(sport)
    expect(providerRows()[0]).toMatchObject({
      sport,
      format: 'redraft',
      scoring: 'standard',
      source: 'fantrax',
      playerId: `${sport}:af:id-judge`,
      adp: 1.8,
    })
    expect(r.fantraxBySport[sport]).toMatchObject({ ok: true, matched: 1 })
    // The NBA-only field stays NBA-only.
    expect(r.fantraxNba).toBeNull()
  })

  it('a failed MLB feed is reported per sport', async () => {
    h.loadFantraxAdp.mockResolvedValue({ ok: false, reason: 'Fantrax returned no ADP for MLB' })
    const r = await runAdpImporter({ sports: ['MLB'], allowProviderFetch: true })
    expect(r.fantraxBySport.MLB).toEqual({ ok: false, reason: 'Fantrax returned no ADP for MLB' })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ marker: vi.fn(), upsert: vi.fn(), identities: vi.fn(), update: vi.fn(), provider: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: mocks.marker, upsert: mocks.upsert }, playerIdentityMap: { findMany: mocks.identities }, $executeRaw: mocks.update } }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', () => ({ getFantraxPlayerIds: mocks.provider }))
import { ingestNbaFantraxIdentities, ingestNhlFantraxIdentities } from '@/lib/player-identity/ingestProFantraxIdentities'
import { ingestMlbFantraxIdentities } from '@/lib/player-identity/ingestMlbFantraxIdentities'

const identity = (sport: string) => ({ id: 'one', canonicalName: sport === 'NBA' ? 'Jayson Tatum' : 'Connor McDavid', currentTeam: sport === 'NBA' ? 'BOS' : 'EDM', position: sport === 'NBA' ? 'F' : 'C', fantraxId: null, rollingInsightsId: 'ri-one' })
const ref = (sport: string) => (sport === 'NBA'
  ? { a: { fantraxId: 'a', name: 'Tatum, Jayson', team: 'BOS', position: 'SF' } }
  : { a: { fantraxId: 'a', name: 'McDavid, Connor', team: 'EDM', position: 'C' } })

describe.each([
  ['NBA', ingestNbaFantraxIdentities],
  ['NHL', ingestNhlFantraxIdentities],
])('scheduled %s Fantrax identity ingestion', (sport, ingest) => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.marker.mockResolvedValue(null)
    mocks.identities.mockResolvedValue([identity(sport)])
    mocks.provider.mockResolvedValue({ ok: true, data: ref(sport) })
    mocks.update.mockResolvedValue(1)
  })
  it('reads its own sport map and registry, and keeps its own cadence marker', async () => {
    expect(await ingest()).toMatchObject({ updated: 1, proposed: 1 })
    expect(mocks.provider).toHaveBeenCalledWith(sport)
    expect(mocks.identities.mock.calls[0]![0].where).toEqual({ sport })
    expect(mocks.marker.mock.calls[0]![0].where.cacheKey).toBe(`fantrax:${sport.toLowerCase()}-identities:last-run`)
    const [sql, payload, ...params] = mocks.update.mock.calls[0]!
    expect(sql.join('')).toContain('p."fantraxId" IS NULL')
    expect(JSON.parse(payload)).toEqual([{ id: 'one', fantraxId: 'a', rollingInsightsId: 'ri-one' }])
    /* The sport guard is a bound parameter on both the target and the uniqueness check. */
    expect(params).toEqual([sport, sport])
  })
  it('dry runs without writing', async () => {
    expect(await ingest(true)).toMatchObject({ proposed: 1, updated: 0, dryRun: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})

it('keeps the MLB cadence marker it always had', async () => {
  vi.clearAllMocks()
  mocks.marker.mockResolvedValue({ data: { at: new Date().toISOString() } })
  expect(await ingestMlbFantraxIdentities()).toMatchObject({ skipped: 'weekly cadence' })
  expect(mocks.marker.mock.calls[0]![0].where.cacheKey).toBe('fantrax:mlb-identities:last-run')
})

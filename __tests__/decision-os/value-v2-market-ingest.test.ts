import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ createMany: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerValueSnapshot: { createMany: mocks.createMany } } }))
import { ingestPlayerValues } from '@/lib/player-values/ingestPlayerValues'
import { playerValueRowObservation } from '@/lib/decision-os/value-v2/marketAdapters'
import { marketSnapshot } from '@/lib/decision-os/value-v2/market'

const player = { player: { name: 'Player One', sleeperId: 'p1', position: 'WR' }, value: 4000,
  trend30Day: 14, maybeTradeFrequency: 0.4, maybeMovingStandardDeviation: 100 }
const now = new Date('2026-09-09T14:32:15Z')
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => [player] })
  mocks.createMany.mockResolvedValue({ count: 1 })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('persists the requested market settings and actual observation time separately from the daily stamp', async () => {
  const result = await ingestPlayerValues(now)
  expect(result.stored).toBe(4)
  for (let index = 0; index < 4; index++) {
    const query = new URL(mocks.fetch.mock.calls[index][0]).searchParams
    const write = mocks.createMany.mock.calls[index][0]
    const row = write.data[0]
    expect(write.skipDuplicates).toBe(true)
    expect(row.marketNumTeams).toBe(Number(query.get('numTeams')))
    expect(row.marketPpr).toBe(Number(query.get('ppr')))
    expect(row.format === 'DYNASTY').toBe(query.get('isDynasty') === 'true')
    expect(row.qbFormat === 'SUPERFLEX').toBe(query.get('numQbs') === '2')
    expect(row.observedAt).toEqual(now)
    expect(row.capturedAt).toEqual(new Date('2026-09-09T00:00:00Z'))
    const observation = playerValueRowObservation(row)
    const snapshot = marketSnapshot({ assetId: 'p1', kind: 'player', observation,
      policy: { now: '2026-09-09T15:00:00Z', maxAgeMs: 3600000 } })
    expect(snapshot.marketValue?.value).toBe(4000)
    expect(snapshot.marketValue?.evidence.asOf).toBe(now.toISOString())
    expect(snapshot.gaps).not.toContain('market_cohort_incomplete')
  }
})
it('reports actual inserted counts so a duplicate retry does not claim another successful capture', async () => {
  mocks.createMany.mockResolvedValue({ count: 0 })
  const result = await ingestPlayerValues(now)
  expect(result.stored).toBe(0)
  expect(result.combos.every(c => c.stored === 0)).toBe(true)
  expect(result.partial).toBe(false)
})
it('retains existing daily uniqueness while recording the original timestamp on a retry', async () => {
  const stored = new Map<string, Record<string, any>>()
  mocks.createMany.mockImplementation(async ({ data }) => {
    let count = 0
    for (const row of data) {
      const key = [row.sleeperId, row.source, row.format, row.qbFormat, row.capturedAt.toISOString()].join(':')
      if (!stored.has(key)) { stored.set(key, row); count++ }
    }
    return { count }
  })
  expect((await ingestPlayerValues(now)).stored).toBe(4)
  vi.setSystemTime(new Date('2026-09-09T20:00:00Z'))
  expect((await ingestPlayerValues(new Date())).stored).toBe(0)
  expect([...stored.values()].every(row => +row.observedAt === +now)).toBe(true)
})
it('continues other market captures when one write fails and marks the run partial', async () => {
  mocks.createMany.mockRejectedValueOnce(new Error('storage unavailable'))
  const result = await ingestPlayerValues(now)
  expect(result.stored).toBe(3)
  expect(result.partial).toBe(true)
  expect(result.combos[0].skipped).toBe('storage unavailable')
})
// Picks are stored, not filtered (so a trade containing one can be graded); a FantasyCalc pick
// carries a synthetic sleeperId and keeps position PICK so unscoped readers can exclude it.
it('rejects ambiguous identities and malformed values, and stores a pick as a pick', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => [player, { ...player, value: 5000 },
    { player: { name: 'Bad', sleeperId: 'bad', position: 'QB' }, value: NaN },
    { player: { name: '2027 Round 1', sleeperId: 'DP_0_0', position: 'PICK' }, value: 2000 },
    { ...player, player: { ...player.player, sleeperId: 'good' } }] })
  const result = await ingestPlayerValues(now)
  expect(result.partial).toBe(true)
  expect(result.combos[0].invalidRows).toBe(3)
  expect(result.combos[0].picksStored).toBe(1)
  const written = mocks.createMany.mock.calls[0][0].data as Array<{ sleeperId: string; position: string | null }>
  expect(written.map(r => r.sleeperId).sort()).toEqual(['DP_0_0', 'good'])
  expect(written.find(r => r.sleeperId === 'DP_0_0')?.position).toBe('PICK')
})
it('counts an id-less row as invalid, pick or not', async () => {
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => [
    { player: { name: 'Pick', position: 'PICK' }, value: 2000 },
    { ...player, player: { ...player.player, sleeperId: 'good' } }] })
  const result = await ingestPlayerValues(now)
  expect(result.combos[0].invalidRows).toBe(1)
  expect(result.combos[0].picksStored).toBe(0)
  expect(mocks.createMany.mock.calls[0][0].data.map((r: { sleeperId: string }) => r.sleeperId)).toEqual(['good'])
})
it('refuses a malformed payload without abandoning the remaining profiles', async () => {
  mocks.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'unavailable' }) })
  const result = await ingestPlayerValues(now)
  expect(result.partial).toBe(true)
  expect(result.combos[0].skipped).toContain('expected rows')
  expect(result.stored).toBe(3)
})

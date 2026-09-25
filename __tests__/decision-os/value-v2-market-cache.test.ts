import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }))
vi.mock('@/lib/fantasycalc-fetch', () => ({ fetchFantasyCalcValues: mocks.fetch }))
vi.mock('@/lib/fantasycalc', () => ({ buildPlayerValuesForNames: vi.fn() }))
import { getFantasyCalcValuesDbFirst, readFantasyCalcValuesFromDb } from '@/lib/fantasycalc-db'

const settings = { isDynasty: false, numQbs: 1 as const, numTeams: 12, ppr: 0.5 as const }
const cachedPlayers = [{ player: { sleeperId: 'p1' }, value: 1000 }]
const fetchedPlayers = [{ player: { sleeperId: 'p1' }, value: 1200 }]
function cached(syncedAt: string, overrides = {}) {
  return { data: { players: cachedPlayers, settings, syncedAt, ...overrides }, expiresAt: new Date('2026-09-10T00:00:00Z') }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T12:00:00Z'))
  mocks.fetch.mockResolvedValue(fetchedPlayers)
  mocks.upsert.mockResolvedValue({})
})
afterEach(() => vi.useRealTimers())
it('returns the original cached observation timestamp without another provider fetch', async () => {
  mocks.findUnique.mockResolvedValue(cached('2026-09-09T11:00:00Z'))
  const observe = vi.fn()
  expect(await getFantasyCalcValuesDbFirst(settings, { maxStaleMs: 7200000, onSnapshot: observe })).toEqual(cachedPlayers)
  expect(observe).toHaveBeenCalledWith({ settings, observedAt: '2026-09-09T11:00:00Z', source: 'fantasycalc_cache' })
  expect(mocks.fetch).not.toHaveBeenCalled()
})
it.each(['2026-09-09T09:00:00Z', '2026-09-09T13:00:00Z', 'invalid'])('refreshes unusable observation %s despite a later cache expiration', async syncedAt => {
  mocks.findUnique.mockResolvedValue(cached(syncedAt))
  const observe = vi.fn()
  expect(await getFantasyCalcValuesDbFirst(settings, { maxStaleMs: 7200000, onSnapshot: observe })).toEqual(fetchedPlayers)
  expect(mocks.fetch).toHaveBeenCalledWith(settings)
  expect(observe).toHaveBeenCalledWith({ settings, observedAt: '2026-09-09T12:00:00.000Z', source: 'fantasycalc_fetch' })
})
it('does not use a dynasty payload stored under a redraft cache key', async () => {
  mocks.findUnique.mockResolvedValue(cached('2026-09-09T11:00:00Z', { settings: { ...settings, isDynasty: true } }))
  expect((await readFantasyCalcValuesFromDb(settings)).players).toEqual([])
  expect(await getFantasyCalcValuesDbFirst(settings)).toEqual(fetchedPlayers)
})
it('refuses malformed profile settings', async () => {
  mocks.findUnique.mockResolvedValue(cached('2026-09-09T11:00:00Z', { settings: { ...settings, numTeams: 0 } }))
  expect((await readFantasyCalcValuesFromDb(settings)).players).toEqual([])
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({find:vi.fn(),upsert:vi.fn(),transaction:vi.fn(),fetch:vi.fn(),enabled:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{sportsDataCache:{findUnique:mocks.find,upsert:mocks.upsert},$transaction:mocks.transaction}}))
vi.mock('@/lib/highlights/x-provider',()=>({fetchRecentXPosts:mocks.fetch,xHighlightsEnabled:mocks.enabled}))
import { refreshXCatalog, readXCatalog } from '@/lib/highlights/x-catalog'
let rows:Map<string,unknown>
beforeEach(()=>{
 vi.clearAllMocks();vi.useRealTimers();vi.unstubAllEnvs();rows=new Map()
 mocks.enabled.mockReturnValue(true);mocks.fetch.mockResolvedValue([])
 mocks.find.mockImplementation(async({where})=>rows.get(where.cacheKey)??null)
 mocks.upsert.mockImplementation(async({where,create,update})=>{const row=rows.has(where.cacheKey)?update:create;rows.set(where.cacheKey,row);return row})
 mocks.transaction.mockImplementation(async callback=>callback({sportsDataCache:{findUnique:mocks.find,upsert:mocks.upsert}}))
})
describe('shared X refresh budget',()=>{
 it('does not call the provider while disabled',async()=>{mocks.enabled.mockReturnValue(false);expect((await refreshXCatalog()).status).toBe('disabled');expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.fetch).not.toHaveBeenCalled()})
 it('reserves persistently before fetching and prevents repeat requests in the same UTC hour',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-11T18:59:00Z'))
  expect((await refreshXCatalog()).status).toBe('ready')
  expect((await refreshXCatalog()).status).toBe('limited');expect(mocks.fetch).toHaveBeenCalledTimes(1)
  expect(mocks.transaction.mock.calls[0][1]).toEqual({isolationLevel:'Serializable'})
  expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0])
  vi.useRealTimers()
 })
 it('stops at the daily request cap and resets on the next UTC day',async()=>{
  vi.stubEnv('X_HIGHLIGHTS_DAILY_REQUEST_LIMIT','2');vi.useFakeTimers()
  for(const hour of [1,2]){vi.setSystemTime(new Date('2026-10-11T0'+hour+':00:00Z'));expect((await refreshXCatalog()).status).toBe('ready')}
  vi.setSystemTime(new Date('2026-10-11T03:00:00Z'));expect((await refreshXCatalog()).status).toBe('limited')
  vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));expect((await refreshXCatalog()).status).toBe('ready')
  expect(mocks.fetch).toHaveBeenCalledTimes(3);vi.useRealTimers();vi.unstubAllEnvs()
 })
 it('fails closed on database errors and counts provider failures as attempts',async()=>{
  mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'))
  await expect(refreshXCatalog()).rejects.toThrow();expect(mocks.fetch).not.toHaveBeenCalled()
  mocks.fetch.mockRejectedValueOnce(new Error('provider unavailable'))
  await expect(refreshXCatalog()).rejects.toThrow()
  expect((await refreshXCatalog()).status).toBe('limited');expect(mocks.fetch).toHaveBeenCalledTimes(1)
 })
 it('rejects expired or malformed stored catalogs',async()=>{
  rows.set('highlights:x:catalog:v1',{data:{posts:[],checkedAt:new Date().toISOString()},expiresAt:new Date(0)})
  expect(await readXCatalog()).toBeNull()
  rows.set('highlights:x:catalog:v1',{data:{posts:[{id:'invalid'}]},expiresAt:new Date(Date.now()+60000)})
  expect(await readXCatalog()).toBeNull()
 })
})


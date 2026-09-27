import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ identities:vi.fn(),transaction:vi.fn(),latest:vi.fn(),remove:vi.fn(),insert:vi.fn(),audit:vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma:{sportsPlayer:{findMany:mocks.identities},$transaction:mocks.transaction} }))
import { importObservedMarketAdpBoard } from '@/lib/workers/importObservedMarketAdp'
const expected = {sport:'NBA',season:2026,format:'redraft' as const,scoring:'points'}
const board = () => ({...expected,evidenceType:'observed_drafts',licensedForUse:true,source:'licensed-export',asOf:new Date().toISOString(),players:[{canonicalPlayerId:'canonical-1',providerPlayerId:'vendor-1',playerName:'Player One',position:'PG',team:'BOS',adp:12.5,draftSampleSize:40}]})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.identities.mockResolvedValue([{id:'canonical-1',name:'Player One',position:'PG'}])
  mocks.latest.mockResolvedValue(null); mocks.insert.mockResolvedValue({count:1})
  mocks.transaction.mockImplementation(callback => callback({adpDataRecord:{findFirst:mocks.latest,deleteMany:mocks.remove,createMany:mocks.insert},adpRefreshRun:{create:mocks.audit}}))
})
describe('licensed market ADP import', () => {
  it('dry run performs no writes',async () => { expect((await importObservedMarketAdpBoard(board(),expected)).dryRun).toBe(true); expect(mocks.transaction).not.toHaveBeenCalled() })
  it('rejects identity mismatch before opening a transaction', async () => { mocks.identities.mockResolvedValue([{id:'canonical-1',name:'Another Player',position:'PG'}]); await expect(importObservedMarketAdpBoard(board(),expected,false)).rejects.toThrow('IDENTITY_MISMATCH'); expect(mocks.transaction).not.toHaveBeenCalled() })
  it('rejects prior observations instead of replacing a newer board', async () => { mocks.latest.mockResolvedValue({createdAt:new Date(Date.now()+60000)}); await expect(importObservedMarketAdpBoard(board(),expected,false)).rejects.toThrow('OLDER_THAN_STORED'); expect(mocks.remove).not.toHaveBeenCalled() })
  it('atomically writes the board and observation provenance', async () => {
    const input = board(); await importObservedMarketAdpBoard(input,expected,false)
    expect(mocks.insert.mock.calls[0][0].data[0]).toMatchObject({sport:'NBA',source:'licensed-export',adp:12.5,createdAt:new Date(input.asOf)})
    expect(mocks.audit.mock.calls[0][0].data.qualitySummary.players[0]).toMatchObject({draftSampleSize:40,providerPlayerId:'vendor-1'})
  })
})

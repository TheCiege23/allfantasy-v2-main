import { describe, it, expect, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({count:2}), resolve: vi.fn().mockReturnValue({playerId:null,matchType:'unresolved'}) }))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>({prisma:{sportsNews:{findMany:vi.fn().mockResolvedValue([])},playerNewsRecord:{createMany:mocks.create}}}))
vi.mock('@/lib/workers/api-chain',()=>({apiChain:{fetch:vi.fn().mockResolvedValue({source:'espn',data:[{title:'Long team news',team:'Unrecognized provider team label long enough',playerName:'Player A'},{title:'Normal news',team:'BOS',playerName:'Player B'}]})}}))
vi.mock('@/lib/player-identity/resolveNewsPlayer',()=>({buildNewsPlayerIndex:vi.fn().mockResolvedValue({resolve:mocks.resolve}),tallyNewsResolution:vi.fn(),attributionRate:()=>null,emptyNewsResolutionTally:()=>({})}))
import {runNewsImporter} from '@/lib/workers/news-importer'
describe('news importer team overflow',()=>{
 it('keeps both stories while rejecting an oversized team label at persistence',async()=>{
  await runNewsImporter({sports:['NBA']})
  const data=mocks.create.mock.calls[0][0].data
  expect(data).toHaveLength(2)
  expect(data[0]).toMatchObject({headline:'Long team news',team:null})
  expect(data[1]).toMatchObject({headline:'Normal news',team:'BOS'})
  expect(mocks.resolve.mock.calls[0][1]).toBeTruthy()
  expect(Array.from(mocks.resolve.mock.calls[0][1] as string).length).toBeGreaterThan(32)
 })
})

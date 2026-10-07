// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const db=vi.hoisted(()=>({playerGameStat:{findMany:vi.fn(),updateMany:vi.fn()},sportsDataCache:{findUnique:vi.fn(),upsert:vi.fn()}}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('server-only',()=>({}))
import {syncRecentNcaafConversions} from '@/lib/stats/syncNcaafConversions'
const now=new Date('2026-10-06'),evidence={playerId:'p',gameId:'cfbd:1',key:'conversions.REC',playId:'try',source:'espn-summary'}
const row={id:'row',playerId:'p',gameId:'cfbd:1',updatedAt:now,statPayload:{name:'Player',_team:'Arkansas','rushing.TD':1}}
beforeEach(()=>{vi.clearAllMocks();db.playerGameStat.findMany.mockResolvedValue([row]);db.playerGameStat.updateMany.mockResolvedValue({count:1});db.sportsDataCache.findUnique.mockResolvedValue({expiresAt:new Date('2026-10-07'),data:{provider:'espn-summary',gameId:'cfbd:1',evidence:[evidence],verified:true}})})
describe('conversion persistence after box-score refresh',()=>{
 it('replays cached role evidence without inventing CFBD provenance or rewriting points',async()=>{
  const r=await syncRecentNcaafConversions(2026,now);expect(r).toMatchObject({gamesProbed:0,rowsWritten:1,evidence:1});const call=db.playerGameStat.updateMany.mock.calls[0]![0];expect(call.where).toEqual({id:'row',updatedAt:now});expect(call.data.statPayload['conversions.REC']).toBe(1);expect(call.data.normalizedStatMap['conversions.REC']).toBe(1);expect(call.data).not.toHaveProperty('source');expect(call.data).not.toHaveProperty('fantasyPoints')
 })
 it('reports concurrent correction and does not cache it as applied',async()=>{db.playerGameStat.updateMany.mockResolvedValue({count:0});const r=await syncRecentNcaafConversions(2026,now);expect(r.rowsWritten).toBe(0);expect(r.gaps[0]).toContain('retry required')})
 it('removes a retracted event only after a verified provider refresh',async()=>{db.playerGameStat.findMany.mockResolvedValue([{...row,statPayload:{...row.statPayload,'conversions.REC':1,_conversionSource:'espn-summary',_conversionPlayIds:'try'}}]);db.sportsDataCache.findUnique.mockResolvedValue({expiresAt:new Date('2026-10-07'),data:{provider:'espn-summary',gameId:'cfbd:1',evidence:[],verified:true}});await syncRecentNcaafConversions(2026,now);expect(db.playerGameStat.updateMany.mock.calls[0]![0].data.statPayload).not.toHaveProperty('conversions.REC')})
 it('leaves invalid JSON payloads out of the retry ledger',async()=>{db.playerGameStat.findMany.mockResolvedValue([{...row,statPayload:null}]);expect((await syncRecentNcaafConversions(2026,now)).rowsWritten).toBe(0)})
})

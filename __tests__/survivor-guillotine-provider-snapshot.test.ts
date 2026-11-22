import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({$transaction:vi.fn(),$executeRaw:vi.fn(),$queryRaw:vi.fn(),playerWeeklyScore:{deleteMany:vi.fn()}}))
const provider=vi.hoisted(()=>({fetch:vi.fn(),coverage:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/workers/providers/survivorSleeper',()=>({fetchNflWeekPlayerMap:provider.fetch}))
vi.mock('@/lib/sports-data/statCoverage',()=>({recordNflWeeklyCoverage:provider.coverage,statCoverageCorrectionsReady:()=>true}))
import {syncSGNflWeek} from '@/lib/survivor-guillotine/providerNflSnapshot'
beforeEach(()=>{vi.resetAllMocks();db.$transaction.mockImplementation(fn=>fn(db));provider.fetch.mockResolvedValue(new Map([['123',{rec:1}]]));provider.coverage.mockResolvedValue(true);db.$queryRaw.mockResolvedValue([{recordedAt:new Date()}]);db.$executeRaw.mockResolvedValue(1);db.playerWeeklyScore.deleteMany.mockResolvedValue({count:2})})
describe('atomic complete NFL snapshots',()=>{
 it('removes vanished rows only after a complete corrected provider response',async()=>{expect((await syncSGNflWeek(2026,7)).removed).toBe(2);expect(db.playerWeeklyScore.deleteMany).toHaveBeenCalledWith({where:{sport:'NFL',season:2026,week:7,playerId:{notIn:['123']}}});expect(db.$transaction).toHaveBeenCalledTimes(1)})
 it('invalidates final proof and retains other live rows during an incomplete response',async()=>{provider.coverage.mockResolvedValue(false);const result=await syncSGNflWeek(2026,7);expect(result.complete).toBe(false);expect(result.correctionsReady).toBe(false);expect(db.playerWeeklyScore.deleteMany).not.toHaveBeenCalled()})
 it('propagates a failed row write through the transaction instead of returning a successful receipt',async()=>{db.$executeRaw.mockRejectedValue(new Error('write failed'));await expect(syncSGNflWeek(2026,7)).rejects.toThrow('write failed');expect(db.playerWeeklyScore.deleteMany).not.toHaveBeenCalled()})
})

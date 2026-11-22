import {beforeEach,describe,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({survivorGuillotineLeague:{findUnique:vi.fn(),updateMany:vi.fn()},survivorGuillotinePower:{count:vi.fn(),createMany:vi.fn()},draftPick:{findMany:vi.fn()},$transaction:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/platform/notification-service',()=>({createPlatformNotification:vi.fn()}))
import {allStarsSGConfig} from '@/lib/survivor-guillotine/config'
import {seedSGLiveDraftPowers} from '@/lib/survivor-guillotine/live'
beforeEach(()=>{vi.resetAllMocks();db.survivorGuillotineLeague.findUnique.mockResolvedValue({status:'setup',config:allStarsSGConfig(),revision:1});db.survivorGuillotinePower.count.mockResolvedValue(0);db.survivorGuillotineLeague.updateMany.mockResolvedValue({count:1});db.$transaction.mockImplementation(fn=>fn(db))})
describe('native draft powers with an empty legacy Player table',()=>{
 it('seeds powers from completed native picks without any legacy-player dependency',async()=>{db.draftPick.findMany.mockResolvedValue([{playerId:'123'},{playerId:'456'}]);expect(await seedSGLiveDraftPowers('L',['123','456'],1)).toEqual({count:1});expect(db.draftPick.findMany.mock.calls[0][0].where.session).toEqual({leagueId:'L',status:'completed'});expect(db.survivorGuillotinePower.createMany).toHaveBeenCalledTimes(1)})
 it('rejects an ID that belongs to another league or an unfinished draft',async()=>{db.draftPick.findMany.mockResolvedValue([{playerId:'123'}]);await expect(seedSGLiveDraftPowers('L',['123','foreign'],1)).rejects.toThrow('completed draft');expect(db.survivorGuillotinePower.createMany).not.toHaveBeenCalled()})
})

import {expect,it,vi} from 'vitest'
const findMany=vi.hoisted(()=>vi.fn().mockResolvedValue([]))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>({prisma:{sportsGame:{findMany}}}))
import {getDraftAdvisorContext} from '@/lib/sports-reporting/DraftAdvisorContextService'
it('uses the league season for both schedule and player evidence',async()=>{
 const context=await getDraftAdvisorContext({sport:'NFL',season:2025,candidates:[]})
 expect(context.season).toBe(2025)
 expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({sport:'NFL',season:2025})}))
})
it.each(['NBA','NHL','MLB','NCAAB','SOCCER'])('does not invent football bye weeks for %s',async sport=>{
 findMany.mockClear()
 const context=await getDraftAdvisorContext({sport,season:2025,candidates:[]})
 expect(context.byeWeekMap).toEqual({})
 expect(findMany).not.toHaveBeenCalled()
})

import {beforeEach,describe,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({entry:vi.fn(),lineup:vi.fn(),update:vi.fn(),optimize:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{
 bestBallContest:{findFirst:vi.fn(async()=>({sport:'NFL',cumulativeScoring:true}))},
 bestBallEntry:{findMany:m.entry,update:m.update},bestBallOptimizedLineup:{findFirst:m.lineup}
}}))
vi.mock('@/lib/bestball/optimizer',()=>({runBestBallOptimizer:m.optimize}))
import {calculateContestScores} from '@/lib/bestball/contestEngine'
beforeEach(()=>{vi.clearAllMocks();m.entry.mockResolvedValue([{id:'e',weeklyScores:[]}])})
describe('Contest score availability',()=>{
 it.each([null,{isFinalized:false,totalPoints:80,optimizerLog:{dataQuality:{status:'AVAILABLE'}}},{isFinalized:true,totalPoints:80,optimizerLog:{dataQuality:{status:'PARTIAL'}}}])('refuses missing or incomplete score rows',async row=>{
  m.lineup.mockResolvedValue(row)
  await expect(calculateContestScores('c',1)).rejects.toThrow('scoring is incomplete')
  expect(m.update).not.toHaveBeenCalled()
 })
 it('retains a real finalized zero',async()=>{
  m.lineup.mockResolvedValue({isFinalized:true,totalPoints:0,optimizerLog:{dataQuality:{status:'AVAILABLE'}}})
  await calculateContestScores('c',1)
  expect(m.update.mock.calls[0][0].data.weeklyScores).toEqual([{week:1,points:0}])
 })
})

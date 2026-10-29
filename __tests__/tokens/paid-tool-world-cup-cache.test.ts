// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest'
const h=vi.hoisted(()=>({member:vi.fn(),replay:vi.fn(),prepare:vi.fn(),cache:vi.fn(),generate:vi.fn()}))
vi.mock('@/lib/tokens/paidToolBilling',()=>({withPaidToolBilling:(handler:unknown)=>handler,replayPaidToolRequest:h.replay}))
vi.mock('@/app/api/brackets/world-cup/_utils',()=>({requireWorldCupApiUser:async()=>({ok:true,user:{id:'u1'}}),assertWorldCupChallengeMemberOrManager:h.member,worldCupChallengeParamsSchema:{safeParse:()=>({success:true,data:{challengeId:'c1'}})}}))
vi.mock('@/lib/bracket-brain/bracketBrainAccess',()=>({userHasBracketBrainAi:async()=>false}))
vi.mock('@/lib/world-cup/worldCupAiTokenFallback',()=>({prepareWorldCupAiTokenFallback:h.prepare,WORLD_CUP_AI_TOKEN_RULES:{edgeReport:'world_cup_ai_edge_report'}}))
vi.mock('@/lib/world-cup/worldCupChimmyContext',()=>({buildWorldCupChimmyContext:async()=>({})}))
vi.mock('@/lib/world-cup/worldCupEdgeReport',()=>({computeWorldCupEdgeReport:()=>({noEntry:false,sections:{}})}))
vi.mock('@/lib/world-cup/worldCupEdgeReportAi',()=>({generateEdgeReportCoaching:h.generate,todayUtcDate:()=> '2026-10-25',edgeReportCacheKey:()=> 'private-user-pool-day'}))
vi.mock('@/lib/ai/ai-result-cache',()=>({getCachedAiResult:h.cache}))
vi.mock('@/lib/world-cup/worldCupDataTrustService',()=>({getWorldCupDataTrustReport:vi.fn()}))
import {POST} from '@/app/api/brackets/world-cup/[challengeId]/edge-report/route'
const request=()=>new Request('https://test/api/brackets/world-cup/c1/edge-report',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})
const ctx={params:Promise.resolve({challengeId:'c1'})}
beforeEach(()=>{vi.resetAllMocks();h.member.mockResolvedValue({ok:true});h.replay.mockResolvedValue(null);h.cache.mockResolvedValue({resultText:JSON.stringify({coachingInsight:'Useful coaching',commissionerPost:'Pool update'})})})
it('returns cached coaching free before checking even an empty wallet',async()=>{
 const response=await POST(request(),ctx);expect(response.status).toBe(200)
 expect(await response.json()).toMatchObject({coaching:{coachingInsight:'Useful coaching',fromCache:true},billing:{tokenCharged:false}})
 expect(h.prepare).not.toHaveBeenCalled();expect(h.generate).not.toHaveBeenCalled()
})
it('checks current membership before reading or replaying a private report',async()=>{
 h.member.mockResolvedValue({ok:false,response:Response.json({error:'Forbidden'},{status:403})})
 expect((await POST(request(),ctx)).status).toBe(403)
 expect(h.cache).not.toHaveBeenCalled();expect(h.replay).not.toHaveBeenCalled();expect(h.prepare).not.toHaveBeenCalled()
})
it('replays the original billed result before using an unbilled cache shortcut',async()=>{
 h.replay.mockResolvedValue(Response.json({billing:{tokenCharged:true},coaching:{coachingInsight:'Original result'}}))
 expect(await(await POST(request(),ctx)).json()).toMatchObject({billing:{tokenCharged:true}})
 expect(h.cache).not.toHaveBeenCalled();expect(h.prepare).not.toHaveBeenCalled()
})

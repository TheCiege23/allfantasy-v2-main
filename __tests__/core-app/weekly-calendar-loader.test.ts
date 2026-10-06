// @vitest-environment node
import { beforeEach,describe,it,expect,vi } from 'vitest'
const h=vi.hoisted(()=>({state:vi.fn(),draft:vi.fn(),chat:vi.fn(),tasks:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>({prisma:{leagueWaiverState:{findMany:h.state},leagueSettings:{findMany:h.draft},leagueChatMessage:{findMany:h.chat},commissionerWorkspaceTask:{findMany:h.tasks}}}))
import { getWeeklyCalendar } from '@/lib/core-app/weeklyCalendarLoader'
const now=new Date('2026-10-06T12:00:00Z'),leagues=[{id:'N',platform:'allfantasy'},{id:'S',platform:'sleeper',platformLeagueId:'123'},{id:'M',platform:'yahoo',platformLeagueId:'456'}]
beforeEach(()=>{vi.clearAllMocks();h.state.mockResolvedValue([]);h.draft.mockResolvedValue([]);h.chat.mockResolvedValue([]);h.tasks.mockResolvedValue([])})
describe('calendar source scopes',()=>{
 it('reads engine schedules only for native leagues, public league polls and commissioner-owned tasks',async()=>{
 await getWeeklyCalendar(leagues,null,now,null,['N','stranger'])
 expect(h.state.mock.calls[0][0].where.leagueId.in).toEqual(['N'])
 expect(h.chat.mock.calls[0][0].where).toMatchObject({leagueId:{in:['N','S','M']},isPrivate:false,visibleToUserId:null,source:null})
 expect(h.tasks.mock.calls[0][0].where.leagueId.in).toEqual(['N'])
 })
 it('keeps the focus scope and reports read failures rather than pretending no events exist',async()=>{
 h.chat.mockRejectedValue(new Error('offline'))
 const c=await getWeeklyCalendar(leagues,null,now,'S',['N'])
 expect(h.state).not.toHaveBeenCalled();expect(h.tasks).not.toHaveBeenCalled();expect(h.chat.mock.calls[0][0].where.leagueId.in).toEqual(['S'])
 expect(c.gaps.some(g=>g.kind==='read'&&g.leagueId==='S')).toBe(true)
 })
 it('uses a real native run and does not fabricate imported waiver times',async()=>{
 h.state.mockResolvedValue([{leagueId:'N',nextRunAt:new Date('2026-10-07T08:00:00Z')}])
 const c=await getWeeklyCalendar(leagues,null,now,null,[])
 expect(c.events[0]).toMatchObject({leagueId:'N',kind:'waivers',source:'waiver-engine',href:'/core/waivers?league=N'})
 expect(c.gaps.some(g=>g.leagueId==='N'&&g.kind==='waivers')).toBe(false)
 expect(c.gaps.some(g=>g.leagueId==='S'&&g.kind==='waivers')).toBe(true)
 })
})

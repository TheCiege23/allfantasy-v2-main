import {beforeEach,describe,it,expect,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),membership:vi.fn(),team:vi.fn(),read:vi.fn(),save:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/league-access',()=>({resolveLeagueMembership:m.membership}))
vi.mock('@/lib/core-app/myTeam',()=>({getMyTeamData:m.team}))
vi.mock('@/lib/core-app/teamPreferenceStore',()=>({readTeamPreference:m.read,saveTeamPreference:m.save}))
import {GET,PUT,DELETE} from '@/app/api/core/team-plan/route'
const url='http://localhost/api/core/team-plan?league=L&week=7'
const req=(body:unknown,method='PUT')=>new Request(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({user:{id:'owner'}});m.membership.mockResolvedValue({ok:true});m.team.mockResolvedValue({workspaceScope:{rosterKey:'server-roster',season:2026},starters:{available:true,data:[{slotLabel:'RB',player:{sleeperId:'a',position:'RB'}}]},bench:{available:true,data:[{sleeperId:'b',position:'RB'},{sleeperId:'c',position:'QB'}]}});m.read.mockResolvedValue(null);m.save.mockResolvedValue(true)})
describe('private weekly plan route',()=>{
 it('rejects anonymous callers before reading any roster',async()=>{m.session.mockResolvedValue(null);expect((await GET(new Request(url))).status).toBe(401);expect(m.team).not.toHaveBeenCalled()})
 it('rejects nonmembers before reading any private plan',async()=>{m.membership.mockResolvedValue({ok:false,status:403});expect((await GET(new Request(url))).status).toBe(403);expect(m.read).not.toHaveBeenCalled()})
 it('derives roster and season from the authenticated server context',async()=>{const response=await PUT(req({expectedVersion:0,note:'private',slots:{0:'b'},rosterKey:'foreign',season:2030,userId:'other'}));expect(response.status).toBe(200);expect(m.save).toHaveBeenCalledWith('owner','weekPlan:["L","server-roster",2026,7]',0,{note:'private',slots:{0:'b'},deleted:false});expect(await response.json()).toMatchObject({tentative:true,lineupSubmitted:false})})
 it('rejects unknown roster scope, invalid weeks, duplicate players and incompatible players',async()=>{expect((await GET(new Request(url.replace('week=7','week=0')))).status).toBe(400);expect((await PUT(req({expectedVersion:0,note:'',slots:{0:'c'}}))).status).toBe(400);expect((await PUT(req({expectedVersion:0,note:'',slots:{0:'b',1:'b'}}))).status).toBe(400);m.team.mockResolvedValue({workspaceScope:null});expect((await GET(new Request(url))).status).toBe(409);expect(m.save).not.toHaveBeenCalled()})
 it('returns a conflict instead of overwriting a newer device plan',async()=>{m.save.mockResolvedValue(false);m.read.mockResolvedValue({version:3,note:'other device'});const response=await PUT(req({expectedVersion:2,note:'stale',slots:{}}));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({plan:{version:3,note:'other device'}})})
 it('deletes through a versioned tombstone and never submits a lineup',async()=>{expect((await DELETE(req({expectedVersion:3},'DELETE'))).status).toBe(200);expect(m.save).toHaveBeenCalledWith('owner',expect.any(String),3,{slots:{},note:'',deleted:true})})
})

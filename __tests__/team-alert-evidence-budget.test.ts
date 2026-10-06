import {describe,it,expect,vi,beforeEach} from 'vitest'
const m=vi.hoisted(()=>({team:vi.fn(),league:vi.fn(),players:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findUnique:m.league}}}))
vi.mock('@/lib/core-app/myTeam',()=>({getMyTeamData:m.team}))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId',()=>({findSportsPlayersForLeague:m.players}))
vi.mock('@/lib/core-app/teamDeliveryReceipts',()=>({dispatchTeamNotification:vi.fn()}))
import {readTeamAlerts} from '@/lib/core-app/teamAlertService'
const deadline=new Date(Date.now()+3600_000).toISOString()
const player=(id:string,out=false)=>({sleeperId:id,name:id,position:'RB',ruledOut:out,kickoff:deadline,injuryStatus:out?'OUT':null})
const data=(out=false)=>({league:{id:'a',name:'Alpha',platform:'manual',sport:'NFL'},starters:{available:true,data:[{slotLabel:'RB',player:player('injured',out)},{slotLabel:'RB',player:player('healthy')}]},bench:{available:true,data:[player('backup')]}})
beforeEach(()=>{vi.clearAllMocks();m.league.mockResolvedValue({settings:{tradeDeadlineAt:deadline},lastSyncedAt:new Date()});m.players.mockResolvedValue(new Map())})
describe('alert evidence read budget',()=>{
 it('keeps deadline-only alerts without a second player evidence read',async()=>{m.team.mockResolvedValue(data());const result=await readTeamAlerts('a','owner');expect(result.alerts.map(a=>a.kind)).toEqual(['deadline']);expect(m.players).not.toHaveBeenCalled();expect(m.team).toHaveBeenCalledWith('a','owner',null,{savedRosterOnly:true,alertPreviewOnly:true})})
 it('verifies only affected injury identities, excluding healthy starters and backups',async()=>{m.team.mockResolvedValue(data(true));const result=await readTeamAlerts('a','owner');expect(result.alerts).toHaveLength(2);expect(m.players).toHaveBeenCalledWith('NFL','manual',['injured'],{translated:true})})
})

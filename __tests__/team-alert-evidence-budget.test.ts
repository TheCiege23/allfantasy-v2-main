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



describe('empty-bench injury evidence', () => {
 it('verifies the injured starter independently of replacement availability', async () => {
   m.team.mockResolvedValue({ ...data(true), bench: { available: false, reason: 'no bench players recorded on this roster' } })
   m.players.mockResolvedValue(new Map([['injured', { source: 'sleeper', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), status: 'OUT' }]]))
   const result = await readTeamAlerts('a', 'owner')
   expect(result.available).toBe(true)
   expect(result.alerts).toHaveLength(2)
   expect(result.alerts.find(a => a.kind === 'injury')).toMatchObject({ playerId: 'injured', alternative: null, fresh: true, source: 'sleeper' })
   expect(m.players).toHaveBeenCalledWith('NFL', 'manual', ['injured'], { translated: true })
 })
 it('still holds injury delivery with uncertain status evidence', async () => {
   m.team.mockResolvedValue({ ...data(true), bench: { available: false } })
   const result = await readTeamAlerts('a', 'owner')
   expect(result.alerts.find(a => a.kind === 'injury')).toMatchObject({ alternative: null, fresh: false })
 })
 it('still holds stale imported roster evidence before player reads', async () => {
   m.team.mockResolvedValue({ ...data(true), league: { id: 'a', name: 'Alpha', platform: 'sleeper', sport: 'NFL' }, bench: { available: false } })
   m.league.mockResolvedValue({ settings: {}, lastSyncedAt: new Date(Date.now() - 31 * 60_000) })
   expect(await readTeamAlerts('a', 'owner')).toEqual({ available: false, alerts: [] })
   expect(m.players).not.toHaveBeenCalled()
 })
})


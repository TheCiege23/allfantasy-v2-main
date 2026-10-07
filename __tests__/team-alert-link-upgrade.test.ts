import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
const m=vi.hoisted(()=>({team:vi.fn(),league:vi.fn(),players:vi.fn(),profile:vi.fn(),claim:vi.fn(),rows:vi.fn(),sql:vi.fn(),dispatch:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findUnique:m.league},userProfile:{findUnique:m.profile},automationAuditLog:{create:m.claim},platformNotification:{findMany:m.rows},$executeRaw:m.sql}}))
vi.mock('@/lib/core-app/myTeam',()=>({getMyTeamData:m.team}))
vi.mock('@/lib/player-identity/findSportsPlayerByLeagueId',()=>({findSportsPlayersForLeague:m.players}))
vi.mock('@/lib/core-app/teamDeliveryReceipts',()=>({dispatchTeamNotification:m.dispatch}))
import {reconcileTeamAlertNotifications} from '@/lib/core-app/teamAlertService'
import {teamInjuryAlertHref} from '@/lib/core-app/teamAlertTarget'
const deadline=new Date(Date.now()+3600_000).toISOString()
const key='team-workspace:a:'+createHash('sha256').update(`injury:p:${deadline}`).digest('hex').slice(0,24)+':owner'
afterEach(()=>vi.unstubAllEnvs())
beforeEach(()=>{
 vi.stubEnv('NEXTAUTH_SECRET','');vi.stubEnv('AUTH_SECRET','');vi.clearAllMocks();m.team.mockResolvedValue({league:{id:'a',name:'Alpha',platform:'manual',sport:'NFL'},starters:{available:true,data:[{slotLabel:'RB',player:{sleeperId:'p',name:'Player',position:'RB',ruledOut:true,kickoff:deadline,injuryStatus:'OUT'}}]},bench:{available:false}})
 m.league.mockResolvedValue({settings:{},lastSyncedAt:new Date()});m.profile.mockResolvedValue(null)
 m.players.mockResolvedValue(new Map([['p',{source:'sleeper',fetchedAt:new Date(),expiresAt:new Date(Date.now()+3600_000),status:'OUT'}]]))
 m.claim.mockRejectedValue({code:'P2002'});m.sql.mockResolvedValue(1)
 m.rows.mockResolvedValue([{id:'n',sourceKey:key,meta:{actionHref:'/core/my-team?league=a',deliveryReceipt:{status:'stored'}}}])
})
describe('unread alert link upgrade without repeat delivery',()=>{
 it('upgrades a previously claimed alert using its exact player, deadline and slot',async()=>{
  expect(await reconcileTeamAlertNotifications('a','owner')).toEqual({evaluated:0,available:true})
  expect(m.dispatch).not.toHaveBeenCalled();expect(m.sql).toHaveBeenCalledTimes(1)
  const [sql,...values]=m.sql.mock.calls[0]
  expect(values).toContain(JSON.stringify({actionHref:teamInjuryAlertHref('a','p',deadline,0)}))
  expect(sql.join('')).toContain('"readAt" IS NULL');expect(sql.join('')).toContain('"userId"=');expect(sql.join('')).toContain('"leagueId"=')
  expect(sql.join('')).toContain('jsonb_typeof');expect(sql.join('')).toContain(' || ')
  expect(m.rows).toHaveBeenCalledWith(expect.objectContaining({where:{userId:'owner',leagueId:'a',type:'team_workspace_alert',readAt:null}}))
 })
 it('adds an account-bound measurement to in-app targets without resending, stable across repeated reconciliation',async()=>{
  vi.stubEnv('NEXTAUTH_SECRET','test-only-key')
  await reconcileTeamAlertNotifications('a','owner')
  const values=m.sql.mock.calls[0].slice(1),json=values.find(v=>typeof v==='string'&&v.startsWith('{'))
  const url=new URL(JSON.parse(json).actionHref,'http://localhost')
  expect(url.searchParams.get('alertPlayer')).toBe('p');expect(url.searchParams.get('alertMeasure')).toMatch(/^\d{13}\.injury\./)
  m.sql.mockClear();await reconcileTeamAlertNotifications('a','owner')
  expect(m.sql.mock.calls[0].slice(1)).toEqual(values);expect(m.dispatch).not.toHaveBeenCalled()
 })
 it('does not rewrite an already exact target or unrelated notification',async()=>{
  m.rows.mockResolvedValue([{id:'n',sourceKey:key,meta:{actionHref:teamInjuryAlertHref('a','p',deadline,0)}},{id:'other',sourceKey:'other:a',meta:{}}])
  await reconcileTeamAlertNotifications('a','owner');expect(m.sql).not.toHaveBeenCalled();expect(m.dispatch).not.toHaveBeenCalled()
 })
 it('preserves unread entries when current roster evidence is unavailable',async()=>{
  m.team.mockResolvedValue(null);expect(await reconcileTeamAlertNotifications('a','owner')).toEqual({evaluated:0,available:false});expect(m.rows).not.toHaveBeenCalled();expect(m.sql).not.toHaveBeenCalled()
 })
 it('resolves a changed kickoff without redirecting the old alert to a different deadline',async()=>{
  m.rows.mockResolvedValue([{id:'old',sourceKey:'team-workspace:a:old:owner',meta:{actionHref:'old'}}])
  await reconcileTeamAlertNotifications('a','owner');expect(m.sql).toHaveBeenCalledTimes(1)
  const [sql,...values]=m.sql.mock.calls[0];expect(sql.join('')).toContain('"readAt"=NOW()');expect(JSON.stringify(values)).toContain('resolvedAt');expect(JSON.stringify(values)).not.toContain('alertPlayer')
 })
})

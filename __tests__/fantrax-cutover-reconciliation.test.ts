import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const f=vi.hoisted(()=>({settings:{} as any, db:{} as any, score:vi.fn(), provider:vi.fn(), rosters:vi.fn(), saved:vi.fn(), commits:0}))
vi.mock('@/lib/prisma',()=>({prisma:new Proxy({},{get:(_,key)=>f.db[key]})}))
vi.mock('@/lib/league-import/fantrax/fantraxApi',()=>({getFantraxTeamRosters:f.rosters,getFantraxMatchupScores:f.provider}))
vi.mock('@/lib/league-import/fantrax/installCutover',()=>({saveCutover:f.saved}))
vi.mock('@/lib/league-import/fantrax/datedCutoverScoring',()=>({readDatedCutoverRoster:f.score}))
vi.mock('@/lib/redraft/scoringEngine',()=>({isScoringStarterSlot:(s:string)=>s==='starter',scoreRosterForWeek:vi.fn()}))
import { reconcileCutover } from '@/lib/league-import/fantrax/reconcileCutover'

const csv='season,period,team_id,player_id,date,slot,points\n2026,1,A,fa,2026-11-02,ACTIVE,9\n2026,1,B,fb,2026-11-02,ACTIVE,3'
const fixture={id:'game',homeRosterId:'A',awayRosterId:'B',lineupSnapshots:{fantraxCutover:{sourceOwned:true,homeTeam:'A',awayTeam:'B'}}}

beforeEach(()=>{
  vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T19:00:00Z'))
  f.commits=0
  f.settings={importCarryover:{cutover:{policy:'reconcile_open_period',snapshotId:'snapshot',season:2026,period:1,periods:[{number:1,startDate:'2026-11-02T12:00:00Z',endDate:'2026-11-10T04:00:00Z'}],installedSeasonId:'season',teams:{A:'a',B:'b'}}}}
  const members=['A','B'].map(i=>({id:i,rosterId:i,playerId:i.toLowerCase(),slotType:'starter',droppedAt:null,addedAt:new Date()}))
  f.db={league:{findUniqueOrThrow:vi.fn(async()=>({settings:f.settings,sport:'NBA',season:2026}))},
    fantraxLeague:{findUniqueOrThrow:vi.fn(async()=>({sourceLeagueId:'provider'}))},redraftMatchup:{findMany:vi.fn(async()=>[fixture]),update:vi.fn()},
    redraftRosterPlayer:{findMany:vi.fn(async()=>members),updateMany:vi.fn()},playerIdentityMap:{findMany:vi.fn(async()=>members.map(m=>({fantraxId:'f'+m.playerId,rollingInsightsId:m.playerId})))},
    redraftDailyLineup:{findMany:vi.fn(async()=>[]),createMany:vi.fn()},leagueAuditLog:{create:vi.fn()},$queryRaw:vi.fn(),
    $transaction:vi.fn(async(fn:any)=>{const r=await fn(f.db);f.commits++;return r})}
  f.saved.mockImplementation(async (_tx,_id,c)=>{f.settings.importCarryover.cutover=c})
  f.rosters.mockResolvedValue({ok:true,data:Object.fromEntries(members.map(p=>[p.rosterId,{rosterItems:[{id:'f'+p.playerId,status:'ACTIVE'}]}]))})
  f.provider.mockResolvedValue({ok:true,data:{period:1,matchups:[{home:{teamId:'A',score:9,gamesPlayed:1},away:{teamId:'B',score:3,gamesPlayed:1}}]}})
  f.score.mockImplementation(async({rosterId,sourceSlots})=>{
    const player=rosterId.toLowerCase(),points=rosterId==='A'?9:3
    expect(sourceSlots.get(JSON.stringify([rosterId,'2026-11-02',player]))).toBe('starter')
    return {roster:[{player,fantraxId:'f'+player}],nextStart:Date.parse('2026-11-02T21:00:00Z'),played:1,
      summary:{points,statTotals:{},missingPlayerIds:[]},lines:[{roster:rosterId,player,day:'2026-11-02',game:'g',slot:'starter',points,stats:{}}]}
  })
})
afterEach(()=>vi.useRealTimers())
it('transfers the period only after both players, locked lineups and official team totals match, and retries without new writes',async()=>{
  expect(await reconcileCutover('league','commish',csv)).toMatchObject({nativeFrom:1,matched:2})
  expect(f.db.redraftDailyLineup.createMany).toHaveBeenCalledOnce()
  expect(f.db.redraftMatchup.update.mock.calls[0][0].data.lineupSnapshots.fantraxCutover.sourceOwned).toBe(false)
  expect(f.saved.mock.calls[0][2]).toMatchObject({settled:true,nativeFrom:1})
  await reconcileCutover('league','commish',csv)
  expect(f.commits).toBe(1)
})
it('leaves Fantrax in control when one individual score differs',async()=>{
  await expect(reconcileCutover('league','commish',csv.replace(',ACTIVE,9',',ACTIVE,8'))).rejects.toThrow(/points differ/)
  expect(f.db.$transaction).not.toHaveBeenCalled();expect(f.saved).not.toHaveBeenCalled()
})
it('refuses if the official scoreboard changed even though the player export matches native stats',async()=>{
  f.provider.mockResolvedValue({ok:true,data:{period:1,matchups:[{home:{teamId:'A',score:7},away:{teamId:'B',score:3}}]}})
  await expect(reconcileCutover('league','commish',csv)).rejects.toThrow(/official current scoreboard/)
  expect(f.saved).not.toHaveBeenCalled()
})

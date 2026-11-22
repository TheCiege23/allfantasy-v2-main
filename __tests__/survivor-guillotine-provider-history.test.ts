import { beforeEach, describe, expect, it, vi } from 'vitest'
const db=vi.hoisted(()=>({$queryRaw:vi.fn(),sportsGame:{findMany:vi.fn()},playerWeeklyScore:{findMany:vi.fn()},playerIdentityMap:{findMany:vi.fn()}}))
const coverage=vi.hoisted(()=>({read:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:db}))
vi.mock('@/lib/sports-data/statCoverage',()=>({readStatCoverage:coverage.read,statCoverageCorrectionsReady:()=>true,coverageGameKey:(g:any)=>JSON.stringify([g.homeTeam,g.awayTeam,g.startTime.toISOString()])}))
import {loadHistoricalPeriod} from '@/lib/redraft/lineupHistory'
import {hydrateRedraftLineupLocks} from '@/lib/redraft/lineupLock'
const kickoff=new Date('2026-10-25T17:00:00Z'),recorded=new Date('2026-10-28T00:00:00Z')
const game={id:'g',externalId:'provider-g',sport:'NFL',season:2026,week:7,seasonType:'regular',homeTeam:'KC',awayTeam:'BUF',startTime:kickoff,status:'final',source:'rolling_insights',fetchedAt:recorded}
const args={leagueId:'L',seasonId:'S',sport:'NFL',season:2026,week:7,settings:{lineup_history_version:1},requireAtomicNflSnapshot:true,scoringWindow:{startsAt:new Date('2026-10-22T00:00:00Z'),endsAt:new Date('2026-10-28T00:00:00Z')}}
function history(from:string){db.$queryRaw.mockResolvedValueOnce([{coveredFrom:new Date(from),legacyBaseline:false}]).mockResolvedValueOnce([{sourcePlayerRowId:'p',effectiveAtMs:Date.parse(from),sequence:1n,afterState:{id:'p',playerId:'123',rosterId:'r',sport:'NFL',team:'KC',position:'QB',slotType:'QB',droppedAt:null}}])}
beforeEach(()=>{
 vi.resetAllMocks();db.sportsGame.findMany.mockResolvedValue([game]);db.playerWeeklyScore.findMany.mockResolvedValue([{playerId:'123',stats:{pass_yds:100},updatedAt:recorded}]);db.playerIdentityMap.findMany.mockResolvedValue([{sleeperId:'123'}]);coverage.read.mockResolvedValue([{kind:'week',identitySpace:'sleeper',source:'sleeper_weekly_stats',week:7,gameKeys:[JSON.stringify(['KC','BUF',kickoff.toISOString()])],participantIds:['123'],recordedAt:recorded}])
})
describe('native provider/history boundaries',()=>{
 it('refuses to award past games to a freshly created native roster epoch',async()=>{history('2026-11-01T00:00:00Z');await expect(loadHistoricalPeriod(db as any,args)).rejects.toThrow('BEFORE_BASELINE')})
 it('also refuses a kickoff before the native baseline when the period itself ends later',async()=>{history('2026-10-26T00:00:00Z');await expect(loadHistoricalPeriod(db as any,args)).rejects.toThrow('BEFORE_BASELINE')})
 it('scores a properly covered roster and scopes a custom NFL date window to its provider week',async()=>{history('2026-10-20T00:00:00Z');const result=await loadHistoricalPeriod(db as any,args);expect(result.contributions[0].stats.pass_yds).toBe(100);expect(result.sourceSnapshotReady).toBe(true);expect(result.missingPlayerIds).toEqual([]);expect(db.sportsGame.findMany.mock.calls[0][0].where).toMatchObject({sport:'NFL',season:2026,week:7})})
 it('holds finalization if another writer changed a stat row after its atomic coverage receipt',async()=>{history('2026-10-20T00:00:00Z');db.playerWeeklyScore.findMany.mockResolvedValue([{playerId:'123',stats:{pass_yds:100},updatedAt:new Date(recorded.getTime()+1)}]);expect((await loadHistoricalPeriod(db as any,args)).sourceSnapshotReady).toBe(false)})
 it('uses the saved NBA scoring period for locks even when period 1 begins months after the standard anchor',async()=>{
  db.sportsGame.findMany.mockResolvedValue([{...game,sport:'NBA',homeTeam:'BOS',awayTeam:'NYK',startTime:new Date('2026-11-12T23:00:00Z')}])
  const result=await hydrateRedraftLineupLocks(db as any,{sport:'NBA',season:2026,week:1,rosterId:'r',now:new Date('2026-11-13T01:00:00Z'),leagueSettings:{sportConfig:{lineupLockType:'game_start'},survivorGuillotine:{scoringWindow:{period:1,startsAt:'2026-11-12T05:00:00Z',endsAt:'2026-11-19T05:00:00Z'}}},players:[{playerId:'nba1',team:'BOS',isLocked:false}]})
  expect(result.players[0].isLocked).toBe(true)
 })
})

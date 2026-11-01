import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
const m=vi.hoisted(()=>({cache:new Map<string,any>(),profile:vi.fn(),updateProfile:vi.fn(),view:vi.fn(),dispatch:vi.fn(),picks:vi.fn(),entries:vi.fn(),pools:vi.fn(),upsert:vi.fn(),transaction:vi.fn(),query:vi.fn()}))
vi.mock("@/lib/prisma",()=>{
  const db:any={sportsDataCache:{findUnique:vi.fn(async({where}:any)=>m.cache.has(where.cacheKey)?{data:m.cache.get(where.cacheKey)}:null),upsert:m.upsert,update:vi.fn(async({where,data}:any)=>{m.cache.set(where.cacheKey,data.data);return {}})},userProfile:{findUnique:m.profile,updateMany:m.updateProfile},playoffBracketPick:{findMany:m.picks},playoffBracketEntry:{findMany:m.entries},playoffBracketChallenge:{findMany:m.pools},$queryRaw:m.query,$transaction:m.transaction}
  m.transaction.mockImplementation(async(fn:any)=>fn(db))
  return {prisma:db}
})
vi.mock("@/lib/playoffs/playoffService",()=>({getPlayoffBracketView:m.view}))
vi.mock("@/lib/notifications/NotificationDispatcher",()=>({dispatchNotification:m.dispatch}))
import { loadBracketExperience, saveBracketAlerts, sweepBracketExperience } from "@/lib/playoffs/bracketExperienceService"
import { defaultBracketAlerts } from "@/lib/playoffs/bracketExperience"
const now=Date.parse("2026-11-07T01:00:00Z")
function view():PlayoffChallengeView{return {challenge:{id:"pool",name:"Pool",ownerUserId:"me",sport:"nba_cup",seasonYear:2026,status:"open",isTestMode:false,createdAt:"",updatedAt:""},viewerUserId:"me",activeEntry:{id:"mine",name:"Mine",userId:"me",isComplete:true,finalizedAt:"2026-11-06T20:00:00Z",pickCount:1,totalScore:0,rank:2,createdAt:""},entries:[{id:"mine",name:"Mine",userId:"me",isComplete:true,finalizedAt:"2026-11-06T20:00:00Z",pickCount:1,totalScore:0,rank:2,createdAt:""}],rounds:[],series:[{...buildPlayoffTemplate({sport:"nba_cup",seasonYear:2026})[0],id:"game",round:"cup_group_play",bestOf:1,homeTeamName:"Boston Celtics",awayTeamName:"Atlanta Hawks",startsAt:"2026-11-07T00:00:00Z",status:"in_progress",lastSyncedAt:new Date(now).toISOString(),liveHomeScore:90,liveAwayScore:80}],picks:[{id:"p",entryId:"mine",seriesId:"game",pickTeamName:"Boston Celtics",createdAt:"",updatedAt:""}]}}
beforeEach(()=>{vi.clearAllMocks();m.cache.clear();vi.useFakeTimers();vi.setSystemTime(now);m.view.mockResolvedValue(view());m.profile.mockResolvedValue({notificationPreferences:{categories:{bracket_updates:{enabled:true}},bracketCoach:{pool:{...defaultBracketAlerts,enabled:true}}},updatedAt:new Date(now)});m.picks.mockResolvedValue([{entryId:"mine",seriesId:"game",pickTeamName:"Boston Celtics"}]);m.entries.mockResolvedValue([{id:"mine",userId:"me",tiebreakerTotalScore:null}]);m.pools.mockResolvedValue([{id:"pool"}]);m.query.mockResolvedValue([{acquired:true}]);m.updateProfile.mockResolvedValue({count:1});m.dispatch.mockResolvedValue({requested:1,suppressed:0,delivered:1,failed:0});m.upsert.mockImplementation(async({where,create,update}:any)=>{const data=m.cache.has(where.cacheKey)?update.data:create.data;m.cache.set(where.cacheKey,data);return {data}})})
afterEach(()=>vi.useRealTimers())
describe("experience persistence and privacy",()=>{
  it("keeps GET reads free of writes, sends, and future rival picks",async()=>{
    const result=await loadBracketExperience(view())
    expect(result.standings!.rows[0]).toMatchObject({livePoints:1})
    expect(m.picks).toHaveBeenCalledWith({where:{challengeId:"pool",entryId:{in:["mine"]},seriesId:{in:["game"]}},select:{entryId:true,seriesId:true,pickTeamName:true}})
    expect(m.upsert).not.toHaveBeenCalled();expect(m.dispatch).not.toHaveBeenCalled();expect(m.updateProfile).not.toHaveBeenCalled()
    expect(JSON.stringify(result.standings)).not.toContain("pickTeamName")
  })
  it("does not return a foreign entry's private ledger or history",async()=>{
    const v=view();v.activeEntry!.userId="stranger"
    const result=await loadBracketExperience(v)
    expect(result.ledger).toEqual([]);expect(result.history.events).toEqual([]);expect(result.officialTotal).toBe(0)
  })
  it("retains sibling preferences through a concurrent settings change",async()=>{
    m.updateProfile.mockResolvedValueOnce({count:0}).mockResolvedValueOnce({count:1})
    m.profile.mockResolvedValueOnce({notificationPreferences:{theme:"dark",bracketCoach:{other:{enabled:true}}},updatedAt:new Date(now)})
      .mockResolvedValueOnce({notificationPreferences:{theme:"light",categories:{bracket_updates:{enabled:false}},bracketCoach:{other:{enabled:true}}},updatedAt:new Date(now+1)})
    await saveBracketAlerts("me","pool",defaultBracketAlerts)
    expect(m.updateProfile.mock.calls[1][0]).toMatchObject({where:{userId:"me",updatedAt:new Date(now+1)},data:{notificationPreferences:{theme:"light",categories:{bracket_updates:{enabled:false}},bracketCoach:{other:{enabled:true},pool:defaultBracketAlerts}}}})
  })
  it("fails visibly after repeated contention instead of overwriting active settings",async()=>{
    m.updateProfile.mockResolvedValue({count:0})
    await expect(saveBracketAlerts("me","pool",defaultBracketAlerts)).rejects.toThrow("PREFERENCES_CHANGED")
    expect(m.updateProfile).toHaveBeenCalledTimes(3)
  })
  it("establishes a baseline then records a final and correction without changing results",async()=>{
    const baseline=await sweepBracketExperience("nba_cup",2026)
    expect(baseline).toMatchObject({processed:1,failures:0,alerts:0});expect(m.dispatch).not.toHaveBeenCalled()
    const v=view();v.series[0].status="final";v.series[0].winnerTeamName="Boston Celtics";v.activeEntry!.totalScore=1;v.activeEntry!.rank=1
    vi.setSystemTime(now+1000);m.view.mockResolvedValue(v)
    const next=await sweepBracketExperience("nba_cup",2026)
    expect(next).toMatchObject({processed:1,alerts:1,failures:0})
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({category:"bracket_updates",userIds:["me"],skipChannels:{sms:true},body:"Open your bracket for your private picks and latest standings."}))
    const saved=m.cache.get("bracket-experience:v1:entry:mine")
    expect(saved.events[0]).toMatchObject({delta:1,kind:"settled"});expect(saved.pendingAlerts).toEqual([])
    vi.setSystemTime(now+2000);await sweepBracketExperience("nba_cup",2026)
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    v.series[0].winnerTeamName="Atlanta Hawks";v.activeEntry!.totalScore=0;vi.setSystemTime(now+3000)
    await sweepBracketExperience("nba_cup",2026)
    expect(m.cache.get("bracket-experience:v1:entry:mine").events[0]).toMatchObject({kind:"corrected",delta:-1})
  })
  it("retains a failed notification handoff and reuses its deduplication identity",async()=>{
    await sweepBracketExperience("nba_cup",2026)
    const v=view();v.series[0].status="final";v.series[0].winnerTeamName="Boston Celtics";vi.setSystemTime(now+1000);m.view.mockResolvedValue(v);m.dispatch.mockResolvedValueOnce({failed:1,delivered:0})
    await sweepBracketExperience("nba_cup",2026)
    expect(m.cache.get("bracket-experience:v1:entry:mine").pendingAlerts).toHaveLength(1)
    vi.setSystemTime(now+2000);await sweepBracketExperience("nba_cup",2026)
    expect(m.dispatch.mock.calls[0][0].dedupePrefix).toBe(m.dispatch.mock.calls[1][0].dedupePrefix)
    expect(m.cache.get("bracket-experience:v1:entry:mine").pendingAlerts).toEqual([])
  })
  it("respects per-entry advisory lock and test-pool query boundaries",async()=>{
    m.query.mockResolvedValue([{acquired:false}]);await sweepBracketExperience("nba_cup",2026)
    expect(m.pools).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({sport:"nba_cup",seasonYear:2026,isTestMode:false})}))
    expect(m.cache.has("bracket-experience:v1:entry:mine")).toBe(false);expect(m.dispatch).not.toHaveBeenCalled()
  })
})

import { describe, expect, it } from "vitest"
import { advanceScoreSnapshot, defaultBracketAlerts, entryChecklist, pendingBracketAlerts, provisionalStandings, readBracketAlerts, scoreLedger } from "@/lib/playoffs/bracketExperience"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
import { nbaCupGroupStandings } from "@/lib/playoffs/nbaCupProgress"
import { buildMatchupEvidence } from "@/lib/playoffs/bracketCoachEvidence"
import type { PlayoffChallengeView, PlayoffSeriesView } from "@/lib/playoffs/types"
const now = Date.parse("2026-11-07T01:00:00Z")
const game = (id: string, extra: Partial<PlayoffSeriesView> = {}): PlayoffSeriesView => ({ ...buildPlayoffTemplate({ sport:"nba_cup",seasonYear:2026 })[0], id, round:"cup_group_play",bestOf:1,homeTeamName:"Boston Celtics",awayTeamName:"Atlanta Hawks",startsAt:"2026-11-07T00:00:00Z",status:"in_progress",lastSyncedAt:new Date(now).toISOString(),liveHomeScore:90,liveAwayScore:80,...extra })
function view(): PlayoffChallengeView {
  return { challenge:{ id:"pool",name:"Pool",ownerUserId:"me",sport:"nba_cup",seasonYear:2026,status:"open",isTestMode:false,createdAt:"",updatedAt:"" },viewerUserId:"me",
    activeEntry:{ id:"mine",name:"Mine",userId:"me",pickCount:2,isComplete:true,finalizedAt:"2026-11-06T20:00:00Z",totalScore:1,rank:2,createdAt:"" },entries:[],rounds:[],
    series:[game("live"),game("final",{status:"final",winnerTeamName:"Boston Celtics"}),game("future",{status:"scheduled",startsAt:"2026-11-07T01:20:00Z"}),game("placeholder",{status:"scheduled",startsAt:null,homeTeamName:"Winner S1"})],
    picks:["live","final"].map(id=>({id,seriesId:id,entryId:"mine",pickTeamName:"Boston Celtics",createdAt:"",updatedAt:""})),
    completion:{ mode:"available_picks_only",isSubmittable:false,requiredPickCount:1,savedRequiredPickCount:0,totalSeriesCount:4,unavailableSeriesCount:3,missingRequiredSeriesIds:["future"] } }
}
describe("points explanation and changes",()=>{
  it("awards only verified finals, explains every point and preserves the official total",()=>{
    const v=view(), before=JSON.stringify(v), rows=scoreLedger(v)
    expect(rows.find(r=>r.id==="final")).toMatchObject({points:1,reason:"correct"})
    expect(rows.find(r=>r.id==="live")).toMatchObject({points:0,reason:"pending"})
    expect(rows.reduce((n,r)=>n+r.points,0)).toBe(v.activeEntry!.totalScore)
    expect(JSON.stringify(v)).toBe(before)
    v.challenge.sport="ncaaf";v.series[1].round="cfp_championship"
    expect(scoreLedger(v)[1].points).toBe(8)
  })
  it("explains drafts, late submissions, invalid teams and wrong picks separately",()=>{
    const v=view();v.activeEntry!.finalizedAt=null
    expect(scoreLedger(v)[1]).toMatchObject({points:0,reason:"draft"})
    v.activeEntry!.finalizedAt="2026-11-07T00:00:00Z"
    expect(scoreLedger(v)[1]).toMatchObject({points:0,reason:"late"})
    v.activeEntry!.finalizedAt="2026-11-06T20:00:00Z";v.picks[1].pickTeamName="Other"
    expect(scoreLedger(v)[1].reason).toBe("invalid_pick")
    v.picks[1].pickTeamName="Atlanta Hawks"
    expect(scoreLedger(v)[1]).toMatchObject({points:0,reason:"wrong"})
  })
  it("starts history honestly and records a zero-point correction, point reversal and idempotent recheck",()=>{
    const v=view(), first=advanceScoreSnapshot(null,scoreLedger(v),2,new Date(now).toISOString())
    expect(first.events).toEqual([])
    v.series[1].liveHomeScore=91
    const corrected=advanceScoreSnapshot(first,scoreLedger(v),2,new Date(now+1000).toISOString())
    expect(corrected.events[0]).toMatchObject({kind:"corrected",delta:0,before:{homeScore:90},after:{homeScore:91}})
    v.series[1].winnerTeamName="Atlanta Hawks"
    const reversal=advanceScoreSnapshot(corrected,scoreLedger(v),3,new Date(now+2000).toISOString())
    expect(reversal.events[0]).toMatchObject({kind:"corrected",delta:-1,before:{points:1},after:{points:0}})
    expect(advanceScoreSnapshot(reversal,scoreLedger(v),3,new Date(now+3000).toISOString()).events).toEqual(reversal.events)
  })
  it("records final settlement once while suppressing meaningless live-score ticks",()=>{
    const v=view(), first=advanceScoreSnapshot(null,scoreLedger(v),2,new Date(now).toISOString())
    v.series[0].liveHomeScore=95
    expect(advanceScoreSnapshot(first,scoreLedger(v),2,new Date(now+1000).toISOString()).events).toEqual([])
    v.series[0].status="final";v.series[0].winnerTeamName="Boston Celtics"
    expect(advanceScoreSnapshot(first,scoreLedger(v),1,new Date(now+2000).toISOString()).events[0]).toMatchObject({kind:"settled",delta:1})
  })
  it("bounds retained history explicitly without losing its start date",()=>{
    const v=view();let state=advanceScoreSnapshot(null,scoreLedger(v),2,new Date(now).toISOString())
    for(let i=0;i<205;i++){v.series[1].liveHomeScore=100+i;state=advanceScoreSnapshot(state,scoreLedger(v),2,new Date(now+(i+1)*1000).toISOString())}
    expect(state.events).toHaveLength(200);expect(state.trimmed).toBe(5);expect(state.since).toBe(new Date(now).toISOString())
  })
})
describe("entry checklist and real-time projection",()=>{
  it("counts only available matchups and never counts unknown knockout slots as missing picks",()=>{
    const v=view(), c=entryChecklist(v,now)
    expect(c).toMatchObject({hasEntry:true,available:1,saved:0,missing:1,pendingMatchups:1,firstMissingId:"future",readyToFinalize:false})
    v.picks.push({...v.picks[0],id:"future",seriesId:"future"});v.activeEntry!.finalizedAt=null;v.completion!.isSubmittable=true
    expect(entryChecklist(v,now)).toMatchObject({saved:1,missing:0,readyToFinalize:true,finalizedAt:null})
  })
  it("never presents someone else's entry as the viewer's saved entry",()=>{
    const v=view();v.activeEntry!.userId="other"
    expect(entryChecklist(v,now)).toMatchObject({hasEntry:false,finalizedAt:null,readyToFinalize:false})
  })
  const entries=[{id:"mine",name:"Mine",totalScore:1,correctPicks:1,finalizedAt:"2026-11-06T20:00:00Z",rank:2,tiebreakerTotalScore:null},{id:"rival",name:"Rival",totalScore:2,correctPicks:2,finalizedAt:"2026-11-06T20:00:00Z",rank:1,tiebreakerTotalScore:null},{id:"draft",name:"SECRET DRAFT",totalScore:20,correctPicks:20,finalizedAt:null,rank:null,tiebreakerTotalScore:null}]
  it("ranks a live lead hypothetically without returning any user's picks or identity",()=>{
    const v=view(), before=JSON.stringify(v), p=provisionalStandings(v,entries,[{entryId:"mine",seriesId:"live",pickTeamName:"Boston Celtics"},{entryId:"rival",seriesId:"live",pickTeamName:"Atlanta Hawks"}],now)
    expect(p.rows.find(r=>r.id==="mine")).toMatchObject({officialScore:1,livePoints:1,provisionalScore:2,officialRank:2,provisionalRank:1,movement:1})
    expect(JSON.stringify(p)).not.toMatch(/SECRET DRAFT|pickTeamName|finalizedAt|userId/)
    expect(JSON.stringify(v)).toBe(before)
  })
  it("excludes stale/tied/unknown scores and late-finalized picks",()=>{
    const v=view(), picks=[{entryId:"mine",seriesId:"live",pickTeamName:"Boston Celtics"}]
    v.series[0].lastSyncedAt=new Date(now-120001).toISOString()
    expect(provisionalStandings(v,entries,picks,now)).toMatchObject({staleGames:1,rows:expect.arrayContaining([expect.objectContaining({id:"mine",livePoints:0})])})
    v.series[0].lastSyncedAt=new Date(now).toISOString();v.series[0].liveAwayScore=90
    expect(provisionalStandings(v,entries,picks,now).rows.find(r=>r.id==="mine")!.livePoints).toBe(0)
    v.series[0].liveAwayScore=80
    expect(provisionalStandings(v,[{...entries[0],finalizedAt:"2026-11-07T00:00:00Z"}],picks,now).rows[0].livePoints).toBe(0)
  })
  it("never turns a game score into a best-of-seven series win",()=>{
    const v=view();v.series[0].bestOf=7;v.challenge.sport="nba"
    expect(provisionalStandings(v,entries,[{entryId:"mine",seriesId:"live",pickTeamName:"Boston Celtics"}],now).rows.find(r=>r.id==="mine")!.livePoints).toBe(0)
  })
})
describe("bracket alert planning",()=>{
  it("defaults on, keeps per-pool opt-outs separate and normalizes malformed preferences",()=>{
    expect(readBracketAlerts(null,"pool").enabled).toBe(true)
    expect(readBracketAlerts({bracketCoach:{other:{enabled:false}}},"pool").enabled).toBe(true)
    expect(readBracketAlerts({bracketCoach:{pool:{enabled:false}}},"pool").enabled).toBe(false)
    expect(readBracketAlerts({bracketCoach:{pool:{enabled:true,leadMinutes:2}}},"pool")).toMatchObject({enabled:true,leadMinutes:30,spoilerSafe:true})
  })
  it("warns about a missing future pick, expires at actual tipoff and deduplicates repeated sweeps",()=>{
    const v=view(), next=advanceScoreSnapshot(null,scoreLedger(v),2,new Date(now).toISOString()), prefs={...defaultBracketAlerts,enabled:true}
    expect(pendingBracketAlerts(v,{...defaultBracketAlerts,enabled:false},null,next,now)).toEqual([])
    const alerts=pendingBracketAlerts(v,prefs,null,next,now)
    expect(alerts).toEqual([expect.objectContaining({kind:"missing",seriesId:"future",deadline:v.series[2].startsAt})])
    next.alertKeys=alerts.map(a=>a.key)
    expect(pendingBracketAlerts(v,prefs,null,next,now)).toEqual([])
    expect(pendingBracketAlerts(v,prefs,null,{...next,alertKeys:[]},Date.parse(v.series[2].startsAt!))).toEqual([])
  })
  it("does not notify old finals on first observation and excludes provisional rank changes",()=>{
    const v=view(), first=advanceScoreSnapshot(null,scoreLedger(v),2,new Date(now).toISOString()), prefs={...defaultBracketAlerts,enabled:true,missingPicks:false,locks:false}
    expect(pendingBracketAlerts(v,prefs,null,first,now)).toEqual([])
    v.series[0].status="final";v.series[0].winnerTeamName="Boston Celtics"
    const next=advanceScoreSnapshot(first,scoreLedger(v),1,new Date(now+1000).toISOString())
    expect(pendingBracketAlerts(v,prefs,first,next,now+1000).map(a=>a.kind)).toEqual(["result","rank"])
    expect(pendingBracketAlerts(v,{...prefs,rankChanges:false},first,next,now+1000).map(a=>a.kind)).toEqual(["result"])
  })
})
describe("Spanish factual evidence",()=>{
  it("localizes missing-data explanations and qualification roads without modifying sports facts",()=>{
    const v=view(), en=buildMatchupEvidence(v,v.series[0],[],[],"Unknown",now), es=buildMatchupEvidence(v,v.series[0],[],[],"Desconocido",now,"es")
    expect(es.recommendation).toBe(en.recommendation)
    expect(es.risks.join(" ")).toContain("Faltan registros")
    expect(es.sourceDescription).toContain("Resultados de proveedores")
    const groups=nbaCupGroupStandings(v.series,2026,"es")
    expect(groups[0].teams[0].road).toContain("partidos de grupo restantes")
    expect(groups.every(g=>g.teams.every(t=>!t.road.includes("group game")))).toBe(true)
  })
})

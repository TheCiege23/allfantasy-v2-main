import { describe, expect, it } from 'vitest'
import { activeFantraxCalendar, sourceOwnsWeek, periodDays, type Cutover } from '@/lib/league-import/fantrax/cutoverPolicy'
import { assignFantraxTeamIds } from '@/lib/league-import/fantrax/fantraxTeamIds'
import { planCutoverSchedule } from '@/lib/league-import/fantrax/planCutoverSchedule'
import { parseCutoverEvidence, verifyDatedRows } from '@/lib/league-import/fantrax/cutoverEvidence'
import { refreshScores } from '@/lib/league-import/fantrax/refreshCutover'
import { parseFantraxPublicRules } from '@/lib/league-import/fantrax/fantraxPublicRules'
import { retainClosedResults } from '@/lib/league-import/fantrax/retainClosedResults'

const periods=[1,2,3].map((number,i)=>({number,startDate:new Date(Date.UTC(2026,10,2+i*7,23)).toISOString(),endDate:new Date(Date.UTC(2026,10,9+i*7,23)-1000).toISOString()}))
const teams=[{teamName:'North',sourceTeamId:'A'},{teamName:'South',sourceTeamId:'B'}]
const ids=assignFantraxTeamIds(teams)
const cut:Cutover={policy:'after_open_period',season:2026,period:2,periods,snapshotId:'snapshot',teams:Object.fromEntries([...ids].map(([name,id])=>[String(id),name]))}
const standings=teams.map((t,i)=>({team:t.teamName,fantraxTeamId:t.sourceTeamId,rank:i+1,wins:1-i,losses:i,ties:0}))
const fixture={homeTeamId:'A',awayTeamId:'B',isPlayoff:false}
const input={leagueId:'native',seasonId:'season',cutover:cut,fixtures:[{...fixture,week:1,played:true,homeScore:6.5,awayScore:6.5,tiebreakWinnerId:'A'},
  {...fixture,week:2,played:true,homeScore:2,awayScore:1},{...fixture,week:3,played:false,homeScore:null,awayScore:null}],standings,
  nativeRosterBySeat:new Map([['north','n'],['south','s']]),playoffStart:4,snapshotTime:new Date(periods[1].startDate)}

describe('commissioner scoring cutover',()=>{
  it('keeps the official tie decision, live source period, future opponents and stable identifiers',()=>{
    const plan=planCutoverSchedule(input)
    expect(plan.rows.map(m=>[m.week,m.status,m.lineupSnapshots.fantraxCutover.sourceOwned])).toEqual([[1,'final',true],[2,'active',true],[3,'scheduled',false]])
    expect(plan.rows[0].lineupSnapshots.fantraxCutover.winner).toBe('n')
    expect(plan.ranks).toEqual({n:1,s:2})
    expect(planCutoverSchedule(input)).toEqual(plan)
  })
  it('rejects stale results, inconsistent records, duplicate fixtures and unknown seats',()=>{
    expect(()=>planCutoverSchedule({...input,snapshotTime:new Date(periods[0].startDate)})).toThrow(/Refresh/)
    expect(()=>planCutoverSchedule({...input,standings:standings.map(t=>({...t,wins:2}))})).toThrow(/published standings/)
    expect(()=>planCutoverSchedule({...input,fixtures:[...input.fixtures,input.fixtures[0]]})).toThrow(/Duplicate/)
    expect(()=>planCutoverSchedule({...input,nativeRosterBySeat:new Map()})).toThrow(/franchise/)
  })
  it('requires positive verification to release the open period and keeps prior games protected',()=>{
    for(const policy of ['after_open_period','reconcile_open_period'] as const){
      expect(sourceOwnsWeek({...cut,policy},2)).toBe(true)
      expect(sourceOwnsWeek({...cut,policy},3)).toBe(false)
    }
    expect(sourceOwnsWeek({...cut,policy:'reconcile_open_period',nativeFrom:2,settled:true},2)).toBe(false)
    expect(sourceOwnsWeek({...cut,nativeFrom:2,settled:true},1)).toBe(true)
    expect(activeFantraxCalendar('fantrax',{fantrax_settings:{scoringPeriods:periods}},new Date(periods[1].startDate))?.period).toBe(2)
    expect(periodDays(periods[0]).start.toISOString()).toBe('2026-11-02T00:00:00.000Z')
  })
  it('binds fresh source scores to both participants and refuses early zeroes and conflicting duplicates',()=>{
    const m=planCutoverSchedule(input).rows[1], side=(teamId:string,score:number,gamesPlayed=1)=>({teamId,teamName:teamId,score,gamesPlayed})
    const game={home:side('B',2),away:side('A',3)}
    const fresh=(rows:typeof game[])=>refreshScores([m],{period:2,matchups:rows},[],true)
    expect(fresh([game])[0]).toMatchObject({homeScore:3,awayScore:2,status:'final'})
    expect(()=>fresh([{home:side('B',0,0),away:side('A',0,0)}])).toThrow()
    expect(()=>fresh([game,{...game,home:side('B',4)}])).toThrow()
  })
  it('checks scores and all category components on each individual athlete and date',()=>{
    const csv='season,period,team_id,player_id,date,slot,points,stat.assist\n2026,2,A,P,2026-11-11,ACTIVE,5,2'
    const data=parseCutoverEvidence(csv,2026,2), roster=[{player:'native',fantraxId:'P'}]
    const line={day:'2026-11-11',game:'game',player:'native',roster:'n',slot:'starter',points:5,stats:{ast:2}}
    const verify=(p:number,keys:string[])=>verifyDatedRows(data,'A',['2026-11-11'],roster,[{...line,points:p}],keys)
    expect(verify(5,[])).toBe(1)
    expect(verify(5,['assist'])).toBe(1)
    expect(()=>verify(4,[])).toThrow(/points differ/)
    expect(()=>verify(5,['rebound'])).toThrow(/component/)
    expect(()=>parseCutoverEvidence(csv+'\n'+csv.split('\n')[1],2026,2)).toThrow(/repeats/)
    expect(()=>verifyDatedRows(data,'A',['2026-11-11','2026-11-12'],roster,[line],[])).toThrow(/Every athlete/)
  })
  it('retains a previously verified final on an incomplete refresh and accepts an explicit scoreless correction',()=>{
    const old={...fixture,week:1,homeTeam:'North',awayTeam:'South',played:true,homeScore:17,awayScore:4,scoreObservedAt:periods[1].startDate}
    const fresh={...old,played:false,homeScore:null,awayScore:null,homeTeamId:'B',awayTeamId:'A'}
    const now=new Date(periods[1].endDate)
    expect(retainClosedResults([fresh],[old],periods,undefined,now)[0]).toMatchObject({homeScore:4,awayScore:17,retainedScore:true})
    expect(retainClosedResults([fresh],[{...old,scoreObservedAt:periods[0].startDate}],periods,undefined,now)[0].played).toBe(false)
    expect(retainClosedResults([{...fresh,played:true,homeScore:0,awayScore:0}],[old],periods,undefined,now)[0].homeScore).toBe(0)
  })
  it('reads the published daily frequency and five-minute pregame lock',()=>{
    expect(parseFantraxPublicRules('<title>League Rules Summary - Daily</title><ul><li>Lineup changes are executed: Daily</li><li>Lineups will become locked 0:05 (hours:minutes) before scheduled start-time of game</li></ul>')).toMatchObject({lineupFrequency:'daily',lineupLockMinutes:5})
  })
})

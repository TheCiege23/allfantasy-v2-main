import {describe,it,expect} from 'vitest'
import {teamInjuryAlertHref,parseTeamAlertTarget,teamAlertDecision,teamDeadlineAlertHref,parseDeadlineAlertTarget,deadlineAlertDecision} from '@/lib/core-app/teamAlertTarget'
import {buildTeamAlerts} from '@/lib/core-app/teamAlerts'
import type {MyTeamData} from '@/lib/core-app/myTeam'
const now=Date.parse('2026-10-06T12:00:00Z'),deadline='2026-10-06T17:00:00.000Z'
const player={sleeperId:'p:1',name:'Starter',position:'RB',ruledOut:true,kickoff:deadline,injuryStatus:'OUT'}
const data={league:{id:'league & one',name:'One',platform:'manual'},starters:{available:true,data:[{slotLabel:'RB',player}]},bench:{available:true,data:[{...player,sleeperId:'backup',ruledOut:false}]}} as unknown as MyTeamData
const target={playerId:'p:1',deadline,slotIndex:0}
describe('exact injury alert destinations',()=>{
 it('encodes league/player identities and preserves an exact decision anchor',()=>{const url=new URL(teamInjuryAlertHref(data.league.id,'p:1',deadline,0),'https://www.allfantasy.ai');expect(url.hash).toBe('#af-team-alert-decision');expect(parseTeamAlertTarget(url,data.league.id)).toEqual(target);expect(parseTeamAlertTarget(url,'other')).toBeNull()})
 it('puts the affected slot in generated alerts without changing their dedupe keys',()=>{const a=buildTeamAlerts(data,{},now)[0];expect(a.key).toBe('injury:p:1:'+deadline);expect(parseTeamAlertTarget(new URL(a.href,'https://www.allfantasy.ai'),data.league.id)).toEqual(target)})
 it('selects only the current matching starter and kickoff',()=>{expect(teamAlertDecision(data,target,now)).toMatchObject({state:'current',slotIndex:0});expect(teamAlertDecision(data,{...target,slotIndex:1},now).state).toBe('lineup_changed')})
 it('preserves milliseconds on the Date values delivered by the Team server component',()=>{
  const precise='2026-10-06T17:00:00.123Z',dated={...data,starters:{available:true,data:[{slotLabel:'RB',player:{...player,kickoff:new Date(precise)}}]}} as unknown as MyTeamData
  expect(teamAlertDecision(dated,{...target,deadline:precise},now).state).toBe('current')
 })
 it('explains a changed lineup, status, schedule and expired deadline',()=>{const changed=(patch:object)=>({...data,starters:{available:true,data:[{slotLabel:'RB',player:{...player,...patch}}]}} as MyTeamData);expect(teamAlertDecision(changed({sleeperId:'other'}),target,now).state).toBe('lineup_changed');expect(teamAlertDecision(changed({ruledOut:false}),target,now).state).toBe('status_changed');expect(teamAlertDecision(changed({kickoff:null}),target,now).state).toBe('schedule_changed');expect(teamAlertDecision(data,target,Date.parse(deadline)).state).toBe('expired')})
 it('does not select a slot for unavailable or automatic lineups',()=>{expect(teamAlertDecision({...data,starters:{available:false,reason:'missing'}},target,now).state).toBe('unavailable');expect(teamAlertDecision({...data,bestBall:true},target,now).slotIndex).toBeNull();expect(teamAlertDecision({...data,league:{...data.league,format:'best_ball'}},target,now).state).toBe('automatic')})
 it('rejects malformed and overlong targeting parameters',()=>{const url=new URL(teamInjuryAlertHref(data.league.id,'p:1',deadline,0),'https://www.allfantasy.ai');for(const [key,value] of [['alertSlot','-1'],['alertDeadline','bad'],['alertPlayer','x'.repeat(201)]]){const bad=new URL(url);bad.searchParams.set(key,value);expect(parseTeamAlertTarget(bad,data.league.id)).toBeNull()}})
})

describe('exact deadline alert destinations',()=>{
 it('targets the recorded calendar entry and rejects another league',()=>{const url=new URL(teamDeadlineAlertHref('a','trade',deadline),'https://www.allfantasy.ai');expect(url.hash).toBe('#af-team-deadline-alert');expect(parseDeadlineAlertTarget(url.searchParams,'a')).toEqual({key:'trade',deadline});expect(parseDeadlineAlertTarget(url.searchParams,'b')).toBeNull()})
 it('distinguishes a current, changed, removed and expired deadline',()=>{const target={key:'trade',deadline},events=[{key:'trade',label:'Trade deadline',at:deadline}];expect(deadlineAlertDecision(events,target,now).state).toBe('current');expect(deadlineAlertDecision(events,{...target,deadline:'2026-10-07T17:00:00Z'},now).state).toBe('changed');expect(deadlineAlertDecision([],target,now).state).toBe('missing');expect(deadlineAlertDecision(events,target,Date.parse(deadline)).state).toBe('expired')})
})

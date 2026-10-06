// @vitest-environment node
import { describe,it,expect } from 'vitest'
import { weeklyRivalryPlans } from '@/lib/core-app/weeklyRivalry'
import { absoluteCalendarTime,buildWeeklyCalendar,weeklyCalendarIcs,type WeeklyCalendarEvent } from '@/lib/core-app/weeklyCalendar'
import { buildWeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
import type { Pairing,WeekBoard } from '@/lib/core-app/weekBoard'
import type { SeasonOutlook } from '@/lib/core-app/seasonOutlook'
const now=new Date('2026-10-06T12:00:00Z')
const pair=(week:number,opponent='2',result=1,scope='sleeper:123',final=true)=>({leagueId:scope,season:2026,week,a:{rosterId:'1',pointsFor:result===0?0:100,pointsAgainst:result===0?0:90,finalized:final,scored:final},b:{rosterId:opponent,pointsFor:result===0?0:result>0?90:110,pointsAgainst:result===0?0:100,finalized:final,scored:final}}) as Pairing
const plans=(pairs:Pairing[])=>weeklyRivalryPlans(pairs,new Map([['sleeper:123:1','1']]),new Map([['sleeper:123:2','Rittnasty'],['sleeper:123:3','Paid']]),new Map([['sleeper:123',{id:'H'}]]),new Map([['sleeper:123',{season:2026,week:4}]]))
describe('upcoming opponent evidence',()=>{
 it('counts only completed meetings before the target, including the finished marker week',()=>{const out=plans([pair(1),pair(2),pair(3),pair(4),pair(5,'2',1,'sleeper:123',false),pair(6)])
 expect(out.find(p=>p.period===5)).toMatchObject({opponent:'Rittnasty',wins:4,losses:0,ties:0,winningStreak:4})
 expect(out.find(p=>p.period===4)?.winningStreak).toBe(3)
 })
 it('ties break streaks and zero-point finals are real meetings',()=>{const out=plans([pair(1),pair(2,'2',0),pair(3,'2',1,'sleeper:123',false),pair(4)])
 expect(out[0]).toMatchObject({wins:1,ties:1,winningStreak:0,losingStreak:0})})
 it('does not borrow another provider, opponent or current matchup result',()=>{const out=plans([pair(1,'2',1,'yahoo:123'),pair(2,'3'),pair(4)])
 expect(out).toEqual([])})
 it('attaches the correct upcoming story and refuses ambiguous target fixtures',()=>{const rivalryPlans=plans([pair(1),pair(2),pair(3),pair(4),pair(5,'2',1,'sleeper:123',false)])
 const card={leagueId:'H',leagueName:'League',season:2026,week:4,opponent:{rosterId:'3',name:'Paid'},live:{final:true}}
 const input={leagues:[{id:'H'}],board:{leaning:[card],coinFlips:[],unprojected:[],rivalryPlans} as unknown as WeekBoard,pulse:null,outlook:{leagues:[{leagueId:'H',season:2026,period:5}],swingByLeague:{H:{opponentName:'Rittnasty',week:5}}} as unknown as SeasonOutlook,now}
 expect(buildWeeklyBlueprint(input).rivalry).toMatchObject({opponent:'Rittnasty',wins:4,winningStreak:4,final:false})
 const target=rivalryPlans.find(p=>p.period===5)!
 expect(buildWeeklyBlueprint({...input,board:{...input.board,rivalryPlans:[target,{...target,opponentRosterId:'9'}]}}).rivalry).toBeUndefined()
 })
})
describe('seven-day calendar',()=>{
 const leagues=[{id:'A',name:'Same name',settings:{lineupLockAt:'2026-10-08T20:00:00-04:00',waiver_next_run:'2026-10-07T08:00:00Z',trade_deadline:9}},{id:'B',name:'Same name',settings:{lineupLockAt:'2026-10-08T20:00:00'}}]
 it('normalizes absolute times and never invents dates for naive clocks or week numbers',()=>{
 expect(absoluteCalendarTime('2026-10-08T20:00:00')).toBeNull();expect(absoluteCalendarTime('2026-10-08')).toBeNull();expect(absoluteCalendarTime('2026-02-30T20:00:00Z')).toBeNull();expect(absoluteCalendarTime(5)).toBeNull()
 const c=buildWeeklyCalendar(leagues,now)
 expect(c.events.map(e=>e.at)).toEqual(['2026-10-07T08:00:00.000Z','2026-10-09T00:00:00.000Z'])
 expect(c.gaps).toContainEqual({leagueId:'B',leagueName:'Same name',kind:'lineup'})
 expect(c.events.some(e=>e.kind==='trade')).toBe(false)
 })
 it('filters membership, selected league, past times and the exclusive seven-day boundary',()=>{
 const extra=['A','B','stranger'].flatMap(leagueId=>['2026-10-06T11:59:00Z','2026-10-06T12:00:00Z','2026-10-13T12:00:00Z'].map(at=>({id:leagueId+at,leagueId,at,kind:'poll',title:'Vote',source:'league-chat',href:'/core/week',leagueName:'wrong'} as WeeklyCalendarEvent)))
 const c=buildWeeklyCalendar(leagues,now,extra,[],'B')
 expect(c.events).toHaveLength(1);expect(c.events[0]).toMatchObject({leagueId:'B',leagueName:'Same name',at:now.toISOString()})
 })
 it('does not warn automatic lineups about a missing manual lock',()=>{const c=buildWeeklyCalendar([{id:'B',lineupAutomatic:true}],now);expect(c.gaps.some(g=>g.kind==='lineup')).toBe(false)})
 it('never converts a next game into a confirmed lineup lock',()=>{const c=buildWeeklyCalendar([{id:'B'}],now,[],[{leagueId:'B',at:'2026-10-09T00:00:00Z'}])
 expect(c.events[0].kind).toBe('game');expect(c.gaps.map(g=>g.kind)).toContain('lineup')})
 it('exports UTC, escapes injection and enables reminders only by explicit choice',()=>{
 const event={id:'poll-1',leagueId:'A',leagueName:'',kind:'poll',at:'2026-10-07T08:00:00Z',title:'Vote, now;\nBEGIN:VEVENT '+ '🏈'.repeat(60),source:'league-chat',href:'/league/A?view=league_chat'} as WeeklyCalendarEvent
 const c=buildWeeklyCalendar(leagues,now,[event]),ics=weeklyCalendarIcs(c)!
 expect(ics).toContain('DTSTART:20261007T080000Z');expect(ics).not.toContain('BEGIN:VALARM');expect(ics).toContain('Vote\\, now\\;\\nBEGIN:VEVENT')
 expect(weeklyCalendarIcs(c,true)).toContain('TRIGGER:-PT15M')
 expect(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75)).toBe(true)
 expect(weeklyCalendarIcs(buildWeeklyCalendar([],now))).toBeNull()
 })
})

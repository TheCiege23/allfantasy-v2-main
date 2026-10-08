// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {buildWeeklyScheduleForecast,type WeeklyScheduledGame} from '@/lib/core-app/weeklyScheduleForecast'
import type {MyTeamRow} from '@/lib/core-app/myTeamPulse'
const now=new Date('2026-10-07T12:00:00Z')
const row={leagueId:'A',leagueName:'Test league',sport:'NHL',leagueSeason:2026,season:2026,players:[{id:'1',name:'Goalie',team:'BOS',position:'G',starter:true}]} as MyTeamRow
const game=(at:string,overrides:Partial<WeeklyScheduledGame>={}):WeeklyScheduledGame=>({sport:'NHL',season:2026,seasonType:'regular',homeTeam:'BOS',awayTeam:'NYR',startTime:at,status:'scheduled',fetchedAt:'2026-10-07T11:00:00Z',expiresAt:'2026-10-08T12:00:00Z',...overrides})
describe('weekly schedule evidence',()=>{
 it('deduplicates repeated fixture sources and exposes consecutive UTC dates without inventing goalie starts',()=>{
  const first=game('2026-10-08T23:00:00Z')
  const out=buildWeeklyScheduleForecast(row,[first,{...first,fetchedAt:'2026-10-07T11:30:00Z'},game('2026-10-09T23:00:00Z')],now)
  expect(out.players[0]).toMatchObject({games:2,backToBackDays:1,role:'goalie'})
  expect(out.gaps).toContain('confirmed-goalie-starts');expect(out.gaps).toContain('schedule-completeness')
 })
 it('rejects expired, completed, exhibition, different-season and outside-window games',()=>{
  const out=buildWeeklyScheduleForecast(row,[game('2026-10-08T23:00:00Z',{expiresAt:'2026-10-06T12:00:00Z'}),game('2026-10-08T23:00:00Z',{status:'final'}),game('2026-10-08T23:00:00Z',{seasonType:'pre'}),game('2026-10-08T23:00:00Z',{season:2025}),game('2026-10-14T12:00:00Z')],now)
  expect(out.players[0].games).toBeNull();expect(out.sampledAt).toBeNull()
 })
 it('does not treat an unresolved team or no stored games as a confirmed zero',()=>{
  const out=buildWeeklyScheduleForecast({...row,players:[{...row.players![0],team:null}]},[game('2026-10-08T23:00:00Z')],now)
  expect(out.players[0].games).toBeNull();expect(out.gaps).toContain('player-schedule')
 })
 it('keeps doubleheaders at different times while rejecting postponed fixtures',()=>{
  const mlb={...row,sport:'MLB',players:[{...row.players![0],position:'SP'}]}
  const out=buildWeeklyScheduleForecast(mlb,[game('2026-10-08T17:00:00Z',{sport:'MLB'}),game('2026-10-08T23:00:00Z',{sport:'MLB'}),game('2026-10-09T23:00:00Z',{sport:'MLB',status:'postponed'})],now)
  expect(out.players[0]).toMatchObject({games:2,backToBackDays:0,role:'pitcher'});expect(out.gaps).toContain('confirmed-pitcher-starts')
 })
 it('withholds forecasts when the roster or schedule read failed',()=>{
  expect(buildWeeklyScheduleForecast({...row,syncFailed:true},[],now).players).toEqual([])
  expect(buildWeeklyScheduleForecast(row,[],now,true).gaps).toEqual(['schedule'])
 })
 it('counts each rostered player once and never borrows another sport’s team abbreviation',()=>{
  const out=buildWeeklyScheduleForecast({...row,players:[row.players![0],row.players![0]]},[game('2026-10-08T23:00:00Z',{sport:'NBA'})],now)
  expect(out.players).toHaveLength(1);expect(out.players[0].games).toBeNull()
 })
})

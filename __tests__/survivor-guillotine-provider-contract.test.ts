import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { sgCatalogRows } from '@/lib/survivor-guillotine/providerCatalog'
import { sgNbaDateAwaitingTipoff, sgNflWeekAwaitingKickoff, sgScheduleRows } from '@/lib/survivor-guillotine/providerSchedule'
import { sgNflSnapshotRows } from '@/lib/survivor-guillotine/providerNflSnapshot'
const ids = new Map([['1','KC'],['2','BUF']])
const game = { season_type:'Regular Season',season:2026,game_ID:'g',game_time:'2026-10-25T17:00:00Z',home_team_ID:1,away_team_ID:2,week:7,status:'Final' }
describe('live provider normalization', () => {
 it('waits for a known future NBA slate, while unknown, started, and final slates still fetch',()=>{
  const [future]=sgScheduleRows('NBA',2026,[{...game,status:'Scheduled'}],ids,x=>x)
  const before=new Date('2026-10-25T16:00:00Z'),after=new Date('2026-10-25T18:00:00Z')
  expect(sgNbaDateAwaitingTipoff([future],'2026-10-25',before)).toBe(true)
  expect(sgNbaDateAwaitingTipoff([future],'2026-10-25',after)).toBe(false)
  expect(sgNbaDateAwaitingTipoff([future],'2026-10-24',before)).toBe(false)
  expect(sgNbaDateAwaitingTipoff([{...future,status:'final'}],'2026-10-25',before)).toBe(false)
 })
 it('waits only for a known future NFL slate, never an unknown or started slate',()=>{
  const [future]=sgScheduleRows('NFL',2026,[{...game,status:'Scheduled'}],ids,x=>x)
  const before=new Date('2026-10-25T16:00:00Z'),after=new Date('2026-10-25T18:00:00Z')
  expect(sgNflWeekAwaitingKickoff([future],before)).toBe(true)
  expect(sgNflWeekAwaitingKickoff([future],after)).toBe(false)
  expect(sgNflWeekAwaitingKickoff([],before)).toBe(false)
  expect(sgNflWeekAwaitingKickoff([{...future,status:'final'}],before)).toBe(false)
 })
 it('keeps NFL offense aggregates out of player and defense scoring while preserving sparse measured zeroes', () => {
  const lines=sgNflSnapshotRows(new Map<string, unknown>([['TEAM_KC',{pass_yd:300}],['KC',{sack:2,pts_allow_0:1}],['123',{pass_yd:300,pass_td:2}],['124',{gms_active:1,gp:1,pos_rank_ppr:999}]]))
  expect(lines.map(x=>x.playerId)).toEqual(['nfl:def:KC','123','124'])
  expect(lines[0].stats).toMatchObject({def_sack:2,def_points_allowed:0})
  expect(lines[1].stats).toMatchObject({pass_yds:300,pass_td:2})
  expect(lines[2].stats).toEqual({provider_stat_row:1})
 })
 it.each([new Map(),new Map([['123',null]]),new Map([['WR-guess',{rec:1}]]),new Map([['123',{label:'unmeasured'}]])])('rejects missing or malformed stat identities and measurements', payload=>{
  expect(()=>sgNflSnapshotRows(payload as ReadonlyMap<string,unknown>)).toThrow()
 })
 it('uses provider-specific profile IDs and honors explicit inactive flags despite stale Active text',()=>{
  expect(sgCatalogRows('NFL',{'167':{player_id:'167',full_name:'Tom Brady',position:'QB',team:null,active:false,status:'Active'}})[0]).toMatchObject({externalId:'sleeper:167',sleeperId:'167',status:'Inactive',source:'sleeper'})
  expect(sgCatalogRows('NBA',[{player_id:167,player:'NBA Player',position:'PG',team:{id:1,team:'Boston Celtics'}}])[0]).toMatchObject({externalId:'167',sleeperId:null,team:'Boston Celtics',source:'rolling_insights'})
 })
 it('excludes preseason and playoffs from the regular scoring/lock schedule',()=>{
  const result=sgScheduleRows('NFL',2026,[{...game,game_ID:'hof',season_type:'HOF'},{...game,game_ID:'pre',season_type:'Preseason'},game,{...game,game_ID:'post',season_type:'WILD CARD'}],ids,x=>x)
  expect(result).toHaveLength(1);expect(result[0]).toMatchObject({externalId:'g',week:7,status:'final'})
 })
 it.each([{season:2025},{away_team_ID:999},{season_type:'Unannounced Format'},{week:19},{game_time:'bad'}])('rejects a mismatched schedule instead of certifying it: %j',invalid=>{
  expect(()=>sgScheduleRows('NFL',2026,[{...game,...invalid}],ids,x=>x)).toThrow()
 })
})

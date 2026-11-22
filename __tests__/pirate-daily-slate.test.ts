import { describe, expect, it } from 'vitest'
import { pirateDailySlateComplete } from '@/lib/pirate/stagingDailySlate'
import type { ScheduleGame } from '@/lib/sports-data/riScheduleCache'
const game: ScheduleGame = {gameId:'real-shape',day:'2026-10-29',startTime:'2026-10-30T00:00:00Z',status:'scheduled',seasonType:'regular',eventName:null,replacedBy:null,
  homeTeam:'Atlanta Hawks',awayTeam:'Cleveland Cavaliers'}
const observed = {homeTeamFull:game.homeTeam!,awayTeamFull:game.awayTeam!,startTime:game.startTime!}
describe('daily pilot independent full-week calendar',()=>{
  it('accepts exact genuine calendar agreement',()=>expect(pirateDailySlateComplete([game],[observed])).toBe(true))
  it('uses the same NBA Clippers identity as the lock reader for RI and ESPN names',()=>{
    expect(pirateDailySlateComplete([{...game,homeTeam:'Los Angeles Clippers'}],[{...observed,homeTeamFull:'LA Clippers'}])).toBe(true)
  })
  it('refuses a partial week, duplicate games, missing names, and wrong lock times',()=>{
    expect(pirateDailySlateComplete([game,{...game,startTime:'2026-11-01T23:00:00Z'}],[observed])).toBe(false)
    expect(pirateDailySlateComplete([game],[observed,observed])).toBe(false)
    expect(pirateDailySlateComplete([{...game,homeTeam:null}],[observed])).toBe(false)
    expect(pirateDailySlateComplete([game],[{...observed,startTime:'2026-10-30T01:00:00Z'}])).toBe(false)
    expect(pirateDailySlateComplete(null,[observed])).toBe(false)
  })
  it('does not demand replaced or preseason rows as part of the regular slate',()=>{
    expect(pirateDailySlateComplete([game,{...game,replacedBy:'replacement'},{...game,seasonType:'preseason'}],[observed])).toBe(true)
  })
})

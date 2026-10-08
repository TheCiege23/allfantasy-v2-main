import { describe,it,expect } from 'vitest'
import { buildWeeklySwings,sportWeekAdvice } from '@/lib/core-app/weeklySportPlan'
import type { WeeklyBlueprint } from '@/lib/core-app/weeklyBlueprint'
describe('sport-aware weekly swings',()=>{
  it.each(['NFL','NCAAF','NBA','NCAAB','NHL','MLB','SOCCER'])('provides distinct guidance for %s', sport=>{
    expect(sportWeekAdvice(sport)).not.toContain('Confirm this sport')
    expect(sportWeekAdvice(sport,true)).not.toBe(sportWeekAdvice(sport))
  })
  it('does not assume basketball game-volume scoring',()=>expect(sportWeekAdvice('NBA')).toContain('Lock-In'))
  it('preserves issue evidence and exact league scope',()=>{
    const data={actions:[{id:'l:lineup',leagueId:'l',leagueName:'Mine',kind:'lineup',count:2,href:'/core/my-team?league=l',evidence:{empty:1,out:1,bye:null,questionable:0},period:5}],sportPlans:[{leagueId:'l',sport:'MLB'}]} as WeeklyBlueprint
    const [signal]=buildWeeklySwings(data)
    expect(signal.tone).toBe('risk');expect(signal.detail).toContain('1 empty slot')
    expect(signal.detail).toContain('probable pitchers');expect(signal.prompt).toContain('Period 5');expect(signal.leagueId).toBe('l')
  })
})

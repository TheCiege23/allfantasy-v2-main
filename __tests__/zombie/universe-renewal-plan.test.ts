import { describe, expect, it } from 'vitest'
import { planUniverseRenewal, renewalFingerprint } from '@/lib/zombie/universeRenewalPlan'
import { nextZombieSettings } from '@/lib/zombie/renewalSettings'
const levels=[{id:'g',name:'Gamma',rankOrder:1},{id:'a',name:'Alpha',rankOrder:2}]
const policy={promotionEnabled:true,relegationEnabled:true,promotionCount:1,relegationCount:1}
const pools=levels.flatMap(l=>[0,1].map(i=>({leagueId:l.id+i,levelId:l.id,name:l.name+i,seats:2,orderInLevel:i})))
const managers=pools.flatMap((p,n)=>[0,1].map(i=>({userId:p.leagueId+i,rosterId:p.leagueId+i,leagueId:p.leagueId,levelId:p.levelId,
  displayName:'Manager '+n+i,teamName:'Team '+n+i,avatarUrl:null,wins:8-n-i,losses:n+i,ties:0,totalPoints:800-n*20-i})))
describe('next-season universe placement',()=>{
  it('places each manager exactly once in full destination leagues, with fresh deterministic draft slots',()=>{
    const one=planUniverseRenewal(managers,levels,policy,pools,'u:2027')
    expect(one.assignments).toHaveLength(8)
    expect(new Set(one.assignments.map(m=>m.userId)).size).toBe(8)
    for(const p of pools) expect(one.assignments.filter(m=>m.destinationLeagueId===p.leagueId).map(m=>m.slot)).toEqual([1,2])
    expect(one.assignments.filter(m=>m.movement==='promotion')).toHaveLength(1)
    expect(one.assignments.filter(m=>m.movement==='relegation')).toHaveLength(1)
    const two=planUniverseRenewal([...managers].reverse(),levels,policy,[...pools].reverse(),'u:2027')
    expect(two.assignments).toEqual(one.assignments)
  })
  it('refuses unbalanced tiers and duplicate managers before placing anyone',()=>{
    expect(()=>planUniverseRenewal(managers,levels,{...policy,relegationCount:0},pools,'x')).toThrow('RENEWAL_CAPACITY_UNBALANCED')
    expect(()=>planUniverseRenewal([...managers,managers[0]],levels,policy,pools,'x')).toThrow('RENEWAL_MEMBERSHIP_AMBIGUOUS')
  })
  it('binds approval to reviewed content rather than JSON property order',()=>{
    expect(renewalFingerprint({a:1,b:[{c:2,d:3}]})).toBe(renewalFingerprint({b:[{d:3,c:2}],a:1}))
    expect(renewalFingerprint({a:2})).not.toBe(renewalFingerprint({a:1}))
  })
  it('preserves rules and strips old credentials, payments, invitations, dates, and runtime state',()=>{
    const next=nextZombieSettings({inviteCode:'old',renewal_completed_for_season:2026,dues_tracker:{paid:['old-user']},
      rosterSettings:{starterSlots:{QB:1}},nfl_scoring_config:{passingYards:.04},draft_slow_runtime_meta:{paused:true},
      foundation_defaults:{roster:{benchSlots:4},draft:{scheduledAt:'old'},conceptPreset:{zombie:true}},
    },2027,'old-league')
    expect(next.rosterSettings).toEqual({starterSlots:{QB:1}})
    expect(next.nfl_scoring_config).toEqual({passingYards:.04})
    expect(next.foundation_defaults).toEqual({roster:{benchSlots:4},conceptPreset:{zombie:true}})
    expect(next).not.toHaveProperty('inviteCode');expect(next).not.toHaveProperty('dues_tracker')
    expect(next).not.toHaveProperty('draft_slow_runtime_meta')
    expect(next.zombie_renewal).toEqual({version:1,season:2027,previousLeagueId:'old-league'})
  })
})

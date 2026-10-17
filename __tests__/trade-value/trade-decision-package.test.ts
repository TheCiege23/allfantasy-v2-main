import {describe,it,expect} from 'vitest'
import {reviewPackageCost} from '@/lib/decision-os/trade/packageCost'
import {decisionSummary,counterDecision} from '@/lib/decision-os/trade/decisionSummary'
import {gradeTrade} from '@/lib/decision-os/trade/tradeGrade'
const p=(playerId:string,projectedPoints:number|null)=>({playerId,position:'RB',projectedPoints})
const args={roster:[p('starter',20),p('bench',8),p('ir',25)],sent:['bench'],incoming:[p('incoming1',22),p('incoming2',10)],slots:['RB'],reserveIds:['ir'],taxiIds:[],capacity:2}
describe('usable roster package economics',()=>{
  it('excludes reserve occupancy and counts incoming players as active rather than free IR slots',()=>{
    const result=reviewPackageCost(args)
    expect(result).toMatchObject({activeBefore:2,activeAfter:3,requiredDrops:1,displacedStarters:['starter']})
    expect(result.candidates).toEqual([{playerId:'starter',name:'starter',singleDropLineupCost:0}])
    expect(result.note).toContain('zero weekly starter cost does not mean')
  })
  it('measures a retained starter’s loss and withholds costs with incomplete projection coverage',()=>{
    expect(reviewPackageCost({...args,sent:[],incoming:[p('in',5)]}).candidates.find(c=>c.playerId==='starter')?.singleDropLineupCost).toBe(12)
    expect(reviewPackageCost({...args,roster:[p('starter',20),p('bench',null)]}).candidates[0].singleDropLineupCost).toBeNull()
    expect(reviewPackageCost({...args,slots:['UNKNOWN']}).candidates[0].singleDropLineupCost).toBeNull()
  })
  it('does not infer capacity or count repeated identities twice',()=>{
    expect(reviewPackageCost({...args,capacity:null})).toMatchObject({capacity:null,requiredDrops:null,candidates:[]})
    expect(reviewPackageCost({...args,incoming:[p('incoming1',22),p('incoming1',22)]})).toMatchObject({activeAfter:2,requiredDrops:0})
  })
})
const grade=gradeTrade({giveValue:100,getValue:140,giveMarket:100,getMarket:140,unpriced:0,giveCount:1,getCount:1,basis:'Test market',scoringApplied:false,needApplied:false,needGap:null,moves:[],lines:[{side:'give',assetKind:'player',name:'Sent',marketValue:100,leagueValue:100,valueSource:'fantasycalc',valueAsOf:'2026-10-03'},{side:'get',assetKind:'player',name:'Received',marketValue:140,leagueValue:140,valueSource:'fantasycalc',valueAsOf:'2026-10-03'}]})
describe('actionable trade summaries',()=>{
  it('explains the evaluated one-player change without claiming a globally minimum counter',()=>{
    const next=grade.graded?{...grade,giveValue:130,getValue:140}:grade
    const text=counterDecision({before:grade,after:next,addTo:'give',cost:reviewPackageCost(args)})
    expect(text).toContain('from 40 to 10')
    expect(text).toContain('needs 0 drops')
    expect(text).toContain('not proof of the smallest possible fair change')
  })
  it('does not equate a price win with a lineup win',()=>{
    const summary=decisionSummary({grade,evaluatedAt:'2026-10-03',visual:{impact:{unit:'league_points_week',week:5,startingPointsBefore:100,startingPointsAfter:90,startingPointsDelta:-10,blockedReason:null,unpricedExcluded:0,depthChanges:[]},reason:null,moved:[],returned:[],rostersStale:false,rostersSyncedAt:'2026-10-03',evaluatedAt:'2026-10-03',season:'2026'}})
    expect(summary.accept.join(' ')).toContain('quoted value')
    expect(summary.hesitate.join(' ')).toContain('10.0 points lower')
    expect(summary.change.join(' ')).toContain('not a confidence interval')
  })
  it('withholds a verdict and keeps generic analysis independent of league projections',()=>{
    expect(decisionSummary({grade:{graded:false,reason:'Missing asset',basis:null}})).toMatchObject({headline:'More evidence needed',hesitate:['Missing asset']})
    expect(decisionSummary({grade,generic:true}).hesitate.join(' ')).toContain('No league roster')
  })
})

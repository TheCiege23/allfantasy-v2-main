import {describe,it,expect} from 'vitest'
import {registeredSeatReadiness,savedPoolCoverage,settlementReadiness} from '@/lib/zombie/readiness'
describe('Zombie readiness evidence',()=>{
 it('does not count placeholder or duplicate ownership as filled seats',()=>{
  expect(registeredSeatReadiness(['real','open','real'],['real'],3)).toEqual({registered:1,missing:2,duplicate:1,ready:false})
  expect(registeredSeatReadiness(['a','b'],['a','b'],2).ready).toBe(true)
 })
 it('accepts zero statistics but excludes ADP, bye and fallback portraits as stats/media',()=>{
  const row={position:'PG',adp:12,display:{assets:{headshotUrl:'https://example.invalid/a.png'},stats:{pointsPerGame:0,reboundsPerGame:0}}}
  expect(savedPoolCoverage({entries:[row]},'NBA')).toEqual({entries:1,portraits:1,stats:1,adp:1,positions:1})
  expect(savedPoolCoverage({entries:[{...row,display:{assets:{headshotUrl:'data:image/png;dummy',headshotFallbackUsed:true},stats:{adp:12,byeWeek:7}}}]},'NBA').stats).toBe(0)
  expect(savedPoolCoverage({entries:[{...row,display:{assets:{headshotUrl:'https://example.invalid/fallback',headshotFallbackUsed:true},stats:{}}}]},'NBA').portraits).toBe(0)
 })
 it.each(['NFL','NBA','NHL','MLB'])('reports absent %s data without manufacturing coverage',(sport)=>{
  expect(savedPoolCoverage(null,sport)).toEqual({entries:0,portraits:0,stats:0,adp:0,positions:0})
  expect(savedPoolCoverage({entries:[{position:'',adp:null,display:{stats:{}}}]},sport)).toMatchObject({stats:0,adp:0,positions:0})
 })
})

describe('settlement readiness',()=>{
 it('flags an absent earlier week even when every saved row is complete',()=>{
  expect(settlementReadiness([{week:1,status:'complete',requiresStatCorrection:false}],1,2)).toEqual({missing:1,pending:0})
 })
 it('honors a midseason start and flagged stat corrections',()=>{
  expect(settlementReadiness([{week:6,status:'complete',requiresStatCorrection:true}],6,6)).toEqual({missing:0,pending:1})
  expect(settlementReadiness([],6,5)).toEqual({missing:0,pending:0})
 })
})

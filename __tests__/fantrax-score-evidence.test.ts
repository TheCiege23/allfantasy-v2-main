import {describe,it,expect} from 'vitest'
import {verifiedSourceZero,reviewedGameStats} from '../lib/import-os/collector/fantraxScoreEvidence'
const input={period:4,playerId:'player',rosterId:7,points:0}
const receipt={verified:true,period:4,rosterId:7,sha256:'a'.repeat(64),zeroEvidence:[{playerId:'player',opponent:'Bye',kind:'bye'}]}
describe('Fantrax score evidence scope',()=>{
 it('labels explicit source zeros without claiming independent calculations',()=>expect(verifiedSourceZero([{data:receipt}],input)).toMatchObject({kind:'bye',independentCalculation:false}))
 it.each([{period:5},{rosterId:8},{points:1}])('rejects stale period, roster and points',change=>expect(verifiedSourceZero([{data:receipt}],{...input,...change})).toBeNull())
 it('rejects ambiguous or malformed source evidence',()=>expect(verifiedSourceZero([{data:{...receipt,zeroEvidence:[...receipt.zeroEvidence,...receipt.zeroEvidence]}}],input)).toBeNull())
 const review={playerId:'player',gameId:'game',kind:'official_box_score',sourceUrl:'https://school.edu/boxscore/1',reviewedAt:'2026-10-07T00:00:00Z',changes:[{key:'passing.YDS',before:177,after:172}]}
 it('preserves raw stats and requires the exact reviewed player/game/value',()=>{
  const raw={'passing.YDS':177};expect(reviewedGameStats(raw,{playerId:'player',gameId:'game'},[review])?.stats).toEqual({'passing.YDS':172});expect(raw['passing.YDS']).toBe(177)
  expect(reviewedGameStats(raw,{playerId:'other',gameId:'game'},[review])).toBeNull()
  expect(reviewedGameStats({'passing.YDS':178},{playerId:'player',gameId:'game'},[review])).toBeNull()
  expect(reviewedGameStats(raw,{playerId:'player',gameId:'game'},[review,review])).toBeNull()
 })
})

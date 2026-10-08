import {describe,it,expect} from 'vitest'
import {playoffInputChanges} from '@/lib/core-app/weeklyPlayoffMovement'
import type {PlayoffPoint} from '@/lib/core-app/weeklyPlayoffPath'
describe('observed playoff movement',()=>{
 it('does not invent causes for legacy snapshots',()=>expect(playoffInputChanges({period:4,probability:30,sampledAt:'2026-10-01'},undefined)).toEqual([]))
 it('compares recorded inputs and omits unchanged/nonfinite metrics',()=>{
 const p:PlayoffPoint={period:4,probability:30,sampledAt:'2026-10-01',inputs:{wins:2,losses:2,ties:0,seed:6,pointsFor:400,weeksRemaining:8,weeklyMean:null}}
 const q:PlayoffPoint={...p,period:5,inputs:{...p.inputs!,wins:3,seed:4,pointsFor:NaN}}
 expect(playoffInputChanges(p,q)).toEqual(['Wins: 2 → 3','Seed: 6 → 4'])
 expect(playoffInputChanges(p,q,true)[0]).toContain('Victorias')
 })
})

import {describe,it,expect} from 'vitest'
import {rotateSweepTargets,nativeSweepDeadline} from '@/lib/core-app/teamSweepPolicy'
describe('bounded team workspace sweep fairness',()=>{
 it('gives every account the first admission slot even when only one target fits each sweep',()=>{const ids=['first','middle','last'];expect([0,1,2].map(tick=>rotateSweepTargets(ids,tick*300_000)[0])).toEqual(ids)})
 it('preserves every roster exactly once without modifying the caller list',()=>{const rosters=[{id:'a'},{id:'b'},{id:'c'}];const result=rotateSweepTargets(rosters,300_000);expect(result.map(r=>r.id)).toEqual(['b','c','a']);expect(rosters.map(r=>r.id)).toEqual(['a','b','c']);expect(rotateSweepTargets([],0)).toEqual([])})
 it('reserves alert admission time while respecting an earlier total deadline',()=>{expect(nativeSweepDeadline(30_000,0)).toBe(10_000);expect(nativeSweepDeadline(5_000,0)).toBe(5_000);expect(nativeSweepDeadline(9_000,10_000)).toBe(9_000)})
})

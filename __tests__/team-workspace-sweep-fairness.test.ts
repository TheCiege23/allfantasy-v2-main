import {readFileSync} from 'node:fs'
import {describe,it,expect} from 'vitest'
import {rotateSweepTargets,nativeSweepDeadline,teamSweepBatchOffset,TEAM_SWEEP_INTERVAL_MS} from '@/lib/core-app/teamSweepPolicy'
describe('bounded team workspace sweep fairness',()=>{
 it('gives every account the first admission slot even when only one target fits each sweep',()=>{const ids=['first','middle','last'];expect([0,1,2].map(tick=>rotateSweepTargets(ids,tick*TEAM_SWEEP_INTERVAL_MS)[0])).toEqual(ids)})
 it('preserves every roster exactly once without modifying the caller list',()=>{const rosters=[{id:'a'},{id:'b'},{id:'c'}];const result=rotateSweepTargets(rosters,TEAM_SWEEP_INTERVAL_MS);expect(result.map(r=>r.id)).toEqual(['b','c','a']);expect(rosters.map(r=>r.id)).toEqual(['a','b','c']);expect(rotateSweepTargets([],0)).toEqual([])})
 it('reserves alert admission time while respecting an earlier total deadline',()=>{expect(nativeSweepDeadline(30_000,0)).toBe(10_000);expect(nativeSweepDeadline(5_000,0)).toBe(5_000);expect(nativeSweepDeadline(9_000,10_000)).toBe(9_000)})
})

it('rotates every account at the actual scheduled interval, including counts divisible by three',()=>{
 const cron=JSON.parse(readFileSync('cron-schedule.json','utf8')) as {crons:Array<{path:string;schedule:string}>}
 expect(cron.crons.find(c=>c.path==='/api/cron/alert-sweep')?.schedule).toBe('*/15 * * * *')
 expect(TEAM_SWEEP_INTERVAL_MS).toBe(15*60_000)
 for(const count of [3,6,9,65]){
  const ids=Array.from({length:count},(_,i)=>i)
  const admitted=new Set(ids.map((_,tick)=>rotateSweepTargets(ids,(100+tick)*15*60_000)[0]))
  expect(admitted.size).toBe(count)
 }
})
it.each([[6,2],[66,2],[24,8],[65,2],[25,8]])('covers all %i leagues through scheduled batches of %i', (count,batchSize)=>{
 const seen=new Set<number>()
 for(let tick=0;tick<count;tick++){
  const skip=teamSweepBatchOffset(count,batchSize,(100+tick)*15*60_000)
  for(let i=skip;i<Math.min(skip+batchSize,count);i++)seen.add(i)
 }
 expect(seen.size).toBe(count)
 expect(teamSweepBatchOffset(0,batchSize,0)).toBe(0)
})

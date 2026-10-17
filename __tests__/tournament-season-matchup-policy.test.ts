import { expect, it } from 'vitest'
import { deriveSeasonMatchupOutcomes, suggestSeasonRoundRobin, validateSeasonMatchupSchedule } from '@/lib/tournament/seasonMatchupPolicy'
const schedule=()=>({period:1,source:'verified-native-scheduler',pairs:[{homeRosterId:'a',awayRosterId:'b'},{homeRosterId:'c',awayRosterId:'d'}]})
it('derives wins, losses and half-win tie credits from exact finalized points',()=>{
 const result=deriveSeasonMatchupOutcomes(schedule(),[{rosterId:'a',points:10},{rosterId:'b',points:-2},{rosterId:'c',points:0.1+0.2},{rosterId:'d',points:0.3}])
 expect(result.map(r=>[r.wins,r.losses,r.ties])).toEqual([[1,0,0],[0,1,0],[0.5,0,1],[0.5,0,1]])
 expect(result[0]).toMatchObject({opponentRosterId:'b',pointsAgainst:-2})
})
it.each(['self','foreign','duplicate','missing'])('refuses %s pairings',kind=>{
 const s=schedule();if(kind==='self')s.pairs[0]!.awayRosterId='a';if(kind==='foreign')s.pairs[0]!.awayRosterId='x';if(kind==='duplicate')s.pairs[1]!.homeRosterId='a';if(kind==='missing')s.pairs.pop()
 expect(()=>validateSeasonMatchupSchedule(s,['a','b','c','d'])).toThrow()
})
it.each([null,NaN,Infinity,0.00001])('refuses unknown or unsafe finalized points %s',points=>expect(()=>deriveSeasonMatchupOutcomes(schedule(),[{rosterId:'a',points},{rosterId:'b',points:0},{rosterId:'c',points:0},{rosterId:'d',points:0}])).toThrow())

it.each([2,4,6,8,12])('suggests a complete %s-team round-robin without repeat opponents before the cycle ends',count=>{
 const ids=Array.from({length:count},(_,i)=>'r'+i),seen=new Set<string>()
 for(let period=1;period<count;period++){
  const schedule=suggestSeasonRoundRobin(ids,period,1)
  expect(schedule.pairs).toHaveLength(count/2)
  for(const pair of schedule.pairs){const key=[pair.homeRosterId,pair.awayRosterId].sort().join(':');expect(seen.has(key)).toBe(false);seen.add(key)}
 }
 expect(seen.size).toBe(count*(count-1)/2)
 expect(suggestSeasonRoundRobin(ids,count,1).pairs).toEqual(suggestSeasonRoundRobin(ids,1,1).pairs.map(p=>({homeRosterId:p.awayRosterId,awayRosterId:p.homeRosterId})))
})
it('anchors suggestions to the actual stage start and does not mutate frozen team order',()=>{
 const ids=['a','b','c','d'];expect(suggestSeasonRoundRobin(ids,5,5).pairs).toEqual(suggestSeasonRoundRobin(ids,1,1).pairs)
 expect(ids).toEqual(['a','b','c','d']);expect(()=>suggestSeasonRoundRobin(ids,4,5)).toThrow()
})

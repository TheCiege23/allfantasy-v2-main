import {describe,it,expect} from 'vitest'
import {historicalNflSchedule} from '@/lib/draft-archive/historicalScheduleModel'
const teams=['BUF','CIN',...Array.from({length:30},(_,i)=>'TEAM'+i)]
const event=(i:number)=>({id:String(i+1),season:{year:2025,type:2},week:{number:i%18+1},date:'2025-09-01T00:00:00Z',status:{type:{completed:true}},competitions:[{competitors:[{homeAway:'home',team:{abbreviation:teams[(i%16)*2]}},{homeAway:'away',team:{abbreviation:teams[(i%16)*2+1]}}]}]})
const full={events:Array.from({length:272},(_,i)=>event(i))}
describe('historical NFL schedule inventory',()=>{
 it('deduplicates calendar overlap and excludes another season and playoffs',()=>{
  expect(historicalNflSchedule([full,{events:[event(0),{...event(999),season:{year:2024,type:2}},{...event(998),season:{year:2025,type:3}}]}],2025)).toHaveLength(272)
 })
 it('rejects missing games/weeks, conflicting dates, malformed dates and current-season imports',()=>{
  for(const payload of [{events:full.events.slice(1)},{events:full.events.map(e=>({...e,week:{number:1}}))},{events:[...full.events,{...event(0),date:'2025-10-01T00:00:00Z'}]},{events:full.events.map((e,i)=>i?e:{...e,date:'unknown'})}])expect(()=>historicalNflSchedule([payload,{events:[]}],2025)).toThrow()
  expect(()=>historicalNflSchedule([full,{events:[]}],new Date().getUTCFullYear())).toThrow()
 })
 it('accepts only the 2022 missing BUF-CIN game and checks the complete team inventory',()=>{
  const cancelled=full.events.slice(1).map(e=>({...e,season:{year:2022,type:2},date:'2022-09-01T00:00:00Z'}))
  expect(historicalNflSchedule([{events:cancelled},{events:[]}],2022)).toHaveLength(271)
  const wrong=full.events.filter((_,i)=>i!==1).map(e=>({...e,season:{year:2022,type:2},date:'2022-09-01T00:00:00Z'}))
  expect(()=>historicalNflSchedule([{events:wrong},{events:[]}],2022)).toThrow()
  expect(()=>historicalNflSchedule([{events:full.events.map(e=>({...e,competitions:[{competitors:[{homeAway:'home',team:{abbreviation:'A'}},{homeAway:'away',team:{abbreviation:'B'}}]}]}))},{events:[]}],2025)).toThrow()
 })

})

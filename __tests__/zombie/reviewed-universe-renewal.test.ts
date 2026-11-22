import {describe,it,expect} from 'vitest'
import {planReviewedUniverseRenewal,parseUniverseRenewalProposal,type UniverseRenewalProposal} from '@/lib/zombie/reviewedUniverseRenewal'
const levels=[{id:'g',name:'Gamma',rankOrder:1,maxLeagues:2},{id:'a',name:'Alpha',rankOrder:2,maxLeagues:2}]
const policy={promotionEnabled:true,relegationEnabled:true,promotionCount:1,relegationCount:1}
const sources=levels.map(l=>({leagueId:l.id+'0',levelId:l.id,name:l.name,seats:8,orderInLevel:0}))
const managers=sources.flatMap(p=>Array.from({length:8},(_,i)=>({userId:p.leagueId+i,rosterId:p.leagueId+i,leagueId:p.leagueId,levelId:p.levelId,displayName:'Manager '+i,teamName:'Team '+i,avatarUrl:null,wins:8-i,losses:i,ties:0,totalPoints:800-i*10})))
function proposal():UniverseRenewalProposal{return {version:1,reason:'Commissioner reviewed expansion',replaceRecordedMovement:false,pools:sources.map(p=>({key:p.leagueId,templateLeagueId:p.leagueId,levelId:p.levelId,name:p.name,seats:10})),placements:managers.map(m=>({userId:m.userId,poolId:m.leagueId}))}}
function plan(p:unknown){return planReviewedUniverseRenewal(managers,levels,policy,sources,p,'u:2027')}
describe('reviewed universe placement and capacity',()=>{
 it('keeps every returning manager exactly once and leaves expansion seats open',()=>{
  const p=proposal(),before=JSON.stringify({p,managers,sources}),r=plan(p)
  expect(r.assignments).toHaveLength(16);expect(r.openSeats).toBe(4)
  expect(new Set(r.assignments.map(m=>m.userId)).size).toBe(16)
  for(const pool of r.pools)expect(r.assignments.filter(m=>m.destinationLeagueId===pool.leagueId).map(m=>m.slot)).toEqual([1,2,3,4,5,6,7,8])
  expect(JSON.stringify({p,managers,sources})).toBe(before)
 })
 it('merges leagues without losing owners and derives real level changes',()=>{
  const p=proposal();p.pools=[{...p.pools[1],seats:16}];p.placements.forEach(m=>m.poolId='a0')
  const r=plan(p);expect(r.openSeats).toBe(0);expect(r.pools).toHaveLength(1)
  expect(r.assignments.filter(m=>m.movement==='promotion')).toHaveLength(8)
  expect(r.movement.filter(m=>m.reason==='promotion')).toHaveLength(8)
 })
 it('splits destinations using explicit source rules and deterministic slots',()=>{
  const p=proposal();p.pools.push({...p.pools[0],key:'expansion',name:'New Gamma',seats:8})
  p.placements[0].poolId='expansion'
  const r=plan(p)
  expect(r.pools.find(p=>p.leagueId==='expansion')?.templateLeagueId).toBe('g0')
  const reversed={...p,placements:[...p.placements].reverse()}
  expect(planReviewedUniverseRenewal([...managers].reverse(),levels,policy,sources,reversed,'u:2027').assignments).toEqual(r.assignments)
 })
 it.each(['missing','duplicate','foreign','unassigned'])('rejects %s manager placement',mode=>{
  const p=proposal()
  if(mode==='missing')p.placements.pop()
  if(mode==='duplicate')p.placements[0]={...p.placements[1]}
  if(mode==='foreign')p.placements[0].userId='outsider'
  if(mode==='unassigned')p.placements[0].poolId='unknown'
  expect(()=>plan(p)).toThrow('RENEWAL_PLACEMENT_INCOMPLETE')
 })
 it.each(['duplicate','foreign-template','foreign-level'])('rejects %s destinations',mode=>{
  const p=proposal()
  if(mode==='duplicate')p.pools[1].key=p.pools[0].key
  if(mode==='foreign-template')p.pools[0].templateLeagueId='foreign'
  if(mode==='foreign-level')p.pools[0].levelId='foreign'
  expect(()=>plan(p)).toThrow('RENEWAL_POOL_INVALID')
 })
 it('refuses overfilled leagues and configured level limits',()=>{
  const p=proposal();p.pools[0].seats=8;p.placements[8].poolId='g0'
  expect(()=>plan(p)).toThrow('RENEWAL_POOL_OVERFILLED')
  const many=proposal();many.pools.push({...many.pools[0],key:'extra1'},{...many.pools[0],key:'extra2'})
  expect(()=>plan(many)).toThrow('RENEWAL_LEVEL_CAPACITY_EXCEEDED')
 })
 it('requires a meaningful reason, supported capacities and a bounded strict payload',()=>{
  for(const p of [{...proposal(),reason:'short'},{...proposal(),unexpected:true},{...proposal(),pools:[{...proposal().pools[0],seats:9}]}])
   expect(()=>parseUniverseRenewalProposal(p)).toThrow('RENEWAL_PROPOSAL_INVALID')
 })
 it('rejects ambiguous source ownership before any assignment',()=>{
  expect(()=>planReviewedUniverseRenewal([...managers,managers[0]],levels,policy,sources,proposal(),'x')).toThrow('RENEWAL_MEMBERSHIP_AMBIGUOUS')
 })
})

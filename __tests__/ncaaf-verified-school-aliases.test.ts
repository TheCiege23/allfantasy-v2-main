import { describe, expect, it } from 'vitest'
import { planNcaafFantraxIdentityLinks, verifiedFantraxSchoolAliases, currentCfbdSchoolIdentities } from '@/lib/player-identity/ncaafFantraxIdentityPlan'
const schools=['Oregon','Oregon State']
const refs=[1,2,3].map(i=>({fantraxId:`fx${i}`,name:`Player ${i}`,team:'Oreg',position:'WR'}))
const rows=refs.map((r,i)=>({id:`p${i}`,canonicalName:r.name,currentTeam:'University of Oregon',position:'WR',fantraxId:r.fantraxId,cfbdId:`cf${i}`}))
const facts=rows.map(r=>({cfbdId:r.cfbdId,name:r.canonicalName,school:'Oregon'}))
describe('verified provider school aliases',()=>{
 it('requires three independent verified current-season athletes, then resolves the abbreviation without prefix guessing',()=>{
  const aliases=verifiedFantraxSchoolAliases(refs,rows,facts,schools)
  expect(aliases).toEqual({oreg:'oregon'})
  const next={fantraxId:'new',name:'Next Player',team:'Oreg',position:'WR'}
  const target={id:'next',canonicalName:next.name,currentTeam:'University of Oregon',position:'WR',fantraxId:null,cfbdId:'cf-next'}
  expect(planNcaafFantraxIdentityLinks([next],[target],schools).links).toHaveLength(0)
  expect(planNcaafFantraxIdentityLinks([next],[target],schools,aliases).links).toEqual([{id:'next',fantraxId:'new',cfbdId:'cf-next'}])
  expect(verifiedFantraxSchoolAliases(refs.slice(0,2),rows,facts,schools)).toEqual({})
 })
 it('refuses conflicting school claims even with three matching anchors',()=>{
  const other={fantraxId:'other',name:'Other Player',team:'Oreg',position:'WR'}
  const otherRow={id:'other',canonicalName:other.name,currentTeam:'Oregon State University',position:'WR',fantraxId:other.fantraxId,cfbdId:'cf-other'}
  expect(verifiedFantraxSchoolAliases([...refs,other],[...rows,otherRow],[...facts,{cfbdId:'cf-other',name:other.name,school:'Oregon State'}],schools)).toEqual({})
 })
 /*
  * 2026-11-19: 21 FBS codes (RUT 78 Rutgers vs 3, WVU 61 vs 3, UGA, Fla…) were never learned because one or
  * two transferred players' stale Fantrax listings dissented. A clear supermajority now teaches the code.
  */
 it('learns a code from a supermajority (10+ anchors, 85%+) despite a stale transfer listing',()=>{
  const make=(n:number,school:string,cfbdSchool:string,prefix:string)=>{
   const r=Array.from({length:n},(_,i)=>({fantraxId:`${prefix}${i}`,name:`${prefix} Player ${i}`,team:'Oreg',position:'WR'}))
   const id=r.map((x,i)=>({id:`${prefix}p${i}`,canonicalName:x.name,currentTeam:school,position:'WR',fantraxId:x.fantraxId,cfbdId:`${prefix}cf${i}`}))
   return {r,id,f:id.map(x=>({cfbdId:x.cfbdId,name:x.canonicalName,school:cfbdSchool}))}
  }
  const many=make(11,'University of Oregon','Oregon','a'), stale=make(1,'Oregon State University','Oregon State','b')
  expect(verifiedFantraxSchoolAliases([...many.r,...stale.r],[...many.id,...stale.id],[...many.f,...stale.f],schools)).toEqual({oreg:'oregon'})
  const few=make(9,'University of Oregon','Oregon','c')
  expect(verifiedFantraxSchoolAliases([...few.r,...stale.r],[...few.id,...stale.id],[...few.f,...stale.f],schools)).toEqual({})
  const split=make(3,'Oregon State University','Oregon State','d')
  expect(verifiedFantraxSchoolAliases([...many.r,...split.r],[...many.id,...split.id],[...many.f,...split.f],schools)).toEqual({})
 })
 it('refuses duplicate source claims, name/position mismatch, and missing game-school proof',()=>{
  expect(verifiedFantraxSchoolAliases([...refs,refs[0]!],rows,facts,schools)).toEqual({})
  expect(verifiedFantraxSchoolAliases(refs,rows,facts.slice(0,2),schools)).toEqual({})
  expect(verifiedFantraxSchoolAliases(refs,[{...rows[0]!,position:'QB'},...rows.slice(1)],facts,schools)).toEqual({})
  expect(verifiedFantraxSchoolAliases(refs,rows,[{...facts[0]!,name:'Different Person'},...facts.slice(1)],schools)).toEqual({})
 })
 it('does not count the same CFBD athlete three times or teach transferred affiliations',()=>{
  expect(verifiedFantraxSchoolAliases(refs,rows.map(r=>({...r,cfbdId:'same'})),facts.map(f=>({...f,cfbdId:'same'})),schools)).toEqual({})
  expect(verifiedFantraxSchoolAliases(refs,rows,[...facts,{...facts[0]!,school:'Oregon State'}],schools)).toEqual({})
 })
})

it('uses current CFBD affiliation for transfers and refuses contradictory names or schools',()=>{
 const old={...rows[0]!,currentTeam:'Oregon State University'}
 expect(currentCfbdSchoolIdentities([old],facts,schools)[0]!.currentTeam).toBe('oregon')
 expect(currentCfbdSchoolIdentities([old],[],schools)[0]!.currentTeam).toBe('Oregon State University')
 expect(currentCfbdSchoolIdentities([old],[{...facts[0]!,name:'Different Player'}],schools)[0]!.currentTeam).toBeNull()
 expect(currentCfbdSchoolIdentities([old],[facts[0]!,{...facts[0]!,school:'Oregon State'}],schools)[0]!.currentTeam).toBeNull()
 expect(currentCfbdSchoolIdentities([old],[{...facts[0]!,school:'Unscheduled School'}],schools)[0]!.currentTeam).toBeNull()
})

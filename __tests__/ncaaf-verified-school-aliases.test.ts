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

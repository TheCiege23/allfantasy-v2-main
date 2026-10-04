import { describe, expect, it } from 'vitest'
import { planCurrentRosterCfbdLinks, currentCfbdRosterProofStart, verifiedCurrentRosterSchoolAliases } from '@/lib/player-identity/currentRosterCfbdLinks'
import type { NcaafIdentityRow } from '@/lib/player-identity/ncaafFantraxIdentityPlan'
const source={fantraxId:'fx1',name:'Smith, Alex',team:'OSU',position:'WR'}
const pool={externalId:'cf1',name:'Alex Smith Jr.',position:'WR',college:'Ohio State',team:'Ohio State University'}
const row:NcaafIdentityRow={id:'p1',canonicalName:'Alex Smith',currentTeam:'Old School',position:'WR',fantraxId:'fx1',cfbdId:null}
const aliases={'osu':'ohio state'}
const plan=(refs=[source],rows=[row],players=[pool],facts:any[]=[],targets=new Set<string>())=>planCurrentRosterCfbdLinks(refs,rows,players,facts,aliases,targets)
describe('current CFBD roster identity proof',()=>{
 it('links an explicitly source-owned player after a verified transfer',()=>expect(plan().links).toEqual([{id:'p1',fantraxId:'fx1',cfbdId:'cf1',name:'Alex Smith',position:'WR'}]))
 it('never overwrites a CFBD link',()=>expect(plan([source],[{...row,cfbdId:'old'}]).links).toHaveLength(0))
 it('refuses a same-name athlete at another school',()=>expect(plan([source],[row],[{...pool,college:'Michigan'}]).links).toHaveLength(0))
 it('refuses position disagreement',()=>expect(plan([source],[{...row,position:'OL'}]).links).toHaveLength(0))
 it('refuses two official athletes with the same name, school and role',()=>expect(plan([source],[row],[pool,{...pool,externalId:'cf2'}]).ambiguous).toBe(1))
 it('refuses two source IDs claiming one athlete',()=>expect(plan([source,{...source,fantraxId:'fx2'}]).links).toHaveLength(0))
 it('refuses duplicate source records',()=>expect(plan([source,source]).links).toHaveLength(0))
 it('refuses duplicate official IDs',()=>expect(plan([source],[row],[pool,pool]).links).toHaveLength(0))
 it('refuses another source owner of the same CFBD ID',()=>expect(plan([source],[row,{...row,id:'p2',fantraxId:'fx2',cfbdId:'cf1'}]).conflicts).toBe(1))
 it('does not create identities for unrostered source directory entries',()=>expect(plan([source],[]).creates).toHaveLength(0))
 it('creates a missing imported identity using official current metadata',()=>expect(plan([source],[],[pool],[],new Set(['fx1'])).creates).toEqual([{fantraxId:'fx1',cfbdId:'cf1',canonicalName:'Alex Smith Jr.',normalizedName:'alex smith',currentTeam:'Ohio State',position:'WR'}]))
 it('attaches to a unique existing CFBD identity instead of duplicating it',()=>{
  const result=plan([source],[{...row,fantraxId:null,cfbdId:'cf1'}],[pool],[],new Set(['fx1']))
  expect(result.sourceLinks).toEqual([{id:'p1',fantraxId:'fx1',cfbdId:'cf1'}]);expect(result.creates).toHaveLength(0)
 })
 it('refuses ambiguous existing registry ownership',()=>expect(plan([source],[{...row,fantraxId:null,cfbdId:'cf1'},{...row,id:'p2',fantraxId:null,cfbdId:'cf1'}],[pool],[],new Set(['fx1'])).conflicts).toBe(1))
 it('uses a game-record name only for that official athlete at the same school',()=>{
  const renamed={...pool,name:'Alexander Smith'}
  expect(plan([source],[row],[renamed],[{cfbdId:'cf1',name:'Alex Smith',school:'Ohio State'}]).links).toHaveLength(1)
  expect(plan([source],[row],[renamed],[{cfbdId:'cf2',name:'Alex Smith',school:'Ohio State'}]).links).toHaveLength(0)
  expect(plan([source],[row],[renamed],[{cfbdId:'cf1',name:'Alex Smith',school:'Michigan'}]).links).toHaveLength(0)
 })
})


it('treats name punctuation consistently, with school/role and both-direction uniqueness still required',()=>{
 const refs=[{fantraxId:'fx',name:'Green, TreyDez',team:'LSU',position:'TE'}]
 const pool=[{externalId:'cf',name:"Trey'Dez Green",position:'TE',college:'LSU',team:'LSU'}]
 const out=planCurrentRosterCfbdLinks(refs,[],pool,[],{},new Set(['fx']))
 expect(out.creates).toHaveLength(1)
 expect(planCurrentRosterCfbdLinks([...refs,{...refs[0]!,fantraxId:'other',name:"Green, Trey'Dez"}],[],pool,[],{},new Set(['fx'])).creates).toHaveLength(0)
})


it('refuses stale, previous-year, partial and future roster snapshot proofs',()=>{
 const now=new Date('2026-10-04T18:00:00Z')
 const state={season:2026,cycleStartedAt:'2026-10-01T15:00:00Z',completedAt:'2026-10-01T16:00:00Z'}
 expect(currentCfbdRosterProofStart(state,now)?.toISOString()).toBe(new Date(state.cycleStartedAt).toISOString())
 for(const bad of [null,{...state,season:2025},{...state,completedAt:null},{...state,cycleStartedAt:'2026-09-01T00:00:00Z'},{...state,completedAt:'2026-10-05T00:00:00Z'},{...state,completedAt:'invalid'},{...state,completedAt:'2026-09-30T00:00:00Z'}])expect(currentCfbdRosterProofStart(bad,now)).toBeNull()
})


it('bootstraps source school codes from three mutually unique athletes and rejects contradictory schools',()=>{
 const refs=[1,2,3].map(n=>({fantraxId:`fx${n}`,name:`Unique Player ${n}`,position:'RB',team:'UtSt'}))
 const pool=refs.map((r,n)=>({externalId:`cf${n}`,name:r.name,position:'RB',college:'Utah State',team:'Utah State'}))
 expect(verifiedCurrentRosterSchoolAliases(refs,pool)).toEqual({utst:'utah state'})
 expect(verifiedCurrentRosterSchoolAliases(refs.slice(0,2),pool)).toEqual({})
 expect(verifiedCurrentRosterSchoolAliases(refs,[...pool,{...pool[0]!,externalId:'duplicate',college:'Utah'}])).toEqual({})
 expect(verifiedCurrentRosterSchoolAliases([...refs,{...refs[0]!,fantraxId:'duplicate'}],pool)).toEqual({})
 const other={fantraxId:'other',name:'Another Athlete',position:'RB',team:'UtSt'}
 expect(verifiedCurrentRosterSchoolAliases([...refs,other],[...pool,{externalId:'other',name:other.name,position:'RB',college:'Utah',team:'Utah'}])).toEqual({})
})


it('accepts a documented nickname only with the exact Fantrax and explicit RotoWire source IDs',()=>{
 const ref={fantraxId:'06982',name:'Cook, Cameron',rotowireId:41891,position:'RB',team:'West Virginia'}
 const p={externalId:'4918103',name:'Cam Cook',position:'RB',college:'West Virginia',team:'West Virginia'}
 expect(planCurrentRosterCfbdLinks([ref],[],[p],[],{},new Set([ref.fantraxId])).creates).toHaveLength(1)
 for(const wrong of [{...ref,rotowireId:1},{...ref,fantraxId:'other'},{...ref,name:'Cook, Connor'},{...ref,team:'Texas'},{...ref,position:'WR'}])expect(planCurrentRosterCfbdLinks([wrong],[],[p],[],{},new Set([wrong.fantraxId])).creates).toHaveLength(0)
})


it('keeps an existing official-ID identity when its canonical name uses the documented full name',()=>{
 const ref={fantraxId:'06982',name:'Cook, Cameron',rotowireId:41891,position:'RB',team:'West Virginia'}
 const p={externalId:'4918103',name:'Cam Cook',position:'RB',college:'West Virginia',team:'West Virginia'}
 const row={id:'owned',canonicalName:'Cameron Cook',currentTeam:'West Virginia',position:'RB',fantraxId:null,cfbdId:'4918103'}
 expect(planCurrentRosterCfbdLinks([ref],[row],[p],[],{},new Set([ref.fantraxId])).sourceLinks).toHaveLength(1)
 expect(planCurrentRosterCfbdLinks([{...ref,rotowireId:1}],[row],[p],[],{},new Set([ref.fantraxId])).sourceLinks).toHaveLength(0)
})

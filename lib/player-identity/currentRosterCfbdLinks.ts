import type { FantraxPlayerRef } from '@/lib/league-import/fantrax/fantraxApi'
import { cfbdScheduleTeamKeys, exactKey } from '@/lib/sports-data/collegeTeamNames'
import { normalizePlayerName } from '@/lib/team-abbrev'
import type { CfbdSchoolFact, NcaafIdentityRow } from './ncaafFantraxIdentityPlan'

export type CurrentCfbdRosterProof = { externalId: string; name: string; position: string | null; college: string | null; team: string | null }
const nameKey = (value: string) => { const p=value.split(','); return normalizePlayerName(p.length===2?`${p[1]} ${p[0]}`:value).replace(/['’-]/g,'') }
const roles = (value: string | null) => String(value??'').toUpperCase().split(/[,/\s]+/).map(p=>p==='FB'?'RB':p==='PK'?'K':p).filter(p=>['QB','RB','WR','TE','K','P','DL','DE','DT','LB','DB','CB','S'].includes(p))

// Verified 2026-10-04 through the RotoWire IDs supplied by Fantrax itself. Each public
// provider profile names the alternate spelling; this is not a generic nickname expansion.
// Biography evidence: docs/readiness/ncaaf-alternate-name-proofs.md (never fetched at runtime).
const documentedSourceNames:Record<string,{rotowireId:string;sourceName:string;officialName:string;canonicalNames?:string[]}>={
 '06982':{rotowireId:'41891',sourceName:'Cook, Cameron',officialName:'Cam Cook'},
 '06jaw':{rotowireId:'47073',sourceName:'Barnes, Christopher',officialName:'Chris Barnes'},
 '06ajd':{rotowireId:'41448',sourceName:'Alexander, Hilton',officialName:'Deuce Alexander'},
 '06fo4':{rotowireId:'42002',sourceName:'Winfield, DWayne Lunch',officialName:'Lunch Winfield',canonicalNames:["D'Wanye Winfield","D'Wanye' Winfield"]},
 '069ol':{rotowireId:'40941',sourceName:'Baxter, Cedric',officialName:'CJ Baxter'},
 '06ks2':{rotowireId:'45156',sourceName:'Bailey, Cedrick',officialName:'CJ Bailey'},
 '06ks3':{rotowireId:'46363',sourceName:'Scott, Duke',officialName:'Jayden Scott'},
}
const sourceNameKey=(ref:FantraxPlayerRef)=>{
 const proof=documentedSourceNames[ref.fantraxId]
 return proof && String(ref.rotowireId??'')===proof.rotowireId && nameKey(ref.name)===nameKey(proof.sourceName)?nameKey(proof.officialName):nameKey(ref.name)
}

const documentedCanonicalName=(ref:FantraxPlayerRef,value:string)=>{
 const proof=documentedSourceNames[ref.fantraxId]
 return Boolean(proof && String(ref.rotowireId??'')===proof.rotowireId && nameKey(ref.name)===nameKey(proof.sourceName) && [proof.sourceName,proof.officialName,...(proof.canonicalNames??[])].some(name=>nameKey(name)===nameKey(value)))
}

/** Only a completed current-season roster snapshot may be handed to this planner.
 * Links an existing, explicitly Fantrax-owned identity to an official athlete; creates missing imported identities only when no CFBD owner exists; never overwrites links. Both directions must be unique across the full source pool.
 */
export function planCurrentRosterCfbdLinks(refs: FantraxPlayerRef[], identities: NcaafIdentityRow[], pool: CurrentCfbdRosterProof[], facts: CfbdSchoolFact[], aliases: Readonly<Record<string,string>>, importedIds: ReadonlySet<string> = new Set()) {
 const factsById=new Map<string,CfbdSchoolFact[]>()
 for(const f of facts)factsById.set(f.cfbdId,[...(factsById.get(f.cfbdId)??[]),f])
 const owners=new Map<string,NcaafIdentityRow[]>(),cfbdOwners=new Map<string,NcaafIdentityRow[]>()
 for(const row of identities){
  if(row.fantraxId)owners.set(row.fantraxId,[...(owners.get(row.fantraxId)??[]),row])
  if(row.cfbdId)cfbdOwners.set(row.cfbdId,[...(cfbdOwners.get(row.cfbdId)??[]),row])
 }
 const index=new Map<string,Set<string>>(),proofs=new Map<string,{names:Set<string>;roles:string[]}>()
 const duplicatePoolIds=new Set<string>()
 for(const p of pool){
  if(proofs.has(p.externalId)){duplicatePoolIds.add(p.externalId);continue}
  const school=cfbdScheduleTeamKeys(p.college??p.team).exact
  const names=new Set([nameKey(p.name),...(factsById.get(p.externalId)??[]).filter(f=>cfbdScheduleTeamKeys(f.school).exact===school).map(f=>nameKey(f.name))])
  const positions=roles(p.position);proofs.set(p.externalId,{names,roles:positions})
  if(!school)continue
  for(const name of names)for(const role of positions){const key=`${name}|${school}|${role}`;const ids=index.get(key)??new Set<string>();ids.add(p.externalId);index.set(key,ids)}
 }
 const candidates=new Map<string,Set<string>>(),claims=new Map<string,Set<string>>(),sourceCounts=new Map<string,number>()
 for(const ref of refs){
  sourceCounts.set(ref.fantraxId,(sourceCounts.get(ref.fantraxId)??0)+1)
  const school=aliases[exactKey(ref.team)]??cfbdScheduleTeamKeys(ref.team).exact
  const ids=new Set<string>()
  for(const role of roles(ref.position))for(const id of index.get(`${sourceNameKey(ref)}|${school}|${role}`)??[])ids.add(id)
  candidates.set(ref.fantraxId,ids)
  for(const id of ids){const sources=claims.get(id)??new Set<string>();sources.add(ref.fantraxId);claims.set(id,sources)}
 }
 const links:Array<{id:string;fantraxId:string;cfbdId:string;name:string;position:string|null}>=[]
 const sourceLinks:Array<{id:string;fantraxId:string;cfbdId:string}>=[]
 const creates:Array<{fantraxId:string;cfbdId:string;canonicalName:string;normalizedName:string;currentTeam:string;position:string}>=[]
 let ambiguous=0,conflicts=0
 for(const ref of refs){
  const owned=owners.get(ref.fantraxId)
  if(owned && (owned.length!==1 || owned[0]!.cfbdId))continue
  if(!owned && !importedIds.has(ref.fantraxId))continue
  const ids=candidates.get(ref.fantraxId)??new Set<string>()
  if(!ids.size)continue
  const id=[...ids][0]!
  if(ids.size!==1 || sourceCounts.get(ref.fantraxId)!==1 || claims.get(id)?.size!==1 || duplicatePoolIds.has(id)){ambiguous++;continue}
  const proof=proofs.get(id)!
  if(!owned){
   const targets=cfbdOwners.get(id)??[]
   if(targets.some(t=>t.fantraxId) || targets.length>1){conflicts++;continue}
   const target=targets[0]
   if(target){
    if(!(proof.names.has(nameKey(target.canonicalName)) || (proof.names.has(sourceNameKey(ref)) && documentedCanonicalName(ref,target.canonicalName))) || !roles(target.position).some(p=>roles(ref.position).includes(p)&&proof.roles.includes(p))){conflicts++;continue}
    sourceLinks.push({id:target.id,fantraxId:ref.fantraxId,cfbdId:id})
   }else{
    const athlete=pool.find(p=>p.externalId===id)!
    creates.push({fantraxId:ref.fantraxId,cfbdId:id,canonicalName:athlete.name,normalizedName:normalizePlayerName(athlete.name),currentTeam:athlete.college??athlete.team!,position:proof.roles.find(p=>roles(ref.position).includes(p))!})
   }
   continue
  }
  const row=owned[0]!
  if(!(proof.names.has(nameKey(row.canonicalName)) || (proof.names.has(sourceNameKey(ref)) && documentedCanonicalName(ref,row.canonicalName))) || !roles(row.position).some(p=>roles(ref.position).includes(p)&&proof.roles.includes(p)))continue
  if((cfbdOwners.get(id)??[]).some(other=>other.fantraxId&&other.fantraxId!==ref.fantraxId)){conflicts++;continue}
  links.push({id:row.id,fantraxId:ref.fantraxId,cfbdId:id,name:row.canonicalName,position:row.position})
 }
 return {links,sourceLinks,creates,ambiguous,conflicts}
}


/** A prior-season fallback or an unfinished refresh cannot prove a current athlete's school. */
export function currentCfbdRosterProofStart(state: unknown, now=new Date()): Date | null {
 if(!state || typeof state!=='object' || Array.isArray(state))return null
 const value=state as Record<string,unknown>
 if(value.season!==now.getUTCFullYear() || typeof value.cycleStartedAt!=='string' || typeof value.completedAt!=='string')return null
 const started=Date.parse(value.cycleStartedAt),completed=Date.parse(value.completedAt)
 return Number.isFinite(started)&&Number.isFinite(completed)&&started<=completed&&completed<=now.getTime()&&now.getTime()-started<30*86400000?new Date(started):null
}


/** Bootstrap a school code only from three distinct mutually unique current roster athletes.
 * Every current roster match bearing that source code must agree on the same school.
 */
export function verifiedCurrentRosterSchoolAliases(refs: FantraxPlayerRef[], pool: CurrentCfbdRosterProof[]) {
 const index=new Map<string,Set<string>>(),byId=new Map(pool.map(p=>[p.externalId,p]))
 const poolCounts=new Map<string,number>();for(const p of pool)poolCounts.set(p.externalId,(poolCounts.get(p.externalId)??0)+1)
 for(const p of pool)for(const role of roles(p.position)){const k=`${nameKey(p.name)}|${role}`;const ids=index.get(k)??new Set<string>();ids.add(p.externalId);index.set(k,ids)}
 const candidates=new Map<FantraxPlayerRef,Set<string>>(),reverse=new Map<string,Set<string>>(),counts=new Map<string,number>()
 for(const ref of refs){
  counts.set(ref.fantraxId,(counts.get(ref.fantraxId)??0)+1)
  const ids=new Set<string>();for(const role of roles(ref.position))for(const id of index.get(`${sourceNameKey(ref)}|${role}`)??[])ids.add(id)
  candidates.set(ref,ids);for(const id of ids){const owners=reverse.get(id)??new Set<string>();owners.add(ref.fantraxId);reverse.set(id,owners)}
 }
 const claims=new Map<string,Map<string,Set<string>>>()
 for(const ref of refs){
  const ids=candidates.get(ref)!,code=exactKey(ref.team)
  if(ids.size!==1 || !code || counts.get(ref.fantraxId)!==1)continue
  const id=[...ids][0]!,p=byId.get(id)!
  if(reverse.get(id)?.size!==1 || poolCounts.get(id)!==1)continue
  const school=cfbdScheduleTeamKeys(p.college??p.team).exact;if(!school)continue
  const schools=claims.get(code)??new Map<string,Set<string>>();const athletes=schools.get(school)??new Set<string>();athletes.add(id);schools.set(school,athletes);claims.set(code,schools)
 }
 const result:Record<string,string>={}
 for(const [code,schools] of claims)if(schools.size===1){const [school,athletes]=[...schools][0]!;if(athletes.size>=3)result[code]=school}
 return result
}

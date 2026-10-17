import {computeLeagueProjectedPoints} from '@/lib/projections/leagueScoring'
import {DEFAULT_SLOT_ELIGIBILITY,type SlotEligibility} from '@/lib/decision-os/trade/rosterImpact'
import {getBestBallSportProfile} from '@/lib/bestball/rules'
export const DRAFT_POINTS_SPORTS=['NFL','NCAAF','NBA','NCAAB','MLB','NHL','SOCCER'] as const
export function draftSlotEligibility(sport:string,positions:string[]=[]):SlotEligibility|null {
 if(!DRAFT_POINTS_SPORTS.some(s=>s===sport))return null
 const slots=sport==='NFL'||sport==='NCAAF'?null:getBestBallSportProfile(sport).lineupSlots
 const singles=slots?Object.fromEntries(slots.flatMap(s=>s.allowedPositions.map(p=>[p,[p]]))):{}
 const base:SlotEligibility=slots?{...singles}:DEFAULT_SLOT_ELIGIBILITY
 if(slots)for(const slot of slots)base[slot.code]=[...new Set([...slot.allowedPositions,...(['G','F','W'].includes(slot.code)?[slot.code]:[])])]
 const result:SlotEligibility=Object.fromEntries(Object.entries(base).map(([slot,allowed])=>[slot,[...allowed]]))
 const known=new Set(Object.values(base).flat())
 for(const raw of positions){
  const position=raw.toUpperCase(),parts=position.split(/[\/, -]+/).filter(Boolean)
  if(parts.length<2||parts.some(p=>!known.has(p)))continue
  for(const [slot,allowed] of Object.entries(base))if(parts.some(p=>allowed.includes(p)))result[slot]=[...result[slot],position]
 }
 return result
}
/** Football aliases are not reused across sports with overlapping stat names. */
export function scoreDraftRates(rates:Record<string,unknown>,rules:Record<string,unknown>,sport:string) {
 if(!draftSlotEligibility(sport))return null
 if(sport==='NFL'||sport==='NCAAF')return computeLeagueProjectedPoints(rates,rules)
 let points=0,matched=0;const unmatched:string[]=[]
 for(const [key,weight] of Object.entries(rules)){
  if(typeof weight!=='number'||!Number.isFinite(weight)||weight===0)continue
  const value=rates[key]
  if(typeof value!=='number'||!Number.isFinite(value)){unmatched.push(key);continue}
  points+=value*weight;matched++
 }
 return matched&&Number.isFinite(points)?{points,coverage:{unmatched}}:null
}

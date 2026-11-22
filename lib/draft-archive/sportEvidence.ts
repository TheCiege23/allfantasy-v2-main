import {computeLeagueProjectedPoints} from '@/lib/projections/leagueScoring'
import {DEFAULT_SLOT_ELIGIBILITY,type SlotEligibility} from '@/lib/decision-os/trade/rosterImpact'
/*
 * Draft-comparison slot ELIGIBILITY (which positions can be compared against which), per sport. This read
 * `getBestBallSportProfile(sport).lineupSlots` until that profile was repointed at the seats best ball
 * scoring actually uses (audit 2026-11-06, finding #22). Draft analysis is not best ball scoring — it
 * serves every league type — so it keeps the eligibility it always had, stated here, instead of changing
 * with a best ball roster template. Never read this as a lineup or a slot count.
 */
type DraftSlot={code:string;allowedPositions:string[]}
const DRAFT_SLOTS:Record<string,DraftSlot[]>={
 NBA:[{code:'PG',allowedPositions:['PG']},{code:'SG',allowedPositions:['SG']},{code:'SF',allowedPositions:['SF']},{code:'PF',allowedPositions:['PF']},{code:'C',allowedPositions:['C']},{code:'G',allowedPositions:['PG','SG']},{code:'F',allowedPositions:['SF','PF']},{code:'UTIL',allowedPositions:['PG','SG','SF','PF','C']}],
 MLB:[{code:'C',allowedPositions:['C']},{code:'1B',allowedPositions:['1B']},{code:'2B',allowedPositions:['2B']},{code:'3B',allowedPositions:['3B']},{code:'SS',allowedPositions:['SS']},{code:'OF',allowedPositions:['OF','LF','CF','RF']},{code:'UTIL',allowedPositions:['C','1B','2B','3B','SS','OF','LF','CF','RF','DH']},{code:'SP',allowedPositions:['SP']},{code:'RP',allowedPositions:['RP']},{code:'P',allowedPositions:['SP','RP']}],
 NHL:[{code:'C',allowedPositions:['C']},{code:'W',allowedPositions:['LW','RW','W']},{code:'D',allowedPositions:['D']},{code:'G',allowedPositions:['G']},{code:'UTIL',allowedPositions:['C','LW','RW','W','D']}],
 NCAAB:[{code:'G',allowedPositions:['G','PG','SG']},{code:'F',allowedPositions:['F','SF','PF']},{code:'UTIL',allowedPositions:['G','F','C','PG','SG','SF','PF']}],
 SOCCER:[{code:'GK',allowedPositions:['GK','GKP']},{code:'DEF',allowedPositions:['DEF','CB','LB','RB','LWB','RWB']},{code:'MID',allowedPositions:['MID','CM','CDM','CAM','LM','RM','AM']},{code:'FWD',allowedPositions:['FWD','ST','CF','LW','RW','SS']}],
}
export const DRAFT_POINTS_SPORTS=['NFL','NCAAF','NBA','NCAAB','MLB','NHL','SOCCER'] as const
export function draftSlotEligibility(sport:string,positions:string[]=[]):SlotEligibility|null {
 if(!DRAFT_POINTS_SPORTS.some(s=>s===sport))return null
 const slots=sport==='NFL'||sport==='NCAAF'?null:(DRAFT_SLOTS[sport]??null)
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

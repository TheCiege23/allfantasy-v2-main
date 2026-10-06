import {scoreDraftRates} from './sportEvidence';
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export type CollegeValueReport={state:'ready'|'partial'|'unavailable';scale:string;pool:number;priced:number;players:Array<{playerId:string;name:string;position:string;value:number|null;rank:number|null;collegePoints:number|null;scoringGaps:string[];missing:string[]}>};
/** Saved option estimates and college points use separate units; unknown values never become zero. */
export function collegeValues(specialty:unknown,start:string|null):CollegeValueReport{
 const s=obj(specialty),c=obj(s.college),at=Date.parse(String(s.capturedAt)),end=Date.parse(start??'');
 const base:CollegeValueReport={state:'unavailable',scale:'fantasycalc-dynasty-superflex-12',pool:0,priced:0,players:[]};
 if(s.version!=='draft-specialty-v1'||c.state!=='captured'||c.valuationVersion!=='college-draft-values-v1'||!Number.isFinite(at)||!Number.isFinite(end)||at>end||!Array.isArray(c.valuations)||!c.valuations.length||c.valuations.length>5000)return base;
 const seen=new Set<string>(),aliases=new Map<string,string>(),ambiguous=new Set<string>();
 for(const raw of c.valuations){const v=obj(raw);if(typeof v.playerId!=='string'||!v.playerId||seen.has(v.playerId))return base;seen.add(v.playerId);
  for(const alias of [v.playerId,v.cfbdId,v.sleeperId])if(typeof alias==='string'&&alias){if(aliases.has(alias)&&aliases.get(alias)!==v.playerId)ambiguous.add(alias);else aliases.set(alias,v.playerId);}}
 const savedRules=obj(obj(c.collegeScoring).rules),rules:Record<string,unknown>={},ruleAliases:Record<string,string>={ppr:'rec',passingTouchdown:'pass_td',receivingTouchdown:'rec_td',rushingTouchdown:'rush_td'};
 let conflictingRules=false;for(const [key,value] of Object.entries(savedRules)){const canonical=ruleAliases[key]??key;if(canonical in rules&&rules[canonical]!==value)conflictingRules=true;rules[canonical]=value;}
 const basis=obj(c.collegeBasis),rates=new Map<string,Record<string,unknown>>(),duplicate=new Set<string>();
 if(basis.version==='draft-analysis-basis-v2'&&basis.sport==='NCAAF'&&basis.state==='captured'&&Date.parse(String(basis.capturedAt))<=end&&Array.isArray(basis.entries)&&basis.entries.length<=5000)
  for(const raw of basis.entries){const e=obj(raw),id=typeof e.playerId==='string'&&!ambiguous.has(e.playerId)?aliases.get(e.playerId):undefined;
   if(!id||!Number.isFinite(Date.parse(String(e.computedAt)))||Date.parse(String(e.computedAt))>end)continue;
   if(rates.has(id))duplicate.add(id);else rates.set(id,obj(e.perGameRates));}
 const players=c.valuations.map(raw=>{const v=obj(raw),o=obj(v.option),dated=Number.isFinite(Date.parse(String(v.computedAt)))&&Date.parse(String(v.computedAt))<=end;
  const value=dated&&o.scale===base.scale&&typeof o.value==='number'&&Number.isFinite(o.value)&&o.value>=0?o.value:null;
  const points=!conflictingRules&&!duplicate.has(String(v.playerId))&&rates.has(String(v.playerId))?scoreDraftRates(rates.get(String(v.playerId))!,rules,'NCAAF'):null;
  return {playerId:String(v.playerId),name:typeof v.name==='string'?v.name:String(v.playerId),position:typeof v.position==='string'?v.position:'Unknown',value,rank:null as number|null,collegePoints:points?.coverage.unmatched.length===0?points.points:null,scoringGaps:points?.coverage.unmatched??[],missing:Array.isArray(o.missing)?o.missing.filter((m):m is string=>typeof m==='string'):['Saved draft-day option estimate unavailable']};});
 for(const p of players)if(p.value!==null)p.rank=1+players.filter(other=>other.value!==null&&other.value>p.value!).length;
 const priced=players.filter(p=>p.value!==null).length;
 return {...base,state:priced===players.length?'ready':'partial',pool:players.length,priced,players};
}

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=64;
const money=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export type SalaryHistoryTeam={rosterId:string;capYear:number;capSpace:number;totalCapHit:number;deadMoneyHit:number;contracts:number;expiring:number;recordedSalary:number;matchesLedger:boolean};
export type SalaryHistory={state:'ready'|'partial'|'unavailable';teams:SalaryHistoryTeam[]};
/** Read only frozen terms. Never infer historical contracts from current records or pick prices. */
export function salaryHistory(specialty:unknown,start:string|null,season:number|null):SalaryHistory{
 const b=object(specialty),s=object(b.salary),unavailable:SalaryHistory={state:'unavailable',teams:[]};
 const at=typeof b.capturedAt==='string'?Date.parse(b.capturedAt):NaN,started=start?Date.parse(start):NaN;
 if(typeof season!=='number'||b.version!=='draft-specialty-v1'||s.state!=='captured'||!Number.isFinite(at)||!Number.isFinite(started)||at>started||(!Number.isInteger(season)||season<1900||season>2200)||!Array.isArray(s.ledgers)||!s.ledgers.length||s.ledgers.length>32||!Array.isArray(s.contracts)||s.contracts.length>1000)return unavailable;
 const teams:SalaryHistoryTeam[]=[],seen=new Set<string>(),players=new Set<string>();
 for(const raw of s.ledgers){const l=object(raw);
  if(!id(l.rosterId)||seen.has(l.rosterId)||l.capYear!==season||typeof l.capSpace!=='number'||!Number.isSafeInteger(l.capSpace)||!money(l.totalCapHit)||!money(l.deadMoneyHit))return unavailable;
  seen.add(l.rosterId);teams.push({rosterId:l.rosterId,capYear:season,capSpace:l.capSpace,totalCapHit:l.totalCapHit,deadMoneyHit:l.deadMoneyHit,contracts:0,expiring:0,recordedSalary:0,matchesLedger:false});
 }
 for(const raw of s.contracts){const c=object(raw);
  if(!id(c.rosterId)||!seen.has(c.rosterId)||!id(c.playerId)||players.has(c.playerId)||!money(c.salary)||!Number.isInteger(c.yearsTotal)||Number(c.yearsTotal)<1||Number(c.yearsTotal)>100||!Number.isInteger(c.contractYear)||Number(c.contractYear)<1||Number(c.contractYear)>Number(c.yearsTotal)||(!Number.isInteger(c.yearSigned)||Number(c.yearSigned)<1900||Number(c.yearSigned)>2200))return unavailable;
  players.add(c.playerId);
  const end=Number(c.yearSigned)+Number(c.yearsTotal)-1;
  // Cap calculation uses the calendar term, not a mutable contractYear counter.
  if(Number(c.yearSigned)>season||end<season)continue;
  const team=teams.find(t=>t.rosterId===c.rosterId)!;
  team.contracts++;team.expiring+=end===season?1:0;team.recordedSalary+=c.salary;
  if(!Number.isSafeInteger(team.recordedSalary))return unavailable;
 }
 teams.forEach(t=>{t.matchesLedger=t.recordedSalary===t.totalCapHit;});
 return{state:teams.every(t=>t.matchesLedger)?'ready':'partial',teams};
}

import {salaryHistory} from './salaryHistoryModel';
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const integer=(v:unknown,min=0,max=1000000):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
export type CapYear={year:number;cap:number;committed:number;deadMoney:number;space:number};
export type SalaryScenarioData={state:'ready'|'unavailable';capYear:number|null;minimumSalary:number;minYears:number;maxYears:number;holdback:number;teams:Array<{rosterId:string;years:CapYear[]}>};
/** Ten-year fixed-contract baseline; future rollover, acquisitions and extensions are not assumed. */
export function salaryScenarioData(specialty:unknown,start:string|null,season:number|null):SalaryScenarioData{
 const unavailable:SalaryScenarioData={state:'unavailable',capYear:season,minimumSalary:0,minYears:1,maxYears:1,holdback:0,teams:[]};
 const s=obj(obj(specialty).salary),r=obj(s.rules),history=salaryHistory(specialty,start,season);
 if(history.state!=='ready'||season===null||r.version!=='salary-draft-rules-v1'||!integer(r.startupCap,1)||!integer(r.capStartYear,1900,2200)||typeof r.capGrowthPercent!=='number'||!Number.isFinite(r.capGrowthPercent)||r.capGrowthPercent<0||r.capGrowthPercent>100||!integer(r.contractMinYears,1,10)||!integer(r.contractMaxYears,1,10)||r.contractMinYears>r.contractMaxYears||!integer(r.minimumSalary)||!integer(r.auctionHoldback)||typeof r.rolloverEnabled!=='boolean'||!integer(r.rolloverMax)||!Array.isArray(s.deadMoney)||s.deadMoney.length>1000)return unavailable;
 const seen=new Set<string>(),dead=new Map<string,Record<string,number>>();
 for(const raw of s.deadMoney){const d=obj(raw),charges=obj(d.charges);
  if(!d.charges||typeof d.charges!=='object'||Array.isArray(d.charges)||typeof d.id!=='string'||!d.id||seen.has(d.id)||typeof d.rosterId!=='string'||!history.teams.some(t=>t.rosterId===d.rosterId)||Object.keys(charges).length>100)return unavailable;
  seen.add(d.id);const totals=dead.get(d.rosterId)??{};
  for(const [year,value]of Object.entries(charges)){if(!/^[0-9]{4}$/.test(year)||!integer(value))return unavailable;totals[year]=(totals[year]??0)+value;if(!Number.isSafeInteger(totals[year]))return unavailable;}
  dead.set(d.rosterId,totals);
 }
 const ledgers=(s.ledgers as unknown[]).map(obj),contracts=(s.contracts as unknown[]).map(obj),teams:SalaryScenarioData['teams']=[];
 for(const team of history.teams){const l=ledgers.find(l=>l.rosterId===team.rosterId)!;
  if(!integer(l.rolloverUsed)||l.rolloverUsed>r.rolloverMax||(!r.rolloverEnabled&&l.rolloverUsed!==0))return unavailable;
  const years:CapYear[]=[];
  for(let i=0;i<10;i++){const year=season+i,cap=Math.floor(r.startupCap*Math.pow(1+r.capGrowthPercent/100,Math.max(0,year-r.capStartYear)))+(i===0?l.rolloverUsed:0);
   const committed=contracts.filter(c=>c.rosterId===team.rosterId&&Number(c.yearSigned)<=year&&Number(c.yearSigned)+Number(c.yearsTotal)>year).reduce((sum,c)=>sum+Number(c.salary),0),deadMoney=dead.get(team.rosterId)?.[String(year)]??0;
   if(!Number.isSafeInteger(cap)||!Number.isSafeInteger(committed)||!Number.isSafeInteger(deadMoney)||cap>1e12)return unavailable;
   const space=cap-committed-deadMoney;if(i===0&&(space!==team.capSpace||deadMoney!==team.deadMoneyHit))return unavailable;
   years.push({year,cap,committed,deadMoney,space});
  }
  teams.push({rosterId:team.rosterId,years});
 }
 return{state:'ready',capYear:season,minimumSalary:r.minimumSalary,minYears:r.contractMinYears,maxYears:r.contractMaxYears,holdback:r.auctionHoldback,teams};
}
export function salaryScenario(data:SalaryScenarioData,rosterId:string,salary:number,years:number){
 const team=data.teams.find(t=>t.rosterId===rosterId);
 if(data.state!=='ready'||!team||!integer(salary,data.minimumSalary)||!integer(years,data.minYears,data.maxYears))return null;
 const schedule=team.years.map((row,i)=>({...row,assumedSalary:i<years?salary:0,spaceAfter:row.space-(i<years?salary:0)}));
 return{salary,years,nominalCommitment:salary*years,fitsStartHoldback:schedule[0].spaceAfter>=data.holdback,fitsAllRecordedCaps:schedule.every(r=>r.spaceAfter>=0),schedule};
}

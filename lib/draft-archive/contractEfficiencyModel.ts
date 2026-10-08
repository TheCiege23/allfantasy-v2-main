import type {PreparationContext} from '@/lib/core-app/draftPreparationModel';
import {frozenUniverse} from './phase4Model';
import {salaryScenarioData} from './salaryScenarioModel';

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
export type ContractEfficiencyReport={
  state:'ready'|'partial'|'unavailable';
  capturedAt:string|null;
  players:Array<{rosterId:string;playerId:string;name:string;position:string;salary:number;remainingYears:number;remainingCommitment:number;capShare:number;baselinePerGame:number|null;baselinePerTenSalary:number|null}>;
};
/** Descriptive efficiency of contracts already frozen at draft start; no multi-year forecast or grade. */
export function contractEfficiency(specialty:unknown,basis:unknown,context:PreparationContext|null,start:string|null,season:number|null):ContractEfficiencyReport{
  const caps=salaryScenarioData(specialty,start,season),raw=object(specialty),salary=object(raw.salary);
  const unavailable:ContractEfficiencyReport={state:'unavailable',capturedAt:null,players:[]};
  if(caps.state!=='ready'||!context||context.season!==season||season===null)return unavailable;
  const pool=frozenUniverse(basis,context,start),aliases=new Map(pool.flatMap(p=>p.aliases.map(a=>[a,p] as const)));
  const players:ContractEfficiencyReport['players']=[];
  for(const value of salary.contracts as unknown[]){
    const contract=object(value),end=Number(contract.yearSigned)+Number(contract.yearsTotal)-1;
    if(Number(contract.yearSigned)>season||end<season)continue;
    const rosterId=String(contract.rosterId),playerId=String(contract.playerId),amount=Number(contract.salary);
    const cap=caps.teams.find(t=>t.rosterId===rosterId)!.years[0].cap,remainingYears=end-season+1;
    const player=aliases.get(playerId),baseline=player?.projectedPoints;
    const baselinePerGame=typeof baseline==='number'&&Number.isFinite(baseline)?baseline:null;
    players.push({rosterId,playerId,name:player?.name??playerId,position:player?.position??'Unknown',salary:amount,remainingYears,remainingCommitment:amount*remainingYears,capShare:amount/cap*100,baselinePerGame,baselinePerTenSalary:amount>0&&baselinePerGame!==null?baselinePerGame*10/amount:null});
  }
  if(players.some(p=>!Number.isSafeInteger(p.remainingCommitment)||!Number.isFinite(p.capShare)||p.baselinePerTenSalary!==null&&!Number.isFinite(p.baselinePerTenSalary)))return unavailable;
  return{state:players.every(p=>p.baselinePerGame!==null&&p.salary>0)?'ready':'partial',capturedAt:typeof raw.capturedAt==='string'?raw.capturedAt:null,players};
}

import {devyOptionValue} from '@/lib/devy/devyOptionValue'
import {captureDraftAnalysisBasis} from './analysisBasis'
import type {Prisma} from '@prisma/client'
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Preserve specialist rules and identity facts before selections; never backfill from today's state. */
export async function captureSpecialtyBasis(tx:Prisma.TransactionClient,league:{leagueVariant?:string|null;season:number|null;settings?:unknown}|null,session:{leagueId:string;devyConfig?:unknown;c2cConfig?:unknown;dispersalPoolConfig?:unknown;draftModeLabel?:string|null},at:Date){
 const base={version:'draft-specialty-v1',capturedAt:at.toISOString()}
 const devy=obj(session.devyConfig),c2c=obj(session.c2cConfig),dispersal=obj(session.dispersalPoolConfig)
 const rounds=(raw:unknown)=>Array.isArray(raw)&&raw.length<=100&&raw.every(r=>Number.isInteger(r)&&r>=1&&r<=100)&&new Set(raw).size===raw.length?raw as number[]:null
 let college:unknown=null,salary:unknown=null
 if(devy.enabled===true||c2c.enabled===true){
  const declared=rounds(c2c.enabled===true?c2c.collegeRounds:devy.devyRounds)
  const players=await tx.devyPlayer.findMany({where:{devyEligible:true},take:5001,select:{id:true,cfbdId:true,sleeperId:true,position:true,graduatedToNFL:true,name:true,recruitingStars:true,recruitingComposite:true,ppaSeasonTotal:true,statSeason:true,draftEligibleYear:true,updatedAt:true}})
  const contemporary=at.getTime()<=Date.now()&&Date.now()-at.getTime()<=300000;
  const collegeScoring=obj(obj(league?.settings).collegeScoringSettings);
  const collegeBasis=c2c.enabled===true&&league?.season&&contemporary?await captureDraftAnalysisBasis(tx,{sport:'NCAAF',season:league.season},at):null;
  const valuations=players.length<=5000&&league?.season&&contemporary?players.map(p=>{const dated=p.updatedAt instanceof Date&&p.updatedAt<=at;const option=dated&&!p.graduatedToNFL?devyOptionValue({position:p.position,recruitingStars:p.recruitingStars,recruitingComposite:p.recruitingComposite,ppaSeasonTotal:Number.isInteger(p.statSeason)&&Number(p.statSeason)>=1900&&Number(p.statSeason)<=league.season!?p.ppaSeasonTotal:null,draftEligibleYear:p.draftEligibleYear,currentSeason:league.season!}):null;return{playerId:p.id,name:p.name,position:p.position,cfbdId:p.cfbdId,sleeperId:p.sleeperId,computedAt:dated?p.updatedAt.toISOString():null,option};}):[];
  college=declared&&players.length<=5000?{state:'captured',mode:c2c.enabled===true?'c2c':'devy',rounds:declared,valuationVersion:'college-draft-values-v1',valuations,collegeBasis,collegeScoring,players:players.map(p=>({playerId:p.id,cfbdId:p.cfbdId,sleeperId:p.sleeperId,position:p.position,graduated:p.graduatedToNFL}))}:{state:'unavailable'}
 }
 if(league?.leagueVariant==='salary_cap'&&league.season){
  const [ledgers,contracts,config,cuts]=await Promise.all([
   tx.salaryCapTeamLedger.findMany({where:{leagueId:session.leagueId,capYear:league.season},take:33,select:{rosterId:true,capSpace:true,totalCapHit:true,deadMoneyHit:true,capYear:true,rolloverUsed:true}}),
   tx.playerContract.findMany({where:{leagueId:session.leagueId,status:{in:['active','tagged','option_exercised']}},take:1001,select:{rosterId:true,playerId:true,salary:true,yearsTotal:true,contractYear:true,yearSigned:true}}),
   tx.salaryCapLeagueConfig.findUnique({where:{leagueId:session.leagueId},select:{startupCap:true,capGrowthPercent:true,contractMinYears:true,contractMaxYears:true,minimumSalary:true,auctionHoldback:true,rolloverEnabled:true,rolloverMax:true,createdAt:true}}),
   tx.playerContract.findMany({where:{leagueId:session.leagueId,status:'cut'},take:1001,select:{id:true,rosterId:true,deadMoneyRemaining:true}}),
  ])
  const declaredYear=obj(league.settings).capStartYear;
  const rules=config?{version:'salary-draft-rules-v1',...config,createdAt:undefined,capStartYear:Number.isInteger(declaredYear)?declaredYear:config.createdAt instanceof Date?config.createdAt.getUTCFullYear():null}:null;
  salary=ledgers.length<=32&&contracts.length<=1000&&cuts.length<=1000?{state:'captured',ledgers,contracts,rules,deadMoney:cuts.map(c=>({id:c.id,rosterId:c.rosterId,charges:c.deadMoneyRemaining}))}:{state:'unavailable'}
 }
 return{...base,college,salary,dispersal:session.draftModeLabel==='dispersal'||Object.keys(dispersal).length?dispersal:null}
}

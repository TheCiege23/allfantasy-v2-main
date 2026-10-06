import type {Prisma} from '@prisma/client'
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Preserve specialist rules and identity facts before selections; never backfill from today's state. */
export async function captureSpecialtyBasis(tx:Prisma.TransactionClient,league:{leagueVariant?:string|null;season:number|null}|null,session:{leagueId:string;devyConfig?:unknown;c2cConfig?:unknown;dispersalPoolConfig?:unknown;draftModeLabel?:string|null},at:Date){
 const base={version:'draft-specialty-v1',capturedAt:at.toISOString()}
 const devy=obj(session.devyConfig),c2c=obj(session.c2cConfig),dispersal=obj(session.dispersalPoolConfig)
 const rounds=(raw:unknown)=>Array.isArray(raw)&&raw.length<=100&&raw.every(r=>Number.isInteger(r)&&r>=1&&r<=100)&&new Set(raw).size===raw.length?raw as number[]:null
 let college:unknown=null,salary:unknown=null
 if(devy.enabled===true||c2c.enabled===true){
  const declared=rounds(c2c.enabled===true?c2c.collegeRounds:devy.devyRounds)
  const players=await tx.devyPlayer.findMany({where:{devyEligible:true},take:5001,select:{id:true,cfbdId:true,sleeperId:true,position:true,graduatedToNFL:true}})
  college=declared&&players.length<=5000?{state:'captured',mode:c2c.enabled===true?'c2c':'devy',rounds:declared,players:players.map(p=>({playerId:p.id,cfbdId:p.cfbdId,sleeperId:p.sleeperId,position:p.position,graduated:p.graduatedToNFL}))}:{state:'unavailable'}
 }
 if(league?.leagueVariant==='salary_cap'&&league.season){
  const [ledgers,contracts]=await Promise.all([
   tx.salaryCapTeamLedger.findMany({where:{leagueId:session.leagueId,capYear:league.season},take:33,select:{rosterId:true,capSpace:true,totalCapHit:true,deadMoneyHit:true,capYear:true}}),
   tx.playerContract.findMany({where:{leagueId:session.leagueId,status:'active'},take:1001,select:{rosterId:true,playerId:true,salary:true,yearsTotal:true,contractYear:true,yearSigned:true}}),
  ])
  salary=ledgers.length<=32&&contracts.length<=1000?{state:'captured',ledgers,contracts}:{state:'unavailable'}
 }
 return{...base,college,salary,dispersal:session.draftModeLabel==='dispersal'||Object.keys(dispersal).length?dispersal:null}
}

import {Prisma} from '@prisma/client'
import {prisma} from '@/lib/prisma'
import {requireCommissionerRole} from '@/lib/league/permissions'
import {jsonRecord} from '@/lib/survivor-guillotine/commissionerUtils'
import {buildSGSchedule} from './config'
import type {SGConfig} from './types'
import {sgDecision,SG_COMMISSIONER_KEY,SG_RUNTIME_KEY,type SGAutomationAction} from './commissionerRules'
/** No controls means legacy behavior; explicit invalid or old-season controls fail closed. */
export async function sgAutomationAllowed(leagueId:string,action:SGAutomationAction,options:{now?:Date;ceremonyAt?:string|null;config?:SGConfig;period?:number}={}){
 const league=await prisma.league.findUnique({where:{id:leagueId}})
 if(!league)return false
 const decision=sgDecision(league.settings,league.season,action,league.emergencyPaused)
 if(!decision.allowed)return false
 if(!decision.managed)return true
 const actor=jsonRecord(league.settings).survivorGuillotineCommissionerActor
 try{if(typeof actor!=='string')return false;await requireCommissionerRole(leagueId,actor,'league')}catch{return false}
 const advanced=decision.rules!.advanced
 if(!advanced)return true
 if(action==='chops'&&options.ceremonyAt&&Date.parse(options.ceremonyAt)+advanced.ceremonyDelayMinutes*60000>(options.now??new Date()).getTime())return false
 if(action==='advance'&&advanced.reviewPhaseChanges&&options.config&&options.period){
  const schedule=buildSGSchedule(options.config).periods,current=schedule.find(p=>p.period===options.period),next=schedule.find(p=>p.period===options.period!+1)
  const phase=(mode:string)=>['match_play','tribe_champion'].includes(mode)?'tribal':mode
  if(current&&next&&phase(current.mode)!==phase(next.mode))return false
 }
 return true
}
/** Generic receipts only: hidden powers, bids, winners and reward dates never enter the Hub. */
export async function recordSGAutomation(leagueId:string,action:SGAutomationAction,state:'completed'|'held'){
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT id FROM leagues WHERE id=${leagueId} FOR UPDATE`
  const league=await tx.league.findUniqueOrThrow({where:{id:leagueId}}),settings=jsonRecord(league.settings)
  if(settings[SG_COMMISSIONER_KEY]==null||!sgDecision(settings,league.season,action,league.emergencyPaused).allowed)return
  const status=state==='completed'?'Scheduled action checked.':'Action needs commissioner review or complete evidence.'
  const prior=jsonRecord(settings[SG_RUNTIME_KEY]);if(prior.action===action&&prior.state===state)return
  await tx.league.update({where:{id:leagueId},data:{settings:{...settings,[SG_RUNTIME_KEY]:{action,state,status,updatedAt:new Date().toISOString()}} as Prisma.InputJsonValue}})
  await tx.leagueAuditLog.create({data:{leagueId,userId:null,actionType:'survivor_guillotine_automation',entityType:'survivor_guillotine_controls',metadata:{action,state}}})
 })
}

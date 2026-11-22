import {Prisma} from '@prisma/client'
import {prisma} from '@/lib/prisma'
import {requireCommissionerRole} from '@/lib/league/permissions'
import {isNativePlatform} from '@/lib/league/isNativeLeague'
import {EntitlementResolver} from '@/lib/subscription/EntitlementResolver'
import {RedraftControlsError} from '@/lib/survivor-guillotine/commissionerUtils'
import {jsonRecord} from '@/lib/survivor-guillotine/commissionerUtils'
import {SG_COMMISSIONER_KEY,SG_RUNTIME_KEY,sgCommissionerSchema} from './commissionerRules'
async function context(leagueId:string,userId:string){
 await requireCommissionerRole(leagueId,userId,'league')
 const league=await prisma.league.findUniqueOrThrow({where:{id:leagueId}})
 if(!isNativePlatform(league.platform)||![league.leagueType,league.leagueVariant].includes('survivor_guillotine'))throw new RedraftControlsError('Native Survivor Guillotine leagues only.',422)
 const isPremium=(await new EntitlementResolver().resolveForUser(league.userId,'commissioner_automation').catch(()=>({hasAccess:false}))).hasAccess
 return {league,isPremium}
}
export async function loadSGCommissioner(leagueId:string,userId:string){
 const {league,isPremium}=await context(leagueId,userId),settings=jsonRecord(league.settings),raw=settings[SG_COMMISSIONER_KEY],parsed=sgCommissionerSchema.safeParse(raw)
 const season=await prisma.survivorGuillotineLeague.findUnique({where:{leagueId},select:{config:true,currentPeriod:true,status:true}})
 return {currentSeason:league.season,isPremium,revision:league.updatedAt.toISOString(),activated:raw!=null,error:raw!=null&&!parsed.success?'Saved controls need repair. Save a new configuration.':null,rules:parsed.success?parsed.data:{version:1 as const,season:league.season??new Date().getUTCFullYear(),paused:false,legacy:true,advanced:null},runtime:settings[SG_RUNTIME_KEY]??null,season,emergencyPaused:league.emergencyPaused}
}
export async function saveSGCommissioner(leagueId:string,userId:string,body:Record<string,unknown>){
 const {league,isPremium}=await context(leagueId,userId),parsed=sgCommissionerSchema.safeParse(body.rules)
 if(!parsed.success)throw new RedraftControlsError('Invalid Survivor Guillotine controls.')
 const next=parsed.data,old=sgCommissionerSchema.safeParse(jsonRecord(league.settings)[SG_COMMISSIONER_KEY])
 if(next.legacy&&old.success&&!old.data.legacy)throw new RedraftControlsError('Legacy behavior cannot replace an explicitly configured policy. Disable automation or configure advanced controls.',409)
 if(next.season!==league.season)throw new RedraftControlsError('Choose the current league season.',409)
 if(next.advanced&&(!old.success||old.data.season!==next.season||JSON.stringify(old.data.advanced)!==JSON.stringify(next.advanced))&&!isPremium)throw new RedraftControlsError('Enabling or changing advanced automation requires the owner’s Commissioner subscription.',403)
 await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SELECT id FROM leagues WHERE id=${leagueId} FOR UPDATE`
  const current=await tx.league.findUniqueOrThrow({where:{id:leagueId}})
  if(current.updatedAt.toISOString()!==body.revision||current.updatedAt.getTime()!==league.updatedAt.getTime())throw new RedraftControlsError('Settings changed. Reload before saving.',409)
  const settings={...jsonRecord(current.settings),[SG_COMMISSIONER_KEY]:next,survivorGuillotineCommissionerActor:userId,[SG_RUNTIME_KEY]:{state:next.paused?'paused':next.advanced||next.legacy?'configured':'manual',status:next.paused?'Automation paused.':next.advanced||next.legacy?'Saved; waiting for the next due action.':'Automation disabled; manual controls remain available.',updatedAt:new Date().toISOString()}}
  await tx.league.update({where:{id:leagueId},data:{settings:settings as Prisma.InputJsonValue}})
  await tx.leagueAuditLog.create({data:{leagueId,userId,actionType:'survivor_guillotine_commissioner_rules',entityType:'survivor_guillotine_controls',entityId:String(next.season),afterState:next as Prisma.InputJsonValue}})
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable})
 return loadSGCommissioner(leagueId,userId)
}

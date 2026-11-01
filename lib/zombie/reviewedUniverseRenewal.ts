import { z } from 'zod'
import { planUniverseMovement, type MovementLevel, type MovementPolicy } from './universeMovementPlan'
import { renewalFingerprint, type RenewalManager, type RenewalPool } from './universeRenewalPlan'

const key=z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
export const universeRenewalProposalSchema=z.object({
  version:z.literal(1), reason:z.string().trim().min(10).max(1000),
  replaceRecordedMovement:z.boolean(),
  pools:z.array(z.object({key,templateLeagueId:key,levelId:key,name:z.string().trim().min(1).max(80),
    seats:z.number().int().refine(n=>[8,10,12,14,16].includes(n))}).strict()).min(1).max(24),
  placements:z.array(z.object({userId:z.string().min(1).max(128),poolId:key}).strict()).min(1).max(384),
}).strict()
export type UniverseRenewalProposal=z.infer<typeof universeRenewalProposalSchema>
export type ReviewedRenewalPool=RenewalPool & {templateLeagueId?:string}
export function parseUniverseRenewalProposal(value:unknown): UniverseRenewalProposal {
  const parsed=universeRenewalProposalSchema.safeParse(value)
  if(!parsed.success) throw new Error('RENEWAL_PROPOSAL_INVALID')
  return parsed.data
}
/** No returning manager can disappear; new capacity is explicitly open, never a fake manager. */
export function planReviewedUniverseRenewal(managers:RenewalManager[],levels:Array<MovementLevel & {maxLeagues?:number}>,policy:MovementPolicy,
  sources:RenewalPool[],raw:unknown,seed:string) {
  const proposal=parseUniverseRenewalProposal(raw)
  if(!managers.length||new Set(managers.map(m=>m.userId)).size!==managers.length||new Set(managers.map(m=>m.rosterId)).size!==managers.length)
    throw new Error('RENEWAL_MEMBERSHIP_AMBIGUOUS')
  if(new Set(proposal.pools.map(p=>p.key)).size!==proposal.pools.length) throw new Error('RENEWAL_POOL_INVALID')
  if(proposal.pools.some(p=>!levels.some(l=>l.id===p.levelId)||!sources.some(s=>s.leagueId===p.templateLeagueId))) throw new Error('RENEWAL_POOL_INVALID')
  for(const level of levels) if(proposal.pools.filter(p=>p.levelId===level.id).length>(level.maxLeagues??24)) throw new Error('RENEWAL_LEVEL_CAPACITY_EXCEEDED')
  if(proposal.placements.length!==managers.length||new Set(proposal.placements.map(p=>p.userId)).size!==managers.length||
    proposal.placements.some(p=>!managers.some(m=>m.userId===p.userId)||!proposal.pools.some(pool=>pool.key===p.poolId)))
    throw new Error('RENEWAL_PLACEMENT_INCOMPLETE')
  const baseline=planUniverseMovement(managers,levels,policy)
  const pools:ReviewedRenewalPool[]=proposal.pools.map((p,i)=>({leagueId:p.key,templateLeagueId:p.templateLeagueId,
    levelId:p.levelId,name:p.name,seats:p.seats,orderInLevel:i}))
  const assignments:Array<RenewalManager & {destinationLeagueId:string;destinationLevelId:string;slot:number;movement:string}>=[]
  for(const pool of pools){
    const occupants=proposal.placements.filter(p=>p.poolId===pool.leagueId)
    if(occupants.length>pool.seats) throw new Error('RENEWAL_POOL_OVERFILLED')
    occupants.sort((a,b)=>renewalFingerprint([seed,pool.leagueId,a.userId]).localeCompare(renewalFingerprint([seed,pool.leagueId,b.userId])))
    for(const [i,p] of occupants.entries()){
      const manager=managers.find(m=>m.userId===p.userId)!,from=levels.find(l=>l.id===manager.levelId)!,to=levels.find(l=>l.id===pool.levelId)!
      assignments.push({...manager,destinationLeagueId:pool.leagueId,destinationLevelId:pool.levelId,slot:i+1,
        movement:to.rankOrder>from.rankOrder?'promotion':to.rankOrder<from.rankOrder?'relegation':'watch'})
    }
  }
  const movement=baseline.map(row=>{
    const assignment=assignments.find(a=>a.rosterId===row.rosterId)!,level=levels.find(l=>l.id===assignment.destinationLevelId)!
    return {...row,projectedLevelId:level.id,toTierLabel:level.tierLabel??level.name,reason:assignment.movement}
  })
  const openSeats=pools.reduce((n,p)=>n+p.seats,0)-assignments.length
  return {pools,assignments,movement,proposal,openSeats}
}

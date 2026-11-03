import type { PrismaClient } from '@prisma/client'

export function needsRegisteredZombieRenewalSeats(settings:unknown) {
  if(!settings||typeof settings!=='object'||Array.isArray(settings)) return false
  const renewal=(settings as Record<string,unknown>).zombie_renewal
  return Boolean(renewal&&typeof renewal==='object'&&!Array.isArray(renewal)&&(renewal as Record<string,unknown>).requiresRegisteredSeats===true)
}
/** Expanded renewals must fill real seats before either manual or scheduled draft starts. */
export async function zombieRenewalDraftReadiness(db:Pick<PrismaClient,'roster'|'appUser'>,leagueId:string,capacity:number,settings:unknown) {
  if(!needsRegisteredZombieRenewalSeats(settings)) return {ready:true}
  const rosters=await db.roster.findMany({where:{leagueId},select:{platformUserId:true}})
  const users=await db.appUser.findMany({where:{id:{in:rosters.map(r=>r.platformUserId)}},select:{id:true}})
  const ids=new Set(users.map(u=>u.id)), owners=rosters.map(r=>r.platformUserId)
  const registered=new Set(owners.filter(id=>ids.has(id))).size
  return {ready:rosters.length===capacity&&registered===capacity,
    error:'Fill every expansion seat with a distinct registered manager before starting the draft ('+registered+'/'+capacity+').'}
}

import 'server-only'
import { prisma } from '@/lib/prisma'
import { TRADE_GRADES_CACHE_PREFIX } from '@/lib/trade-intel/sleeperTradeGradeService'
import { realizedReceipt } from './realizedReceipt'
/** Caller must first authorize the completed trade and resolve the participant's provider identity. */
export async function loadRealizedReceipt(args:{leagueId:string;transactionId:string;ownerId:string}) {
  const row=await prisma.sportsDataCache.findUnique({where:{cacheKey:`${TRADE_GRADES_CACHE_PREFIX}${args.leagueId}`},select:{data:true,expiresAt:true}})
  return row?realizedReceipt(row.data,{...args,expiresAt:row.expiresAt,now:new Date()}):null
}

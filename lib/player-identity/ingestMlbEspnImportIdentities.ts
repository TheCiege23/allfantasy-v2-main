import { prisma } from '@/lib/prisma'
import { planMlbEspnIdentityLinks } from './mlbEspnIdentityPlan'
/** Authorized import boundary only; uses the captured roster, without another provider read. */
export async function ingestMlbEspnImportIdentities(playerMap: Record<string,{name:string;position:string;team:string}>, dryRun=false) {
  const rows=await prisma.playerIdentityMap.findMany({where:{sport:'MLB'},select:{id:true,canonicalName:true,currentTeam:true,position:true,espnId:true,rollingInsightsId:true}})
  const {links,...coverage}=planMlbEspnIdentityLinks(Object.entries(playerMap).map(([id,p])=>({id,...p})),rows)
  const updated=dryRun || !links.length ? 0 : await prisma.$executeRaw`
    WITH links AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(links)}::jsonb) AS l(id text, "espnId" text, "rollingInsightsId" text))
    UPDATE "PlayerIdentityMap" p SET "espnId"=l."espnId", "updatedAt"=NOW(), "lastSyncedAt"=NOW()
    FROM links l WHERE p.id=l.id AND p.sport='MLB' AND p."espnId" IS NULL AND p."rollingInsightsId"=l."rollingInsightsId"
    AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" other WHERE other.sport='MLB' AND other."espnId"=l."espnId")
  `
  return {...coverage,proposed:links.length,updated,dryRun}
}

import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'

export type RiGameWrite = {
  playerId:string; sportType:string; gameId:string; providerPlayerId:string; providerGameId:string;
  season:number; weekOrRound:number; statPayload:Prisma.InputJsonValue; normalizedStatMap:Prisma.InputJsonValue;
  source:string; confidence:number; team:string|null; opponent:string|null; gameDate:Date|null; fetchedAt:Date;
}

/** One game, inside the caller's transaction/advisory lock. Preserve scoring columns on
 * replay; only the existing RI writer's provider fields are replaced. Last duplicate wins,
 * matching sequential upserts, without PostgreSQL's double-conflict error. */
export async function writeRiGameRows(tx:Pick<Prisma.TransactionClient,'$executeRaw'>,input:RiGameWrite[]) {
  const unique=new Map(input.map(row=>[JSON.stringify([row.playerId,row.sportType,row.gameId]),row]))
  if(!unique.size)return 0
  const rows=[...unique.values()].map(row=>({...row,id:randomUUID(),updatedAt:row.fetchedAt}))
  const count=await tx.$executeRaw(Prisma.sql`
    INSERT INTO player_game_stats (id,"playerId","sportType","gameId",provider_player_id,provider_game_id,season,"weekOrRound",stat_payload,normalized_stat_map,source,confidence,team,opponent,game_date,fetched_at,"updatedAt")
    SELECT r.id,r."playerId",r."sportType",r."gameId",r."providerPlayerId",r."providerGameId",r.season,r."weekOrRound",r."statPayload",r."normalizedStatMap",r.source,r.confidence,r.team,r.opponent,r."gameDate"::date,r."fetchedAt",r."updatedAt"
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id text,"playerId" text,"sportType" text,"gameId" text,"providerPlayerId" text,"providerGameId" text,season int,"weekOrRound" int,"statPayload" jsonb,"normalizedStatMap" jsonb,source text,confidence double precision,team text,opponent text,"gameDate" timestamptz,"fetchedAt" timestamptz,"updatedAt" timestamptz)
    ON CONFLICT ("playerId","sportType","gameId") DO UPDATE SET
      provider_player_id=EXCLUDED.provider_player_id,provider_game_id=EXCLUDED.provider_game_id,
      season=EXCLUDED.season,"weekOrRound"=EXCLUDED."weekOrRound",stat_payload=EXCLUDED.stat_payload,
      normalized_stat_map=EXCLUDED.normalized_stat_map,source=EXCLUDED.source,confidence=EXCLUDED.confidence,
      team=EXCLUDED.team,opponent=EXCLUDED.opponent,game_date=EXCLUDED.game_date,fetched_at=EXCLUDED.fetched_at,"updatedAt"=EXCLUDED."updatedAt"
  `)
  if(count!==unique.size)throw Error('RI_GAME_BATCH_COUNT_MISMATCH')
  return count
}

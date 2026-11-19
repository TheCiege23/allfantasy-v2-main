import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadPlayerPools, lockPlayerPools } from './load'
import { poolOf, readPlayerPoolScope } from './policy'

type Asset = {assetType?: string; playerId?: string | null; fromRosterId?: string | null; toRosterId: string}
export async function checkPoolTransfers(leagueId: string, assets: readonly Asset[], seasonId?: string, tx?: Prisma.TransactionClient, storedSettings?: unknown): Promise<string | null> {
  const players = assets.filter(a => (!a.assetType || a.assetType === 'player') && a.playerId)
  if (!players.length) return null
  const db = tx ?? prisma
  const settings = storedSettings === undefined ? (await db.league.findUnique({where:{id:leagueId},select:{settings:true}}))?.settings : storedSettings
  if (readPlayerPoolScope(settings) === 'league') return null
  if (tx) await lockPlayerPools(tx,leagueId)
  const season = seasonId ?? (await db.redraftRoster.findFirstOrThrow({where:{id:players[0].toRosterId,leagueId},select:{seasonId:true}})).seasonId
  const pools = await loadPlayerPools(leagueId,{db, seasonId:season, ...(tx ? {} : {settings})})
  const held = await db.redraftRosterPlayer.findMany({where:{roster:{leagueId,seasonId:season},droppedAt:null,playerId:{in:players.map(a=>a.playerId!)}},select:{playerId:true,rosterId:true}})
  const outgoing = new Set(players.map(a=>JSON.stringify([a.fromRosterId,a.playerId])))
  const occupied = new Set(held.filter(h=>!outgoing.has(JSON.stringify([h.rosterId,h.playerId]))).map(h=>JSON.stringify([poolOf(pools,h.rosterId),h.playerId])))
  for (const a of players) {
    const key = JSON.stringify([poolOf(pools,a.toRosterId),a.playerId])
    if (occupied.has(key)) return 'This player is already owned in the receiving team’s player pool.'
    occupied.add(key)
  }
  return null
}


import type { Prisma } from '@prisma/client'
import { loadPlayerPools } from './load'
import { poolOf } from './policy'

export async function validateCurrentPoolOwnership(db: Prisma.TransactionClient, leagueId: string, settings: unknown) {
  const season = await db.redraftSeason.findFirst({where:{leagueId},orderBy:{season:'desc'},select:{id:true}})
  const pools = await loadPlayerPools(leagueId,{db,settings,seasonId:season?.id})
  const rows = season ? await db.redraftRosterPlayer.findMany({where:{roster:{seasonId:season.id},droppedAt:null},select:{rosterId:true,playerId:true}}) : []
  const boards = await db.draftSession.findMany({where:{leagueId,status:{in:['pre_draft','paused','in_progress']}},select:{picks:{select:{rosterId:true,playerId:true,playerName:true,position:true}}}})
  const claimed = new Map<string,string>()
  for (const p of rows) {
    const key = JSON.stringify([poolOf(pools,p.rosterId),p.playerId])
    if (claimed.has(key)) throw new Error('This layout puts two owned copies of a player in the same pool.')
    claimed.set(key,p.rosterId)
  }
  for (const board of boards) {
    const seen = new Set<string>()
    for (const p of board.picks) {
      if (!p.playerName.trim() || p.position==='SKIP') continue
      const key = JSON.stringify([poolOf(pools,p.rosterId),p.playerId || p.playerName.trim().toLowerCase()])
      if (seen.has(key) || claimed.has(key)) throw new Error('This layout conflicts with players already drafted or rostered in the same pool.')
      seen.add(key)
    }
  }
}

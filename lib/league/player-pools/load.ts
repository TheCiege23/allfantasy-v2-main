import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { rosterSourceTeamId } from '@/lib/league-import/importedRosterIdentity'
import { readPlayerPoolScope, teamPoolResolver, type PlayerPools, poolOf } from './policy'

type PoolDb = Pick<Prisma.TransactionClient, 'league' | 'leagueTeam' | 'roster' | 'redraftRoster'>

export async function loadPlayerPools(leagueId: string, options: { db?: PoolDb; settings?: unknown; seasonId?: string } = {}): Promise<PlayerPools> {
  const db = options.db ?? prisma
  const settings = options.settings === undefined ? (await db.league.findUnique({where:{id:leagueId},select:{settings:true}}))?.settings : options.settings
  if (readPlayerPoolScope(settings) === 'league') return null
  const [teams, rosters] = await Promise.all([
    db.leagueTeam.findMany({where:{leagueId, lifecycleState:{not:'ARCHIVED'}},select:{id:true,externalId:true}}),
    db.roster.findMany({where:{leagueId},select:{id:true,platformUserId:true,redraftRosterId:true}}),
  ])
  const resolve = teamPoolResolver(settings)
  const byExternalId = new Map(teams.map(t => [t.externalId,resolve(t.id)]))
  const missing = rosters.filter(r => !byExternalId.has(r.id)).map(r => r.id)
  const imports = missing.length ? await db.roster.findMany({where:{leagueId,id:{in:missing}},select:{id:true,playerData:true}}) : []
  const sourceIds = new Map(imports.map(r => [r.id,rosterSourceTeamId(r.playerData)]))
  const pools: Record<string,string> = {}
  const owners = new Map<string,string>()
  for (const r of rosters) {
    const group = byExternalId.get(r.id) ?? byExternalId.get(sourceIds.get(r.id) ?? '')
    if (!group) continue
    pools[r.id] = group
    if (r.redraftRosterId) pools[r.redraftRosterId] = group
    owners.set(r.platformUserId, group)
  }
  if (options.seasonId) {
    const seasonRosters = await db.redraftRoster.findMany({where:{leagueId,seasonId:options.seasonId},select:{id:true,ownerId:true}})
    for (const r of seasonRosters) {
      const group = pools[r.id] ?? owners.get(r.ownerId) ?? (r.ownerId.startsWith('roster:') ? pools[r.ownerId.slice(7)] : undefined)
      if (group) pools[r.id] = group
      poolOf(pools, r.id)
    }
  }
  return pools
}

export function poolRosterIds(pools: PlayerPools, rosterId: string): string[] | undefined {
  if (!pools) return undefined
  const group = poolOf(pools,rosterId)
  return Object.keys(pools).filter(id=>pools[id]===group)
}

// Serializes pool membership edits and cross-engine acquisitions in a transaction.
export async function lockPlayerPools(tx: Prisma.TransactionClient, leagueId: string) {
  await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
}

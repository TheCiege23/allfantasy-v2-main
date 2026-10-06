import { mkdirSync, writeFileSync } from 'node:fs'
import { prisma } from '../lib/prisma'
import { searchCFBPlayers } from '../lib/cfb-player-data'
import { planWinstonWatkinsRepair, WINSTON_WATKINS_PROOF as proof } from '../lib/player-identity/winstonWatkinsRepair'

// Dry run unless --apply. The explicit database host and owned league scope must match.
async function main() {
  const args = process.argv.slice(2)
  const snapshotId = args.find(a => a.startsWith('--snapshot='))?.slice(11)
  const host = args.find(a => a.startsWith('--expected-db-host='))?.slice(19)
  const apply = args.includes('--apply')
  if (!snapshotId || !host || new URL(process.env.DATABASE_URL!).hostname !== host) throw new Error('Database/snapshot scope guard failed')
  const snapshot = await prisma.fantraxLeague.findUnique({ where: { id: snapshotId }, select: { appUserId: true, sport: true, season: true, roster: true } })
  const league = await prisma.league.findFirst({ where: { platform: 'fantrax', platformLeagueId: snapshotId, sport: 'NCAAF', season: proof.season }, select: { id: true, userId: true } })
  if (!snapshot?.appUserId || !league || league.userId !== snapshot.appUserId || snapshot.sport !== 'cfb' || snapshot.season !== proof.season || !Array.isArray(snapshot.roster)) throw new Error('Owned imported CFB league scope failed')
  const provider = await searchCFBPlayers('Winston Watkins')
  const where = { sport: { in: ['NCAAF', 'NCAAFB'] }, OR: [{ fantraxId: proof.fantraxId }, { cfbdId: proof.cfbdId }] }
  const before = await prisma.playerIdentityMap.findMany({ where })
  const source = snapshot.roster as Array<{ fantraxId?: string; name?: string; primaryPosition?: string; team?: string }>
  const plan = planWinstonWatkinsRepair(source, before, provider)
  let writes = 0
  if (apply && plan.changed) {
    mkdirSync('tmp', { recursive: true })
    writeFileSync(`tmp/winston-identity-before-${Date.now()}.json`, JSON.stringify(before, null, 2), { flag: 'wx' })
    writes = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fantrax:ncaaf-current-roster-links'))`
      const now = await tx.playerIdentityMap.findMany({ where })
      const current = planWinstonWatkinsRepair(source, now, provider)
      if (!current.changed) return 0
      const original = before.find(r => r.id === current.row.id)!
      const result = await tx.playerIdentityMap.updateMany({ where: { id: current.row.id, fantraxId: proof.fantraxId, cfbdId: proof.knownWrongCfbdId, updatedAt: original.updatedAt }, data: { cfbdId: proof.cfbdId, lastSyncedAt: new Date() } })
      if (result.count !== 1) throw new Error('Concurrent Winston identity change; repair rolled back')
      return result.count
    }, { isolationLevel: 'Serializable', timeout: 30000 })
  }
  console.log(JSON.stringify({ apply, changed: plan.changed, writes, fantraxId: proof.fantraxId, cfbdId: proof.cfbdId, scoresWritten: 0 }))
}
main().catch(e => { console.error({ error: e instanceof Error ? e.message : 'Winston identity repair failed' }); process.exitCode = 1 }).finally(() => prisma.$disconnect())

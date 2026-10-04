/** Read-only archive smoke check. Prints aggregate coverage only, never account or player data. */
import { prisma } from '../lib/prisma'
import { draftArchiveCatalog } from '../lib/draft-archive/catalog'
import { draftArchiveDetail } from '../lib/draft-archive/detail'

async function main() {
  const leagues = await prisma.league.findMany({ take: 20, orderBy: { id: 'asc' }, select: { id: true, userId: true } })
  const catalog = await draftArchiveCatalog(leagues.map(l => l.id), { limit: 5 })
  let checked = 0
  for (const choice of catalog.choices) {
    const owner = leagues.find(l => l.id === choice.leagueId)?.userId
    if (!owner) continue
    const detail = await draftArchiveDetail(choice.leagueId, owner, choice.key)
    if (!detail || detail.choice.key !== choice.key) throw new Error('Archive binding check failed')
    checked++
  }
  console.log(JSON.stringify({ leaguesScanned: leagues.length, archiveRecords: catalog.total, detailsChecked: checked }))
}
main().catch((error: unknown) => {
  // Only print known schema/binding categories; DB errors can include connection identifiers.
  console.error('Archive read-only verification failed', error instanceof Error ? error.name : 'UnknownError')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())

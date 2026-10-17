/** Read-only archive smoke check. Prints aggregate coverage only, never account or player data. */
import { prisma } from '../lib/prisma'
import { draftArchiveCatalog } from '../lib/draft-archive/catalog'
import { draftArchiveDetail } from '../lib/draft-archive/detail'
import { archiveLedger, archiveSequence } from '../lib/draft-archive/ledger'

async function main() {
  const leagues = await prisma.league.findMany({ take: 20, orderBy: { id: 'asc' }, select: { id: true, userId: true } })
  const catalog = await draftArchiveCatalog(leagues.map(l => l.id), { limit: 5 })
  const sessions = await prisma.draftSession.findMany({ where: { leagueId: { in: leagues.map(l => l.id) } }, take: 5, select: { id: true, leagueId: true } })
  for (const session of sessions) {
    const rows = await archiveLedger(prisma, session.leagueId, session.id, { take: 2 })
    if (rows.length === 2 && (archiveSequence(rows[0].afterState) ?? 0) < (archiveSequence(rows[1].afterState) ?? 0)) throw new Error('Archive ledger ordering check failed')
  }
  let checked = 0
  for (const choice of catalog.choices) {
    const owner = leagues.find(l => l.id === choice.leagueId)?.userId
    if (!owner) continue
    const detail = await draftArchiveDetail(choice.leagueId, owner, choice.key)
    if (!detail || detail.choice.key !== choice.key) throw new Error('Archive binding check failed')
    checked++
  }
  const coverage = await prisma.$queryRaw<Array<{ unresolvedPicks: number; unresolvedLeagues: number }>>`
    SELECT COUNT(*)::int AS "unresolvedPicks",COUNT(DISTINCT f."leagueId")::int AS "unresolvedLeagues"
    FROM dw_draft_facts f JOIN leagues l ON l.id=f."leagueId"
    WHERE lower(l.platform)='sleeper' AND NULLIF(f.metadata->>'sourceDraftId','') IS NULL`
  console.log(JSON.stringify({ leaguesScanned: leagues.length, archiveRecords: catalog.total, detailsChecked: checked, ledgerReadsChecked: sessions.length, ...coverage[0] }))
}
main().catch((error: unknown) => {
  // Only print known schema/binding categories; DB errors can include connection identifiers.
  console.error('Archive read-only verification failed', error instanceof Error ? error.name : 'UnknownError')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())

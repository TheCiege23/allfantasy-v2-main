/** Add verified Sleeper source provenance to legacy facts. Default: bounded dry-run.
 * --apply requires --production on a verified production database. Never deletes picks.
 */
import { Prisma } from '@prisma/client'
import { createRequire } from 'node:module'
import { prisma } from '../lib/prisma'
import { getDatabaseUrlOrThrow } from '../lib/env/database-url'
import { getLeagueDrafts, getDraftPicks, getLeagueRosters } from '../lib/sleeper-client'
import { getSleeperHistoricalLeagueChain } from '../lib/league-import/sleeper/SleeperHistoricalLeagueChain'
import { sleeperDraftArchiveMetadata } from '../lib/league-import/sleeper/draftArchiveMetadata'
import { normalizePickNumber } from '../lib/league-import/sleeper/sleeperDraftPickIdentity'
import { uniqueHistoricalSelection, type HistoricalSelection } from '../lib/draft-archive/backfillMatch'
const { identifyTarget } = createRequire(import.meta.url)('./db-target-identity.cjs')
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
async function main() {
  const apply = process.argv.includes('--apply')
  const target = identifyTarget(getDatabaseUrlOrThrow())
  if (apply && (target.kind === 'production' ? !process.argv.includes('--production') : target.kind !== 'safe')) throw new Error('Verified target required')
  const all = process.argv.includes('--all')
  const limit = Math.max(1, Math.min(all ? 500 : 20, Number(process.argv.find(v => v.startsWith('--limit='))?.split('=')[1]) || (all ? 500 : 2)))
  const leagues = await prisma.$queryRaw<Array<{ id: string; platformLeagueId: string }>>(Prisma.sql`
    SELECT l.id,l."platformLeagueId" FROM leagues l WHERE lower(l.platform)='sleeper' AND l."platformLeagueId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM dw_draft_facts f WHERE f."leagueId"=l.id AND NULLIF(f.metadata->>'sourceDraftId','') IS NULL)
    ORDER BY l.id LIMIT ${limit}`)
  const report = { mode: apply ? 'apply' : 'dry-run', target: target.kind, leagues: leagues.length, processed: 0, examined: 0, matched: 0, unresolved: 0, updated: 0, conflicts: 0, failures: 0 }
  for (const league of leagues) {
    try {
      const facts = await prisma.draftFact.findMany({ where: { leagueId: league.id }, orderBy: { draftId: 'asc' }, take: 10001 })
      if (facts.length > 10000) throw new Error('League exceeds bounded rehearsal size')
      const legacy = facts.filter(f => !record(f.metadata).sourceDraftId)
      const chain = await getSleeperHistoricalLeagueChain(league.platformLeagueId, 20)
      const candidates: HistoricalSelection[] = []
      for (const season of chain.filter(s => legacy.some(f => f.season === s.season))) {
        const rosters = await getLeagueRosters(season.externalLeagueId).catch(() => null)
        const drafts = await getLeagueDrafts(season.externalLeagueId, { strict: true })
        for (const draft of drafts) {
          const id = draft.draft_id
          if (!id || !/^\d+$/.test(id)) throw new Error('Invalid source draft ID')
          const picks = await getDraftPicks(id, { strict: true })
          if (draft.status === 'complete' && !picks.length) throw new Error('Completed source selections unavailable')
          const response = await fetch('https://api.sleeper.app/v1/draft/' + id + '/traded_picks', { signal: AbortSignal.timeout(12000) })
          const payload: unknown = response.ok ? await response.json() : null
          const tradedPicks = Array.isArray(payload) ? payload : null
          for (const [index, pick] of picks.entries()) {
            candidates.push({ sourceDraftId: id, season: season.season, round: Number(pick.round), overall: normalizePickNumber(pick, index + 1), playerId: pick.player_id,
              metadata: sleeperDraftArchiveMetadata({ sourceDraftId: id, sourceLeagueId: season.externalLeagueId, season: season.season, draft, league: season.league, pick, tradedPicks, rosters, includeDraftSnapshot: true }) })
          }
        }
      }
      const snapshots = new Set<string>()
      const updates: Array<{ id: string; before: unknown; after: Prisma.InputJsonValue }> = []
      for (const fact of legacy) {
        report.examined++
        const match = uniqueHistoricalSelection(fact, candidates)
        if (!match) { report.unresolved++; continue }
        report.matched++
        const metadata = { ...record(fact.metadata), ...record(match.metadata) }
        if (snapshots.has(match.sourceDraftId) && !record(fact.metadata).archiveDraft) delete metadata.archiveDraft
        snapshots.add(match.sourceDraftId)
        updates.push({ id: fact.draftId, before: fact.metadata, after: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue })
      }
      if (apply) for (let offset = 0; offset < updates.length; offset += 25) {
        const count = await prisma.$transaction(async tx => {
          let changed = 0
          for (const update of updates.slice(offset, offset + 25)) {
            const result = await tx.draftFact.updateMany({ where: { draftId: update.id, leagueId: league.id, metadata: { equals: update.before == null ? Prisma.DbNull : update.before as Prisma.InputJsonValue } }, data: { metadata: update.after } })
            changed += result.count
          }
          return changed
        }, { timeout: 15000 })
        report.updated += count; report.conflicts += Math.min(25, updates.length - offset) - count
      }
    } catch { report.failures++ }
    report.processed++
    if (all && report.processed % 20 === 0) console.log(JSON.stringify({ progress: true, ...report }))
  }
  console.log(JSON.stringify(report))
  if (report.failures || report.conflicts) process.exitCode = 1
}
main().catch(() => { console.error('Archive backfill failed; stored selections were not deleted'); process.exitCode = 1 }).finally(() => prisma.$disconnect())

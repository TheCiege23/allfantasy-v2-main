/** Read-only: classify unmatched provider facts without printing account or player details. */
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getSleeperHistoricalLeagueChain } from '../lib/league-import/sleeper/SleeperHistoricalLeagueChain'
import { getLeagueDrafts, getDraftPicks } from '../lib/sleeper-client'
import { normalizePickNumber } from '../lib/league-import/sleeper/sleeperDraftPickIdentity'
import { uniqueHistoricalSelection, type HistoricalSelection } from '../lib/draft-archive/backfillMatch'

async function main() {
  const leagues = await prisma.$queryRaw<Array<{ id: string; platformLeagueId: string }>>(Prisma.sql`
    SELECT l.id,l."platformLeagueId" FROM leagues l WHERE lower(l.platform)='sleeper' AND l."platformLeagueId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM dw_draft_facts f WHERE f."leagueId"=l.id AND NULLIF(f.metadata->>'sourceDraftId','') IS NULL)
    ORDER BY l.id LIMIT 50`)
  const totals = { leagues: leagues.length, unavailableChains: 0, unavailableDrafts: 0, unavailablePicks: 0, exact: 0, uniqueRoundMismatch: 0, ambiguous: 0, absentSeason: 0, absentPlayerAtPick: 0, overBound: 0 }
  for (const league of leagues) {
    const facts = await prisma.draftFact.findMany({ where: { leagueId: league.id }, take: 10001 })
    if (facts.length > 10000) { totals.overBound++; continue }
    const legacy = facts.filter(f => !f.metadata || typeof f.metadata !== 'object' || !('sourceDraftId' in f.metadata) || !f.metadata.sourceDraftId)
    let chain: Awaited<ReturnType<typeof getSleeperHistoricalLeagueChain>>
    try { chain = await getSleeperHistoricalLeagueChain(league.platformLeagueId, 20) } catch { totals.unavailableChains++; continue }
    if (!chain.length) { totals.unavailableChains++; continue }
    const candidates: HistoricalSelection[] = []
    let failed = false
    for (const season of chain.filter(s => legacy.some(f => f.season === s.season))) {
      let drafts: Awaited<ReturnType<typeof getLeagueDrafts>>
      try { drafts = await getLeagueDrafts(season.externalLeagueId, { strict: true }) } catch { totals.unavailableDrafts++; failed = true; break }
      for (const draft of drafts) {
        if (!draft.draft_id) continue
        try {
          const picks = await getDraftPicks(draft.draft_id, { strict: true })
          if (draft.status === 'complete' && !picks.length) throw new Error('Source selections absent')
          for (const [index, pick] of picks.entries()) candidates.push({ sourceDraftId: draft.draft_id, season: season.season, round: Number(pick.round), overall: normalizePickNumber(pick, index + 1), playerId: pick.player_id, metadata: null })
        } catch { totals.unavailablePicks++; failed = true; break }
      }
      if (failed) break
    }
    if (failed) continue
    for (const fact of legacy) {
      if (uniqueHistoricalSelection(fact, candidates)) { totals.exact++; continue }
      const same = candidates.filter(c => c.season === fact.season && c.overall === fact.pickNumber && c.playerId === fact.playerId)
      if (new Set(same.map(c => c.sourceDraftId)).size === 1) totals.uniqueRoundMismatch++
      else if (same.length) totals.ambiguous++
      else if (!chain.some(s => s.season === fact.season)) totals.absentSeason++
      else totals.absentPlayerAtPick++
    }
  }
  console.log(JSON.stringify(totals))
}
main().catch(() => { console.error('Read-only archive diagnostics failed'); process.exitCode = 1 }).finally(() => prisma.$disconnect())

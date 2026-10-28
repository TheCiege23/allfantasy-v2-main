import { prisma } from '@/lib/prisma'
import { extractMlbDraftSeasonStats, extractNbaDraftSeasonRates, extractNhlDraftSeasonStats } from './sportsPlayerRecordDraftEnrichment'
import { selectDraftSeasonRows } from './selectDraftSeasonRows'

/** Provider IDs, sport and season are joined directly; names never join statistics. */
export async function loadStoredDraftSeasonStats(sport: string, ids: string[], season: number) {
  const out = new Map<string, { nbaDraftStats: ReturnType<typeof extractNbaDraftSeasonRates>; seasonStatLine: ReturnType<typeof extractMlbDraftSeasonStats>; statSeason: string }>()
  if (!['NBA', 'NHL', 'MLB'].includes(sport) || !ids.length) return out
  const rows = await prisma.playerSeasonStats.findMany({
    where: { sport, playerId: { in: [...new Set(ids)] }, source: 'rolling_insights', seasonType: 'regular', season: { in: [String(season), String(season - 1)] }, gamesPlayed: { gt: 0 } },
    select: { playerId: true, season: true, gamesPlayed: true, stats: true, position: true },
  })
  for (const [id, row] of selectDraftSeasonRows(rows, season)) {
    // RI's season field named "minutes" has unverified units; never label it MPG.
    const nbaBlob = row.stats && typeof row.stats === 'object' && !Array.isArray(row.stats) ? { ...row.stats } : {}
    delete (nbaBlob as Record<string, unknown>).minutes
    const nbaDraftStats = sport === 'NBA' ? extractNbaDraftSeasonRates(nbaBlob) : null
    const seasonStatLine = sport === 'MLB' ? extractMlbDraftSeasonStats(row.stats) : sport === 'NHL' ? extractNhlDraftSeasonStats(row.stats) : null
    // RI acknowledges incomplete NHL goalie decisions/shutouts. Omit those metrics until its backfill is verified.
    if (sport === 'NHL' && seasonStatLine && (row.position === 'G' || 'savePercentage' in seasonStatLine || 'goalsAgainstAverage' in seasonStatLine)) {
      delete seasonStatLine.wins
      delete seasonStatLine.shutouts
    }
    if (nbaDraftStats || seasonStatLine) out.set(id, { nbaDraftStats, seasonStatLine, statSeason: sport === 'NBA' || sport === 'NHL' ? row.season + '–' + String(Number(row.season) + 1).slice(-2) : row.season })
  }
  return out
}

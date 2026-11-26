import { prisma } from '@/lib/prisma'
import { extractMlbDraftSeasonStats, extractNbaDraftSeasonRates, extractNhlDraftSeasonStats } from './sportsPlayerRecordDraftEnrichment'
import { selectDraftSeasonRows, normalizeRiDraftSeasonUnits } from './selectDraftSeasonRows'

/** Provider IDs, sport and season are joined directly; names never join statistics. */
export async function loadStoredDraftSeasonStats(sport: string, ids: string[], season: number) {
  /** `statSeasonIsPrevious`: no played row for `season`, so the line is the season before it. The room says so beside the numbers. */
  const out = new Map<string, { nbaDraftStats: ReturnType<typeof extractNbaDraftSeasonRates>; seasonStatLine: ReturnType<typeof extractMlbDraftSeasonStats>; statSeason: string; statSeasonIsPrevious: boolean }>()
  if (!['NBA', 'NHL', 'MLB'].includes(sport) || !ids.length) return out
  const rows = await prisma.playerSeasonStats.findMany({
    where: { sport, playerId: { in: [...new Set(ids)] }, source: 'rolling_insights', seasonType: 'regular', season: { in: [String(season), String(season - 1)] }, gamesPlayed: { gt: 0 } },
    select: { playerId: true, season: true, gamesPlayed: true, stats: true, position: true },
  })
  const selected = selectDraftSeasonRows(rows, season)
  // "Previous" is measured against the newest season these players have a game in, not against
  // `season`. A caller with no league passes the calendar year, and an NBA or NHL season is stored
  // under the year it STARTS in: from January, `season` is one more than every row, and comparing
  // with it would call the whole league's current numbers last season's.
  const newestSeason = Math.max(...[...selected.values()].map((row) => Number(row.season)).filter(Number.isFinite), -Infinity)
  for (const [id, row] of selected) {
    const box = normalizeRiDraftSeasonUnits(sport, row.stats)
    const nbaDraftStats = sport === 'NBA' ? extractNbaDraftSeasonRates(box) : null
    const seasonStatLine = sport === 'MLB' ? extractMlbDraftSeasonStats(box) : sport === 'NHL' ? extractNhlDraftSeasonStats(box) : null
    // RI acknowledges incomplete NHL goalie decisions/shutouts. Omit those metrics until its backfill is verified.
    if (sport === 'NHL' && seasonStatLine && (row.position === 'G' || 'savePercentage' in seasonStatLine || 'goalsAgainstAverage' in seasonStatLine)) {
      delete seasonStatLine.wins
      delete seasonStatLine.shutouts
    }
    if (nbaDraftStats || seasonStatLine) out.set(id, { nbaDraftStats, seasonStatLine, statSeason: sport === 'NBA' || sport === 'NHL' ? row.season + '–' + String(Number(row.season) + 1).slice(-2) : row.season, statSeasonIsPrevious: Number(row.season) < newestSeason })
  }
  return out
}

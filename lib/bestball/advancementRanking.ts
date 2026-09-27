export type BestBallAdvancementTieRule = 'points_for' | 'max_week' | 'advance_all'
type ScoredEntry = { id: string; totalPoints: number; weeklyScores: unknown }

function highestWeek(entry: ScoredEntry): number {
  if (!Array.isArray(entry.weeklyScores)) return 0
  const scores = entry.weeklyScores.flatMap(row =>
    row && typeof row === 'object' && typeof row.points === 'number' && Number.isFinite(row.points) ? [row.points] : [],
  )
  return scores.length ? Math.max(...scores) : 0
}

export function rankBestBallEntries<T extends ScoredEntry>(entries: T[], rule: BestBallAdvancementTieRule): T[] {
  return [...entries].sort((a, b) => b.totalPoints - a.totalPoints ||
    (rule === 'max_week' ? highestWeek(b) - highestWeek(a) : 0) || a.id.localeCompare(b.id))
}

export function selectBestBallAdvancers<T extends ScoredEntry>(sorted: T[], count: number, rule: BestBallAdvancementTieRule): T[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid advancer count')
  const advance = sorted.slice(0, count)
  if (rule === 'advance_all' && advance.length) {
    const boundary = advance[advance.length - 1]!.totalPoints
    advance.push(...sorted.slice(count).filter(entry => entry.totalPoints === boundary))
  }
  return advance
}

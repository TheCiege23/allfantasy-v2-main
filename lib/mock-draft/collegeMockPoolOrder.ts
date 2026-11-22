/**
 * Which college players a college football mock draft shows, and in what order (2026-11-20).
 *
 * The mock used the shared sport pool, which orders by `allfantasy_adp_snapshots` and then, with
 * no ranking left, alphabetically. For NCAAF that meant 91 players ranked by drafts of that same
 * alphabetical list in May (half of them centers, every name A to J, test drafts included), then
 * names starting with A. Measured on production: about 33 of the 300 players shown had any stats,
 * and nobody past "Am..." appeared.
 *
 * Now: only the positions a college mock rosters (QB, RB, WR, TE), ordered by this season's
 * production, from the same `DevyPlayer` lines the stat columns show (mockPoolSeasonStats.ts).
 * Players with no line follow in the pool's own order. Each player appears once.
 */
import type { CFBPlayerStats } from '@/lib/cfb-player-data'

export const COLLEGE_MOCK_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

/** Mirrors `normalizeDevyName` (lib/devy/devyPlayerReads.ts), the key the college lines are stored under. */
export function collegeNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Ordering only, never shown: ordinary football points with half a point per catch, so the order
 * leans neither PPR nor standard. A yard is worth the same whoever gains it; touchdowns count 4
 * passing and 6 otherwise.
 */
export function collegeProductionScore(line: CFBPlayerStats): number {
  return (
    line.passingYards * 0.04 + line.passingTDs * 4 +
    line.rushingYards * 0.1 + line.rushingTDs * 6 +
    line.receivingYards * 0.1 + line.receivingTDs * 6 +
    line.receptions * 0.5
  )
}

export interface CollegePoolRow {
  name: string
  position: string
}

/**
 * Pure: the college pool in mock order. A row's line counts only when its position matches the
 * line's (the name map already drops names two players share). Rows keep their pool order within
 * a tie, so the pool's own preference (a row with a photo) decides which copy of a player stays.
 */
export function orderCollegeMockPool<T extends CollegePoolRow>(
  rows: readonly T[],
  byName: ReadonlyMap<string, CFBPlayerStats>,
  limit: number,
): T[] {
  const allowed = new Set<string>(COLLEGE_MOCK_POSITIONS)
  const seen = new Set<string>()
  const scored: Array<{ row: T; score: number | null; index: number }> = []
  rows.forEach((row, index) => {
    const position = String(row.position ?? '').trim().toUpperCase()
    const nameKey = collegeNameKey(String(row.name ?? ''))
    if (!allowed.has(position) || !nameKey) return
    const key = `${nameKey}|${position}`
    if (seen.has(key)) return
    seen.add(key)
    const line = byName.get(nameKey)
    const matches = line && String(line.position ?? '').trim().toUpperCase() === position
    scored.push({ row, score: matches ? collegeProductionScore(line) : null, index })
  })
  scored.sort((a, b) => {
    if (a.score != null && b.score != null) return b.score - a.score || a.index - b.index
    if (a.score != null) return -1
    if (b.score != null) return 1
    return a.index - b.index
  })
  return scored.slice(0, Math.max(0, limit)).map((s) => s.row)
}

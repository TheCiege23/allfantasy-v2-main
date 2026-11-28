/**
 * Fantasy-point rank over the last 7 / 14 / 30 days and the season — pure.
 *
 * "Average rank over different time periods is probably the single most useful metric for start/sit
 * and waiver decisions" — r/fantasyhockey, on Yahoo's 2026 redesign removing it. This answers it
 * from games already played: every player's fantasy points in the window, ranked across the sport
 * and within his position.
 *
 * Rules, each deliberate:
 *   - A window is the N Eastern days BEFORE today. Today's games are left out: they may be live, and
 *     a rank that moves during a game is not a 7-day rank.
 *   - Rank is by TOTAL points in the window (what a weekly matchup adds up), with ties sharing a rank
 *     (1, 2, 2, 4). Points per game is reported beside it — the two answer different questions.
 *   - Only players with a game in the window are ranked; the population says how many.
 */

export type RankWindowKey = 'd7' | 'd14' | 'd30' | 'season'

export const RANK_WINDOWS: ReadonlyArray<{ key: RankWindowKey; days: number | null; label: string }> = [
  { key: 'd7', days: 7, label: 'Last 7' },
  { key: 'd14', days: 14, label: 'Last 14' },
  { key: 'd30', days: 30, label: 'Last 30' },
  { key: 'season', days: null, label: 'Season' },
]

/** One player's points on one Eastern day (several games or box groups that day already summed). */
export interface DayPoints {
  playerId: string
  /** `YYYY-MM-DD`, Eastern. */
  day: string
  points: number
  games: number
}

/** [overall rank, position rank, points, games] — compact, because a table is cached per league per day. */
export type RankCell = [number, number, number, number]

export interface WindowRankTable {
  asOf: string
  /** Primary position per ranked player (what the position rank is within). */
  positions: Record<string, string>
  windows: Record<RankWindowKey, { population: number; byPlayer: Record<string, RankCell> }>
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

/** The position a player is ranked within: first listed, with feeds' spellings folded together. */
export function rankPosition(sport: string, raw: string | null | undefined): string {
  const first = String(raw ?? '').split(/[\/,\s]+/)[0].trim().toUpperCase()
  if (!first) return '—'
  if (sport === 'NHL') {
    if (first === 'L' || first === 'LW') return 'LW'
    if (first === 'R' || first === 'RW') return 'RW'
    if (first === 'D' || first.startsWith('DEF')) return 'D'
    if (first === 'G' || first.startsWith('GOAL')) return 'G'
    if (first === 'C' || first.startsWith('CEN')) return 'C'
    if (first === 'F') return 'F'
  }
  return first
}

function competitionRanks(rows: Array<{ id: string; points: number }>): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.points - a.points)
  const out = new Map<string, number>()
  let rank = 0
  let prev: number | null = null
  sorted.forEach((r, i) => {
    if (prev === null || r.points !== prev) rank = i + 1
    prev = r.points
    out.set(r.id, rank)
  })
  return out
}

export function computeWindowRanks(args: {
  sport: string
  today: string
  days: DayPoints[]
  /** Raw position per player id; missing means unknown ("—"). */
  positions: ReadonlyMap<string, string | null>
}): WindowRankTable {
  const { sport, today, days } = args
  const posOf = (id: string) => rankPosition(sport, args.positions.get(id))
  const windows = {} as WindowRankTable['windows']
  const positions: Record<string, string> = {}

  for (const w of RANK_WINDOWS) {
    const from = w.days == null ? null : addDays(today, -w.days)
    const tot = new Map<string, { points: number; games: number }>()
    for (const d of days) {
      if (d.day >= today) continue
      if (from && d.day < from) continue
      const t = tot.get(d.playerId) ?? { points: 0, games: 0 }
      t.points += d.points
      t.games += d.games
      tot.set(d.playerId, t)
    }
    const rows = [...tot.entries()].filter(([, t]) => t.games > 0).map(([id, t]) => ({ id, points: Math.round(t.points * 100) / 100 }))
    const overall = competitionRanks(rows)
    const byPos = new Map<string, Array<{ id: string; points: number }>>()
    for (const r of rows) {
      const p = posOf(r.id)
      positions[r.id] = p
      byPos.set(p, [...(byPos.get(p) ?? []), r])
    }
    const posRank = new Map<string, number>()
    for (const list of byPos.values()) for (const [id, rk] of competitionRanks(list)) posRank.set(id, rk)
    const byPlayer: Record<string, RankCell> = {}
    for (const r of rows) byPlayer[r.id] = [overall.get(r.id)!, posRank.get(r.id)!, r.points, tot.get(r.id)!.games]
    windows[w.key] = { population: rows.length, byPlayer }
  }
  return { asOf: today, positions, windows }
}

export interface PlayerWindowRank {
  key: RankWindowKey
  label: string
  rank: number | null
  positionRank: number | null
  points: number | null
  games: number
  perGame: number | null
  population: number
}

/** One player's row out of a table — every window, including the ones he has no game in. */
export function playerWindowRanks(table: WindowRankTable, playerId: string): { position: string | null; windows: PlayerWindowRank[] } {
  return {
    position: table.positions[playerId] ?? null,
    windows: RANK_WINDOWS.map((w) => {
      const win = table.windows[w.key]
      const cell = win?.byPlayer[playerId]
      return {
        key: w.key,
        label: w.label,
        rank: cell ? cell[0] : null,
        positionRank: cell ? cell[1] : null,
        points: cell ? cell[2] : null,
        games: cell ? cell[3] : 0,
        perGame: cell && cell[3] > 0 ? Math.round((cell[2] / cell[3]) * 100) / 100 : null,
        population: win?.population ?? 0,
      }
    }),
  }
}

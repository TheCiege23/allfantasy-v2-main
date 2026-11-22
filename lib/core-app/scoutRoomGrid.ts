import type { ScoutedManager } from '@/lib/core-app/scout'

/**
 * The War Room's "room at a glance" grid (components/core-app/screens/Scout.tsx `RoomGrid`): every live
 * team's rank in this league, column by column, shaded from stronger to weaker.
 *
 * ⚠ EVERY COLUMN IS A RANK THE STANDINGS ALREADY HOLD. The design's grid ranked positional strength
 * (QB / RB / WR / TE / FLEX), and nothing on this screen reads rosters by position — so the columns are
 * the four the Standings read carries: seed, power rank, points for, and wins in the last five. A shaded
 * grid of numbers the screen does not have would look exactly as confident as this one.
 */

export type RoomGridColumn = 'seed' | 'power' | 'pointsFor' | 'form'

export type RoomGridCell = { column: RoomGridColumn; rank: number; tier: 1 | 2 | 3 | 4 | 5 }

type RoomGridRow = {
  managerId: string
  teamName: string
  isYou: boolean
  isNextOpponent: boolean
  cells: RoomGridCell[]
}

export type RoomGrid = {
  columns: RoomGridColumn[]
  rows: RoomGridRow[]
  /** How many teams each column ranks — the "of 12" in every reading. */
  outOf: number
  /** Your best and worst column, when you are on the grid. Null otherwise. */
  you: { strongest: RoomGridCell; weakest: RoomGridCell } | null
}

/** Fewer than this and a five-step shade says nothing a list does not. */
const ROOM_GRID_MIN_TEAMS = 3

/** Competition ranking (1, 1, 3): a tie shares the better rank, and the next rank skips. */
function competitionRanks<T>(items: T[], score: (t: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => score(b) - score(a))
  const ranks = new Map<T, number>()
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1]
    ranks.set(item, prev !== undefined && score(prev) === score(item) ? ranks.get(prev)! : i + 1)
  })
  return ranks
}

/** 1 = the strongest fifth of the room, 5 = the weakest. */
export function roomGridTier(rank: number, outOf: number): 1 | 2 | 3 | 4 | 5 {
  if (outOf <= 0) return 5
  return Math.min(5, Math.max(1, Math.ceil((rank * 5) / outOf))) as 1 | 2 | 3 | 4 | 5
}

export function buildRoomGrid(managers: ScoutedManager[]): RoomGrid | null {
  // A chopped team is out of the race; ranking it would push every live team down a place.
  const live = managers.filter((m) => m.standing && !m.eliminated)
  if (live.length < ROOM_GRID_MIN_TEAMS) return null
  const outOf = live.length

  const columns: RoomGridColumn[] = ['seed', 'power', 'pointsFor']
  // Before anyone has played there is no form to rank, and a column of ties would shade every team alike.
  if (live.some((m) => m.standing!.form.length > 0)) columns.push('form')

  const pf = competitionRanks(live, (m) => m.standing!.pointsFor)
  const wins = competitionRanks(live, (m) => m.standing!.form.filter((r) => r === 'W').length)

  const rankOf = (m: ScoutedManager, column: RoomGridColumn): number => {
    const s = m.standing!
    if (column === 'seed') return s.seed
    if (column === 'power') return s.powerRank
    if (column === 'pointsFor') return pf.get(m)!
    return wins.get(m)!
  }

  const rows: RoomGridRow[] = [...live]
    .sort((a, b) => a.standing!.seed - b.standing!.seed)
    .map((m) => ({
      managerId: m.managerId,
      teamName: m.teamName,
      isYou: m.isYou,
      isNextOpponent: m.isNextOpponent,
      cells: columns.map((column) => {
        const rank = rankOf(m, column)
        return { column, rank, tier: roomGridTier(rank, outOf) }
      }),
    }))

  const mine = rows.find((r) => r.isYou)
  const you = mine
    ? {
        // First column wins a tie, so the reading follows the grid's own left-to-right order.
        strongest: mine.cells.reduce((best, c) => (c.rank < best.rank ? c : best)),
        weakest: mine.cells.reduce((worst, c) => (c.rank > worst.rank ? c : worst)),
      }
    : null

  return { columns, rows, outOf, you }
}

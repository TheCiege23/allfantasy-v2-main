import type { WeekBoard } from '@/lib/core-app/weekBoard'

/**
 * How far through the week the head-to-head games are, for the Your Week board's progress bar
 * (2026-11-05). Pure, and read only from the loader's own `live` field: a matchup is DECIDED when
 * both sides' week is settled (`live.final`), LIVE when points exist but it is not, and NOT STARTED
 * when no points exist yet. Elimination weeks are left out — they have no opponent and settle by a
 * cut line, which the board shows in its own section.
 */
export type YourWeekProgress = {
  headToHead: number
  decided: number
  live: number
  notStarted: number
  coinFlips: number
}

export function yourWeekProgress(data: Pick<WeekBoard, 'coinFlips' | 'leaning' | 'unprojected'>): YourWeekProgress {
  const games = [...data.coinFlips, ...data.leaning, ...data.unprojected]
  let decided = 0
  let live = 0
  for (const g of games) {
    if (!g.live) continue
    if (g.live.final) decided += 1
    else live += 1
  }
  return {
    headToHead: games.length,
    decided,
    live,
    notStarted: games.length - decided - live,
    coinFlips: data.coinFlips.length,
  }
}

import {
  compareOfficial,
  type BoardTeam,
  type OrderCtx,
  type OrderRow,
  type Record3,
  type StandingsBoard,
} from '@/lib/core-app/standingsModel'

/**
 * "What if" — pick a winner for each of the next week's games and see the table that would result.
 *
 * ⚠ THE SAME ORDERING RULE AS THE TABLE, NOT A LOOK-ALIKE. `compareOfficial` is the function the board
 * itself sorts with; this module adds the picked results to records and to the head-to-head grid and
 * calls it again. A second implementation of the tiebreak chain would agree today and drift tomorrow.
 *
 * ⚠ POINTS FOR IS HELD AT TODAY'S TOTALS. Nobody picks a score, so a points tiebreak between two teams
 * level after the picks is decided on the points already banked. The screen says so.
 *
 * ⚠ OFFERED ONLY WHERE IT CAN BE HONEST. A league with a weekly median game awards a second result
 * from the score, which a pick cannot supply — the records would be half-updated. A points-only league
 * has no results to pick. Both get `null` and the screen draws nothing.
 */

export type WhatIfGame = { key: string; a: BoardTeam; b: BoardTeam }

export type WhatIfRow = {
  team: BoardTeam
  record: Record3
  seed: number
  /** Against the same rule with no picks — positive = up. */
  move: number
  inField: boolean
}

export type WhatIfSetup = {
  week: number
  games: WhatIfGame[]
  field: number
  /** True when the live table is the platform's own order, which our rule may not reproduce exactly. */
  platformOrder: boolean
}

export function gameKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

export function whatIfSetup(board: StandingsBoard): WhatIfSetup | null {
  if (!board.hasHeadToHead || board.medianGames) return null
  const next = board.nextGames
  if (!next || next.games.length === 0) return null
  const byId = new Map(board.teams.map((t) => [t.rosterId, t]))
  const games: WhatIfGame[] = []
  for (const g of next.games) {
    const a = byId.get(g.a)
    const b = byId.get(g.b)
    if (a && b) games.push({ key: gameKey(a.rosterId, b.rosterId), a, b })
  }
  if (games.length === 0) return null
  /* Your game first, then in table order of the better-seeded side — the games that matter to you lead. */
  games.sort(
    (x, y) =>
      Number(y.a.isYou || y.b.isYou) - Number(x.a.isYou || x.b.isYou) ||
      Math.min(x.a.seed, x.b.seed) - Math.min(y.a.seed, y.b.seed),
  )
  return {
    week: next.week,
    games,
    field: Math.min(board.rules.playoffTeams, board.teams.length),
    platformOrder: board.platformOrder,
  }
}

/** `picks` maps a game key to the winner's rosterId. Unpicked games are simply not played. */
export function applyWhatIf(board: StandingsBoard, setup: WhatIfSetup, picks: Record<string, string>): WhatIfRow[] {
  const records = new Map<string, Record3>(board.teams.map((t) => [t.rosterId, { ...t.record }]))
  const h2h: OrderCtx['h2h'] = {}
  for (const [a, row] of Object.entries(board.h2h)) {
    h2h[a] = {}
    for (const [b, r] of Object.entries(row)) h2h[a][b] = { ...r }
  }
  const bump = (winner: string, loser: string) => {
    records.get(winner)!.wins += 1
    records.get(loser)!.losses += 1
    const w = ((h2h[winner] ??= {})[loser] ??= { wins: 0, losses: 0, ties: 0 })
    w.wins += 1
    const l = ((h2h[loser] ??= {})[winner] ??= { wins: 0, losses: 0, ties: 0 })
    l.losses += 1
  }
  for (const g of setup.games) {
    const w = picks[g.key]
    if (w === g.a.rosterId) bump(g.a.rosterId, g.b.rosterId)
    else if (w === g.b.rosterId) bump(g.b.rosterId, g.a.rosterId)
  }

  const ctx: OrderCtx = { h2h: board.h2h, hasHeadToHead: true, tiebreakers: board.rules.tiebreakers }
  const rowOf = (t: BoardTeam, record: Record3): OrderRow => ({
    rosterId: t.rosterId,
    name: t.name,
    record,
    pointsFor: t.pointsFor,
    pointsAgainst: t.pointsAgainst,
  })
  /*
   * The baseline is OUR rule with no picks, not the live seed. Where the live table is the platform's
   * own order the two can differ before anything is picked, and measuring moves against the live seed
   * would show teams moving because of a tiebreak nobody touched.
   */
  const baseline = new Map(
    [...board.teams]
      .map((t) => rowOf(t, t.record))
      .sort((a, b) => compareOfficial(a, b, ctx))
      .map((r, i) => [r.rosterId, i + 1]),
  )
  const scenarioCtx: OrderCtx = { ...ctx, h2h }
  const byId = new Map(board.teams.map((t) => [t.rosterId, t]))
  return [...board.teams]
    .map((t) => rowOf(t, records.get(t.rosterId)!))
    .sort((a, b) => compareOfficial(a, b, scenarioCtx))
    .map((r, i) => ({
      team: byId.get(r.rosterId)!,
      record: r.record,
      seed: i + 1,
      move: (baseline.get(r.rosterId) ?? i + 1) - (i + 1),
      inField: i + 1 <= setup.field,
    }))
}

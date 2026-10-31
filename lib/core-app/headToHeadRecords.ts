/**
 * Head-to-head wins / losses / ties from PAIRED scores — never from `WeeklyMatchup.win`.
 *
 * 🛑 `win` IS NOT A RESULT (see standingsModel.ts). The writer stores a tie as `win = 0` for both
 * sides, and rows written before the Sleeper fix store a roster with no opponent as `win = 1` with
 * `pointsAgainst = 0`. Those rows stay in the table until their weeks are re-synced, so every reader
 * derives the result itself: rows are grouped on (week, matchupId), a group of exactly two rows is a
 * game, the higher score wins and equal scores are a tie. Anything else — a roster alone in its
 * matchup, a null matchupId, a group of three — has no result.
 *
 * Pass ONE league-season's rows (and only the rows that count, e.g. scored regular-season weeks);
 * the grouping key has no league or season in it. Rosters with no result are absent from the map.
 */
export type HeadToHeadRow = { week: number; matchupId: number | null; rosterId: string; pointsFor: number }
export type HeadToHeadRecord = { wins: number; losses: number; ties: number }

export function headToHeadRecords(rows: readonly HeadToHeadRow[]): Map<string, HeadToHeadRecord> {
  const groups = new Map<string, HeadToHeadRow[]>()
  for (const r of rows) {
    if (r.matchupId == null) continue
    const key = `${r.week}|${r.matchupId}`
    const group = groups.get(key)
    if (group) group.push(r)
    else groups.set(key, [r])
  }

  const out = new Map<string, HeadToHeadRecord>()
  const recordOf = (rosterId: string) => {
    const rec = out.get(rosterId) ?? { wins: 0, losses: 0, ties: 0 }
    out.set(rosterId, rec)
    return rec
  }
  for (const pair of groups.values()) {
    if (pair.length !== 2) continue
    const [a, b] = pair
    if (a.pointsFor === b.pointsFor) {
      recordOf(a.rosterId).ties += 1
      recordOf(b.rosterId).ties += 1
      continue
    }
    const [win, loss] = a.pointsFor > b.pointsFor ? [a, b] : [b, a]
    recordOf(win.rosterId).wins += 1
    recordOf(loss.rosterId).losses += 1
  }
  return out
}

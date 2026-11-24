/**
 * The Matchup tab's "League scoreboard" for an IMPORTED league: every game of the week, from the
 * stored `WeeklyMatchup` rows the platform sync writes.
 *
 * 🛑 FOUND LIVE 2026-11-23, beside the empty "My matchup" fixed in #4139. The scoreboard route read only
 * `TeamWeekResult`, which no importer writes, so every imported league's scoreboard said "Scores appear
 * here once week N is scored" in the middle of a scored week.
 *
 * PURE — no I/O. Rows pair on `matchupId` (and `game`, for a league that plays several a week); a row
 * with no partner is a bye.
 */
import type { NativeBoardGame, NativeGameStatus } from './nativeMatchupModel'

export type ImportedWeekRow = {
  rosterId: string
  matchupId: number | null
  game: number | null
  pointsFor: number
}

export function importedBoardGames(
  rows: readonly ImportedWeekRow[],
  opts: { nameOf: (rosterId: string) => string; viewerRosterId: string | null; weekFinal: boolean },
): NativeBoardGame[] {
  const groups = new Map<string, ImportedWeekRow[]>()
  for (const r of rows) {
    const key = r.matchupId == null ? `bye:${r.rosterId}:${r.game ?? 1}` : `m:${r.matchupId}:${r.game ?? 1}`
    const list = groups.get(key)
    if (list) list.push(r)
    else groups.set(key, [r])
  }
  const games: NativeBoardGame[] = []
  for (const [key, list] of groups) {
    // The viewer's side on top, so "you" reads first wherever the viewer plays.
    const sorted = [...list].sort((a, b) =>
      a.rosterId === opts.viewerRosterId ? -1 : b.rosterId === opts.viewerRosterId ? 1 : a.rosterId.localeCompare(b.rosterId),
    )
    const [home, away] = sorted
    const scored = sorted.some((r) => r.pointsFor > 0)
    // All-zero rows are a scheduled game, not a 0-0 result: no score is drawn until someone has one.
    const status: NativeGameStatus = !scored ? 'upcoming' : opts.weekFinal ? 'final' : 'live'
    const side = (r: ImportedWeekRow) => ({ rosterId: r.rosterId, teamName: opts.nameOf(r.rosterId), totalPoints: scored ? r.pointsFor : null })
    games.push({
      id: key,
      kind: 'regular',
      label: null,
      status,
      home: side(home),
      away: away ? side(away) : null,
      mine: sorted.some((r) => r.rosterId === opts.viewerRosterId),
    })
  }
  // The viewer's game first, then real games before byes, each in a stable order.
  return games.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(!a.away) - Number(!b.away) || a.id.localeCompare(b.id))
}

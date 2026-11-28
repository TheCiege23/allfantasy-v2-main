import type { GradeLeagueListRow } from '@/components/trade-evaluator/GradeLeaguePicker'

/**
 * Which league the AF Legacy Share tab's "Trade Vote" is graded in (2026-11-26).
 *
 * 🛑 THE SHARE TAB SENT NO LEAGUE, SO EVERY VOTE READ "Not graded — no league is selected".
 * `/api/legacy/trade-vote-analyze` grades through the one grader, and the one grade is taken on a
 * league's own values — so without a `league_id` it can only withhold. The options come from the same
 * read the trade analyzer's picker uses (`GET /api/league/list?summary=1` →
 * `gradeLeagueOptions`), so only a league with a unified AllFantasy row is offered: that id is the one
 * the route's membership gate (`resolveEvaluationLeagueId`) and the grader both accept.
 *
 * The default, when the manager has not chosen: the league whose roster holds the typed players (read
 * off the page's own Sleeper league history and player-name map — no new request), else the most
 * recent league offered. Pure, for the test.
 */

/** A league-list row as `/api/league/list` returns it — what the picker reads, plus the provider ids. */
export type ShareVoteLeagueRow = GradeLeagueListRow & {
  platformLeagueId?: string | null
  sleeperLeagueId?: string | null
}

/** The page's Sleeper league history row, as far as this needs it. */
export type ShareVoteSleeperLeague = {
  league_id: string
  season?: number | null
  roster?: { starters?: string[]; bench?: string[]; reserve?: string[]; taxi?: string[] } | null
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.'’`-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The unified AllFantasy id a list row is graded under, or '' when it has none. */
function unifiedIdOf(row: ShareVoteLeagueRow): string {
  if (!row.hasUnifiedRecord) return ''
  return String(row.unifiedLeagueId ?? row.id ?? '').trim()
}

/** The default league for a vote. Returns '' when no option exists. */
export function defaultShareVoteLeagueId(args: {
  /** Ids the picker offers (`gradeLeagueOptions(rows).map(o => o.id)`). */
  optionIds: ReadonlyArray<string>
  rows: ReadonlyArray<ShareVoteLeagueRow>
  /** Every name typed on either side. */
  typedNames: ReadonlyArray<string>
  sleeperLeagues: ReadonlyArray<ShareVoteSleeperLeague>
  /** Sleeper player id → name, as `/api/legacy/players` returns it. */
  playerNames: Readonly<Record<string, { name?: string | null } | undefined>>
}): string {
  const offered = new Set(args.optionIds)
  if (offered.size === 0) return ''

  // 1. The league whose roster holds the typed players.
  const wanted = new Set(args.typedNames.map(norm).filter(Boolean))
  if (wanted.size > 0) {
    const ids = new Set<string>()
    for (const [id, p] of Object.entries(args.playerNames)) {
      if (p?.name && wanted.has(norm(p.name))) ids.add(id)
    }
    if (ids.size > 0) {
      let best: { afId: string; hits: number; season: number } | null = null
      for (const lg of args.sleeperLeagues) {
        const r = lg.roster
        if (!r) continue
        const held = [...(r.starters ?? []), ...(r.bench ?? []), ...(r.reserve ?? []), ...(r.taxi ?? [])]
        const hits = new Set(held.filter((pid) => ids.has(pid))).size
        if (hits === 0) continue
        const row = args.rows.find(
          (x) => unifiedIdOf(x) && (x.platformLeagueId === lg.league_id || x.sleeperLeagueId === lg.league_id || x.id === lg.league_id),
        )
        const afId = row ? unifiedIdOf(row) : ''
        if (!afId || !offered.has(afId)) continue
        const season = Number(lg.season) || 0
        if (!best || hits > best.hits || (hits === best.hits && season > best.season)) best = { afId, hits, season }
      }
      if (best) return best.afId
    }
  }

  // 2. The most recent league offered; the picker's own order breaks a tie.
  let pick = ''
  let pickSeason = -1
  for (const id of args.optionIds) {
    const season = Math.max(0, ...args.rows.filter((r) => unifiedIdOf(r) === id).map((r) => Number(r.season) || 0))
    if (season > pickSeason) {
      pick = id
      pickSeason = season
    }
  }
  return pick
}

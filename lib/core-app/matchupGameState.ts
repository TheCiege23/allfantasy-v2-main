import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export type StarterGameState = 'upcoming' | 'live' | 'final' | 'unknown'
type Game = { homeTeam: string; awayTeam: string; status: string | null; startTime: Date | null; fetchedAt: Date; seasonType?: string | null }

/**
 * Each club's newest trusted game row, built from the week's games alone.
 *
 * 🛑 CACHED PER GAMES ARRAY, BECAUSE IT DEPENDS ONLY ON THE GAMES. It was rebuilt inside every
 * `starterGameStates` call — and the all-leagues board calls that once per lineup, both sides of
 * every league: 136 calls on one 65-league account, each re-deriving the same index from the same
 * 96 games. Measured 2026-10-03 against production: ~450–570 ms of one board render, more than the
 * win probabilities, the settings read or any single query on the page.
 *
 * The build itself is now one pass — each team normalized once, an untyped row matched through a
 * (home|away) lookup instead of a scan of every fixture. Same rule, same result, pinned against the
 * previous implementation in `__tests__/core-app/matchup-game-state-index.test.ts`. ⚠ The CACHE is
 * the saving: on a 96-game week the one-pass build measured no faster than the old scan, which only
 * normalized a pair once their kickoffs matched (136 calls: 160 ms before, 25 ms cached, 156 ms
 * uncached).
 *
 * ⚠ KEYED ON THE ARRAY, CHECKED ON ITS LENGTH. Every caller builds its games array once and reads
 * it; an array that grows after a first call is rebuilt. One mutated in place at the same length
 * would read a stale index — nothing does that today, and a caller that needs to should pass a new
 * array.
 */
const clubIndexCache = new WeakMap<readonly Game[], { length: number; byClub: Map<string, Game> }>()

function clubIndex(games: readonly Game[]): Map<string, Game> {
  const hit = clubIndexCache.get(games)
  if (hit && hit.length === games.length) return hit.byClub
  const byClub = buildClubIndex(games)
  clubIndexCache.set(games, { length: games.length, byClub })
  return byClub
}

function buildClubIndex(games: readonly Game[]): Map<string, Game> {
  /*
   * String keys keep the original comparison exactly, including its edge: two names that BOTH fail
   * to normalize compared `null === null`, which matched. `String(null)` keeps that; `undefined`
   * stays distinct from `null`, as `===` had it.
   */
  const norm = games.map((g) => ({ home: normalizeTeamAbbrev(g.homeTeam), away: normalizeTeamAbbrev(g.awayTeam) }))
  const fixtureTimes = new Map<string, number[]>()
  games.forEach((g, i) => {
    if (g.seasonType === null || !g.startTime) return
    const key = `${String(norm[i].home)}|${String(norm[i].away)}`
    const list = fixtureTimes.get(key)
    if (list) list.push(g.startTime.getTime())
    else fixtureTimes.set(key, [g.startTime.getTime()])
  })
  // The live-score writer does not persist seasonType. Its updates are safe
  // only when their clubs and kickoff match a known regular-season fixture.
  const candidates: number[] = []
  games.forEach((g, i) => {
    if (g.seasonType !== null) {
      candidates.push(i)
      return
    }
    if (!g.startTime) return
    const at = g.startTime.getTime()
    const times = fixtureTimes.get(`${String(norm[i].home)}|${String(norm[i].away)}`)
    if (times?.some((t) => Math.abs(at - t) < 60_000)) candidates.push(i)
  })
  // Newest provider row first; a stable sort keeps the input order between equal fetches, as before.
  candidates.sort((a, b) => games[b].fetchedAt.getTime() - games[a].fetchedAt.getTime())
  const byClub = new Map<string, Game>()
  for (const i of candidates) {
    for (const club of [norm[i].home, norm[i].away]) {
      if (club && !byClub.has(club)) byClub.set(club, games[i])
    }
  }
  return byClub
}

/** A kickoff alone never proves that a game has finished. Newest provider row wins. */
export function starterGameStates(
  players: ReadonlyMap<string, { team: string | null }>,
  games: Game[],
  now = new Date(),
): Map<string, StarterGameState> {
  const byClub = clubIndex(games)
  return new Map([...players].map(([id, player]) => {
    const game = byClub.get(normalizeTeamAbbrev(player.team) ?? '')
    const status = String(game?.status ?? '').toLowerCase()
    let state: StarterGameState = 'unknown'
    if (game && /^(final|finished|completed?|status_final|status_final_ot)$/.test(status)) state = 'final'
    else if (game && now.getTime() - game.fetchedAt.getTime() <= 3_600_000) {
      if (/^(live|in_progress|inprogress|status_in_progress|halftime|status_halftime)$/.test(status)) state = 'live'
      else if (game.startTime && game.startTime > now && /^(scheduled|pre|not_started|status_scheduled)$/.test(status)) state = 'upcoming'
    }
    return [id, state]
  }))
}

const FINAL_STATUS = /^(final|finished|completed?|status_final|status_final_ot)$/

/**
 * Has every REGULAR-SEASON game of one week been played to a final?
 *
 * 🛑 WHY. A fantasy week's scores read "so far" until the platform's league settings move to the
 * next week — and Sleeper does not do that until Wednesday. On Tuesday 2026-09-29, with every
 * week-3 game final, the home still said "Week 3 · scores so far · 0% win" and Your Week said
 * "−40.8 so far". The schedule already knew: all 16 regular-season week-3 fixtures read `final`
 * in every source. This answers from it, under the same rule as `starterGameStates` — a kickoff
 * alone never proves a game finished; only a final status does.
 *
 * ⚠ REGULAR SEASON ONLY, AND NOT MERELY "seasonType IS NOT NULL". Preseason weeks reuse the
 * numbers 1–4 (`seasonType: 'pre'`), and the live-score writer stores rows with NO seasonType,
 * preseason ones included — measured the same day: `espn_live` held week-3 rows from August.
 * A fixture is a `regular` row; an untyped row only counts as a newer reading of one of them
 * (same clubs, kickoff within a minute), exactly as above.
 *
 * Several sources describe each game and can disagree while one lags, so each fixture is read
 * from its NEWEST row. No regular-season fixture at all means "not known to be finished" — false.
 */
export function weekFinished(games: Game[]): boolean {
  const key = (g: Game) => {
    const teams = [normalizeTeamAbbrev(g.homeTeam), normalizeTeamAbbrev(g.awayTeam)]
    if (!g.startTime || teams.some((t) => !t)) return null
    return { minute: Math.round(g.startTime.getTime() / 60_000), clubs: [...teams].sort().join('|') }
  }
  const newest = new Map<string, Game>()
  const fixtures = games.filter((g) => g.seasonType === 'regular')
  for (const f of fixtures) {
    const k = key(f)
    if (!k) continue
    const id = `${k.minute}|${k.clubs}`
    for (const g of games) {
      if (g.seasonType !== 'regular' && g.seasonType != null) continue
      const gk = key(g)
      if (!gk || gk.clubs !== k.clubs || Math.abs(gk.minute - k.minute) > 1) continue
      const prior = newest.get(id)
      if (!prior || g.fetchedAt > prior.fetchedAt) newest.set(id, g)
    }
  }
  if (newest.size === 0) return false
  return [...newest.values()].every((g) => FINAL_STATUS.test(String(g.status ?? '').toLowerCase()))
}

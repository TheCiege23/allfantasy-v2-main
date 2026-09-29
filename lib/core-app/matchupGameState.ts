import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

export type StarterGameState = 'upcoming' | 'live' | 'final' | 'unknown'
type Game = { homeTeam: string; awayTeam: string; status: string | null; startTime: Date | null; fetchedAt: Date; seasonType?: string | null }

/** A kickoff alone never proves that a game has finished. Newest provider row wins. */
export function starterGameStates(
  players: ReadonlyMap<string, { team: string | null }>,
  games: Game[],
  now = new Date(),
): Map<string, StarterGameState> {
  const byClub = new Map<string, Game>()
  const canonical = games.filter((game) => game.seasonType !== null)
  // The live-score writer does not persist seasonType. Its updates are safe
  // only when their clubs and kickoff match a known regular-season fixture.
  const candidates = games.filter((game) => game.seasonType !== null || canonical.some((fixture) =>
    game.startTime && fixture.startTime && Math.abs(game.startTime.getTime() - fixture.startTime.getTime()) < 60_000 &&
    normalizeTeamAbbrev(game.homeTeam) === normalizeTeamAbbrev(fixture.homeTeam) &&
    normalizeTeamAbbrev(game.awayTeam) === normalizeTeamAbbrev(fixture.awayTeam)))
  for (const game of [...candidates].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())) {
    for (const team of [game.homeTeam, game.awayTeam]) {
      const club = normalizeTeamAbbrev(team)
      if (club && !byClub.has(club)) byClub.set(club, game)
    }
  }
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

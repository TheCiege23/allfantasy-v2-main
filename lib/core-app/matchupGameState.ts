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

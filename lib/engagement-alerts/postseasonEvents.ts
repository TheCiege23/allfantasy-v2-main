import type { GameAlert, GameObservation } from './gameEvents'

/** Use provider-completed series and named rounds, never a headline or a guessed wins threshold. */
export function postseasonAlerts(sport: string, game: GameObservation, now = Date.now()): GameAlert[] {
  if (!game.completed || game.homeScore == null || game.awayScore == null || !game.startTime || now - Date.parse(game.startTime) > 12 * 3600_000 || Date.parse(game.startTime) > now || !Number.isFinite(Date.parse(game.startTime))) return []
  const round = game.eventName ?? ''
  if (!/\b(ALCS|NLCS|ALDS|NLDS|ALWC|NLWC|World Series|playoffs?|finals?|championship|Super Bowl|MLS Cup)\b/i.test(round)) return []
  let winner: string | null = null
  if (game.playoffSeries?.completed && game.playoffSeries.winnerTeamId) {
    winner = game.playoffSeries.winnerTeamId === game.homeTeamId ? game.homeTeam : game.playoffSeries.winnerTeamId === game.awayTeamId ? game.awayTeam : null
  } else if (!game.playoffSeries && ['NFL', 'NCAAF', 'NCAAB'].includes(sport) && game.homeScore != null && game.awayScore != null && game.homeScore !== game.awayScore) {
    winner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam
  }
  if (!winner) return []
  const label = round.replace(/\s*[-–]\s*Game \d+.*$/i, '').trim()
  return [{ key: `postseason:${game.season}:${label}:${winner}`, type: 'postseason_clinch', title: `${sport}: ${winner} clinches ${label}`, body: `${winner} wins ${label}. ${game.awayTeam} ${game.awayScore} — ${game.homeTeam} ${game.homeScore}.` }]
}

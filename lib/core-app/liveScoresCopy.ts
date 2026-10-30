/**
 * Spanish copy for the in-shell Live Scores screen (`components/core-app/screens/LiveScores.tsx`).
 *
 * Every function returns its English input (or the exact English sentence the screen printed before)
 * in any language but Spanish, so the English screen is byte-identical. Exact-match strings live in
 * `ES`; sentences carrying numbers or names get their own function, which reads both languages from
 * the `liveScoresMessages` catalog (lib/core-app/messages/liveScores.ts), as do the label localisers.
 *
 * Style: informal "tú", Latin-American neutral. Proper nouns, team abbreviations, player names, sport
 * codes and product names (AllFantasy, Chimmy) stay as they are.
 */

import { messagesFor } from '@/lib/i18n/messages'
import { liveScoresMessages } from '@/lib/core-app/messages/liveScores'

const ES: Record<string, string> = {
  // Header and controls
  'Core · Live': 'En vivo',
  'Live Scores': 'Marcadores en vivo',
  'Only games affecting starters in this league, scored with this league’s rules.':
    'Solo los partidos que afectan a tus titulares en esta liga, con las reglas de puntuación de esta liga.',
  'Games affecting your starters across all leagues. Points follow each league’s scoring.':
    'Partidos que afectan a tus titulares en todas tus ligas. Los puntos siguen la puntuación de cada liga.',
  'All games, with your roster contributions highlighted where available.':
    'Todos los partidos, con los aportes de tu plantilla destacados cuando están disponibles.',
  'Which games to show': 'Qué partidos mostrar',
  'My games': 'Mis partidos',
  'All games': 'Todos los partidos',
  'Search team, game, or your player': 'Busca equipo, partido o tu jugador',
  'Search this live scoreboard by team, game, player, or league':
    'Busca en este marcador en vivo por equipo, partido, jugador o liga',
  'Refreshing scores': 'Actualizando marcadores',
  'Refresh scores': 'Actualizar marcadores',
  'Refreshing…': 'Actualizando…',
  Sport: 'Deporte',

  // Connection state (labels from lib/live/connectionState)
  Offline: 'Sin conexión',
  Reconnecting: 'Reconectando',
  Delayed: 'Con retraso',
  Live: 'En vivo',
  Idle: 'En pausa',
  'No connection — these scores are the last we received.':
    'Sin conexión: estos son los últimos marcadores que recibimos.',
  'Trying to reach the feed. Showing the last scores we received.':
    'Intentando conectar con la fuente. Mostramos los últimos marcadores que recibimos.',
  'The feed has not updated for a while. These scores may be behind.':
    'La fuente no se actualiza desde hace un rato. Estos marcadores podrían estar atrasados.',

  // Slate
  'this league': 'esta liga',
  'your starters · live first, then most leagues affected':
    'tus titulares · en vivo primero, luego los que afectan más ligas',
  'all games · live first': 'todos los partidos · en vivo primero',
  'Showing every game.': 'Mostrando todos los partidos.',
  'Top 25 and your teams only': 'Solo Top 25 y tus equipos',
  'Show all games': 'Mostrar todos los partidos',
  'Try a team name, abbreviation, rostered player, or league name.':
    'Prueba con el nombre de un equipo, una abreviatura, un jugador de tu plantilla o el nombre de una liga.',

  // Side panel
  'Your live impact': 'Tu impacto en vivo',
  'Contributions by league': 'Aportes por liga',
  'Actual points from games on this slate. Remaining is a player count, not a projection. Different league scoring totals are not comparable.':
    'Puntos reales de los partidos de esta jornada. «Restantes» es un conteo de jugadores, no una proyección. Los totales de ligas con puntuación distinta no son comparables.',
  Completed: 'Completados',
  Remaining: 'Restantes',
  'No roster contributions available for this view.':
    'No hay aportes de plantilla disponibles para esta vista.',
  'Latest for you': 'Lo último para ti',
  'Live plays': 'Jugadas en vivo',
  'Up next for you': 'Lo próximo para ti',
  'Scores come from the official feed. AllFantasy only reads your leagues — nothing here changes anything on your platform.':
    'Los marcadores vienen de la fuente oficial. AllFantasy solo lee tus ligas: nada de aquí cambia nada en tu plataforma.',

  // Impact summary
  'we could not read your rosters': 'no pudimos leer tus plantillas',
  'This is a problem on our end, not an empty roster. The scores themselves are fine.':
    'Es un problema de nuestra parte, no una plantilla vacía. Los marcadores en sí están bien.',
  'None of your starters are on this slate.': 'Ninguno de tus titulares juega en esta jornada.',
  'no roster to score against yet': 'aún no hay plantilla para puntuar',
  'Claim your team in one of your leagues and this fills in automatically.':
    'Vincula tu equipo en una de tus ligas y esto se completará automáticamente.',

  // Game card
  'Gamecast →': 'Seguir en vivo →',
  'Game details →': 'Detalles del partido →',
  'Last play': 'Última jugada',
  'Win prob · est': 'Prob. de victoria · est.',
  Team: 'Equipo',
  'Red zone': 'Zona roja',
  Ball: 'Balón',
  'Bases empty': 'Bases vacías',
  Pitching: 'Lanzando',
  'At bat': 'Al bate',
  'Not from this game — it has not kicked off.': 'No son de este partido: aún no ha comenzado.',
  'Game leaders': 'Líderes del partido',
  'Top performer': 'Mejor actuación',
  'has the ball': 'tiene el balón',
  Possession: 'Posesión',
  'Final games': 'Partidos finalizados',
  'Show fewer': 'Mostrar menos',
  'BIG PLAY': 'JUGADA GRANDE',
  TURNOVER: 'PÉRDIDA',

  // Pre-kickoff leaders captions
  'Before kickoff · form so far': 'Antes del inicio · rendimiento hasta ahora',
  "Last season's highlight players": 'Jugadores destacados de la temporada pasada',
  "Last week's highlight players": 'Jugadores destacados de la semana pasada',
  'Season highlight players so far': 'Jugadores destacados de la temporada hasta ahora',

  // Empty states
  'Scores could not be loaded.': 'No se pudieron cargar los marcadores.',
  'This is a problem on our end, not an empty slate — there may well be games on. Retrying automatically.':
    'Es un problema de nuestra parte, no una jornada vacía: puede que sí haya partidos. Reintentando automáticamente.',
  'No Top 25 games on this slate.': 'No hay partidos del Top 25 en esta jornada.',
  'Follow a team': 'Sigue a un equipo',
  ' to always see its games.': ' para ver siempre sus partidos.',
  'We could not read your rosters.': 'No pudimos leer tus plantillas.',
  'The scores themselves are fine — this is a problem on our end, so we cannot say which games involve your players. Switch to All games to see the full slate meanwhile.':
    'Los marcadores en sí están bien: es un problema de nuestra parte, así que no podemos decir qué partidos involucran a tus jugadores. Mientras tanto, cambia a Todos los partidos para ver la jornada completa.',
  'None of your players are playing right now.': 'Ninguno de tus jugadores está jugando ahora mismo.',
  'No games on this slate.': 'No hay partidos en esta jornada.',
  'Switch to All games to see the rest of the slate.':
    'Cambia a Todos los partidos para ver el resto de la jornada.',
  'Nothing is scheduled in this window.': 'No hay nada programado en este horario.',

  // Lock warning
  'Lineup decision closing': 'Se cierra una decisión de alineación',
  'under a minute': 'menos de un minuto',
  'Change it on your platform — AllFantasy cannot set your lineup for you. Leagues that lock weekly may already be closed.':
    'Cámbiala en tu plataforma: AllFantasy no puede fijar tu alineación por ti. Las ligas que se bloquean semanalmente podrían estar cerradas ya.',
}

/** The number- and name-carrying sentences, in the reader's language (lib/core-app/messages/liveScores.ts). */
const msg = (language: string | null | undefined) => messagesFor(liveScoresMessages, language)

/** Exact-match lookup. English (or any untranslated string) comes back unchanged. */
export function liveScoresCopy(english: string, language: string | null | undefined): string {
  return msg(language).exact(english, ES[english])
}

/** " · updated 12s ago" */
export function updatedAgo(age: string, language: string | null | undefined): string {
  return msg(language).updatedAgo(age)
}

/** Sport tab badge: "3 games in slate" */
export function slateCountAria(n: number, language: string | null | undefined): string {
  return msg(language).slateCountAria(n)
}

/** "Top 25 and teams you follow · 4 other games hidden." */
export function top25HiddenNote(n: number, language: string | null | undefined): string {
  return msg(language).top25HiddenNote(n)
}

/** Empty-slate body when the Top 25 filter hid everything. */
export function top25EmptyBody(n: number, language: string | null | undefined): string {
  return msg(language).top25EmptyBody(n)
}

/** "No scoreboard match for “query”." */
export function noScoreboardMatch(query: string, language: string | null | undefined): string {
  return msg(language).noScoreboardMatch(query)
}

/** "3 player scores unavailable; totals are partial." */
export function missingScores(n: number, language: string | null | undefined): string {
  return msg(language).missingScores(n)
}

/** "starters playing now in this league" */
export function startersPlayingNow(n: number, leagueScoped: boolean, language: string | null | undefined): string {
  return msg(language).startersPlayingNow(n, leagueScoped)
}

/** Spanish twin of `starterStageDetail` in lib/live/liveImpact. */
export function starterStageDetailCopy(
  impact: { livePlayers: number; liveGames: number; upcomingPlayers?: number; finishedPlayers?: number },
  english: string,
  language: string | null | undefined,
): string {
  return msg(language).starterStageDetail(english, impact)
}

/** "None on the field right now · <detail>" */
export function noneOnField(detail: string, language: string | null | undefined): string {
  return msg(language).noneOnField(detail)
}

/** Localises `playAgeLabel` output: "just now", "4 min ago", "2 hr ago". */
export function playAgeCopy(label: string, language: string | null | undefined): string {
  return msg(language).playAge(label)
}

/** Localises projection labels from lib/live/liveTieInGroups: "out", "proj 14.2", "proj 9.1–12.0". */
export function projectionCopy(label: string, language: string | null | undefined): string {
  return msg(language).projection(label)
}

/** Card tag: "NFL · Week 6" */
export function weekLabel(sport: string, week: number, language: string | null | undefined): string {
  return msg(language).weekLabel(sport, week)
}

/** Highlight video title. */
export function highlightTitle(away: string, home: string, language: string | null | undefined): string {
  return msg(language).highlightTitle(away, home)
}

/** Field strip aria-label prefix: "KC ball" */
export function teamBall(abbrev: string, language: string | null | undefined): string {
  return msg(language).teamBall(abbrev)
}

/** Diamond aria-label: "Runners on first and second" */
export function runnersOn(bases: readonly string[], language: string | null | undefined): string {
  if (bases.length === 0) return liveScoresCopy('Bases empty', language)
  return msg(language).runnersOn(bases)
}

/** Diamond aria-label suffix: ", 2-1 count, 1 out" */
export function countSuffix(balls: number, strikes: number, outs: number, language: string | null | undefined): string {
  return msg(language).countSuffix(balls, strikes, outs)
}

/** "KC 2 timeouts left" */
export function timeoutsLeft(abbrev: string, left: number, language: string | null | undefined): string {
  return msg(language).timeoutsLeft(abbrev, left)
}

/** "KC leaders" */
export function teamLeaders(abbrev: string, language: string | null | undefined): string {
  return msg(language).teamLeaders(abbrev)
}

/** "Final · 3 games" */
export function finalCount(n: number, language: string | null | undefined): string {
  return msg(language).finalCount(n)
}

/** "2 starters" */
export function starterCount(n: number, language: string | null | undefined): string {
  return msg(language).starterCount(n)
}

/** " · top " before the best starter's name. */
export function topPrefix(language: string | null | undefined): string {
  return msg(language).topPrefix
}

/** "Your starters · 3 players · 2 leagues" */
export function yourStartersHead(players: number, leagues: number, language: string | null | undefined): string {
  return msg(language).yourStartersHead(players, leagues)
}

/** "Show all 12 starters" */
export function showAllStarters(n: number, language: string | null | undefined): string {
  return msg(language).showAllStarters(n)
}

/** "2 leagues" */
export function leagueCount(n: number, language: string | null | undefined): string {
  return msg(language).leagueCount(n)
}

/** Starter-row points tooltip before kickoff. */
export function projectionTitle(leagueName: string | null, language: string | null | undefined): string {
  return msg(language).projectionTitle(leagueName)
}

/** "Points in <league>" */
export function pointsIn(leagueName: string, language: string | null | undefined): string {
  return msg(language).pointsIn(leagueName)
}

/** "3 lineup decisions closing" */
export function lineupDecisionsClosing(n: number, language: string | null | undefined): string {
  if (n === 1) return liveScoresCopy('Lineup decision closing', language)
  return msg(language).lineupDecisionsClosing(n)
}

/** "kicks off in 12m" */
export function kicksOffIn(countdown: string, language: string | null | undefined): string {
  return msg(language).kicksOffIn(countdown)
}

/** "2 benched, 1 starting · 2 leagues" — Spanish twin of the screen's `describeLockExposure`. */
export function lockExposure(
  alert: { bench: number; starters: number; leagues: { leagueName: string }[] },
  language: string | null | undefined,
): string {
  const m = msg(language)
  const parts: string[] = []
  if (alert.bench > 0) parts.push(m.lockBenched(alert.bench))
  if (alert.starters > 0) {
    parts.push(m.lockStarting(alert.starters))
  }
  const leagues =
    alert.leagues.length === 1
      ? alert.leagues[0]!.leagueName
      : m.lockLeagues(alert.leagues.length)
  return `${parts.join(', ')} · ${leagues}`
}

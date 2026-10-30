/**
 * Spanish copy for the in-shell Live Scores screen (`components/core-app/screens/LiveScores.tsx`).
 *
 * Every function returns its English input (or the exact English sentence the screen printed before)
 * unless `language === 'es'`, so the English screen is byte-identical. Exact-match strings live in
 * `ES`; sentences carrying numbers or names get their own function.
 *
 * Style: informal "tú", Latin-American neutral. Proper nouns, team abbreviations, player names, sport
 * codes and product names (AllFantasy, Chimmy) stay as they are.
 */

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

const isEs = (language: string | null | undefined) => language === 'es'

/** Exact-match lookup. English (or any untranslated string) comes back unchanged. */
export function liveScoresCopy(english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  return ES[english] ?? english
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** " · updated 12s ago" */
export function updatedAgo(age: string, language: string | null | undefined): string {
  return isEs(language) ? ` · actualizado hace ${age}` : ` · updated ${age} ago`
}

/** Sport tab badge: "3 games in slate" */
export function slateCountAria(n: number, language: string | null | undefined): string {
  return isEs(language)
    ? `${n} ${plural(n, 'partido', 'partidos')} en la jornada`
    : `${n} ${plural(n, 'game', 'games')} in slate`
}

/** "Top 25 and teams you follow · 4 other games hidden." */
export function top25HiddenNote(n: number, language: string | null | undefined): string {
  return isEs(language)
    ? `Top 25 y equipos que sigues · ${n} ${plural(n, 'partido más oculto', 'partidos más ocultos')}.`
    : `Top 25 and teams you follow · ${n} other ${plural(n, 'game', 'games')} hidden.`
}

/** Empty-slate body when the Top 25 filter hid everything. */
export function top25EmptyBody(n: number, language: string | null | undefined): string {
  return isEs(language)
    ? `${n} ${plural(n, 'partido entre equipos sin ranking está oculto', 'partidos entre equipos sin ranking están ocultos')}.`
    : `${n} ${plural(n, 'game', 'games')} between unranked teams ${plural(n, 'is', 'are')} hidden.`
}

/** "No scoreboard match for “query”." */
export function noScoreboardMatch(query: string, language: string | null | undefined): string {
  return isEs(language)
    ? `Ningún resultado en el marcador para “${query}”.`
    : `No scoreboard match for “${query}”.`
}

/** "3 player scores unavailable; totals are partial." */
export function missingScores(n: number, language: string | null | undefined): string {
  return isEs(language)
    ? `${n} ${plural(n, 'puntuación de jugador no disponible', 'puntuaciones de jugadores no disponibles')}; los totales son parciales.`
    : `${n} player scores unavailable; totals are partial.`
}

/** "starters playing now in this league" */
export function startersPlayingNow(n: number, leagueScoped: boolean, language: string | null | undefined): string {
  if (isEs(language)) {
    return `${plural(n, 'titular jugando', 'titulares jugando')} ahora${leagueScoped ? ' en esta liga' : ''}`
  }
  return `${plural(n, 'starter', 'starters')} playing now${leagueScoped ? ' in this league' : ''}`
}

/** Spanish twin of `starterStageDetail` in lib/live/liveImpact. */
export function starterStageDetailCopy(
  impact: { livePlayers: number; liveGames: number; upcomingPlayers?: number; finishedPlayers?: number },
  english: string,
  language: string | null | undefined,
): string {
  if (!isEs(language)) return english
  const parts: string[] = []
  if (impact.livePlayers > 0) parts.push(`en ${impact.liveGames} ${plural(impact.liveGames, 'partido', 'partidos')}`)
  if (impact.upcomingPlayers) parts.push(`${impact.upcomingPlayers} por jugar`)
  if (impact.finishedPlayers) parts.push(`${impact.finishedPlayers} ${plural(impact.finishedPlayers, 'terminado', 'terminados')}`)
  return parts.join(' · ')
}

/** "None on the field right now · <detail>" */
export function noneOnField(detail: string, language: string | null | undefined): string {
  return isEs(language) ? `Ninguno en el campo ahora mismo · ${detail}` : `None on the field right now · ${detail}`
}

/** Localises `playAgeLabel` output: "just now", "4 min ago", "2 hr ago". */
export function playAgeCopy(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  if (label === 'just now') return 'justo ahora'
  const min = /^(\d+) min ago$/.exec(label)
  if (min) return `hace ${min[1]} min`
  const hr = /^(\d+) hr ago$/.exec(label)
  if (hr) return `hace ${hr[1]} h`
  return label
}

/** Localises projection labels from lib/live/liveTieInGroups: "out", "proj 14.2", "proj 9.1–12.0". */
export function projectionCopy(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  if (label === 'out') return 'fuera'
  if (label.startsWith('proj ')) return `proy. ${label.slice(5)}`
  return label
}

/** Card tag: "NFL · Week 6" */
export function weekLabel(sport: string, week: number, language: string | null | undefined): string {
  return isEs(language) ? `${sport} · Semana ${week}` : `${sport} · Week ${week}`
}

/** Highlight video title. */
export function highlightTitle(away: string, home: string, language: string | null | undefined): string {
  return isEs(language) ? `Resumen: ${away} en ${home}` : `${away} at ${home} highlights`
}

/** Field strip aria-label prefix: "KC ball" */
export function teamBall(abbrev: string, language: string | null | undefined): string {
  return isEs(language) ? `Balón de ${abbrev}` : `${abbrev} ball`
}

const BASE_ES: Record<string, string> = { first: 'primera', second: 'segunda', third: 'tercera' }

/** Diamond aria-label: "Runners on first and second" */
export function runnersOn(bases: readonly string[], language: string | null | undefined): string {
  if (bases.length === 0) return liveScoresCopy('Bases empty', language)
  if (isEs(language)) {
    return `${plural(bases.length, 'Corredor', 'Corredores')} en ${bases.map((b) => BASE_ES[b] ?? b).join(' y ')}`
  }
  return `Runner${bases.length > 1 ? 's' : ''} on ${bases.join(' and ')}`
}

/** Diamond aria-label suffix: ", 2-1 count, 1 out" */
export function countSuffix(balls: number, strikes: number, outs: number, language: string | null | undefined): string {
  return isEs(language)
    ? `, cuenta ${balls}-${strikes}, ${outs} ${plural(outs, 'out', 'outs')}`
    : `, ${balls}-${strikes} count, ${outs} ${plural(outs, 'out', 'outs')}`
}

/** "KC 2 timeouts left" */
export function timeoutsLeft(abbrev: string, left: number, language: string | null | undefined): string {
  return isEs(language)
    ? `${abbrev}: ${left} ${plural(left, 'tiempo muerto restante', 'tiempos muertos restantes')}`
    : `${abbrev} ${left} timeouts left`
}

/** "KC leaders" */
export function teamLeaders(abbrev: string, language: string | null | undefined): string {
  return isEs(language) ? `Líderes de ${abbrev}` : `${abbrev} leaders`
}

/** "Final · 3 games" */
export function finalCount(n: number, language: string | null | undefined): string {
  return isEs(language)
    ? `Final · ${n} ${plural(n, 'partido', 'partidos')}`
    : `Final · ${n} ${plural(n, 'game', 'games')}`
}

/** "2 starters" */
export function starterCount(n: number, language: string | null | undefined): string {
  return isEs(language)
    ? `${n} ${plural(n, 'titular', 'titulares')}`
    : `${n} ${plural(n, 'starter', 'starters')}`
}

/** " · top " before the best starter's name. */
export function topPrefix(language: string | null | undefined): string {
  return isEs(language) ? ' · mejor ' : ' · top '
}

/** "Your starters · 3 players · 2 leagues" */
export function yourStartersHead(players: number, leagues: number, language: string | null | undefined): string {
  return isEs(language)
    ? `Tus titulares · ${players} ${plural(players, 'jugador', 'jugadores')} · ${leagues} ${plural(leagues, 'liga', 'ligas')}`
    : `Your starters · ${players} ${plural(players, 'player', 'players')} · ${leagues} ${plural(leagues, 'league', 'leagues')}`
}

/** "Show all 12 starters" */
export function showAllStarters(n: number, language: string | null | undefined): string {
  return isEs(language) ? `Mostrar los ${n} titulares` : `Show all ${n} starters`
}

/** "2 leagues" */
export function leagueCount(n: number, language: string | null | undefined): string {
  return isEs(language) ? `${n} ${plural(n, 'liga', 'ligas')}` : `${n} ${plural(n, 'league', 'leagues')}`
}

/** Starter-row points tooltip before kickoff. */
export function projectionTitle(leagueName: string | null, language: string | null | undefined): string {
  if (isEs(language)) {
    return `Proyección de esta semana${leagueName ? ` en ${leagueName}` : ''}, según la puntuación de cada liga`
  }
  return `Projection for this week${leagueName ? ` in ${leagueName}` : ''}, under each league’s own scoring`
}

/** "Points in <league>" */
export function pointsIn(leagueName: string, language: string | null | undefined): string {
  return isEs(language) ? `Puntos en ${leagueName}` : `Points in ${leagueName}`
}

/** "3 lineup decisions closing" */
export function lineupDecisionsClosing(n: number, language: string | null | undefined): string {
  if (n === 1) return liveScoresCopy('Lineup decision closing', language)
  return isEs(language) ? `Se cierran ${n} decisiones de alineación` : `${n} lineup decisions closing`
}

/** "kicks off in 12m" */
export function kicksOffIn(countdown: string, language: string | null | undefined): string {
  return isEs(language) ? `empieza en ${countdown}` : `kicks off in ${countdown}`
}

/** "2 benched, 1 starting · 2 leagues" — Spanish twin of the screen's `describeLockExposure`. */
export function lockExposure(
  alert: { bench: number; starters: number; leagues: { leagueName: string }[] },
  language: string | null | undefined,
): string {
  const es = isEs(language)
  const parts: string[] = []
  if (alert.bench > 0) parts.push(es ? `${alert.bench} en la banca` : `${alert.bench} benched`)
  if (alert.starters > 0) {
    parts.push(es ? `${alert.starters} ${plural(alert.starters, 'titular', 'titulares')}` : `${alert.starters} starting`)
  }
  const leagues =
    alert.leagues.length === 1
      ? alert.leagues[0]!.leagueName
      : es
        ? `${alert.leagues.length} ligas`
        : `${alert.leagues.length} leagues`
  return `${parts.join(', ')} · ${leagues}`
}

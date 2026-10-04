/**
 * Spanish for the explanations the Matchup screen prints from the server (2026-10-03).
 *
 * 🛑 WHY THIS EXISTS. Every `{ available: false, reason }` the matchup loaders return, and the win
 * probability's `detail` line, is written in English on the server — and the server render does not
 * know the reader's language (`page.tsx` reads no language, and switching language re-renders only
 * client components). So a Spanish reader saw an English sentence wherever the screen explained a
 * gap. The owner's ask: when the language switches, ALL the wording switches.
 *
 * So the screen translates at render, in the client, where the language is known and a switch takes
 * effect at once. Fixed sentences map exactly; parameterised ones by pattern. A string not listed
 * here falls back to the English original — never to a blank — and
 * `__tests__/core-app/matchup-reason-text.test.ts` scans the producing modules so a NEW English
 * reason without a Spanish line fails the suite instead of shipping.
 *
 * PURE and client-safe: no imports, so it can be bundled into the screen.
 */

const EXACT_ES: Record<string, string> = {
  // lib/core-app/matchup.ts
  'no matchup resolved, so there are no teams to name':
    'no se resolvió ningún enfrentamiento, así que no hay equipos que nombrar',
  'no matchup resolved, so there are no lineups to pair':
    'no se resolvió ningún enfrentamiento, así que no hay alineaciones que emparejar',
  'no matchup resolved, so no per-player scoring was looked for':
    'no se resolvió ningún enfrentamiento, así que no se buscaron puntos por jugador',
  'no matchup resolved, so there is nothing to project':
    'no se resolvió ningún enfrentamiento, así que no hay nada que proyectar',
  'Starter game states are unavailable until both lineups can be read.':
    'El estado de los partidos de los titulares no está disponible hasta que se puedan leer ambas alineaciones.',
  'this league has no platform id, so its weekly results cannot be located':
    'esta liga no tiene identificador de plataforma, así que no se pueden localizar sus resultados semanales',
  'a guillotine league is scored against the whole field each week, so there is no single opponent':
    'una liga guillotina se puntúa contra toda la liga cada semana, así que no hay un único rival',
  'no weekly results stored for this league': 'no hay resultados semanales guardados para esta liga',
  'we cannot tell which team in this league is yours, so there is no matchup to show':
    'no podemos saber cuál es tu equipo en esta liga, así que no hay enfrentamiento que mostrar',
  'both full rosters could not be verified': 'no se pudieron verificar ambas plantillas completas',
  'full rosters cannot be projected': 'no se pueden proyectar las plantillas completas',
  'we could not match both sides of this matchup to an imported roster':
    'no pudimos vincular ambos lados de este enfrentamiento con una plantilla importada',
  'neither roster has a starting lineup stored for this week':
    'ninguna plantilla tiene una alineación titular guardada para esta semana',

  // lib/core-app/matchupForecast.ts (and lib/projections/winProbability.ts)
  'Best Ball win probability needs a full-roster outcome model; a probability from one projected optimal lineup would overstate certainty.':
    'La probabilidad de victoria en Best Ball necesita un modelo de resultados de la plantilla completa; una probabilidad basada en una sola alineación óptima proyectada exageraría la certeza.',
  'Some starter game states are unavailable, so remaining points and win probability cannot be verified.':
    'El estado de algunos partidos de los titulares no está disponible, así que no se pueden verificar los puntos restantes ni la probabilidad de victoria.',
  "points are already on the board, but this league's per-player scores have not been imported, so we cannot tell how much of each starter's projection is still to come":
    'ya hay puntos en el marcador, pero los puntos por jugador de esta liga no se han importado, así que no podemos saber cuánto de la proyección de cada titular falta por llegar',
  'no starters on file for one side of this matchup':
    'no hay titulares registrados para uno de los lados de este enfrentamiento',
  'all starters final — this matchup is tied': 'todos los titulares terminaron — este enfrentamiento está empatado',
  'a win probability needs both lineups priced — and a ratio of current points would not be a probability':
    'una probabilidad de victoria necesita ambas alineaciones valoradas — y una proporción de los puntos actuales no sería una probabilidad',

  'Assumes starters score independently. Same-team stacks correlate, so extreme probabilities are overstated.':
    'Supone que los titulares puntúan de forma independiente. Los jugadores del mismo equipo están correlacionados, así que las probabilidades extremas están exageradas.',

  // lib/projections/leagueScoring.ts
  'we hold no scoring settings for this league, and a generic projection would not be yours':
    'no tenemos la configuración de puntuación de esta liga, y una proyección genérica no sería la tuya',

  // lib/core-app/playerProjections.ts — My Team's matchup card relays it (`nextMatchup.unpricedReason`)
  "no starter could be priced under this league's scoring — the projection feed does not carry these players, or this league's rules do not cover their stat lines":
    'no se pudo valorar a ningún titular con la puntuación de esta liga — el feed de proyecciones no incluye a estos jugadores, o las reglas de esta liga no cubren sus estadísticas',

  // lib/core-app/bestBallForecast.ts
  'the league has no verified starting-slot template': 'la liga no tiene una plantilla de posiciones titulares verificada',
  'the full roster is unavailable': 'la plantilla completa no está disponible',
  'points are on the board but player scoring has not been imported':
    'hay puntos en el marcador, pero los puntos por jugador no se han importado',
  'a roster player has no verified position': 'un jugador de la plantilla no tiene una posición verificada',
  'a roster player has no verified game state': 'un jugador de la plantilla no tiene un estado de partido verificado',
  'a live or finished roster player has no imported score':
    'un jugador de la plantilla en juego o ya terminado no tiene puntos importados',
  'a roster player cannot be projected under this league’s scoring rules':
    'un jugador de la plantilla no se puede proyectar con las reglas de puntuación de esta liga',
  'eligible roster players cannot fill every starting slot':
    'los jugadores elegibles de la plantilla no pueden cubrir todas las posiciones titulares',
}

const starters = (n: number) => (n === 1 ? '1 titular' : `${n} titulares`)

const PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^your team has no result stored for week (\d+)$/, (m) => `tu equipo no tiene resultado guardado para la semana ${m[1]}`],
  [
    /^week (\d+) is on file but nothing has been scored — this is an unplayed week, not a 0-0 game$/,
    (m) => `la semana ${m[1]} está registrada pero no se ha anotado nada — es una semana sin jugar, no un 0-0`,
  ],
  [
    /^(\d+) starters? could not be priced under this league's scoring — no projection on file, or stats its rules do not cover — and counting them as zero would tilt the result toward the other side$/,
    (m) =>
      `${starters(Number(m[1]))} no se ${m[1] === '1' ? 'pudo' : 'pudieron'} valorar con la puntuación de esta liga — no hay proyección registrada, o estadísticas que sus reglas no cubren — y contar${m[1] === '1' ? 'lo' : 'los'} como cero inclinaría el resultado hacia el otro lado`,
  ],
  [
    /^(\d+) starters? still to play have no projection — treating them as zero would tilt the result toward the other side$/,
    (m) =>
      `${starters(Number(m[1]))} por jugar sin proyección — contar${m[1] === '1' ? 'lo' : 'los'} como cero inclinaría el resultado hacia el otro lado`,
  ],
  [/^all starters final — decided by ([\d.]+)$/, (m) => `todos los titulares terminaron — decidido por ${m[1]}`],
  [
    /^no starter could be priced for (\d+) week (\d+) — the feed does not cover this week, or this league's rules cannot score its stat lines$/,
    (m) =>
      `no se pudo valorar a ningún titular para la semana ${m[2]} de ${m[1]} — el feed no cubre esta semana, o las reglas de esta liga no pueden puntuar sus estadísticas`,
  ],
  [
    /^no per-player scoring has been ingested for (\d+) week (\d+), so each column below is a projection priced under this league's rules — not a live score$/,
    (m) =>
      `aún no se han importado los puntos por jugador de la semana ${m[2]} de ${m[1]}, así que cada columna de abajo es una proyección valorada con las reglas de esta liga — no un marcador en vivo`,
  ],
  [
    /^(\d+) starters? (?:still to play|with scoring remaining), ([\d.]+) projected points outstanding$/,
    (m) => `${starters(Number(m[1]))} con puntos por sumar, ${m[2]} puntos proyectados pendientes`,
  ],
  // The starter-state tally (`yetToPlay.reason`), one segment at a time.
  [/^(\d+) yet to start$/, (m) => `${m[1]} por empezar`],
  [/^(\d+) in progress$/, (m) => `${m[1]} en juego`],
  [/^(\d+) finished or unavailable$/, (m) => `${m[1]} terminados o no disponibles`],
  [/^(\d+) game states unavailable$/, (m) => `${m[1]} estados de partido no disponibles`],
]

const PREFIXES_ES: Array<[string, string]> = [
  ['Your roster: ', 'Tu plantilla: '],
  ['Opponent roster: ', 'Plantilla rival: '],
]

function segmentEs(segment: string): string {
  const exact = EXACT_ES[segment]
  if (exact) return exact
  for (const [en, es] of PREFIXES_ES) {
    if (segment.startsWith(en)) return es + segmentEs(segment.slice(en.length))
  }
  for (const [pattern, render] of PATTERNS_ES) {
    const m = segment.match(pattern)
    if (m) return render(m)
  }
  return segment
}

/**
 * The reason in the reader's language. Composite lines (the tally and the win-probability detail are
 * joined with " · ") are translated segment by segment. Unknown text passes through unchanged.
 */
export function matchupReasonText(reason: string | null | undefined, language: string): string {
  if (!reason) return ''
  if (language !== 'es') return reason
  return reason.split(' · ').map(segmentEs).join(' · ')
}

/** "confidence: MEDIUM" in the reader's language — the tier names are the model's, not prose. */
export function matchupConfidenceText(tier: string, language: string): string {
  if (language !== 'es') return `${tier} confidence`
  const es: Record<string, string> = { HIGH: 'alta', MEDIUM: 'media', LOW: 'baja' }
  return `confianza ${es[tier] ?? tier.toLowerCase()}`
}

/** Exposed for the coverage test only. */
export const __MATCHUP_REASON_ES_EXACT = EXACT_ES

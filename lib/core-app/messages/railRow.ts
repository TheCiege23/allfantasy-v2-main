import { defineMessages } from '@/lib/i18n/messages'

/**
 * One league row in the league rail (components/core-app/RailRowBody.tsx).
 */

/** 1st, 2nd, 3rd, 4th … and 11th/12th/13th, which are the ones a naive rule gets wrong. */
function ordinal(n: number): string {
  const teens = n % 100
  if (teens >= 11 && teens <= 13) return `${n}th`
  const unit = n % 10
  if (unit === 1) return `${n}st`
  if (unit === 2) return `${n}nd`
  if (unit === 3) return `${n}rd`
  return `${n}th`
}

export const railRowMessages = defineMessages({
  en: {
    /* RailSide — the projection tooltip. `genericPpr` is "afProjected == null". */
    sideTitle: (provider: string, pricedFrom: number, starterCount: number, genericPpr: boolean): string =>
      `Weekly baseline projection — ${provider}’s projection from ${pricedFrom} of ${starterCount} starters${
        genericPpr
          ? ', generic PPR because this league’s scoring could not be re-scored'
          : ', re-scored with this league’s settings'
      } · live score is shown separately`,
    /* The small label in front of each side's projected total. */
    projShort: 'proj',
    /* RailStanding */
    noHeadToHead: 'no head-to-head — rank not yet measurable',
    tiedPrefix: 'T-',
    rank: (n: number): string => ordinal(n),
    of: ' of ',
    tiedLowest: 'tied lowest',
    chopLine: (team: string, value: string) => `Lowest: ${team} · ${value}`,
    toPass: (team: string, value: string) => `To pass: ${team} · ${value}`,
    weeksLeft: (n: number) => (n === 1 ? '1 week left' : `${n} weeks left`),
    /* The draft time ("Mon 8pm"): the locale, and how the clock reads — English drops the space and lowercases AM/PM. */
    dateLocale: 'en-US',
    shortTime: (time: string): string => time.replace(/\s?([AP])M$/i, (_, h: string) => `${h.toLowerCase()}m`),
    /* The rail header's week ("Week 8"), which arrives in English from the server. */
    weekLabel: (label: string): string => label,
    onTheBlock: 'on the block',
    bottomOfLeague: 'bottom of the league',
    overTheCut: (margin: string) => `+${margin} over the cut`,
    overLast: (margin: string) => `+${margin} over last`,
    cutPosition: 'cut position',
    placesClear: (n: number): string => `${n} ${n === 1 ? 'place' : 'places'} clear`,
    onPoints: 'on points',
    onProjection: 'on projection',
    /* A best-ball league ranks on projected finals: banked points plus the best lineup still possible. */
    onBestBallProvisional: 'on projected best-ball final · provisional',
    onBestBallFinal: 'on final best-ball points',
    /* RailGuillotine */
    ofAlive: (n: number) => ` of ${n} alive`,
    choppedWeek: (week: number) => `Chopped wk ${week}`,
    chopped: 'Chopped',
    eliminated: 'eliminated',
    draft: 'Draft',
    seasonNotStarted: 'Season not started',
    firstChopWeekLower: (week: number) => `first chop wk ${week}`,
    aliveCount: (n: number) => `${n} alive`,
    firstChopWeek: (week: number) => `First chop wk ${week}`,
    noChopsYet: 'no chops yet',
    noScoresYet: 'no scores yet',
    inChopZone: 'in the chop zone',
    toSafety: (margin: string) => `${margin} to safety`,
    tiedAtLine: 'tied at the line',
    aboveChop: (margin: string) => `+${margin} above chop`,
    alive: 'alive',
    /* RailRowBody */
    syncPaused: 'Sync paused',
    updatesDelayed: 'Updates delayed',
    lastResult: 'Last result',
    /* Between the two managers of a head-to-head. */
    vs: 'VS',
    /* The pill beside a league whose scores are moving right now. */
    live: 'LIVE',
    /* Flags on a league that needs you (urgencyBadges.ts). */
    fixLineup: 'Fix lineup',
    tradeOffer: 'Trade offer',
    /* The head-to-head's tooltip: a tap there opens the Matchup screen. */
    openMatchup: 'Open matchup',
    /* The odds bar's accessible name. */
    winOdds: (pct: number) => `${pct}% chance to win`,
    /* Appended to a flagged league row's accessible name, which the visible flags sit inside. */
    attentionAria: (lineup: boolean, offer: boolean) =>
      `${lineup ? ', lineup needs fixing' : ''}${offer ? ', trade offer waiting' : ''}`,
    /* Appended to a row's accessible name when its league chat has unread messages. */
    unreadAria: (count: string) => `, ${count} unread chat ${count === '1' ? 'message' : 'messages'}`,
    /* The favorites section at the top of the list (pinned leagues). */
    favoritesHeading: 'Favorites',
    favoritesShort: 'Favorites',
    sectionToggleAria: (name: string, count: number, folded: boolean) =>
      `${name}, ${count} ${count === 1 ? 'league' : 'leagues'} — ${folded ? 'show' : 'hide'}`,
    /* Filter chips above the list. */
    filterGroupAria: 'Filter leagues',
    filterLabel: (f: 'all' | 'live' | 'commissioner' | 'needs'): string =>
      f === 'all' ? 'All' : f === 'live' ? 'Live' : f === 'commissioner' ? 'Commissioner' : 'Needs action',
    holdHint: 'Drag a league to reorder it, or press and hold (right-click) it to pin, move or hide it.',
    /* The Pin and Move sheet. */
    menuTitle: (name: string) => `Options for ${name}`,
    menuClose: 'Close',
    pin: 'Pin to top',
    unpin: 'Unpin',
    moveUp: 'Move up',
    moveDown: 'Move down',
    reorder: 'Reorder leagues',
    reorderHint: 'Drag ⠿ to put your leagues in order.',
    hide: 'Hide from this list',
    hideNote: 'Bring it back any time in Settings.',
    hiddenCount: (n: number) => `${n} hidden · Settings`,
    hiddenCountAria: (n: number) => `${n} hidden ${n === 1 ? 'league' : 'leagues'} — manage in Settings`,
    menuDone: 'Done',
    yourTeam: 'Your team',
    opponentNotNamed: 'opponent not named',
    espnUnavailable: 'Matchup unavailable from ESPN',
    matchupNotAvailable: 'Matchup not available yet',
  },
  es: {
    sideTitle: (provider, pricedFrom, starterCount, genericPpr) =>
      `Proyección base semanal — proyección de ${provider} con ${pricedFrom} de ${starterCount} titulares${
        genericPpr
          ? ', PPR genérico porque no se pudo recalcular con la puntuación de esta liga'
          : ', recalculada con la configuración de esta liga'
      } · el marcador en vivo se muestra aparte`,
    projShort: 'proy',
    noHeadToHead: 'sin enfrentamiento directo: posición aún no medible',
    tiedPrefix: 'E-',
    rank: (n) => `#${n}`,
    of: ' de ',
    tiedLowest: 'empatado en el último lugar',
    chopLine: (team, value) => `Más bajo: ${team} · ${value}`,
    toPass: (team, value) => `Por superar: ${team} · ${value}`,
    weeksLeft: (n) => (n === 1 ? 'queda 1 semana' : `quedan ${n} semanas`),
    dateLocale: 'es',
    shortTime: (time) => time,
    weekLabel: (label) => label.replace(/^Week (\d+)/, 'Semana $1'),
    onTheBlock: 'en la línea de corte',
    bottomOfLeague: 'último de la liga',
    overTheCut: (margin) => `+${margin} sobre el corte`,
    overLast: (margin) => `+${margin} sobre el último`,
    cutPosition: 'posición de corte',
    placesClear: (n) => `${n} ${n === 1 ? 'puesto' : 'puestos'} de margen`,
    onPoints: 'por puntos',
    onProjection: 'por proyección',
    onBestBallProvisional: 'por final proyectado de best ball · provisional',
    onBestBallFinal: 'por puntos finales de best ball',
    ofAlive: (n) => ` de ${n} vivos`,
    choppedWeek: (week) => `Eliminado sem ${week}`,
    chopped: 'Eliminado',
    eliminated: 'fuera de la liga',
    draft: 'Draft',
    seasonNotStarted: 'Temporada sin empezar',
    firstChopWeekLower: (week) => `primer corte sem ${week}`,
    aliveCount: (n) => `${n} vivos`,
    firstChopWeek: (week) => `Primer corte sem ${week}`,
    noChopsYet: 'sin cortes aún',
    noScoresYet: 'sin puntos todavía',
    inChopZone: 'en zona de corte',
    toSafety: (margin) => `${margin} para salvarse`,
    tiedAtLine: 'empatado en la línea',
    aboveChop: (margin) => `+${margin} sobre el corte`,
    alive: 'vivo',
    syncPaused: 'Sincronización en pausa',
    updatesDelayed: 'Actualizaciones retrasadas',
    lastResult: 'Último resultado',
    vs: 'VS',
    live: 'EN VIVO',
    fixLineup: 'Corregir la alineación',
    tradeOffer: 'Oferta de intercambio',
    openMatchup: 'Abrir el enfrentamiento',
    winOdds: (pct) => `${pct}% de probabilidad de ganar`,
    attentionAria: (lineup, offer) =>
      `${lineup ? ', hay que corregir la alineación' : ''}${offer ? ', oferta de intercambio pendiente' : ''}`,
    unreadAria: (count) => `, ${count} ${count === '1' ? 'mensaje' : 'mensajes'} de chat sin leer`,
    favoritesHeading: 'Favoritas',
    favoritesShort: 'Favoritas',
    sectionToggleAria: (name, count, folded) =>
      `${name}, ${count} ${count === 1 ? 'liga' : 'ligas'} — ${folded ? 'mostrar' : 'ocultar'}`,
    filterGroupAria: 'Filtrar ligas',
    filterLabel: (f) =>
      f === 'all' ? 'Todas' : f === 'live' ? 'En vivo' : f === 'commissioner' ? 'Comisionado' : 'Requieren acción',
    holdHint: 'Arrastra una liga para reordenarla, o mantenla pulsada (clic derecho) para fijarla, moverla u ocultarla.',
    menuTitle: (name) => `Opciones de ${name}`,
    menuClose: 'Cerrar',
    pin: 'Fijar arriba',
    unpin: 'Quitar de arriba',
    moveUp: 'Subir',
    moveDown: 'Bajar',
    reorder: 'Reordenar ligas',
    reorderHint: 'Arrastra ⠿ para ordenar tus ligas.',
    hide: 'Ocultar de esta lista',
    hideNote: 'Puedes volver a mostrarla en Ajustes.',
    hiddenCount: (n) => `${n} ${n === 1 ? 'oculta' : 'ocultas'} · Ajustes`,
    hiddenCountAria: (n) => `${n} ${n === 1 ? 'liga oculta' : 'ligas ocultas'}; gestiónalas en Ajustes`,
    menuDone: 'Listo',
    yourTeam: 'Tu equipo',
    opponentNotNamed: 'rival sin nombre',
    espnUnavailable: 'ESPN no devolvió un calendario de enfrentamientos para esta liga',
    matchupNotAvailable: 'sin enfrentamiento directo registrado esta semana',
  },
})

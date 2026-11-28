/**
 * The words the player card's header, tabs and roster actions add (components/core-app/player-card/
 * PlayerCardSheet.tsx), English and Spanish. The card's older words stay in playerCardCopy.ts.
 */

export type CardTabId = 'outlook' | 'gamelog' | 'career' | 'depth' | 'schedule' | 'history' | 'news'

export type PlayerCardLayoutCopy = {
  tabs: Record<CardTabId, string>
  tabsLabel: string
  overall: string
  rostered: string
  started: string
  drop: string
  add: string
  dropAria: (name: string) => string
  addAria: (name: string) => string
  confirmTitle: string
  confirmSub: string
  confirmDrop: string
  dropTag: string
  confirmNext: string
  cancel: string
  confirm: string
  thisWeek: string
  season: string
  restOfSeason: string
  value: string
  chimmyTake: string
  colDate: string
  colWeek: string
  colOpp: string
  colPts: string
  colSeason: string
  colTeam: string
  colGames: string
  colPerGame: string
  lastGames: (season: number) => string
  /** Swipe between players: the arrows' labels and "3 of 15". */
  prevPlayer: (name: string) => string
  nextPlayer: (name: string) => string
  playerOf: (index: number, total: number) => string
  swipeHint: string
  depthAt: (position: string) => string
  starter: string
}

const en: PlayerCardLayoutCopy = {
  tabs: {
    outlook: 'Outlook',
    gamelog: 'Game log',
    career: 'Career',
    depth: 'Depth chart',
    schedule: 'Schedule',
    history: 'History',
    news: 'News',
  },
  tabsLabel: 'Player details',
  overall: 'overall',
  rostered: 'rostered',
  started: 'started',
  drop: 'Drop',
  add: 'Add',
  dropAria: (name) => `Drop ${name}`,
  addAria: (name) => `Add ${name}`,
  confirmTitle: 'Confirm transaction',
  confirmSub: 'Review the players in this roster move.',
  confirmDrop: 'Drop player',
  dropTag: 'DROP',
  confirmNext: 'Next, pick the player who takes his roster spot.',
  cancel: 'Cancel',
  confirm: 'Confirm',
  thisWeek: 'This week',
  season: 'Season',
  restOfSeason: 'Rest of season',
  value: 'Value',
  chimmyTake: "Chimmy's take",
  colDate: 'Date',
  colWeek: 'Wk',
  colOpp: 'Opp',
  colPts: 'Pts',
  colSeason: 'Season',
  colTeam: 'Team',
  colGames: 'GP',
  colPerGame: 'Pts/G',
  lastGames: (season) => `${season} games`,
  prevPlayer: (name) => `Previous player: ${name}`,
  nextPlayer: (name) => `Next player: ${name}`,
  playerOf: (index, total) => `${index} of ${total}`,
  swipeHint: 'Swipe or use the arrow keys to move between players',
  depthAt: (position) => `${position} depth chart`,
  starter: 'Starter',
}

const es: PlayerCardLayoutCopy = {
  tabs: {
    outlook: 'Panorama',
    gamelog: 'Partidos',
    career: 'Carrera',
    depth: 'Profundidad',
    schedule: 'Calendario',
    history: 'Historial',
    news: 'Noticias',
  },
  tabsLabel: 'Detalles del jugador',
  overall: 'general',
  rostered: 'en plantilla',
  started: 'titular',
  drop: 'Soltar',
  add: 'Agregar',
  dropAria: (name) => `Soltar a ${name}`,
  addAria: (name) => `Agregar a ${name}`,
  confirmTitle: 'Confirmar movimiento',
  confirmSub: 'Revisa los jugadores de este movimiento.',
  confirmDrop: 'Soltar jugador',
  dropTag: 'SOLTAR',
  confirmNext: 'Después elige al jugador que ocupa su lugar.',
  cancel: 'Cancelar',
  confirm: 'Confirmar',
  thisWeek: 'Esta semana',
  season: 'Temporada',
  restOfSeason: 'Resto de temporada',
  value: 'Valor',
  chimmyTake: 'La opinión de Chimmy',
  colDate: 'Fecha',
  colWeek: 'Sem',
  colOpp: 'Rival',
  colPts: 'Pts',
  colSeason: 'Temporada',
  colTeam: 'Equipo',
  colGames: 'PJ',
  colPerGame: 'Pts/P',
  lastGames: (season) => `Partidos ${season}`,
  prevPlayer: (name) => `Jugador anterior: ${name}`,
  nextPlayer: (name) => `Siguiente jugador: ${name}`,
  playerOf: (index, total) => `${index} de ${total}`,
  swipeHint: 'Desliza o usa las flechas para pasar de un jugador a otro',
  depthAt: (position) => `Profundidad ${position}`,
  starter: 'Titular',
}

export function playerCardLayoutCopy(language: string | null | undefined): PlayerCardLayoutCopy {
  return String(language ?? '').toLowerCase().startsWith('es') ? es : en
}

import type { LeagueAction, LeagueCardState } from './leagueActions'

/**
 * Words for the per-league action cards and sheet (leagueActions.ts) and the phone-only search
 * dock and folds (2026-10-08). Pure, client-safe; English and Spanish.
 */

export type LeagueActionsCopy = {
  cardsLabel: string
  cardsHint: string
  actionLabel: (a: LeagueAction, last: string) => string
  state: (s: LeagueCardState, owner: string | null) => string
  bestBall: string
  nothingHere: string
  moreFor: (league: string) => string
  sheetTitle: (last: string, league: string) => string
  close: string
  readOnly: string
  dockSearch: string
  foldShow: (title: string) => string
  foldHide: (title: string) => string
  foldNews: string
  foldValue: string
  foldDepth: string
  foldWhoStarts: string
  foldSeason: string
}

const EN: LeagueActionsCopy = {
  cardsLabel: 'Your move in each league',
  cardsHint: 'Swipe for more leagues',
  actionLabel: (a, last) => {
    const where = a.platformLabel === 'AllFantasy' ? '' : ` in ${a.platformLabel}`
    switch (a.kind) {
      case 'start':
        return `Start ${last}${where}`
      case 'bench':
        return `Bench ${last}${where}`
      case 'activate':
        return `Move ${last} off IR${where}`
      case 'lineup':
        return `Set lineup${where}`
      case 'open_league':
        return `Open league${where}`
      case 'trade_away':
        return `Trade ${last} away`
      case 'trade_for':
        return `Trade for ${last}`
      case 'propose':
        return `Propose${where}`
      case 'add':
        return `Add ${last}${where}`
      case 'league_home':
        return 'League home'
    }
  },
  state: (s, owner) =>
    s === 'start' ? 'Starting' : s === 'bench' ? 'On your bench' : s === 'ir' ? 'On your IR' : s === 'taxi' ? 'On your taxi squad' : s === 'free' ? 'Free agent' : owner ? `${owner} has him` : 'Taken',
  bestBall: 'Best ball — the platform sets the lineup',
  nothingHere: 'Nothing to open for this league yet',
  moreFor: (l) => `More actions in ${l}`,
  sheetTitle: (last, l) => `${last} in ${l}`,
  close: 'Close',
  readOnly: 'AllFantasy opens the screen; the change is made on the platform.',
  dockSearch: 'Search players',
  foldShow: (t) => `Show ${t}`,
  foldHide: (t) => `Hide ${t}`,
  foldNews: 'News',
  foldValue: 'Market value',
  foldDepth: 'Depth chart',
  foldWhoStarts: "Who'd start",
  foldSeason: 'This season',
}

const ES: LeagueActionsCopy = {
  cardsLabel: 'Tu jugada en cada liga',
  cardsHint: 'Desliza para ver más ligas',
  actionLabel: (a, last) => {
    const where = a.platformLabel === 'AllFantasy' ? '' : ` en ${a.platformLabel}`
    switch (a.kind) {
      case 'start':
        return `Alinear a ${last}${where}`
      case 'bench':
        return `Mandar a ${last} a la banca${where}`
      case 'activate':
        return `Sacar a ${last} de IR${where}`
      case 'lineup':
        return `Ajustar alineación${where}`
      case 'open_league':
        return `Abrir liga${where}`
      case 'trade_away':
        return `Traspasar a ${last}`
      case 'trade_for':
        return `Pedir a ${last} en un traspaso`
      case 'propose':
        return `Proponer${where}`
      case 'add':
        return `Fichar a ${last}${where}`
      case 'league_home':
        return 'Inicio de la liga'
    }
  },
  state: (s, owner) =>
    s === 'start'
      ? 'Titular'
      : s === 'bench'
        ? 'En tu banca'
        : s === 'ir'
          ? 'En tu IR'
          : s === 'taxi'
            ? 'En tu taxi'
            : s === 'free'
              ? 'Agente libre'
              : owner
                ? `Lo tiene ${owner}`
                : 'Tiene dueño',
  bestBall: 'Best ball: la plataforma fija la alineación',
  nothingHere: 'Todavía no hay nada que abrir en esta liga',
  moreFor: (l) => `Más acciones en ${l}`,
  sheetTitle: (last, l) => `${last} en ${l}`,
  close: 'Cerrar',
  readOnly: 'AllFantasy abre la pantalla; el cambio se hace en la plataforma.',
  dockSearch: 'Buscar jugadores',
  foldShow: (t) => `Mostrar ${t}`,
  foldHide: (t) => `Ocultar ${t}`,
  foldNews: 'Noticias',
  foldValue: 'Valor de mercado',
  foldDepth: 'Profundidad',
  foldWhoStarts: 'Quién jugaría',
  foldSeason: 'Esta temporada',
}

export function leagueActionsCopy(language: string): LeagueActionsCopy {
  return language === 'es' ? ES : EN
}

import { defineMessages } from '@/lib/i18n/messages'

/**
 * The 3–4 team trade builder in Create a trade (components/core-app/screens/MultiTeamTradeBuilder.tsx,
 * lib/trade-intel/multiTeamGrade.ts, lib/trade-screenshot/matchMultiOffer.ts), 2026-11-14.
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): a pick is a
 * «selección», and no Spanish value says «waiver».
 */
export const multiTeamTradeMessages = defineMessages({
  en: {
    modeLabel: 'How many teams',
    modeTwo: '2 teams',
    modeMulti: '3–4 teams',
    teamsLabel: 'Teams in this trade',
    teamsHint: 'Pick 3 or 4 teams, yours included. Each one adds what it sends, and picks who gets it.',
    maxTeams: 'A trade here has at most 4 teams.',
    you: 'You',
    anotherManager: 'Another manager',
    sends: (team: string): string => (team === 'You' ? 'You send' : `${team} sends`),
    nothingYet: 'Nothing added yet.',
    search: 'Add a player or pick',
    searchFor: (team: string): string => `Add a player or pick ${team === 'You' ? 'you send' : `${team} sends`}`,
    noMatch: 'No player or pick by that name on this roster.',
    goesTo: 'to',
    goesToFor: (asset: string): string => `Who gets ${asset}`,
    remove: 'Remove',
    removeAsset: (asset: string): string => `Remove ${asset}`,
    gradeTitle: 'Grade',
    gradeSub: 'League value only',
    gets: (team: string, got: string, gave: string): string =>
      team === 'You' ? `You get ${got} for ${gave}` : `${team} gets ${got} for ${gave}`,
    getsNothing: 'Gets nothing yet',
    sendsNothing: 'Sends nothing yet',
    unpriced: (n: number): string =>
      `Not graded: ${n} ${n === 1 ? 'asset has' : 'assets have'} no value on this league’s chart`,
    incomplete: 'Every team has to send something and get something before the trade can be graded.',
    pickMoreTeams: 'Pick at least 3 teams to build a 3–4 team trade.',
    fair: 'Fair trade: every team gets about what it gives',
    ahead: (names: string[]): string =>
      names.length === 1
        ? names[0] === 'You'
          ? 'You come out ahead'
          : `${names[0]} comes out ahead`
        : `${names.join(' and ')} come out ahead`,
    basis:
      'Graded on league value only: what each team gets against what it gives, on the same A–F scale as a 2-team trade. Roster fit and Chimmy’s read are for 2-team trades.',
    sendIn: (platform: string): string => `Send it in ${platform}`,
    loaded: (teams: number, assets: number): string =>
      `Loaded a ${teams}-team trade from your screenshot: ${assets} ${assets === 1 ? 'asset' : 'assets'}. Check them against the offer.`,
    notPlaced: (list: string): string => `Not placed on a roster, so add by hand: ${list}.`,
    faabLeftOut: (list: string): string => `FAAB is not part of a 3–4 team grade, so ${list} was left out.`,
    refusedUnreadable: 'We could not read that screenshot. Try a sharper one that shows every team, or build the trade by hand.',
    refusedTeamCount: (n: number): string =>
      `That offer shows ${n} ${n === 1 ? 'team' : 'teams'}. A 3–4 team trade needs 3 or 4.`,
    refusedUnplaced: 'We could not tell which manager is which in that offer. Screenshot the screen that shows every team name, or build it by hand.',
    refusedDuplicate: 'Two sections of that offer matched the same manager. Build it by hand.',
  },
  es: {
    modeLabel: 'Cuántos equipos',
    modeTwo: '2 equipos',
    modeMulti: '3–4 equipos',
    teamsLabel: 'Equipos en este intercambio',
    teamsHint: 'Elige 3 o 4 equipos, incluido el tuyo. Cada uno añade lo que envía y elige quién lo recibe.',
    maxTeams: 'Un intercambio aquí tiene como máximo 4 equipos.',
    you: 'Tú',
    anotherManager: 'Otro mánager',
    sends: (team: string): string => (team === 'Tú' ? 'Envías' : `${team} envía`),
    nothingYet: 'Todavía no añadiste nada.',
    /* Short: it is a placeholder in a third of the width; the field's label carries the full sentence. */
    search: 'Jugador o selección',
    searchFor: (team: string): string => `Añade un jugador o una selección que ${team === 'Tú' ? 'envías' : `envía ${team}`}`,
    noMatch: 'No hay ningún jugador ni selección con ese nombre en esta plantilla.',
    goesTo: 'para',
    goesToFor: (asset: string): string => `Quién recibe a ${asset}`,
    remove: 'Quitar',
    removeAsset: (asset: string): string => `Quitar ${asset}`,
    gradeTitle: 'Calificación',
    gradeSub: 'Solo valor de liga',
    gets: (team: string, got: string, gave: string): string =>
      team === 'Tú' ? `Recibes ${got} por ${gave}` : `${team} recibe ${got} por ${gave}`,
    getsNothing: 'Todavía no recibe nada',
    sendsNothing: 'Todavía no envía nada',
    unpriced: (n: number): string =>
      `Sin calificar: ${n} ${n === 1 ? 'activo no tiene' : 'activos no tienen'} valor en la tabla de esta liga`,
    incomplete: 'Cada equipo tiene que enviar algo y recibir algo antes de poder calificar el intercambio.',
    pickMoreTeams: 'Elige al menos 3 equipos para armar un intercambio de 3–4 equipos.',
    fair: 'Intercambio justo: cada equipo recibe más o menos lo que da',
    ahead: (names: string[]): string =>
      names.length === 1
        ? names[0] === 'Tú'
          ? 'Sales ganando'
          : `${names[0]} sale ganando`
        : `${names.join(' y ')} salen ganando`,
    basis:
      'Calificado solo con el valor de liga: lo que cada equipo recibe frente a lo que da, en la misma escala A–F que un intercambio de 2 equipos. El encaje en la plantilla y la lectura de Chimmy son para intercambios de 2 equipos.',
    sendIn: (platform: string): string => `Envíalo en ${platform}`,
    loaded: (teams: number, assets: number): string =>
      `Cargamos un intercambio de ${teams} equipos desde tu captura: ${assets} ${assets === 1 ? 'activo' : 'activos'}. Compáralos con la oferta.`,
    notPlaced: (list: string): string => `Sin ubicar en una plantilla, así que añádelos a mano: ${list}.`,
    faabLeftOut: (list: string): string => `El FAAB no forma parte de la calificación de 3–4 equipos, así que se dejó fuera ${list}.`,
    refusedUnreadable: 'No pudimos leer esa captura. Prueba con una más nítida que muestre todos los equipos, o arma el intercambio a mano.',
    refusedTeamCount: (n: number): string =>
      `Esa oferta muestra ${n} ${n === 1 ? 'equipo' : 'equipos'}. Un intercambio de 3–4 equipos necesita 3 o 4.`,
    refusedUnplaced: 'No pudimos saber qué mánager es cuál en esa oferta. Haz una captura de la pantalla que muestra el nombre de cada equipo, o ármalo a mano.',
    refusedDuplicate: 'Dos secciones de esa oferta coinciden con el mismo mánager. Ármalo a mano.',
  },
})

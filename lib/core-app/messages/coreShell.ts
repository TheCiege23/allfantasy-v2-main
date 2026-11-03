import { defineMessages } from '@/lib/i18n/messages'
import { ageText } from '@/lib/core-app/shellCopy'

/**
 * The /core shell (components/core-app/AfCoreShell.tsx): the topbar search, the league rail, the
 * primary nav, the topbar's updates menu and plan chip, the home bracket promo, the phone tab bar and
 * its More sheet, and the sync chip text (`syncChipText`). Nav labels stay with navLabel()/coreUiCopy().
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite.
 */
export const coreShellMessages = defineMessages({
  en: {
    // TopSearch
    searchPlaceholder: 'Find a player or jump to a league',
    searchAria: 'Search any player or league',
    searchResultsAria: 'Player and league results',
    searchSearching: 'Searching…',
    searchNoMatch: 'No players or leagues match that.',
    searchLeague: 'League',
    searchPlayer: 'Player',

    // syncChipText — `ageLabel` arrives in English from the server; Spanish translates it too.
    syncNever: 'Never synced',
    synced: (ageLabel: string) => `synced ${ageLabel}`,

    // Skip link, rail handle and rail header
    skipToContent: 'Skip to content',
    closeLeagues: 'Close leagues',
    openLeagues: 'Open leagues',
    homeAria: 'AllFantasy home',
    collapseRail: 'Collapse the league rail',
    expandRail: 'Expand the league rail',
    leagueNoun: (count: number): string => (count === 1 ? 'league' : 'leagues'),
    hiddenLeaguesAria: (count: number) => `${count} hidden ${count === 1 ? 'league' : 'leagues'}: show them in Settings`,
    hiddenLeaguesShow: (count: number) => `${count} hidden · Show`,

    // Rail rows
    railRowTitle: (railName: string, platform: string, careerLine: string | null) =>
      `${railName} · ${platform}${careerLine ? ` · your career here ${careerLine}` : ''}`,
    railRowAria: (railName: string, platform: string, careerLine: string | null) =>
      `${railName} on ${platform}${careerLine ? `, your career here ${careerLine}` : ''}`,

    // Rail footer
    showHideLeaguesTitle: 'Show or hide leagues in Settings',
    showHiddenLeagues: (count: number) => `Show ${count} hidden ${count === 1 ? 'league' : 'leagues'}`,
    manageInSettings: 'Manage in Settings',
    profileTitle: 'Profile, settings and modes',
    yourAccount: 'Your account',
    profileAndSettings: 'Profile & settings',

    // Primary nav
    sectionsAria: 'Sections',
    importReadOnly: 'Read-only, takes about a minute.',

    // Topbar
    yourLeagues: 'Your leagues',
    closeSearch: 'Close search',
    searchPlayersAndLeagues: 'Search players and leagues',
    adminAria: 'Open AllFantasy administration',
    updatesAria: 'League updates and refresh',
    updates: 'Updates',
    leagueUpdates: 'League updates',
    nativeChangesSave: 'Changes save to AllFantasy.',
    platformLineupChanges: 'Make lineup changes on your league’s platform.',
    // The updates menu's handoff to the open league's platform (lib/core-app/shellLineupHandoff.ts).
    readOnlyChangesIn: (platform: string) => `AllFantasy only reads this league — changes are made in ${platform}.`,
    fixLineupIn: (platform: string) => `Fix lineup in ${platform}`,
    openLeagueIn: (platform: string) => `Open league in ${platform}`,
    tokensLeft: 'tokens left',
    planTokens: 'Plan tokens',
    planTokensBody:
      'Your plan includes a monthly allowance of Chimmy requests — grades, projections and recommendations. Resets on your billing date.',

    // Home bracket promo
    bracketKicker: 'BRACKET LEAGUES',
    bracketTitle: 'Build a bracket. Bring your friends.',
    bracketBody: 'Pick winners, share your bracket, and climb the leaderboard.',
    bracketExplore: 'Explore and create',
    bracketJoin: 'Join a league',

    // Phone tab bar and More sheet
    mainNavAria: 'Main',
    closeMenu: 'Close more menu',
  },
  es: {
    searchPlaceholder: 'Busca un jugador o ve a una liga',
    searchAria: 'Busca cualquier jugador o liga',
    searchResultsAria: 'Resultados de jugadores y ligas',
    searchSearching: 'Buscando…',
    searchNoMatch: 'Ningún jugador ni liga coincide.',
    searchLeague: 'Liga',
    searchPlayer: 'Jugador',

    syncNever: 'Nunca sincronizado',
    synced: (ageLabel) => `sincronizado ${ageText(ageLabel, 'es')}`,

    skipToContent: 'Saltar al contenido',
    closeLeagues: 'Cerrar ligas',
    openLeagues: 'Abrir ligas',
    homeAria: 'Inicio de AllFantasy',
    collapseRail: 'Contraer la barra de ligas',
    expandRail: 'Expandir la barra de ligas',
    leagueNoun: (count) => (count === 1 ? 'liga' : 'ligas'),
    hiddenLeaguesAria: (count) => `${count} ${count === 1 ? 'liga oculta' : 'ligas ocultas'}: mostrarlas en Ajustes`,
    hiddenLeaguesShow: (count) => `${count} ocultas · Mostrar`,

    railRowTitle: (railName, platform, careerLine) =>
      `${railName} · ${platform}${careerLine ? ` · tu historial aquí ${careerLine}` : ''}`,
    railRowAria: (railName, platform, careerLine) =>
      `${railName} en ${platform}${careerLine ? `, tu historial aquí ${careerLine}` : ''}`,

    showHideLeaguesTitle: 'Mostrar u ocultar ligas en Ajustes',
    showHiddenLeagues: (count) => `Mostrar ${count} ${count === 1 ? 'liga oculta' : 'ligas ocultas'}`,
    manageInSettings: 'Gestionar en Ajustes',
    profileTitle: 'Perfil, ajustes y modos',
    yourAccount: 'Tu cuenta',
    profileAndSettings: 'Perfil y ajustes',

    sectionsAria: 'Secciones',
    importReadOnly: 'Solo lectura, tarda cerca de un minuto.',

    yourLeagues: 'Tus ligas',
    closeSearch: 'Cerrar búsqueda',
    searchPlayersAndLeagues: 'Buscar jugadores y ligas',
    adminAria: 'Abrir la administración de AllFantasy',
    updatesAria: 'Actualizaciones de liga',
    updates: 'Actualizaciones',
    leagueUpdates: 'Actualizaciones de liga',
    nativeChangesSave: 'Los cambios se guardan en AllFantasy.',
    platformLineupChanges: 'Cambia la alineación en la plataforma de tu liga.',
    readOnlyChangesIn: (platform) => `AllFantasy solo lee esta liga: los cambios se hacen en ${platform}.`,
    fixLineupIn: (platform) => `Arreglar la alineación en ${platform}`,
    openLeagueIn: (platform) => `Abrir la liga en ${platform}`,
    tokensLeft: 'tokens restantes',
    planTokens: 'Tokens del plan',
    planTokensBody:
      'Tu plan incluye una cantidad mensual de solicitudes a Chimmy: calificaciones, proyecciones y recomendaciones. Se renueva en tu fecha de facturación.',

    bracketKicker: 'LIGAS DE BRACKETS',
    bracketTitle: 'Crea un bracket. Invita a tus amigos.',
    bracketBody: 'Elige ganadores, comparte tus picks y compite en la clasificación.',
    bracketExplore: 'Explorar y crear',
    bracketJoin: 'Unirme a una liga',

    mainNavAria: 'Principal',
    closeMenu: 'Cerrar el menú',
  },
})

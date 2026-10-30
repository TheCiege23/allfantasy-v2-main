import { defineMessages } from '@/lib/i18n/messages'

/**
 * Screen 3a, the all-leagues home (components/core-app/screens/Dashboard3A.tsx) and the cards it
 * exports: the rail and insights shell, matchups, Ask Chimmy, career, rivalry radar, the portfolio
 * chart, exposure and my leagues.
 * Every string is the one the component wrote before the move, byte for byte, in both languages — a
 * relocation, not a rewrite. The loader-text lookup tables in lib/core-app/dashboard3aCopy.ts are a
 * different thing (Spanish keyed by the English a loader wrote) and stay there.
 *
 * Three labels wrap a `coreUiCopy` term in Spanish only ('Rankings', 'Portfolio', 'Rivalry Radar');
 * the caller passes that Spanish term in and each language uses what it needs, so this file imports
 * nothing at runtime.
 */

/** A finished (or still running) week's result, as the matchup card's note says it. */
type MatchResult = 'tied' | 'won' | 'lost' | 'partial'

export const dashboard3aMessages = defineMessages({
  en: {
    // Dashboard3A shell
    railMoreTitle: (n: number) => `${n} more ${n === 1 ? 'league' : 'leagues'} — open Portfolio`,
    importLeagueTitle: 'Import a league',
    profileTitle: 'Profile, settings and modes',
    insightsSummary: 'Portfolio & season insights',
    insightsSub: 'Exposure, results and tools',

    // Dash3AMatchups
    matchNote: (week: number, result: MatchResult): string =>
      `Week ${week} · ${({ tied: 'you tied', won: 'you won', lost: 'you lost', partial: 'scores so far' } as const)[result]}`,
    matchPeriod: (season: number | string, week: number) => `${season} · Week ${week}`,
    leaguePeriods: 'League periods',
    availableScores: 'Available scores',
    leagueMatchups: 'League matchups',
    noScoredTitle: 'No scored matchups this week.',
    noScoredBody:
      'Weekly scoring is only recorded for leagues with a synced history. Import or re-sync a league and its scores appear here.',
    winSuffix: 'win',

    // Dash3AChimmy
    chimmyTitle: 'ASK CHIMMY',
    chimmySub: 'Your day, in one line',
    chimmyNoLeaguesBefore: 'No leagues connected yet. ',
    chimmyConnectOne: 'Connect one',
    chimmyNoLeaguesAfter: ' and I’ll tell you what needs you first.',
    chimmyClean: 'Nothing needs you right now — you’re clean across every league.',
    chimmyOpen: (n: number) => (n === 1 ? 'One thing needs you today.' : `${n} things need you today, soonest first.`),
    chimmyNote: 'I’ll point you at the league and screen — you make the change on the platform.',

    // Dash3ACareer
    careerLabel: 'YOUR CAREER',
    rankingsLink: (_rankingsEs: string): string => 'Rankings →',
    levelShort: 'LVL',
    careerLevel: 'CAREER LEVEL',
    titlesLabel: (n: number): string => (n === 1 ? 'TITLE' : 'TITLES'),
    seasonsLabel: (n: number): string => (n === 1 ? 'SEASON' : 'SEASONS'),
    rankXp: 'Rank XP',
    xpTo: 'to',
    careerUnscored:
      'Your career has not been scored yet. It fills in once a league with a completed season is imported.',

    // Dash3ARivals
    rivalryRadarLabel: (_rivalryRadarEs: string): string => 'RIVALRY RADAR',
    rivalSharedLeagues: (n: number) => ` · ${n} leagues`,
    rivalsUnread: 'Head-to-head records have not been read yet.',

    // Dash3APortfolioChart
    portfolioChartTitle: 'League portfolio by platform',
    portfolioChartValue: 'Leagues',

    // Dash3AExposure
    exposureLabel: 'PORTFOLIO & EXPOSURE',
    exposureUnread: 'Roster exposure has not been read yet.',
    openPortfolio: (_portfolioEs: string): string => 'Open Portfolio →',

    // Dash3ALeagues
    leaguesShownOf: (shown: number, total: number) => `${shown} of ${total}`,
    leaguesTotal: (total: number) => `${total} total`,
    myLeagues: 'MY LEAGUES',
    noLeaguesImported: 'No leagues imported yet. Connect a platform and they appear here.',
    leagueAlt: 'League',
    untitledLeague: 'Untitled league',
    showAllLeagues: (total: number) => `Show all ${total} →`,
  },
  es: {
    // Dashboard3A shell
    railMoreTitle: (n) => `${n} ${n === 1 ? 'liga más' : 'ligas más'}: abrir Portafolio`,
    importLeagueTitle: 'Importar una liga',
    profileTitle: 'Perfil, ajustes y modos',
    insightsSummary: 'Análisis de tus ligas y temporada',
    insightsSub: 'Exposición, resultados y herramientas',

    // Dash3AMatchups
    matchNote: (week, result) =>
      `Semana ${week} · ${({ tied: 'empataste', won: 'ganaste', lost: 'perdiste', partial: 'marcador parcial' } as const)[result]}`,
    matchPeriod: (season, week) => `${season} · Semana ${week}`,
    leaguePeriods: 'Periodos de cada liga',
    availableScores: 'Marcadores disponibles',
    leagueMatchups: 'Enfrentamientos de tus ligas',
    noScoredTitle: 'No hay enfrentamientos puntuados esta semana.',
    noScoredBody:
      'El marcador semanal solo se registra en ligas con historial sincronizado. Importa o vuelve a sincronizar una liga y sus marcadores aparecerán aquí.',
    winSuffix: 'de ganar',

    // Dash3AChimmy
    chimmyTitle: 'PREGUNTAR A CHIMMY',
    chimmySub: 'Tu día, en una línea',
    chimmyNoLeaguesBefore: 'Aún no hay ligas conectadas. ',
    chimmyConnectOne: 'Conecta una',
    chimmyNoLeaguesAfter: ' y te diré qué necesita tu atención primero.',
    chimmyClean: 'Nada requiere tu atención ahora: estás al día en todas tus ligas.',
    chimmyOpen: (n) =>
      n === 1 ? 'Hoy hay una cosa que requiere tu atención.' : `Hoy hay ${n} cosas que requieren tu atención; primero, la más urgente.`,
    chimmyNote: 'Te indico la liga y la pantalla; tú haces el cambio en la plataforma.',

    // Dash3ACareer
    careerLabel: 'TU CARRERA',
    rankingsLink: (rankingsEs) => `${rankingsEs} →`,
    levelShort: 'NIV',
    careerLevel: 'NIVEL DE CARRERA',
    titlesLabel: (n) => (n === 1 ? 'TÍTULO' : 'TÍTULOS'),
    seasonsLabel: (n) => (n === 1 ? 'TEMPORADA' : 'TEMPORADAS'),
    rankXp: 'XP de rango',
    xpTo: 'para',
    careerUnscored:
      'Tu carrera aún no tiene puntuación. Se completa cuando importas una liga con una temporada terminada.',

    // Dash3ARivals
    rivalryRadarLabel: (rivalryRadarEs) => rivalryRadarEs.toUpperCase(),
    rivalSharedLeagues: (n) => ` · ${n} ligas`,
    rivalsUnread: 'Aún no se han leído tus historiales de enfrentamientos.',

    // Dash3APortfolioChart
    portfolioChartTitle: 'Cartera de ligas por plataforma',
    portfolioChartValue: 'Ligas',

    // Dash3AExposure
    exposureLabel: 'CARTERA Y EXPOSICIÓN',
    exposureUnread: 'Aún no se ha leído la exposición de tus plantillas.',
    openPortfolio: (portfolioEs) => `Abrir ${portfolioEs} →`,

    // Dash3ALeagues
    leaguesShownOf: (shown, total) => `${shown} de ${total}`,
    leaguesTotal: (total) => `${total} en total`,
    myLeagues: 'MIS LIGAS',
    noLeaguesImported: 'Aún no has importado ligas. Conecta una plataforma y aparecerán aquí.',
    leagueAlt: 'Liga',
    untitledLeague: 'Liga sin nombre',
    showAllLeagues: (total) => `Ver las ${total} →`,
  },
})

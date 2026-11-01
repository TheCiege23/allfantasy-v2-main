import type { FinderCopy } from '../playerFinderCopy'
import { coreUiCopy } from '../coreUiCopy'
import { kickoffText } from '../kickoffText'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Player Finder's own words — the screen (components/core-app/screens/PlayerFinder.tsx), worded in
 * lib/core-app/playerFinderCopy.ts `finderCopy`. Every string is the one the module produced before the
 * move, byte for byte, in both languages — a relocation, not a rewrite. The `FinderCopy` type stays
 * exported from playerFinderCopy.ts, which callers already import. The loaders' reasons and the
 * designation table stay there: they are Spanish keyed on English, not en/es pairs.
 */

const leaguesWord = (n: number) => (n === 1 ? 'league' : 'leagues')
const ligas = (n: number) => (n === 1 ? 'liga' : 'ligas')

export const finderScreenMessages = defineMessages<FinderCopy>({
  en: {
    railLabel: 'Search',
    h1: 'Player Finder',
    matches: (n) => `Matches · ${n}`,
    typeTwo: 'Type at least two characters to search.',
    noMatch: (q) => `No player matching “${q}”.`,
    noPosition: 'no position on file',
    compareWithName: (name) => `Compare with ${name}`,
    recentlySearched: 'Recently searched',
    trendHeading: 'Most added this week',
    trendSub: (n, through) => `of ${n} ${n === 1 ? 'league' : 'leagues'} adding${through ? ` · through ${through}` : ''}`,
    trendAddedIn: (n) => `added in ${n} leagues`,
    otherMatches: 'Other matches',
    alsoMatched: 'Also matched',
    railFoot: 'Stats, injuries and news come from live sports data — never an invented number.',
    mainLabel: 'Player details',
    sideLabel: 'What to do',
    inLeague: (name) => `in ${name}`,
    inThisLeague: 'in this league',
    allLeaguesLink: 'All leagues →',
    onLeagues: (yours, count, platforms) =>
      `on ${yours} of your ${count} ${leaguesWord(count)}${platforms ? `, across ${platforms}` : ''}`,
    notOnAny: (count) => `not on any of your ${count} ${leaguesWord(count)}`,
    rosteredByOthers: (n) => ` · rostered by others in ${n}`,
    signInAcross: ' · sign in to see him across your leagues',
    crossLeagueUnavailable: ' · cross-league lookup unavailable',
    and: 'and',
    compareWith: 'Compare with',
    projWeek: (w) => `Proj wk ${w}`,
    projThisWeek: 'Proj this week',
    projectionTitle: 'Projection',
    projectionLeagueBody: 'Expected points this week under this league’s own scoring settings — not a generic ranking.',
    projectionStandardBody:
      'The projection feed’s standard-scoring number for this week. What he is worth in each of YOUR leagues — under that league’s own scoring — is the PROJ column in the table below.',
    leagueScoringOf: (name) => `${name ?? 'This league'}’s scoring`,
    standardScoringSeason: (season) => `Standard scoring · ${season}`,
    afProjWeek: (w) => `AF proj wk ${w}`,
    afProj: 'AF proj',
    afTitle: 'AllFantasy projection',
    afLeagueBody:
      'AllFantasy’s own projection engine for this week, adjusted to this league’s scoring. The tile beside it is the provider’s (Sleeper) projection.',
    afStandardBody:
      'AllFantasy’s own projection engine for this week, standard scoring. What he projects in each of YOUR leagues is the AF column in the table below.',
    thisLeagueScoring: 'this league’s scoring',
    standardScoring: 'Standard scoring',
    posRank: 'Pos rank',
    ofPricedHere: (outOf, pos) => `of ${outOf} priced ${pos}s · this league’s scoring`,
    ofProjected: (outOf, pos) => `of ${outOf} projected ${pos}s`,
    idpValue: 'IDP value',
    idpBody: (numTeams, idpStarters) =>
      'The market chart beside this (FantasyCalc) prices no defenders at all, so this is built from projections against a fixed reference league — ' +
      `${numTeams} teams, ${idpStarters} IDP starters, on the default IDP scoring profile. ` +
      'It is NOT on the same scale as the offensive values elsewhere on this page: what a top defender is worth against a top receiver is a separate question this number does not answer.',
    idpRank: (rank) => `rank ${rank}`,
    idpReference: (numTeams, idpStarters) => `${numTeams}-team · ${idpStarters} IDP`,
    snapShare: 'Snap share',
    snapShareBody:
      'Share of his team’s offensive plays he was on the field for, over the games we hold. Rising snap share usually comes before rising points.',
    snapsHelp: (basis, games) => `${basis === 'defense' ? 'Defensive' : 'Offensive'} snaps · ${games} game${games === 1 ? '' : 's'}`,
    age: 'Age',
    noBirthDate: 'no birth date on file',
    injury: 'Injury',
    noDesignation: 'no designation',
    inThisLeagueHeading: 'In this league',
    everyLeagueHeading: 'Every platform, every league',
    slotStatusHere: 'Slot and status here ·',
    slotStatusNow: 'Slot and status as they stand right now',
    signInReason:
      'Sign in to see which of your leagues roster him, what slot he is in, and what he is worth under each league’s own scoring.',
    connectLeague: 'Connect a league — it is free',
    notOnRosterHere: 'Not on any roster we can read in this league.',
    notOnAnyRoster: (count) => `He is not on any roster in the ${count} ${leaguesWord(count)} you have connected.`,
    showOtherRows: (n) => `Show the ${n} ${leaguesWord(n)} where someone else has him`,
    hideOtherRows: 'Show only your leagues',
    notOnYourRosters: 'Not on any of your rosters — other managers have him.',
    colLeague: 'League',
    colSlot: 'Slot',
    colStatus: 'Status',
    colProj: 'Proj',
    colValue: 'Value',
    rosteredBy: (who) => `rostered by ${who}`,
    rosteredByAnother: 'rostered by another manager',
    thisLeagueBadge: 'This league',
    valueInline: (v) => `value ${v}`,
    valueBasis: (mode, superflex) => `${mode} · ${superflex ? 'superflex' : '1QB'}`,
    valueAdjusted: 'adjusted for this league’s scoring',
    slotUnconfirmed: 'slot unconfirmed',
    notChecked: (names, platforms) =>
      `Not checked: ${names.join(', ')} — ${names.length === 1 ? 'its rosters use' : 'their rosters use'} ${platforms} player ids we have not matched to our player table yet.`,
    tradeFor: (last) => `Trade for ${last} →`,
    whereToFix: 'Where to fix it →',
    nothingToDo: 'Nothing to do',
    projectsHigher: (name) => `${name} projects higher in that slot`,
    benchIsRight: 'Bench is right',
    onIr: 'On IR — no report says otherwise',
    noCall: 'No call — unpriced',
    seasonStatistics: 'Season statistics',
    pickAMatch: 'Pick a match to see slots, injury and season history.',
  },
  es: {
    railLabel: 'Búsqueda',
    h1: coreUiCopy('Player Finder', 'es'),
    matches: (n) => `Coincidencias · ${n}`,
    typeTwo: 'Escribe al menos dos caracteres para buscar.',
    noMatch: (q) => `Ningún jugador coincide con «${q}».`,
    noPosition: 'sin posición registrada',
    compareWithName: (name) => `Comparar con ${name}`,
    recentlySearched: 'Búsquedas recientes',
    trendHeading: 'Los más añadidos esta semana',
    // «altas», as the app says for adds elsewhere ("altas y bajas").
    trendSub: (n, through) => `de ${n} ${n === 1 ? 'liga' : 'ligas'} con altas${through ? ` · hasta el ${kickoffText(through, 'es')}` : ''}`,
    trendAddedIn: (n) => `añadido en ${n} ${n === 1 ? 'liga' : 'ligas'}`,
    otherMatches: 'Otras coincidencias',
    alsoMatched: 'También coinciden',
    railFoot: 'Las estadísticas, las lesiones y las noticias vienen de datos deportivos en vivo: nunca un número inventado.',
    mainLabel: 'Detalles del jugador',
    sideLabel: 'Qué hacer',
    inLeague: (name) => `en ${name}`,
    inThisLeague: 'en esta liga',
    allLeaguesLink: `${coreUiCopy('All leagues', 'es')} →`,
    onLeagues: (yours, count, platforms) =>
      `en ${yours} de tus ${count} ${ligas(count)}${platforms ? `, en ${platforms}` : ''}`,
    notOnAny: (count) => (count === 1 ? 'no está en tu única liga' : `no está en ninguna de tus ${count} ligas`),
    rosteredByOthers: (n) => ` · lo tienen otros en ${n}`,
    signInAcross: ' · inicia sesión para verlo en todas tus ligas',
    crossLeagueUnavailable: ' · la búsqueda entre ligas no está disponible',
    and: 'y',
    compareWith: 'Comparar con',
    projWeek: (w) => `Proy. sem. ${w}`,
    projThisWeek: 'Proy. esta semana',
    projectionTitle: 'Proyección',
    projectionLeagueBody: 'Puntos esperados esta semana con la puntuación propia de esta liga, no un ranking genérico.',
    projectionStandardBody:
      'La cifra del proveedor de proyecciones para esta semana, con puntuación estándar. Lo que vale en cada una de TUS ligas, con la puntuación propia de esa liga, es la columna PROY. de la tabla de abajo.',
    leagueScoringOf: (name) => `Puntuación de ${name ?? 'esta liga'}`,
    standardScoringSeason: (season) => `Puntuación estándar · ${season}`,
    afProjWeek: (w) => `Proy. AF sem. ${w}`,
    afProj: 'Proy. AF',
    afTitle: 'Proyección de AllFantasy',
    afLeagueBody:
      'El motor de proyecciones propio de AllFantasy para esta semana, ajustado a la puntuación de esta liga. La casilla de al lado es la proyección del proveedor (Sleeper).',
    afStandardBody:
      'El motor de proyecciones propio de AllFantasy para esta semana, con puntuación estándar. Lo que proyecta en cada una de TUS ligas es la columna AF de la tabla de abajo.',
    thisLeagueScoring: 'puntuación de esta liga',
    standardScoring: 'Puntuación estándar',
    posRank: 'Rango pos.',
    ofPricedHere: (outOf, pos) => `de ${outOf} ${pos} valorados · puntuación de esta liga`,
    ofProjected: (outOf, pos) => `de ${outOf} ${pos} proyectados`,
    idpValue: 'Valor IDP',
    idpBody: (numTeams, idpStarters) =>
      'La tabla de mercado de al lado (FantasyCalc) no valora a ningún defensor, así que esto se calcula con proyecciones frente a una liga de referencia fija: ' +
      `${numTeams} equipos, ${idpStarters} titulares IDP, con el perfil de puntuación IDP predeterminado. ` +
      'NO está en la misma escala que los valores ofensivos del resto de esta página: cuánto vale un defensor de élite frente a un receptor de élite es otra pregunta que este número no responde.',
    idpRank: (rank) => `puesto ${rank}`,
    idpReference: (numTeams, idpStarters) => `${numTeams} equipos · ${idpStarters} IDP`,
    snapShare: '% de snaps',
    snapShareBody:
      'La parte de las jugadas ofensivas de su equipo en las que estuvo en el campo, en los partidos que tenemos. Un % de snaps en alza suele llegar antes que los puntos en alza.',
    snapsHelp: (basis, games) => `Snaps ${basis === 'defense' ? 'defensivos' : 'ofensivos'} · ${games} ${games === 1 ? 'partido' : 'partidos'}`,
    age: 'Edad',
    noBirthDate: 'sin fecha de nacimiento registrada',
    injury: 'Lesión',
    noDesignation: 'sin designación',
    inThisLeagueHeading: 'En esta liga',
    everyLeagueHeading: 'Todas las plataformas, todas las ligas',
    slotStatusHere: 'Puesto y estado aquí ·',
    slotStatusNow: 'Puesto y estado tal como están ahora',
    signInReason:
      'Inicia sesión para ver cuáles de tus ligas lo tienen, en qué puesto está y cuánto vale con la puntuación propia de cada liga.',
    connectLeague: 'Conecta una liga: es gratis',
    notOnRosterHere: 'No está en ninguna plantilla que podamos leer en esta liga.',
    notOnAnyRoster: (count) =>
      count === 1
        ? 'No está en ninguna plantilla de la liga que conectaste.'
        : `No está en ninguna plantilla de las ${count} ligas que conectaste.`,
    showOtherRows: (n) => (n === 1 ? 'Ver la liga donde lo tiene otro equipo' : `Ver las ${n} ligas donde lo tiene otro equipo`),
    hideOtherRows: 'Ver solo tus ligas',
    notOnYourRosters: 'No está en ninguna de tus plantillas: lo tienen otros equipos.',
    colLeague: 'Liga',
    colSlot: 'Puesto',
    colStatus: 'Estado',
    colProj: 'Proy.',
    colValue: 'Valor',
    rosteredBy: (who) => `lo tiene ${who}`,
    rosteredByAnother: 'lo tiene otro mánager',
    thisLeagueBadge: 'Esta liga',
    valueInline: (v) => `valor ${v}`,
    valueBasis: (mode, superflex) => `${mode === 'dynasty' ? 'dinastía' : 'redraft'} · ${superflex ? 'superflex' : '1QB'}`,
    valueAdjusted: 'ajustado a la puntuación de esta liga',
    slotUnconfirmed: 'puesto sin confirmar',
    notChecked: (names, platforms) =>
      `Sin comprobar: ${names.join(', ')}. Sus plantillas usan ids de jugador de ${platforms} que todavía no emparejamos con nuestra tabla de jugadores.`,
    tradeFor: (last) => `Intercambiar por ${last} →`,
    whereToFix: 'Dónde corregirlo →',
    nothingToDo: 'Nada que hacer',
    projectsHigher: (name) => `${name} tiene más proyección en ese puesto`,
    benchIsRight: coreUiCopy('Bench is right', 'es'),
    onIr: 'En IR: ningún reporte dice lo contrario',
    noCall: 'Sin decisión: sin valorar',
    seasonStatistics: 'Estadísticas de temporada',
    pickAMatch: 'Elige una coincidencia para ver puestos, lesión e historial de temporadas.',
  },
})

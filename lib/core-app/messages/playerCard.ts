import type { PlayerCardCopy } from '../playerCardCopy'
import { coreUiCopy } from '../coreUiCopy'
import { freeAgentText } from '../finderSearchCopy'
import { FOREIGN_IDS_UNREADABLE } from '../foreignIdSpaceCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * The player card pop-up's own words (components/core-app/player-card/PlayerCardSheet.tsx, via
 * `playerCardCopy` in lib/core-app/playerCardCopy.ts). Every string is the one the module produced
 * before the move, byte for byte, in both languages — a relocation, not a rewrite. The table's type
 * stays exported from playerCardCopy.ts, which callers already import; this file imports it as a type
 * only. The Spanish rebuilds of loader English (slots, reasons, the insight, waiver facts) stay in
 * playerCardCopy.ts: they are keyed on English or built from parts, not en/es pairs.
 */

type Sample = { kind: 'games' | 'at_bats' | 'innings'; count: number }
const sampleCount = (s: Sample) => (s.kind === 'innings' ? String(s.count) : String(Math.round(s.count)))
/** "26 games", "412 at-bats", "41.2 innings". */
const sampleEn = (s: Sample) => `${sampleCount(s)} ${s.kind === 'games' ? 'games' : s.kind === 'at_bats' ? 'at-bats' : 'innings'}`
const sampleEs = (s: Sample) => `${sampleCount(s)} ${s.kind === 'games' ? 'partidos' : s.kind === 'at_bats' ? 'turnos al bate' : 'entradas'}`

/** A market mode or format ("dynasty", "DYNASTY", "redraft") as Player Finder's value basis says it. */
export const modeEs = (mode: string) => (mode.toLowerCase() === 'dynasty' ? 'dinastía' : mode.toLowerCase())

/** "Todavía no podemos emparejar…" — coreUiCopy holds the clause; the card prints it as a sentence. */
const UNREADABLE_ES = (() => {
  const clause = coreUiCopy("this league's player ids can't be matched to ours yet", 'es')
  return clause.charAt(0).toUpperCase() + clause.slice(1)
})()

export const playerCardMessages = defineMessages<PlayerCardCopy>({
  en: {
    afRank: 'AF league rank', afTrade: 'AF league trade value', afWeek: week => `AF week ${week}`,
    afFullSeason: 'AF full season', afRemaining: 'AF rest of season', afPerGame: 'per game',
    afStandardSeason: 'standard season length', afPoints: 'fantasy points', afCategory: 'category score',
    back: '‹ Back',
    dialogLabel: (name) => `${name} player card`,
    follow: (name) => `Follow ${name}`,
    unfollow: (name) => `Unfollow ${name}`,
    followTitle: 'Follow in every league: his status and next game on your home',
    followingTitle: 'Following in every league — click to stop',
    watch: (name) => `Watch ${name}`,
    stopWatching: (name) => `Stop watching ${name}`,
    watchTitle: 'Add to your watchlist',
    watchingTitle: 'Watching — click to remove',
    close: 'Close player card',
    unreadable: FOREIGN_IDS_UNREADABLE,
    freeAgent: 'FREE AGENT',
    onYourRoster: 'ON YOUR ROSTER',
    ownedBy: (owner) => `OWNED BY ${(owner ?? 'another manager').toUpperCase()}`,
    proposeTrade: 'Propose Trade',
    blockOn: 'On your trade block ✓ · Take off',
    blockPut: 'Put on trade block',
    blockTag: 'ON THE TRADE BLOCK',
    blockListed: (ago) => ` · listed ${ago} ago`,
    blockSaveFailed: 'That did not save. Try again.',
    age: 'AGE',
    height: 'HT',
    weight: 'WT',
    experience: 'EXP',
    college: 'COLLEGE',
    rookie: 'ROOKIE',
    loading: 'Loading this player’s market…',
    loadError: 'This player’s card could not be loaded.',
    feedChecked: (ago) => `feed checked ${ago ?? 'just now'}`,
    feedNeverRan: 'feed has not completed a run for this sport yet',
    feedLastError: (ago) => ` · last error ${ago}`,
    feedSkipped: (n) => ` · ${n} run${n === 1 ? '' : 's'} skipped for budget`,
    basedOn: (basis) => `Based on ${basis}.`,
    leaguePrice: 'LEAGUE PRICE',
    leaguePriceSub: (mode, numQbs, teams) => `${mode} · ${numQbs === 2 ? 'SF' : '1QB'} · ${teams}-team`,
    leagueValue: 'LEAGUE VALUE',
    leagueValueSub: (perGame, unit, gamesLeft, scheduleKnown) =>
      `${perGame} ${unit === 'category score' ? 'cat' : 'pts'}/g · ${scheduleKnown ? `${gamesLeft} games left` : `${gamesLeft}-game season`}`,
    dynastyValue: 'DYNASTY',
    dynastyValueSub: (age) => (age != null ? `age ${age} · model estimate` : 'no age on file · model estimate'),
    boardBasis: (b) =>
      `${b.sport} value on this league's own board, the one its trade grades use: ${b.perGame} ${b.unit} per game against ${b.replacement} for the best free agent at his position (${b.replacementName}), ${b.scheduleKnown ? `over ${b.gamesLeft} games left` : `over a full ${b.gamesLeft}-game season (the schedule is not posted yet)`}.` +
      (b.sample ? ` Rests on ${sampleEn(b.sample)}${b.baseline ? `, leaning on the ${b.baseline} season` : ''}.` : ''),
    notPriced: 'not priced',
    slot: 'SLOT',
    tradePrice: 'TRADE PRICE',
    deltaDays: (days) => `${days}d`,
    priceMoveLocked: (plan) => `price move · ${plan}`,
    noMove: 'no move on file',
    overallRank: 'OVERALL RK',
    posRank: (position) => `POS RK${position ? ` · ${position.toUpperCase()}` : ''}`,
    rostered: 'ROSTERED',
    ofLeagues: (n) => `of ${n} AF leagues`,
    startPct: (pct) => ` · ${pct}% start`,
    marketBasis: (format, qbFormat, source) =>
      `${format.toLowerCase()} · ${qbFormat === 'SUPERFLEX' ? 'superflex' : 'one-QB'} · ${source.toLowerCase()}`,
    noMarketPrice: 'No market price.',
    weekRow: (week, bye, home, opponent) => `WK${week} · ${bye ? 'BYE' : `${home ? 'vs' : '@'} ${opponent}`}`,
    gameRow: (day, home, opponent) => `${day} · ${home ? 'vs' : '@'} ${opponent}`,
    gamesThisWeek: (n) => (n === 0 ? 'No games this week' : `${n} ${n === 1 ? 'game' : 'games'} this week`),
    projTitle: (p) => `${p}: ${p}’s projection · AF: AllFantasy engine projection`,
    projNote: (p) => `${p} is ${p}’s own projection; AF is AllFantasy’s own engine. Both are PPR.`,
    schedule: 'SCHEDULE',
    nextUp: 'NEXT UP · SCHEDULE',
    playoffSchedule: (start, end) => (start != null && end != null ? `PLAYOFF SCHEDULE · WK ${start}-${end}` : 'PLAYOFF SCHEDULE'),
    yourRosterAt: (position) => `YOUR ROSTER${position ? ` AT ${position.toUpperCase()}` : ''}`,
    nobodyElse: 'You have nobody else at this position in this league, or your team is not claimed here.',
    unreadableSentence: `${FOREIGN_IDS_UNREADABLE}.`,
    tradesInLeague: 'TRADES IN THIS LEAGUE',
    recentTrades: 'RECENT TRADES',
    noLeagueTrade: 'No trade in this league has moved him.',
    importedScope: 'Trades in leagues AllFantasy has imported.',
    similarPrice: 'SIMILAR PRICE',
    latest: 'LATEST',
    cost: (list) => `Cost ${list}`,
    packageNotRecorded: 'Package not recorded',
    movedWith: (list) => `Moved with ${list}`,
    gradeAria: 'Trade grade for each side',
    gotHim: 'Got him',
    paid: 'Paid',
    gradeLine: (got, gave, moment) => `${got} for ${gave} on the league’s values ${moment}`,
    notGraded: (reason) => `Not graded: ${reason}`,
  },
  es: {
    afRank: 'Ranking AF en la liga', afTrade: 'Valor de intercambio AF', afWeek: week => `AF semana ${week}`,
    afFullSeason: 'Temporada completa AF', afRemaining: 'Resto de temporada AF', afPerGame: 'por partido',
    afStandardSeason: 'duración estándar', afPoints: 'puntos de fantasía', afCategory: 'puntos de categoría',
    back: '‹ Volver',
    dialogLabel: (name) => `Ficha de ${name}`,
    follow: (name) => `Seguir a ${name}`,
    unfollow: (name) => `Dejar de seguir a ${name}`,
    followTitle: 'Síguelo en todas tus ligas: su estado y su próximo partido en tu inicio',
    followingTitle: 'Lo sigues en todas tus ligas: haz clic para dejar de seguirlo',
    watch: (name) => `Añadir a ${name} a tu lista de seguimiento`,
    stopWatching: (name) => `Quitar a ${name} de tu lista de seguimiento`,
    watchTitle: 'Añadir a tu lista de seguimiento',
    watchingTitle: 'En tu lista de seguimiento: haz clic para quitarlo',
    close: 'Cerrar la ficha del jugador',
    unreadable: UNREADABLE_ES,
    freeAgent: freeAgentText('es').toUpperCase(),
    onYourRoster: 'EN TU PLANTILLA',
    ownedBy: (owner) => `LO TIENE ${(owner ?? 'otro mánager').toUpperCase()}`,
    proposeTrade: 'Proponer intercambio',
    blockOn: 'En venta ✓ · Retirar',
    blockPut: 'Poner en venta',
    blockTag: 'EN VENTA',
    blockListed: (ago) => ` · publicado ${ago}`,
    blockSaveFailed: 'No se guardó. Inténtalo de nuevo.',
    age: 'EDAD',
    height: 'ALT.',
    weight: 'PESO',
    experience: 'EXP.',
    college: 'UNIVERSIDAD',
    rookie: 'NOVATO',
    loading: 'Cargando el mercado de este jugador…',
    loadError: 'No se pudo cargar la ficha de este jugador.',
    feedChecked: (ago) => `fuente revisada ${ago ?? 'justo ahora'}`,
    feedNeverRan: 'la fuente todavía no completó una ejecución para este deporte',
    feedLastError: (ago) => ` · último error ${ago}`,
    feedSkipped: (n) => ` · ${n} ${n === 1 ? 'ejecución omitida' : 'ejecuciones omitidas'} por presupuesto`,
    basedOn: (basis) => `Basado en ${basis}.`,
    leaguePrice: 'PRECIO EN LA LIGA',
    leaguePriceSub: (mode, numQbs, teams) => `${modeEs(mode)} · ${numQbs === 2 ? 'SF' : '1QB'} · ${teams} equipos`,
    leagueValue: 'VALOR EN LA LIGA',
    leagueValueSub: (perGame, unit, gamesLeft, scheduleKnown) =>
      `${perGame} ${unit === 'category score' ? 'cat' : 'pts'}/p · ${scheduleKnown ? `quedan ${gamesLeft} partidos` : `temporada de ${gamesLeft} partidos`}`,
    dynastyValue: 'DINASTÍA',
    dynastyValueSub: (age) => (age != null ? `${age} años · estimación del modelo` : 'sin edad registrada · estimación del modelo'),
    boardBasis: (b) =>
      `Valor de ${b.sport} en la tabla propia de esta liga, la misma que usan sus notas de intercambios: ${b.perGame} ${b.unit === 'category score' ? 'de puntaje de categorías' : 'puntos de fantasy'} por partido frente a ${b.replacement} del mejor agente libre en su posición (${b.replacementName}), ${b.scheduleKnown ? `en los ${b.gamesLeft} partidos que quedan` : `en una temporada completa de ${b.gamesLeft} partidos (el calendario todavía no se publicó)`}.` +
      (b.sample ? ` Se apoya en ${sampleEs(b.sample)}${b.baseline ? `, todavía con peso de la temporada ${b.baseline}` : ''}.` : ''),
    notPriced: 'sin precio',
    slot: 'PUESTO',
    tradePrice: 'PRECIO DE INTERCAMBIO',
    deltaDays: (days) => `${days} d`,
    priceMoveLocked: (plan) => `movimiento de precio · ${plan}`,
    noMove: 'sin movimiento registrado',
    overallRank: 'RANGO GENERAL',
    posRank: (position) => `RANGO POS.${position ? ` · ${position.toUpperCase()}` : ''}`,
    rostered: 'EN PLANTILLAS',
    ofLeagues: (n) => `de ${n} ligas de AF`,
    startPct: (pct) => ` · ${pct}% titular`,
    marketBasis: (format, qbFormat, source) =>
      `${modeEs(format)} · ${qbFormat === 'SUPERFLEX' ? 'superflex' : 'un QB'} · ${source.toLowerCase()}`,
    noMarketPrice: 'Sin precio de mercado.',
    weekRow: (week, bye, home, opponent) => `SEM ${week} · ${bye ? 'DESCANSO' : `${home ? 'vs' : '@'} ${opponent}`}`,
    gameRow: (day, home, opponent) => `${day} · ${home ? 'vs' : '@'} ${opponent}`,
    gamesThisWeek: (n) => (n === 0 ? 'Sin partidos esta semana' : `${n} ${n === 1 ? 'partido' : 'partidos'} esta semana`),
    projTitle: (p) => `${p}: proyección de ${p} · AF: proyección del motor de AllFantasy`,
    projNote: (p) => `${p} es la proyección propia de ${p}; AF es el motor propio de AllFantasy. Ambas son PPR.`,
    schedule: 'CALENDARIO',
    nextUp: 'PRÓXIMOS PARTIDOS · CALENDARIO',
    playoffSchedule: (start, end) =>
      start != null && end != null ? `CALENDARIO DE PLAYOFFS · SEM ${start}-${end}` : 'CALENDARIO DE PLAYOFFS',
    yourRosterAt: (position) => `TU PLANTILLA${position ? ` EN ${position.toUpperCase()}` : ''}`,
    nobodyElse: 'No tienes a nadie más en esta posición en esta liga, o tu equipo no está reclamado aquí.',
    unreadableSentence: `${UNREADABLE_ES}.`,
    tradesInLeague: 'INTERCAMBIOS EN ESTA LIGA',
    recentTrades: 'INTERCAMBIOS RECIENTES',
    noLeagueTrade: 'Ningún intercambio de esta liga lo ha movido.',
    importedScope: 'Intercambios en ligas que AllFantasy ha importado.',
    similarPrice: 'PRECIO SIMILAR',
    latest: 'LO ÚLTIMO',
    cost: (list) => `Costó ${list}`,
    packageNotRecorded: 'Paquete no registrado',
    movedWith: (list) => `Llegó junto a ${list}`,
    gradeAria: 'Calificación del intercambio para cada lado',
    gotHim: 'Lo recibió',
    paid: 'Pagó',
    gradeLine: (got, gave, moment) => `${got} por ${gave} con los valores de la liga ${moment}`,
    notGraded: (reason) => `${coreUiCopy('Not graded:', 'es')} ${reason}`,
  },
})

import type { TradeValueCopy } from '../finderTradeValueCopy'
import { coreUiCopy } from '../coreUiCopy'
import { tradeVisualCopy } from '../tradeVisualCopy'
import { finderCopy } from '../playerFinderCopy'
import { finderPlayerInfoCopy } from '../finderPlayerInfoCopy'
import { freeAgentText } from '../finderSearchCopy'
import { slotText } from '../playerMovesCopy'
import { defineMessages } from '@/lib/i18n/messages'

/**
 * Player Finder's trade-and-value cards (lib/core-app/finderTradeValueCopy.ts `tradeValueCopy`): the
 * trade visual, the trade windows, the value trend, the shares board, the team split and the
 * league-in-context card. Every string is the one the module produced before the move, byte for byte,
 * in both languages — a relocation, not a rewrite. The `TradeValueCopy` type stays exported from
 * finderTradeValueCopy.ts, which callers already import. The loaders' reasons and the Spanish rebuilds
 * of server-built sentences (pitch lines, bid reasons, nudges) stay there: they are Spanish keyed on
 * English or built from parts, not en/es pairs.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

const STANCE_ES: Record<string, string> = { contender: 'contendiente', rebuilder: 'en reconstrucción', middle: 'intermedio' }
const HOLDER_SLOT_ES = { STARTER: 'titular', BENCH: 'banca', IR: 'IR', TAXI: 'taxi' } as const

export const finderTradeValueMessages = defineMessages<TradeValueCopy>({
  en: {
    tradeFor: (last) => `Trade for ${last}`,
    bidFor: (last) => `What to bid for ${last}`,
    bidUpgrade: (last) => `${last} would be an upgrade — he is worth bidding on if he hits waivers`,
    bidNoUpgrade: (last) => `${last} would not improve your lineup`,
    bidUpTo: (d) => `Up to $${d}`,
    bidShareOfBudget: (pct) => `${pct}% of your budget`,
    bidShareTail: (pct) => ` — ${pct}% of the upgrade value on his roster.`,
    openTradeCenter: finderPlayerInfoCopy('en').wsOpenTradeCenter,
    noTradesHeading: 'This league does not allow trades',
    noTradesFallback: 'This league’s format has no trades, so there is no package to build for him.',
    whatItTakes: (last, team) => `What it takes to get ${last} from ${team}`,
    noBalanced: (last, team) => `No balanced package for ${last} from ${team} right now`,
    stance: (s) => s,
    tooEarlyStance: 'too early to tell if buying or selling',
    needs: (list) => ` · needs ${list}`,
    deepAt: (list) => ` · deep at ${list}`,
    youGive: 'You give',
    youGet: 'You get',
    nothing: 'Nothing',
    marketValueTitle: 'AllFantasy market value',
    gradePrefix: (reason) => `Grade: ${reason}`,
    deltaToYou: (v) => `${v} market value to you`,
    otherPackages: 'Other packages',
    packageFor: (give, receive) => `${give} for ${receive}`,
    nothingBalanced:
      'The package finder found nothing balanced from your surplus positions. Try the Trade Center to build one by hand.',
    sendItOn: (p) => `Send it on ${p}`,
    valuesFoot: (mode, ppr, numQbs) => `Values are AllFantasy market values (${mode}, ${ppr} PPR, ${numQbs === 2 ? 'superflex' : '1QB'}).`,
    neverSends: (p) => `AllFantasy never sends a trade — you send it on ${p}.`,
    windowTitle: 'Trade window · when they move',
    windowsTitle: 'Trade windows · who’s reachable',
    movedTodayTitle: 'A listed manager moved in the last day',
    windowHelpTitle: 'Trade window',
    windowHelpBody: (league, zone) =>
      `When each manager usually makes their moves, read from ${league}’s own transaction history — so you pitch while they are around instead of letting it sit. AllFantasy cannot see who is online; the window is when they have acted before, in the league’s zone (${zone}).`,
    windowsHelpTitle: 'Trade windows',
    windowsHelpBody:
      'Every league where another manager has him, ordered by when they usually move — read from each league’s own transaction history, in that league’s zone. AllFantasy cannot see who is online; a window is when they have acted before.',
    yoursNoBuyer: (pos) => `He is yours here, and no other roster could be read for a need at ${pos ?? 'his position'}.`,
    nobodyToPitch: 'Nobody to pitch.',
    noMovesIngested:
      'No moves are ingested for this league yet, so there is no window — the need and record are real, the timing is not known.',
    unattributed: (n) => `${n} move${n === 1 ? '' : 's'} in this league could not be put to a name.`,
    copied: 'Copied',
    couldNotCopy: 'Couldn’t copy',
    copyPitch: 'Copy the pitch',
    copyPitchTo: (owner) => `Copy the pitch to @${owner}`,
    gradeIt: 'Grade it',
    gradeItIn: (league) => `Grade it in ${league} →`,
    inWindowNow: (n, total) => `${n} of ${total} ${total === 1 ? 'owner is' : 'owners are'} in their window right now.`,
    soonestFirst: (total) => `${total} ${total === 1 ? 'owner' : 'owners'} across your leagues, soonest window first.`,
    unreadLeagues: (n) => `${n} more ${n === 1 ? 'league' : 'leagues'} where someone else has him could not be read for a window.`,
    trendHeading: 'Market value, last 30 days',
    trendScope: (n) => `${n} of your ${n === 1 ? 'league' : 'leagues'}`,
    trendYoursIn: (n) => ` · yours in ${n}`,
    trendDefaultChart: 'default chart — no league in view',
    sevenDays: '7 days',
    sinceDay: (day) => `since ${day}`,
    month: 'month',
    notEnoughHistory: (label) => `${label}: not enough history`,
    sparkLabel: (d1, d2, v1, v2) => `Value from ${d1} to ${d2}: ${v1} to ${v2}`,
    nudgeHead: (kind) => (kind === 'sell-high' ? 'Sell-high window' : kind === 'buy-low' ? 'Buy-low window' : 'Big drop'),
    trendFoot:
      'FantasyCalc market value, captured daily; a missed day is a gap in the line, not a guess. Moves are judged against every player on the same chart, because redraft values swing about twice as hard as dynasty.',
    sharesTitle: 'Your shares',
    sharesTitleIn: (league) => `Your shares · in ${league}`,
    sharesSub: (players, rosters) => `${players} players across ${rosters} ${rosters === 1 ? 'roster' : 'rosters'}`,
    sharesUnsupported: (n) => ` · ${n} on a platform we can't read yet`,
    sharesNone: 'No rostered players found in the leagues read.',
    sharesOf: 'of',
    sharesStarting: (n) => `${n} starting`,
    holderYou: (slot) => (slot === 'STARTER' ? 'You · starting' : slot === 'IR' ? 'You · IR' : slot === 'TAXI' ? 'You · taxi' : 'You · bench'),
    anotherManager: 'Another manager',
    freeAgent: freeAgentText('en'),
    notReadable: 'Not readable',
    valueLocked: 'value · AF Pro',
    valueDash: 'value —',
    seasonLine: (points, games) => `${points} pts · ${games} ${games === 1 ? 'game' : 'games'}`,
    noStatsYet: 'no stats yet',
    scoringUnknown: 'scoring unknown',
    sharesFootLeague: (league) =>
      `Ranked by how many of your rosters hold him. "Value" is ${league}'s format and scoring (* when its scoring moves the market number); points are this season under ${league}'s own scoring, from his game stat lines.`,
    sharesFootAll:
      'Ranked by how many of your rosters hold him. Pick a league at the top to see who has each of them there, what they are worth in it, and what they have scored under its scoring.',
    splitHeading: 'Where your starters come from',
    splitSub: (n) => `${n} starting QB/RB/WR/TE ${n === 1 ? 'slot' : 'slots'} across your rosters`,
    splitSlots: (n) => `${n} ${n === 1 ? 'slot' : 'slots'}`,
    splitMoreClubs: (teams, starts) => `${teams} more ${teams === 1 ? 'club' : 'clubs'} · ${starts} ${starts === 1 ? 'slot' : 'slots'}`,
    splitNoClub: (n) => `${n} with no club on file`,
    splitWorstByeHead: (week) => `Week ${week} is your biggest bye ahead:`,
    splitWorstByeBody: (starts, total, pct, teams) => ` ${starts} of your ${total} starting slots (${pct}) are off — ${teams}.`,
    splitNoByeAhead: 'None of these clubs has a bye still ahead.',
    splitByesUnknown: "Bye weeks aren't on file yet, so there's no bye call.",
    inThisLeague: 'In this league',
    youLetter: 'Y',
    onYourRoster: (team) => `On your roster${team ? ` — ${team}` : ''}`,
    thatsYou: "That's you. The slot below is where he sits right now.",
    slotChip: (slot) => slot,
    commissioner: 'commissioner',
    noTeamRow: 'rostered here — we hold no team row for this roster, so we cannot name them',
    theirSlotTitle: 'On their roster, in this slot',
    theyStartHim: 'THEY START HIM',
    theirSlot: (slot) => `THEIR ${slot}`,
    unrosteredHere: 'Unrostered in this league',
    notOnAnyRosterHere: (n) => `Not on any of the ${n} rosters we hold for it — he is there to be claimed.`,
    projWeekScoring: (week) => `proj wk ${week} · this league's scoring`,
    readOnly: (p) => `Read-only — the change is made on ${p}. We show you the league and the screen.`,
  },
  es: {
    tradeFor: (last) => `Intercambiar por ${last}`,
    bidFor: (last) => `Qué pujar por ${last}`,
    bidUpgrade: (last) => `${last} mejoraría tu alineación: vale la pena pujar por él si llega a agentes libres`,
    bidNoUpgrade: (last) => `${last} no mejoraría tu alineación`,
    bidUpTo: (d) => `Hasta $${d}`,
    bidShareOfBudget: (pct) => `El ${pct}% de tu presupuesto`,
    bidShareTail: (pct) => `: el ${pct}% del valor de mejora de su plantilla.`,
    openTradeCenter: finderPlayerInfoCopy('es').wsOpenTradeCenter, // WhoStartsHim's (#2069): one translator
    noTradesHeading: 'Esta liga no permite intercambios',
    noTradesFallback: 'El formato de esta liga no tiene intercambios, así que no hay paquete que armar por él.',
    whatItTakes: (last, team) => `Qué hace falta para conseguir a ${last} de ${team}`,
    noBalanced: (last, team) => `Ahora mismo no hay un paquete equilibrado por ${last} con ${team}`,
    stance: (s) => STANCE_ES[s] ?? s,
    tooEarlyStance: 'aún es pronto para saber si compra o vende',
    needs: (list) => ` · necesita ${list}`,
    deepAt: (list) => ` · le sobra en ${list}`,
    youGive: tradeVisualCopy('You give', 'es'),
    youGet: tradeVisualCopy('You get', 'es'),
    nothing: coreUiCopy('Nothing', 'es'),
    marketValueTitle: 'Valor de mercado de AllFantasy',
    gradePrefix: (reason) => `Calificación: ${reason}`,
    deltaToYou: (v) => `${v} de valor de mercado para ti`,
    otherPackages: 'Otros paquetes',
    packageFor: (give, receive) => `${give} por ${receive}`,
    nothingBalanced: `El buscador de paquetes no encontró nada equilibrado con tus posiciones sobrantes. Prueba el ${coreUiCopy('Trade Center', 'es')} para armar uno a mano.`,
    sendItOn: (p) => `Envíalo en ${p}`,
    valuesFoot: (mode, ppr, numQbs) => {
      // playerFinderCopy's basis words ("dinastía · superflex"), with the PPR between them as in English.
      const [modeEs, qb] = finderCopy('es').valueBasis(mode, numQbs === 2).split(' · ')
      return `Los valores son valores de mercado de AllFantasy (${modeEs}, ${ppr} PPR, ${qb}).`
    },
    neverSends: (p) => `AllFantasy nunca envía un intercambio: lo envías tú en ${p}.`,
    windowTitle: 'Ventana de intercambio · cuándo se mueven',
    windowsTitle: 'Ventanas de intercambio · a quién puedes contactar',
    movedTodayTitle: 'Un mánager de la lista hizo un movimiento en el último día',
    windowHelpTitle: 'Ventana de intercambio',
    windowHelpBody: (league, zone) =>
      `Cuándo suele hacer sus movimientos cada mánager, según el historial de transacciones de ${league}, para que se lo propongas mientras está activo en lugar de dejarlo esperar. AllFantasy no puede ver quién está conectado; la ventana es cuando ha actuado antes, en la zona horaria de la liga (${zone}).`,
    windowsHelpTitle: 'Ventanas de intercambio',
    windowsHelpBody:
      'Cada liga donde otro mánager lo tiene, ordenada por cuándo suele moverse, según el historial de transacciones de cada liga y en su zona horaria. AllFantasy no puede ver quién está conectado; una ventana es cuando ha actuado antes.',
    yoursNoBuyer: (pos) => `Aquí es tuyo, y no se pudo leer ninguna otra plantilla con necesidad en ${pos ?? 'su posición'}.`,
    nobodyToPitch: 'No hay a quién proponérselo.',
    noMovesIngested:
      'Aún no se han cargado movimientos de esta liga, así que no hay ventana: la necesidad y el récord son reales, pero no se sabe cuándo se mueven.',
    unattributed: (n) =>
      n === 1 ? '1 movimiento de esta liga no se pudo atribuir a nadie.' : `${n} movimientos de esta liga no se pudieron atribuir a nadie.`,
    copied: 'Copiado',
    couldNotCopy: 'No se pudo copiar',
    copyPitch: 'Copiar la propuesta',
    copyPitchTo: (owner) => `Copiar la propuesta para @${owner}`,
    gradeIt: 'Calificarlo',
    gradeItIn: (league) => `Calificarlo en ${league} →`,
    inWindowNow: (n, total) =>
      total === 1 ? `${n} de 1 dueño está en su ventana ahora mismo.` : `${n} de ${total} dueños están en su ventana ahora mismo.`,
    soonestFirst: (total) =>
      `${total} ${plural(total, 'dueño', 'dueños')} en tus ligas, primero la ventana más próxima.`,
    unreadLeagues: (n) =>
      n === 1
        ? 'No se pudo leer la ventana de 1 liga más donde otro lo tiene.'
        : `No se pudo leer la ventana de ${n} ligas más donde otro lo tiene.`,
    trendHeading: 'Valor de mercado, últimos 30 días',
    trendScope: (n) => `${n} de tus ${plural(n, 'liga', 'ligas')}`,
    trendYoursIn: (n) => ` · tuyo en ${n}`,
    trendDefaultChart: 'tabla predeterminada: ninguna liga a la vista',
    sevenDays: '7 días',
    sinceDay: (day) => `desde el ${day}`,
    month: 'mes',
    notEnoughHistory: (label) => `${label}: sin historial suficiente`,
    sparkLabel: (d1, d2, v1, v2) => `Valor del ${d1} al ${d2}: de ${v1} a ${v2}`,
    nudgeHead: (kind) => (kind === 'sell-high' ? 'Momento de vender alto' : kind === 'buy-low' ? 'Momento de comprar barato' : 'Gran caída'),
    trendFoot:
      'Valor de mercado de FantasyCalc, registrado a diario; un día sin registro es un hueco en la línea, no una estimación. Los movimientos se comparan con todos los jugadores de la misma tabla, porque los valores de redraft oscilan el doble que los de dinastía.',
    sharesTitle: 'Tus acciones',
    sharesTitleIn: (league) => `Tus acciones · en ${league}`,
    sharesSub: (players, rosters) =>
      `${players} ${plural(players, 'jugador', 'jugadores')} en ${rosters} ${plural(rosters, 'plantilla', 'plantillas')}`,
    sharesUnsupported: (n) => ` · ${n} en una plataforma que aún no podemos leer`,
    sharesNone: 'No se encontraron jugadores en las plantillas de las ligas leídas.',
    sharesOf: 'de',
    sharesStarting: (n) => `${n} ${plural(n, 'titular', 'titulares')}`,
    holderYou: (slot) => `Tú · ${HOLDER_SLOT_ES[slot]}`,
    anotherManager: coreUiCopy('Another manager', 'es'),
    freeAgent: freeAgentText('es'),
    notReadable: 'No legible',
    valueLocked: 'valor · AF Pro',
    valueDash: 'valor —',
    seasonLine: (points, games) => `${points} pts · ${games} ${plural(games, 'partido', 'partidos')}`,
    noStatsYet: 'aún sin estadísticas',
    scoringUnknown: 'puntuación desconocida',
    sharesFootLeague: (league) =>
      `Ordenado por cuántas de tus plantillas lo tienen. «Valor» es el formato y la puntuación de ${league} (* cuando su puntuación mueve la cifra de mercado); los puntos son de esta temporada con la puntuación propia de ${league}, según sus estadísticas por partido.`,
    sharesFootAll:
      'Ordenado por cuántas de tus plantillas lo tienen. Elige una liga arriba para ver quién tiene a cada uno ahí, cuánto vale en ella y cuánto ha anotado con su puntuación.',
    splitHeading: 'De dónde vienen tus titulares',
    splitSub: (n) => `${n} ${plural(n, 'puesto titular', 'puestos titulares')} de QB/RB/WR/TE en tus plantillas`,
    splitSlots: (n) => `${n} ${plural(n, 'puesto', 'puestos')}`,
    splitMoreClubs: (teams, starts) =>
      `${teams} ${plural(teams, 'equipo más', 'equipos más')} · ${starts} ${plural(starts, 'puesto', 'puestos')}`,
    splitNoClub: (n) => `${n} sin equipo registrado`,
    splitWorstByeHead: (week) => `La semana ${week} es tu mayor descanso por delante:`,
    splitWorstByeBody: (starts, total, pct, teams) => ` ${starts} de tus ${total} puestos titulares (${pct}) descansan: ${teams}.`,
    splitNoByeAhead: 'Ninguno de estos equipos tiene todavía una semana de descanso por delante.',
    splitByesUnknown: 'Las semanas de descanso aún no están registradas, así que no hay aviso de descanso.',
    inThisLeague: finderCopy('es').inThisLeagueHeading,
    youLetter: 'T',
    onYourRoster: (team) => `En tu plantilla${team ? ` — ${team}` : ''}`,
    thatsYou: 'Eres tú. El puesto de abajo es donde está ahora mismo.',
    slotChip: (slot) => slotText(slot, 'es'),
    commissioner: 'comisionado',
    noTeamRow: 'está en una plantilla de aquí, pero no tenemos su equipo registrado, así que no podemos decir de quién es',
    theirSlotTitle: 'En su plantilla, en este puesto',
    theyStartHim: 'LO ALINEAN DE TITULAR',
    theirSlot: (slot) => `EN SU ${slotText(slot, 'es')}`,
    unrosteredHere: 'Sin equipo en esta liga',
    notOnAnyRosterHere: (n) =>
      n === 1
        ? 'No está en la única plantilla que tenemos de ella: está disponible para reclamarlo.'
        : `No está en ninguna de las ${n} plantillas que tenemos de ella: está disponible para reclamarlo.`,
    projWeekScoring: (week) => `proy. sem. ${week} · ${finderCopy('es').thisLeagueScoring}`,
    readOnly: (p) => `Solo lectura: el cambio se hace en ${p}. Te mostramos la liga y la pantalla.`,
  },
})

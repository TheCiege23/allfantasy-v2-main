import { coreUiCopy } from './coreUiCopy'
import { tradeVisualCopy } from './tradeVisualCopy'
import { finderCopy, reasonText } from './playerFinderCopy'
import { finderPlayerInfoCopy } from './finderPlayerInfoCopy'
import { freeAgentText } from './finderSearchCopy'
import { slotText } from './playerMovesCopy'
import { kickoffText, weekdayEs } from './kickoffText'
import { ageText, leagueConceptText } from './shellCopy'
import { FOREIGN_IDS_UNREADABLE } from './foreignIdSpaceCopy'
import { WEEKDAYS, hourLabel, windowLabel, type ActivityWindow } from './managerActivityWindow'
import { agoLabel, lastName, pitchLine, pitchText, type PitchLine, type PitchPackage } from './tradePitch'
import { platformLabel } from './platformLinks'
import type { ManagerPresence, MoveKind, PresenceManager } from './managerPresence'
import type { PlayerBidInstead } from './playerTradeVisual'
import type { TrendNudge } from './valueTrend'

/**
 * Player Finder's trade-and-value cards in the reader's language (2026-10-05): the trade visual
 * (TradeVisual), the trade windows (TradeWindow, TradeWindows), the market-value trend (ValueTrend),
 * the "Your shares" board and its team split (PlayerSharesBoard, TeamSplit) and the league-in-context
 * card (LeagueOwnershipCard).
 *
 * The English here is each card's English BYTE FOR BYTE — the cards' own suites pin it — so English
 * mode is unchanged. Spanish is built at render from `useOptionalLanguage`, which starts at English on
 * the server and the client alike.
 *
 * Shared translators are reused, never copied:
 *   - trade and value wording goes through the Trade Center's own Spanish: `tradeVisualCopy` ("You
 *     give" → "Envías", the package finder's reasons) and `coreUiCopy` (the grade labels — "Even",
 *     "Slightly favors you" — and "Trade Center"), so the two screens say the same thing;
 *   - the value-book basis ("dynasty · superflex") through playerFinderCopy's `valueBasis`, loader
 *     reasons it already knows through `reasonText`, injury chips through `designationText`;
 *   - the league card's buttons through finderSearchCopy.ts `viewActionsText`, the sticky bar's own
 *     translator, since both render `leagueViewActions`; a FAAB bid is a «puja», as FreeAgentBids says;
 *   - slots ("STARTER", "IR SLOT") through playerMovesCopy's `slotText`, a weekday through `weekdayEs`,
 *     a short date ("Sep 28") through `kickoffText`, an age ("3h ago") through shellCopy's `ageText`,
 *     a league format through `leagueConceptText`.
 *
 * ⚠ SERVER-BUILT SENTENCES ARE REBUILT FROM PARTS, never pattern-matched: the bid card's reason
 * (`PlayerBidInstead.parts`) and the value nudge (`TrendNudge.parts`). The English fields stay as the
 * loaders write them — Chimmy's trade-target verdict reads `bidInstead.reason` as written. A payload
 * built before the parts existed renders its English whole.
 *
 * ⚠ THE LOADERS' FIXED REASONS ARE TRANSLATED WHOLE OR NOT AT ALL, anchored at both ends; an unknown
 * one stays English, never half.
 *
 * Provider and league text — player, team, owner and league names, records, positions — is never
 * touched. PURE, client-safe.
 */

const es = (language: string) => language === 'es'
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// ── The static words, card by card ──────────────────────────────────────────────────────────────

export type TradeValueCopy = {
  // TradeVisual
  tradeFor: (last: string) => string
  bidFor: (last: string) => string
  bidUpgrade: (last: string) => string
  bidNoUpgrade: (last: string) => string
  bidUpTo: (dollars: number) => string
  bidShareOfBudget: (pct: number) => string
  bidShareTail: (pct: number) => string
  openTradeCenter: string
  noTradesHeading: string
  noTradesFallback: string
  whatItTakes: (last: string, team: string) => string
  noBalanced: (last: string, team: string) => string
  stance: (stance: string) => string
  tooEarlyStance: string
  needs: (list: string) => string
  deepAt: (list: string) => string
  youGive: string
  youGet: string
  nothing: string
  marketValueTitle: string
  gradePrefix: (reason: string) => string
  deltaToYou: (signedValue: string) => string
  otherPackages: string
  packageFor: (give: string, receive: string) => string
  nothingBalanced: string
  sendItOn: (platform: string) => string
  valuesFoot: (mode: 'dynasty' | 'redraft', ppr: number, numQbs: number) => string
  neverSends: (platform: string) => string
  // TradeWindow / TradeWindows
  windowTitle: string
  windowsTitle: string
  movedTodayTitle: string
  windowHelpTitle: string
  windowHelpBody: (leagueName: string, zone: string) => string
  windowsHelpTitle: string
  windowsHelpBody: string
  yoursNoBuyer: (position: string | null) => string
  nobodyToPitch: string
  noMovesIngested: string
  unattributed: (n: number) => string
  copied: string
  couldNotCopy: string
  copyPitch: string
  copyPitchTo: (owner: string) => string
  gradeIt: string
  gradeItIn: (leagueName: string) => string
  inWindowNow: (n: number, total: number) => string
  soonestFirst: (total: number) => string
  unreadLeagues: (n: number) => string
  // ValueTrend
  trendHeading: string
  trendScope: (leagues: number) => string
  trendYoursIn: (yours: number) => string
  trendDefaultChart: string
  sevenDays: string
  sinceDay: (day: string) => string
  month: string
  notEnoughHistory: (label: string) => string
  sparkLabel: (fromDay: string, toDay: string, fromValue: string, toValue: string) => string
  nudgeHead: (kind: TrendNudge['kind']) => string
  trendFoot: string
  // PlayerSharesBoard
  sharesTitle: string
  sharesTitleIn: (leagueName: string) => string
  sharesSub: (players: number, rosters: number) => string
  sharesUnsupported: (n: number) => string
  sharesNone: string
  sharesOf: string
  sharesStarting: (n: number) => string
  holderYou: (slot: 'STARTER' | 'BENCH' | 'IR' | 'TAXI') => string
  anotherManager: string
  freeAgent: string
  notReadable: string
  valueLocked: string
  valueDash: string
  seasonLine: (points: string, games: number) => string
  noStatsYet: string
  scoringUnknown: string
  sharesFootLeague: (leagueName: string) => string
  sharesFootAll: string
  // TeamSplit
  splitHeading: string
  splitSub: (n: number) => string
  splitSlots: (n: number) => string
  splitMoreClubs: (teams: number, starts: number) => string
  splitNoClub: (n: number) => string
  splitWorstByeHead: (week: number) => string
  splitWorstByeBody: (starts: number, total: number, pct: string, teams: string) => string
  splitNoByeAhead: string
  splitByesUnknown: string
  // LeagueOwnershipCard
  inThisLeague: string
  youLetter: string
  onYourRoster: (teamName: string | null) => string
  thatsYou: string
  slotChip: (slot: string) => string
  commissioner: string
  noTeamRow: string
  theirSlotTitle: string
  theyStartHim: string
  theirSlot: (slot: string) => string
  unrosteredHere: string
  notOnAnyRosterHere: (rosters: number) => string
  projWeekScoring: (week: number) => string
  readOnly: (platform: string) => string
}

const EN: TradeValueCopy = {
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
}

const STANCE_ES: Record<string, string> = { contender: 'contendiente', rebuilder: 'en reconstrucción', middle: 'intermedio' }
const HOLDER_SLOT_ES = { STARTER: 'titular', BENCH: 'banca', IR: 'IR', TAXI: 'taxi' } as const

const ES: TradeValueCopy = {
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
}

export function tradeValueCopy(language: string): TradeValueCopy {
  return es(language) ? ES : EN
}

// ── The loaders' fixed reasons ──────────────────────────────────────────────────────────────────

/**
 * Every key is a sentence one of this group's loaders writes today, verbatim: playerTradeVisual.ts
 * (the card's and the grade's unavailable reasons), managerPresence.ts, playerShares.ts and
 * playerLeagueView.ts (the ownership `unknown` reason). Exported so a test can hold each to its source.
 */
const REASON_ES: Record<string, string> = {
  // lib/core-app/playerTradeVisual.ts — the card
  'sign in to build a trade for him': 'inicia sesión para armar un intercambio por él',
  'league not found': 'no se encontró la liga',
  'you need a claimed team in this league to build a trade': 'necesitas un equipo reclamado en esta liga para armar un intercambio',
  [`${FOREIGN_IDS_UNREADABLE.toLowerCase()}, so we can't tell who holds him`]: `${coreUiCopy(FOREIGN_IDS_UNREADABLE.toLowerCase(), 'es')}, así que no sabemos quién lo tiene`,
  'he is not on any roster we can read here — claim him instead of trading for him':
    'no está en ninguna plantilla que podamos leer aquí: reclámalo en lugar de intercambiar por él',
  'he is already on your roster in this league': 'ya está en tu plantilla en esta liga',
  'no market values are loaded for this league’s format yet, so a package cannot be priced':
    'todavía no hay valores de mercado cargados para el formato de esta liga, así que no se puede valorar un paquete',
  // lib/core-app/playerTradeVisual.ts — the grade
  'the trade grade did not answer in time': 'la calificación del intercambio no respondió a tiempo',
  'this package could not be graded just now': 'este paquete no se pudo calificar ahora mismo',
  'no package to grade': 'no hay paquete que calificar',
  'this league does not allow trades, so there is no package to grade': 'esta liga no permite intercambios, así que no hay paquete que calificar',
  // lib/core-app/managerPresence.ts (and playerLeagueView.ts's ownership reason)
  'sign in to see who to pitch': 'inicia sesión para ver a quién proponérselo',
  'no rosters have been imported for this league, so we cannot tell who has him':
    'no se ha importado ninguna plantilla de esta liga, así que no sabemos quién lo tiene',
  'nobody has him here — he is a free agent, so there is nobody to pitch; claim him':
    'aquí no lo tiene nadie: es agente libre, así que no hay a quién proponérselo; reclámalo',
  'the roster that holds him has no team row we can name': 'la plantilla que lo tiene no tiene un equipo registrado al que podamos nombrar',
  // lib/core-app/playerShares.ts
  'sign in to see the players you roster most': 'inicia sesión para ver los jugadores que más tienes',
  'connect a league to see your shares': 'conecta una liga para ver tus acciones',
  'none of your leagues has a claimed team yet': 'ninguna de tus ligas tiene todavía un equipo reclamado',
}

const REASON_PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // lib/core-app/rosterIdCoverage.ts `coverageReason` — managerPresence.ts and playerLeagueView.ts
  [
    /^this league's rosters use (\S+) player ids we have not matched to our player table yet, so we cannot tell who has him$/,
    (m) => `las plantillas de esta liga usan ids de jugador de ${m[1]} que todavía no emparejamos con nuestra tabla de jugadores, así que no sabemos quién lo tiene`,
  ],
]

export const TRADE_VALUE_REASON_KEYS: readonly string[] = Object.keys(REASON_ES)

/**
 * A loader's reason in the reader's language. This group's own reasons first; then the trade grader's
 * withheld reasons, which it writes with a full stop that the card strips (tradeVisualCopy has them);
 * then Player Finder's `reasonText`. An unknown reason stays English.
 */
export function tradeValueReasonText(reason: string, language: string): string {
  if (!es(language)) return reason
  const exact = REASON_ES[reason]
  if (exact != null) return exact
  for (const [pattern, build] of REASON_PATTERNS_ES) {
    const m = reason.match(pattern)
    if (m) return build(m)
  }
  if (!reason.endsWith('.')) {
    const withStop = tradeVisualCopy(`${reason}.`, 'es')
    if (withStop !== `${reason}.`) return withStop.replace(/\.$/, '')
  }
  return reasonText(reason, 'es')
}

// ── The grade ───────────────────────────────────────────────────────────────────────────────────

/** "Even", "Slightly favors you" … — the Trade Center's own table. */
export function gradeLabelText(label: string, language: string): string {
  return coreUiCopy(label, language)
}

/**
 * The grade's recommendation (`tradeGradeRecommendation` in lib/decision-os/trade/tradeGrade.ts), one
 * sentence per letter. The two with a figure keep it as the grader formatted it. The "Quoted values:"
 * form is the package-review sentence, translated whole or not at all.
 */
const RECOMMENDATION_ES: Record<string, string> = {
  'A clear win on league value. Check lineup fit and injury risk, then take it.':
    'Una victoria clara según el valor de liga. Revisa el encaje en la alineación y el riesgo de lesión, y acéptalo.',
  'Favors you on league value. Confirm lineup fit and player risk before acting.':
    'Te favorece según el valor de liga. Confirma el encaje en la alineación y el riesgo de los jugadores antes de actuar.',
  'Even on league value — decide on roster fit, this week’s lineup and team direction.':
    'Equilibrado según el valor de liga: decide según el encaje en la plantilla, la alineación de esta semana y el rumbo del equipo.',
}

export function gradeRecommendationText(text: string, language: string): string {
  if (!es(language)) return text
  const exact = RECOMMENDATION_ES[text]
  if (exact) return exact
  const counter = text.match(/^Favors the other side on league value\. A counter needs about ([\d,.]+) more coming back to reach even\.$/)
  if (counter) return `Favorece al otro lado según el valor de liga. Una contraoferta necesita recibir unos ${counter[1]} más para quedar equilibrada.`
  const overpay = text.match(/^An overpay on league value — about ([\d,.]+) short\. Decline, or ask for substantially more\.$/)
  if (overpay) return `Pagas de más según el valor de liga: te faltan unos ${overpay[1]}. Recházalo o pide bastante más.`
  const quoted = text.match(/^Quoted values: (.+?)\. (.+)$/)
  if (quoted) {
    const label = quoted[1]!.charAt(0).toUpperCase() + quoted[1]!.slice(1)
    const labelEs = coreUiCopy(label, 'es')
    const note = tradeVisualCopy(quoted[2]!, 'es')
    if (labelEs !== label && note !== quoted[2]) return `Valores cotizados: ${labelEs.toLowerCase()}. ${note}`
  }
  return text
}

/**
 * The package finder's reasons (lib/trade-discovery/redraftTradeDiscovery.ts). The Trade Center's
 * `tradeVisualCopy` holds most of the finder's sentences; these two it does not.
 */
const PACKAGE_REASON_ES: Record<string, string> = {
  'Target player is on the trade block': 'El jugador buscado está en el mercado de intercambios',
  'Fills one of your roster needs': 'Cubre una de las necesidades de tu plantilla',
}

export function packageReasonText(reason: string, language: string): string {
  if (!es(language)) return reason
  return PACKAGE_REASON_ES[reason] ?? tradeVisualCopy(reason, 'es')
}

/** The concept catalog's no-trade notes (lib/league-rules/conceptCatalog.ts), via `tradeBanReason`. */
const TRADE_BAN_ES: Record<string, string> = {
  'This format has no trades. FAAB is the only way to acquire a player, which is why bid timing carries the whole game.':
    'Este formato no tiene intercambios. El FAAB es la única forma de conseguir un jugador, y por eso el momento de la oferta lo decide todo.',
  'Tournament entries are not rosters that trade with one another.': 'Las inscripciones de un torneo no son plantillas que intercambien entre sí.',
}

export function tradeBanText(text: string, language: string): string {
  if (!es(language)) return text
  return TRADE_BAN_ES[text] ?? text
}

/** `describeScoringFit` (lib/trade-value/scoringFit.ts): "Adjusted for this league’s own reception rules, …". */
export function scoringAdjustmentText(text: string, language: string): string {
  if (!es(language)) return text
  const m = text.match(/^Adjusted for this league’s own reception rules, which the (\S+) PPR chart cannot express: (.+)\.$/)
  return m ? `Ajustado a las reglas de recepción propias de esta liga, que la tabla de ${m[1]} PPR no puede expresar: ${m[2]}.` : text
}

// ── The bid card (a no-trade elimination league) ────────────────────────────────────────────────

/** `bidFor`'s reason, rebuilt from `PlayerBidInstead.parts`; English as written without them. */
export function bidReasonText(bid: PlayerBidInstead, language: string): string {
  const p = bid.parts
  if (!es(language) || !p) return bid.reason
  const money = (n: number) => `$${Math.round(n)}`
  const body =
    p.bid === 'unpriced'
      ? 'No hay un valor utilizable para él ni para el jugador al que reemplazaría: sin valorar, que no es lo mismo que valorado en cero.'
      : p.bid === 'no-upgrade'
        ? 'No mejora tu alineación titular: el jugador al que reemplazaría vale lo mismo o más. No pujes nada; lo escaso son los dólares, no el nombre.'
        : `Es el ${p.sharePct}% del valor de mejora en agentes libres esta semana, así que le corresponde el ${p.sharePct}% de los ${money(p.weekBudget)} de esta semana` +
          (p.paced
            ? `: tus ${money(p.budgetRemaining)} repartidos en unas ${p.weeksAssumed.toFixed(1)} semanas más.`
            : ': todo tu presupuesto restante, porque no hay calendario de eliminación con el que repartirlo.')
  if (bid.marginalValue <= 0) return `No hay intercambios en esta liga, y además no mejoraría tu alineación: ${body}`
  return (
    `No hay intercambios en esta liga. Solo llega a agentes libres si eliminan a su dueño, y toda su plantilla llega con él: ${body}` +
    (p.faabKnown ? '' : ' No tenemos tu FAAB restante en esta liga, así que esa parte no se puede convertir en dólares.')
  )
}

// ── Trade windows ───────────────────────────────────────────────────────────────────────────────

const DAYPART_ES: Record<ActivityWindow['daypart'], string> = {
  morning: 'por la mañana',
  midday: 'a mediodía',
  afternoon: 'por la tarde',
  evening: 'por la noche',
  late: 'de madrugada',
}

/**
 * When a manager usually moves: "Sun 10a–12p ET" → "los dom 10a–12p ET", "Tue evenings ET" → "los mar
 * por la noche ET". The clock and the zone read the same in Spanish (as `kickoffText` keeps them).
 */
export function windowLabelText(w: ActivityWindow, language: string, withZone = true): string {
  if (!es(language)) {
    const label = windowLabel(w)
    return withZone ? label : label.replace(/ [A-Z]{2,4}$/, '')
  }
  const day = weekdayEs(WEEKDAYS[w.weekday] ?? 'Sun')
  const when = w.precision === 'window' ? `${hourLabel(w.startHour)}–${hourLabel(w.endHour)}` : DAYPART_ES[w.daypart]
  return `los ${day} ${when}${withZone ? ` ${w.zone}` : ''}`
}

const FAIRNESS_ES: Record<string, string> = {
  balanced: 'equilibrados',
  'slight edge you': 'con ligera ventaja para ti',
  'slight edge partner': 'con ligera ventaja para el otro equipo',
  lopsided: 'desequilibrados',
  'low confidence': 'poco fiables',
}
const valuesAreEs = (fairness: string) => `los valores están ${FAIRNESS_ES[fairness] ?? fairness}`

const LAST_MOVE_ES: Record<MoveKind, string> = {
  trade: 'Último intercambio',
  waiver: 'Último reclamo ganado',
  roster_move: 'Último movimiento',
}
const NEED_ES = { thin: 'Escaso en', set: 'Cubierto en', deep: 'Sobrado en' } as const
const NEED_LOWER_ES = { thin: 'escaso', set: 'cubierto', deep: 'sobrado' } as const

/**
 * The trade-window line in the reader's language. The English is `pitchLine`'s, and so is the
 * TIMING in both languages — whether now is their window is decided once, there, never twice.
 */
export function pitchLineText(
  args: { presence: ManagerPresence; manager: PresenceManager; playerName: string; now: Date; pkg: PitchPackage },
  language: string,
): PitchLine {
  const english = pitchLine(args)
  if (!es(language)) return english
  const { presence, manager: m, playerName, now, pkg } = args
  const last = lastName(playerName)
  const handle = `@${m.ownerName}`
  const platform = platformLabel(presence.platform)

  let lead: string
  if (m.window) lead = `${handle} suele moverse ${windowLabelText(m.window, 'es')}`
  else if (!presence.activityIngested) lead = `${handle}: aún no se han cargado movimientos de ${platform}`
  else if (m.moves === 0) lead = `${handle} no ha hecho ningún movimiento aquí`
  else lead = `${handle} se mueve sin horario fijo`

  const sentences: string[] = []
  if (m.role === 'owner') {
    sentences.push(
      m.startsHim === true
        ? `Alinea a ${last} de titular en ${presence.leagueName}.`
        : m.startsHim === false
          ? `Tiene a ${last} en la banca en ${presence.leagueName}.`
          : `Tiene a ${last} en ${presence.leagueName}.`,
    )
    sentences.push(pkg && pkg.give.length > 0 ? `Ofrece ${pkg.give.join(' + ')} por ${last}: ${valuesAreEs(pkg.fairness)}.` : 'Pregunta qué haría falta.')
  } else {
    const need = m.need
      ? `${NEED_ES[m.need.level]} ${m.need.position} (${m.need.held} para ${m.need.starters} ${plural(m.need.starters, 'puesto', 'puestos')})`
      : null
    const standing = [m.record, m.rank != null ? `#${m.rank}` : null].filter(Boolean).join(', ') || null
    const lede = [need, standing].filter(Boolean).join(', ')
    sentences.push(lede ? `${lede}: ofrécele a ${last} ahí.` : `Ofrécele a ${last} ahí.`)
  }

  if (english.timing === 'now') sentences.push('Proponlo ahora: es su ventana.')
  else if (english.timing === 'later' && m.window) sentences.push(`Proponlo ${windowLabelText(m.window, 'es', false)}, no ahora.`)
  else if (m.lastMove) sentences.push(`${LAST_MOVE_ES[m.lastMove.kind]}: ${ageText(agoLabel(now.getTime() - new Date(m.lastMove.at).getTime()), 'es')}.`)

  return { lead, body: sentences.join(' '), timing: english.timing }
}

/** What the Copy button puts on the clipboard, in the reader's language. English is `pitchText`'s. */
export function pitchMessageText(args: { manager: PresenceManager; playerName: string; pkg: PitchPackage }, language: string): string {
  if (!es(language)) return pitchText(args)
  const { manager: m, playerName, pkg } = args
  if (m.role === 'owner') {
    if (pkg && pkg.give.length > 0) {
      return `Hola ${m.ownerName}, ¿cambiarías a ${playerName} por ${pkg.give.join(' + ')}? En AllFantasy ${valuesAreEs(pkg.fairness)}. Si hay alguna versión de eso que harías, te escucho.`
    }
    return `Hola ${m.ownerName}, ¿qué haría falta para conseguir a ${playerName}? Estoy abierto a selecciones o a un cambio en una posición que necesites.`
  }
  const need = m.need ? ` se te ve ${NEED_LOWER_ES[m.need.level]} en ${m.need.position}:` : ''
  return `Hola ${m.ownerName},${need} ¿te interesa ${playerName}? Dime a quién moverías y lo paso por AllFantasy.`
}

// ── The value trend ─────────────────────────────────────────────────────────────────────────────

/**
 * "dynasty · superflex" — a value book's basis as `describeValueBook` writes it (BookTrend.label, the
 * nudge's bookLabel), through playerFinderCopy's `valueBasis`. Anything else stays as written.
 */
export function bookLabelText(label: string, language: string): string {
  if (!es(language)) return label
  const m = label.match(/^(dynasty|redraft) · (superflex|1QB)$/)
  return m ? finderCopy('es').valueBasis(m[1] as 'dynasty' | 'redraft', m[2] === 'superflex') : label
}

/** A pinned en-US short date ("Sep 28") in the reader's language ("28 sep"). */
export function shortDateText(text: string, language: string): string {
  return kickoffText(text, language)
}

/** The nudge's sentence, rebuilt from `TrendNudge.parts`; English as written without them. */
export function nudgeText(nudge: TrendNudge, language: string): string {
  const p = nudge.parts
  if (!es(language) || !p) return nudge.text
  const move = `${p.up ? 'Sube' : 'Baja'} un ${p.pct}% esta semana: ${p.up ? 'una subida' : 'una caída'} mayor que la de ${p.tenths} de cada 10 jugadores de esta tabla.`
  const leagues = `${p.yours} ${plural(p.yours, 'liga', 'ligas')}`
  if (nudge.kind === 'sell-high') return `${move} Lo tienes en ${leagues}: un momento para vender alto, si estás dispuesto a moverlo.`
  if (nudge.kind === 'check-cause') return `${move} Lo tienes en ${leagues}: revisa la causa antes de vender en plena caída.`
  return `${move} No es tuyo en estas ligas: un momento para comprar barato, si la causa es temporal.`
}

// ── The league-in-context card ──────────────────────────────────────────────────────────────────

/**
 * The league's format chip (`League.leagueType`: "dynasty", "guillotine", "salary_cap" …). The names
 * Spanish fantasy keeps (dynasty, redraft, keeper, best_ball …) stay as stored; the rest follow
 * shellCopy's `leagueConceptText`.
 */
export function leagueFormatText(format: string, language: string): string {
  if (!es(language)) return format
  const title = format
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  const translated = leagueConceptText(title, 'es')
  return translated === title ? format : translated.toLowerCase()
}

import { coreUiCopy } from './coreUiCopy'
import { FOREIGN_IDS_UNREADABLE } from './foreignIdSpaceCopy'
import { infoReasonText } from './finderPlayerInfoCopy'
import { designationText } from './playerFinderCopy'
import { freeAgentText } from './finderSearchCopy'
import { ageText } from './shellCopy'
import { tradeVisualCopy } from './tradeVisualCopy'
import type { PlayerCardInsight } from './playerCard'
import type { WaiverEdgeFact } from '@/lib/competitive-edge/waiverEdge'

/**
 * The player card pop-up (components/core-app/player-card/PlayerCardSheet.tsx) and the Waivers
 * screens' Competitive Edge card (components/core-app/screens/WaiverCompetitiveEdge.tsx) in the
 * reader's language (2026-10-06).
 *
 * One EN and one ES table behind the same type, as playerFinderCopy.ts does. The EN is each
 * component's English BYTE FOR BYTE — the player-card-* and competitive-edge-waiver-* suites pin it —
 * so English mode is unchanged.
 *
 * Shared translators are reused, never copied: the card shows much of what Player Finder shows, so
 * "Free agent" is finderSearchCopy's, designations go through playerFinderCopy's `designationText`,
 * the dynasty/redraft word as Player Finder's value basis prints it (`dinastía`, `redraft`), relative ages through
 * shellCopy's `ageText`, an unknown loader reason through finderPlayerInfoCopy's `infoReasonText`
 * (which already holds "No recent item mentions this player."), and a withheld trade grade's reason
 * through `tradeVisualCopy`, which holds tradeGrade.ts's reasons. The "when was it graded" phrase is
 * `gradeMoment`'s, in the caller — never "values today" on its own.
 *
 * ⚠ WHAT STAYS AS THE FEED WROTE IT: player, team, league and manager names, news headlines and
 * sources, the injury feed's note and body part, NFL club codes, platform names and the price source.
 *
 * ⚠ LOADER SENTENCES. playerCard.ts's fixed reasons are translated whole, keyed verbatim
 * (`playerCardReasonText`, every key held to its source by __tests__/player-card-spanish.test.tsx);
 * its templated insight and waiverEdge.ts's facts carry structured `parts` beside their English, and
 * the Spanish is built from those at render. Anything unknown stays whole English, never half.
 *
 * PURE, client-safe (the two `import type`s are erased).
 */

const es = (language: string) => language === 'es'

/** A market mode or format ("dynasty", "DYNASTY", "redraft") as Player Finder's value basis says it. */
const modeEs = (mode: string) => (mode.toLowerCase() === 'dynasty' ? 'dinastía' : mode.toLowerCase())

/* ── the player card ────────────────────────────────────────────────────────────────────────────── */

export type PlayerCardCopy = {
  // header
  back: string
  dialogLabel: (name: string) => string
  follow: (name: string) => string
  unfollow: (name: string) => string
  followTitle: string
  followingTitle: string
  watch: (name: string) => string
  stopWatching: (name: string) => string
  watchTitle: string
  watchingTitle: string
  close: string
  // identity
  unreadable: string
  freeAgent: string
  onYourRoster: string
  ownedBy: (owner: string | null) => string
  proposeTrade: string
  blockOn: string
  blockPut: string
  blockTag: string
  blockListed: (ago: string) => string
  blockSaveFailed: string
  age: string
  height: string
  weight: string
  experience: string
  college: string
  rookie: string
  loading: string
  loadError: string
  // availability
  feedChecked: (ago: string | null) => string
  feedNeverRan: string
  feedLastError: (ago: string | null) => string
  feedSkipped: (n: number) => string
  // insight
  basedOn: (basis: string) => string
  // tiles
  leaguePrice: string
  leaguePriceSub: (mode: string, numQbs: number, teams: number) => string
  notPriced: string
  slot: string
  tradePrice: string
  deltaDays: (days: number) => string
  priceMoveLocked: (planName: string) => string
  noMove: string
  overallRank: string
  posRank: (position: string | null) => string
  rostered: string
  ofLeagues: (n: number) => string
  startPct: (pct: number) => string
  marketBasis: (format: string, qbFormat: string, source: string) => string
  noMarketPrice: string
  // schedule
  weekRow: (week: number, bye: boolean, home: boolean, opponent: string | null) => string
  projTitle: (provider: string) => string
  projNote: (provider: string) => string
  schedule: string
  nextUp: string
  playoffSchedule: (startWeek: number | null, endWeek: number | null) => string
  yourRosterAt: (position: string | null) => string
  nobodyElse: string
  unreadableSentence: string
  // trades, comps, news
  tradesInLeague: string
  recentTrades: string
  noLeagueTrade: string
  importedScope: string
  similarPrice: string
  latest: string
  cost: (list: string) => string
  packageNotRecorded: string
  movedWith: (list: string) => string
  gradeAria: string
  gotHim: string
  paid: string
  gradeLine: (got: string, gave: string, moment: string) => string
  notGraded: (reason: string) => string
}

const EN: PlayerCardCopy = {
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
}

/** "Todavía no podemos emparejar…" — coreUiCopy holds the clause; the card prints it as a sentence. */
const UNREADABLE_ES = (() => {
  const clause = coreUiCopy("this league's player ids can't be matched to ours yet", 'es')
  return clause.charAt(0).toUpperCase() + clause.slice(1)
})()

const ES: PlayerCardCopy = {
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
}

export function playerCardCopy(language: string): PlayerCardCopy {
  return es(language) ? ES : EN
}

/**
 * How long ago, the card's compact way: "5m", "3h", "2d", "1w" in English (the card's own rounding,
 * unchanged), "hace 5 min" … in Spanish through shellCopy's `ageText`. Null for no or a bad date.
 */
export function cardAgo(iso: string | null, language: string): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000))
  let short: string
  if (mins < 60) short = `${mins}m`
  else {
    const hrs = Math.round(mins / 60)
    if (hrs < 48) short = `${hrs}h`
    else {
      const days = Math.round(hrs / 24)
      short = days < 14 ? `${days}d` : `${Math.round(days / 7)}w`
    }
  }
  return es(language) ? ageText(`${short} ago`, 'es') : short
}

/** The roster slot playerCard.ts writes (`slotOf`, plus its two "not found" states). */
const SLOT_ES: Record<string, string> = {
  STARTER: 'TITULAR',
  'IR SLOT': 'PUESTO IR',
  TAXI: 'TAXI',
  BENCH: 'BANCA',
  'NOT ROSTERED': 'SIN EQUIPO',
  UNREADABLE: 'NO LEGIBLE',
}

export function slotText(slot: string, language: string): string {
  return es(language) ? (SLOT_ES[slot] ?? slot) : slot
}

/** "2026 1st" (playerCard.ts `pickLabels`) → "2026 · ronda 1". Anything else passes through. */
export function pickLabelText(label: string, language: string): string {
  if (!es(language)) return label
  const m = /^(\d{4}) (\d+)(?:st|nd|rd|th)$/.exec(label)
  return m ? `${m[1]} · ronda ${m[2]}` : label
}

/**
 * The injury feed's status, as the card prints it — upper case ("QUESTIONABLE", "OUT", "IR"). The
 * Spanish is Player Finder's designation word, upper-cased; an abbreviation (IR, PUP) stays.
 */
export function injuryStatusText(status: string, language: string): string {
  if (!es(language)) return status
  const title = status
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  const translated = designationText(title, 'es')
  return translated === title ? status : translated.toUpperCase()
}

/**
 * playerCard.ts's fixed reasons and the trade-block messages (lib/trade-block/importedTradeBlock.ts),
 * verbatim. Every key is a sentence a loader writes today; the test holds each one to its source.
 */
const REASON_ES: Record<string, string> = {
  // loadMarket / loadComps
  'No Sleeper id on file for this player, so no market row can be matched.':
    'No tenemos el id de Sleeper de este jugador, así que no se puede emparejar ningún registro de mercado.',
  'FantasyCalc publishes no value for kickers or defenders, so this player has no market price.':
    'FantasyCalc no publica valores para pateadores ni defensas, así que este jugador no tiene precio de mercado.',
  'No market snapshot on file for this player.': 'No hay ningún registro de mercado de este jugador.',
  'No other players priced in this capture.': 'No hay otros jugadores valorados en este registro.',
  'No comparable prices found.': 'No se encontraron precios comparables.',
  'No price for this player, so there is nothing to compare against.': 'Este jugador no tiene precio, así que no hay con qué compararlo.',
  // loadSchedule
  'No club on file for this player, so his fixtures cannot be looked up.':
    'No tenemos el equipo de este jugador, así que no se pueden buscar sus partidos.',
  'No fixtures on file for these weeks.': 'No hay partidos registrados para estas semanas.',
  // loadTrades
  'No Sleeper id on file, so trades cannot be matched to this player.':
    'No tenemos el id de Sleeper, así que no se pueden emparejar intercambios con este jugador.',
  'Sign in to see trades involving this player from your own leagues.':
    'Inicia sesión para ver los intercambios de tus ligas en los que participó este jugador.',
  'No trade involving this player in your leagues.': 'Ningún intercambio de tus ligas incluye a este jugador.',
  'No trade involving this player in the leagues we hold.': 'Ningún intercambio de las ligas que tenemos incluye a este jugador.',
  // ownership, the injury feed's stamp
  'Ownership could not be read.': 'No se pudieron leer los datos de plantillas.',
  'No record of when this sport was last checked.': 'No hay registro de cuándo se revisó este deporte por última vez.',
  // the league flavour
  'No market values for this league configuration.': 'No hay valores de mercado para la configuración de esta liga.',
  'No published value for kickers or defenders in this format.': 'No hay valores publicados para pateadores ni defensas en este formato.',
  'This player is not in the value set for this league format.': 'Este jugador no está en la tabla de valores del formato de esta liga.',
  'League values could not be read.': 'No se pudieron leer los valores de la liga.',
  'This league has not published a playoff start week, so its playoff schedule cannot be named.':
    'Esta liga no publicó la semana de inicio de los playoffs, así que no se puede indicar su calendario de playoffs.',
  // lib/trade-block/importedTradeBlock.ts — the block's note, and why a mark did not save
  "Sleeper doesn't share its trade block with outside apps, so this only includes players managers put on the block in AllFantasy.":
    'Sleeper no comparte sus jugadores en venta con apps externas, así que aquí solo aparecen los que los mánagers pusieron en venta en AllFantasy.',
  'League not found.': 'No se encontró la liga.',
  'Claim your team in this league to use its trade block.': 'Reclama tu equipo en esta liga para poner jugadores en venta.',
  'Only players on your own roster can go on your trade block.': 'Solo puedes poner en venta a jugadores de tu propia plantilla.',
  "This league's roster ids are not on file yet; try again after the next sync.":
    'Los ids de plantilla de esta liga todavía no están registrados; inténtalo de nuevo después de la próxima sincronización.',
}

const REASON_PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // loadInjury — the window is a constant (INJURY_WINDOW_DAYS)
  [/^No injury designation reported in the last (\d+) days\.$/, (m) => `No se reportó ninguna designación de lesión en los últimos ${m[1]} días.`],
  // ownership — too few leagues
  [
    /^Only (\d+) leagues imported — too few for an ownership rate to mean anything yet\.$/,
    (m) => `Solo hay ${m[1]} ligas importadas: muy pocas para que un porcentaje en plantillas signifique algo todavía.`,
  ],
  // importedTradeBlock.ts `tradeBlockSupport` — a platform other than Sleeper
  [
    /^(.+) doesn't share its trade block with AllFantasy, and marking players here is only available for Sleeper leagues so far\.$/,
    (m) =>
      `${m[1] === 'This platform' ? 'Esta plataforma' : m[1]} no comparte sus jugadores en venta con AllFantasy, y por ahora solo se pueden poner en venta jugadores en ligas de Sleeper.`,
  ],
]

/** Every loader sentence `playerCardReasonText` translates whole — exported so a test can hold each to its source. */
export const PLAYER_CARD_REASON_KEYS: readonly string[] = Object.keys(REASON_ES)

/** A loader's reason or note in the reader's language; an unknown one goes to Player Finder's, then stays English. */
export function playerCardReasonText(reason: string, language: string): string {
  if (!es(language)) return reason
  const exact = REASON_ES[reason]
  if (exact != null) return exact
  for (const [pattern, build] of REASON_PATTERNS_ES) {
    const m = reason.match(pattern)
    if (m) return build(m)
  }
  return infoReasonText(reason, language)
}

/** Why a trade's grade was withheld (tradeGrade.ts and the pick/asset readers) — tradeVisualCopy holds them. */
export function withheldGradeText(reason: string, language: string): string {
  return es(language) ? tradeVisualCopy(reason, 'es') : reason
}

const n0 = (n: number) => Math.round(n).toLocaleString('en-US')
const nRaw = (n: number) => n.toLocaleString('en-US')

/**
 * The card's one derived sentence (playerCard.ts `deriveInsight`), from its `parts`. An insight with no
 * parts (an older payload) stays whole English.
 */
export function insightText(insight: PlayerCardInsight, language: string): { headline: string; detail: string; basis: string } {
  const p = insight.parts
  if (!es(language) || !p) return { headline: insight.headline, detail: insight.detail, basis: insight.basis }
  switch (p.kind) {
    case 'price': {
      const fmt = modeEs(p.format)
      return {
        headline: `El precio de ${p.last} ${p.up ? 'subió' : 'bajó'} ${nRaw(p.change)} en ${p.days} días.`,
        detail: p.up
          ? `Ahora vale ${nRaw(p.value)}, un ${p.pct.toFixed(1)}% más. Si quieres comprarlo, la ventana que existía hace ${p.days} días ya se cerró.`
          : `Ahora vale ${nRaw(p.value)}, un ${p.pct.toFixed(1)}% menos. Una caída de este tamaño es una ventana de compra si crees que su rol sigue intacto.`,
        basis: `${fmt} · ${p.qbFormat === 'SUPERFLEX' ? 'superflex' : '1QB'} · registros de ${p.source.toLowerCase()} con ${p.days} días de diferencia`,
      }
    }
    case 'hedge':
      return {
        headline: `Está en plantillas del ${p.own}% de nuestras ligas, pero solo es titular en el ${p.start}% de ellas.`,
        detail: `${p.rosteredIn} de ${p.leaguesCounted} ligas lo tienen y ${p.startedIn} lo alinean de titular. Los mánagers se están cubriendo, que es como se ve una compra barata antes de que se mueva el precio.`,
        basis: `% en plantillas y % de titular en ${p.leaguesCounted} ligas de AllFantasy`,
      }
    case 'bye':
      return {
        headline: `Descansa en la semana ${p.week}: compáralo con tus titulares antes de intercambiar por él.`,
        detail: `No juega en la semana ${p.week}. Un descanso que coincide con el del resto de tus titulares en esta posición es un costo que nunca aparece en la nota de un intercambio.`,
        basis: `calendario ${p.season}, su equipo no figura en los partidos de la semana ${p.week}`,
      }
    case 'comps':
      return {
        headline: `Con un precio similar al de ${p.names.join(', ')}.`,
        detail:
          'Son los precios más cercanos en el mismo registro. Si no harías el cambio directo, el mercado no está de acuerdo contigo sobre alguno de ellos.',
        basis: 'valores más cercanos en el mismo registro del mercado',
      }
  }
}

/* ── the Waivers screens' Competitive Edge card ─────────────────────────────────────────────────── */

export type WaiverEdgeCopy = {
  heading: string
  aria: string
  basis: (season: number, asOf: string, stale: boolean) => string
}

/**
 * Spanish only — WaiverCompetitiveEdge keeps its English JSX as it was. "Ventaja competitiva" in the
 * heading, as Draft HQ's (`coreUiCopy('Competitive Edge · how the others draft')`); the lock keeps the
 * product name, as coreDepthLockCopy says. Claims are "reclamos" and bids "ofertas", the Waivers
 * screens' words (coreUiCopy, help-topics/waivers.ts).
 */
export const WAIVER_EDGE_ES: WaiverEdgeCopy = {
  heading: 'Ventaja competitiva · los reclamos de los demás mánagers',
  aria: 'Ventaja competitiva · agentes libres',
  basis: (season, asOf, stale) =>
    `Datos de los reclamos ganados en el historial de Sleeper de esta liga en la temporada ${season}${asOf ? `, a ${asOf} ET` : ''}${stale ? ' (puede estar desactualizado)' : ''}. Sleeper no publica las ofertas perdidas, así que solo cuenta las ganadas. Muestra lo que hicieron, no lo que ofertarán.`,
}

const money = (n: number) => `$${n0(n)}`
const reclamos = (n: number) => `${n} ${n === 1 ? 'reclamo' : 'reclamos'}`

/** One waiver-edge fact (waiverEdge.ts) in the reader's language — built from its `parts`, or its English whole. */
export function waiverFactText(fact: WaiverEdgeFact, language: string): string {
  const p = fact.parts
  if (!es(language) || !p) return fact.text
  switch (p.kind) {
    case 'faab_left': {
      const vs =
        p.viewer == null
          ? ''
          : p.left > p.viewer
            ? `, más que tus ${money(p.viewer)}`
            : p.left < p.viewer
              ? `, menos que tus ${money(p.viewer)}`
              : ', lo mismo que a ti'
      return `A ${p.name} le quedan ${money(p.left)} de FAAB${vs}.`
    }
    case 'no_claims':
      return `${p.name} no ganó ningún reclamo esta temporada.`
    case 'claims':
      return p.spent == null
        ? `${p.name} ganó ${reclamos(p.claims)} esta temporada.`
        : `${p.name} ganó ${reclamos(p.claims)} esta temporada y gastó ${money(p.spent)} en total.`
    case 'biggest_bid':
      return `Su oferta ganadora más alta fue de ${money(p.bid)}${p.position ? ` (${p.position})` : ''}.`
    case 'zero_bids':
      return `${p.zero} de sus ${reclamos(p.claims)} ${p.zero === 1 ? 'fue una oferta de $0' : 'fueron ofertas de $0'}.`
    case 'position':
      return `${p.count} de sus ${reclamos(p.claims)} fueron de ${p.position}.`
    case 'outbid_by':
      return p.more === 0
        ? `Ningún otro mánager tiene más FAAB que tus ${money(p.viewer)}.`
        : `${p.more} de los ${p.withBudget} otros mánagers ${p.more === 1 ? 'tiene' : 'tienen'} más FAAB que tus ${money(p.viewer)}.`
    case 'league_claims':
      return p.claims === 0
        ? 'Todavía no hay reclamos ganados registrados en esta liga esta temporada.'
        : `Esta liga lleva ${p.claims} ${p.claims === 1 ? 'reclamo ganado' : 'reclamos ganados'} esta temporada.`
  }
}

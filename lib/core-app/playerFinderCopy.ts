import { coreUiCopy } from './coreUiCopy'
import { kickoffText } from './kickoffText'

/**
 * Player Finder's own words — components/core-app/screens/PlayerFinder.tsx — in the reader's
 * language (2026-10-04).
 *
 * The screen's subcomponents carry their own copy (GameDayBanner, LockClock, LeagueCalls,
 * SwapCandidates, RecommendedMoves, PlayerVerdict …); this is only what the screen itself writes:
 * the rail, the header line, the stat tiles, the injury block, the league table and the empty states.
 * The English here is the screen's English byte for byte — __tests__/player-finder-screen.test.tsx
 * pins it — so English mode is unchanged.
 *
 * Shared translators are reused, never copied: the injury designations and the not-playing chip go
 * through `coreUiCopy`'s table and patterns (adc631a91, #2043), the report time through its
 * `reported …` patterns, the freshness age through shellCopy's `ageText`, the slot chip through
 * playerMovesCopy's `slotText`.
 *
 * The rail's "Most added this week" card (player-finder/TrendingAdds.tsx) takes its words from here
 * too (`trend*`), since it sits beside "Recently searched"; its pinned en-US date ("Sep 28") reads
 * "28 sep" through `kickoffText`. Counts, names, clubs and links do not follow the language.
 *
 * ⚠ THE LOADERS' REASONS ARE TRANSLATED WHOLE OR NOT AT ALL. `reasonText` knows the exact sentences
 * playerFinder.ts, playerImpact.ts, playerLeagueView.ts, snapShare.ts and scoringFit.ts write, each
 * anchored at both ends; a reason it does not know stays whole English, never half. The loaders keep
 * writing English — nothing here changes what a server sends.
 *
 * PURE, client-safe.
 */

export type FinderCopy = {
  // ── The rail ──────────────────────────────────────────────────────────────
  railLabel: string
  h1: string
  matches: (n: number) => string
  typeTwo: string
  noMatch: (query: string) => string
  noPosition: string
  compareWithName: (name: string) => string
  recentlySearched: string
  /** "Most added this week" (TrendingAdds.tsx): the heading, the freshness line, a row's count label. */
  trendHeading: string
  /** `through` is the pinned en-US short date ("Sep 28"), or null when no transaction carries one. */
  trendSub: (activeLeagues: number, through: string | null) => string
  trendAddedIn: (leagues: number) => string
  otherMatches: string
  alsoMatched: string
  railFoot: string
  mainLabel: string
  sideLabel: string
  // ── The header line ───────────────────────────────────────────────────────
  inLeague: (name: string) => string
  inThisLeague: string
  allLeaguesLink: string
  onLeagues: (yours: number, leagueCount: number, platforms: string | null) => string
  notOnAny: (leagueCount: number) => string
  rosteredByOthers: (n: number) => string
  signInAcross: string
  crossLeagueUnavailable: string
  /** The last joiner in "Sleeper, ESPN and Yahoo". */
  and: string
  compareWith: string
  // ── The stat tiles ────────────────────────────────────────────────────────
  projWeek: (week: number) => string
  projThisWeek: string
  projectionTitle: string
  projectionLeagueBody: string
  projectionStandardBody: string
  leagueScoringOf: (leagueName: string | null) => string
  standardScoringSeason: (season: string) => string
  afProjWeek: (week: number) => string
  afProj: string
  afTitle: string
  afLeagueBody: string
  afStandardBody: string
  thisLeagueScoring: string
  standardScoring: string
  posRank: string
  ofPricedHere: (outOf: number, position: string) => string
  ofProjected: (outOf: number, position: string) => string
  idpValue: string
  idpBody: (numTeams: number, idpStarters: number) => string
  idpRank: (rank: number) => string
  idpReference: (numTeams: number, idpStarters: number) => string
  snapShare: string
  snapShareBody: string
  snapsHelp: (basis: 'defense' | 'offense', games: number) => string
  age: string
  noBirthDate: string
  // ── Injury ────────────────────────────────────────────────────────────────
  injury: string
  noDesignation: string
  // ── The league table ──────────────────────────────────────────────────────
  inThisLeagueHeading: string
  everyLeagueHeading: string
  slotStatusHere: string
  slotStatusNow: string
  signInReason: string
  connectLeague: string
  notOnRosterHere: string
  notOnAnyRoster: (leagueCount: number) => string
  /** The folded table: rows where someone else has him, behind one toggle (OTHERS_FOLD_AFTER). */
  showOtherRows: (n: number) => string
  hideOtherRows: string
  notOnYourRosters: string
  colLeague: string
  colSlot: string
  colStatus: string
  colProj: string
  colValue: string
  rosteredBy: (who: string) => string
  rosteredByAnother: string
  thisLeagueBadge: string
  valueInline: (value: string) => string
  valueBasis: (mode: 'dynasty' | 'redraft', superflex: boolean) => string
  valueAdjusted: string
  slotUnconfirmed: string
  notChecked: (leagueNames: string[], platforms: string) => string
  // ── A row's action ────────────────────────────────────────────────────────
  tradeFor: (last: string) => string
  whereToFix: string
  nothingToDo: string
  projectsHigher: (name: string) => string
  benchIsRight: string
  onIr: string
  noCall: string
  // ── The rest ──────────────────────────────────────────────────────────────
  seasonStatistics: string
  pickAMatch: string
}

const leaguesWord = (n: number) => (n === 1 ? 'league' : 'leagues')
const ligas = (n: number) => (n === 1 ? 'liga' : 'ligas')

const EN: FinderCopy = {
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
}

const ES: FinderCopy = {
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
}

export function finderCopy(language: string): FinderCopy {
  return language === 'es' ? ES : EN
}

/** "Sleeper and ESPN", "Sleeper, ESPN and Yahoo" — the joiner in the reader's language. */
export function platformListText(names: string[], language: string): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} ${finderCopy(language).and} ${names[names.length - 1]}`
}

/**
 * An injury designation or readiness label — the chip beside his name, the Status column, the injury
 * block. `coreUiCopy` holds the feed's designations (Questionable, Doubtful, Out …) and "Ready"; the
 * two here are the ones whose `coreUiCopy` key already means something else: `Inactive` there is a
 * plural column heading ("Inactivos"), and a single player's chip is singular.
 */
const DESIGNATION_ES: Record<string, string> = { Active: 'Activo', Inactive: 'Inactivo' }

export function designationText(label: string, language: string): string {
  if (language !== 'es') return label
  return DESIGNATION_ES[label] ?? coreUiCopy(label, 'es')
}

/**
 * The loaders' reasons — why a tile, block or cell is empty. Every key is a sentence a loader writes
 * today, verbatim; see the module comment.
 */
const REASON_ES: Record<string, string> = {
  // lib/core-app/playerFinder.ts
  'we have no platform id for this player, so we cannot tell which of your leagues roster him':
    'no tenemos un id de plataforma para este jugador, así que no podemos saber cuáles de tus ligas lo tienen',
  'no injury designation on file — which is not the same as healthy': 'no hay designación de lesión registrada, que no es lo mismo que sano',
  'no season statistics ingested for this player': 'no hay estadísticas de temporada cargadas para este jugador',
  'this week’s projection feed does not carry this player': 'el proveedor de proyecciones de esta semana no incluye a este jugador',
  'we hold no Sleeper id for this player, and the projection feed is keyed by one':
    'no tenemos el id de Sleeper de este jugador, y las proyecciones se identifican por ese id',
  'a rank needs this player to appear in the projection set, and he does not':
    'un rango necesita que este jugador aparezca en las proyecciones, y no aparece',
  'AllFantasy’s engine has no projection for this player this week': 'el motor de AllFantasy no tiene proyección para este jugador esta semana',
  'we hold no Sleeper id for this player, and AllFantasy’s projections are keyed by one':
    'no tenemos el id de Sleeper de este jugador, y las proyecciones de AllFantasy se identifican por ese id',
  // lib/core-app/playerImpact.ts `afPoints` (the table's PROJ cell and "No call — unpriced")
  'we hold no scoring settings for this league, and a generic projection would not be yours':
    'no tenemos las reglas de puntuación de esta liga, y una proyección genérica no sería la tuya',
  'we hold no usable scoring rules for this league — only a preset label, not the rules themselves':
    'no tenemos reglas de puntuación utilizables para esta liga: solo una etiqueta de formato, no las reglas',
  // lib/core-app/playerLeagueView.ts (the tiles in league mode)
  'we hold no scoring settings for this league, and a generic projection would not be this league’s':
    'no tenemos las reglas de puntuación de esta liga, y una proyección genérica no sería la de esta liga',
  'no projection week is loaded yet': 'todavía no hay ninguna semana de proyecciones cargada',
  'a rank needs this player priced under this league’s scoring first':
    'un rango necesita primero valorar a este jugador con la puntuación de esta liga',
  'the projection feed does not list him at this position, so he cannot be ranked in it':
    'el proveedor de proyecciones no lo lista en esta posición, así que no se le puede dar un rango en ella',
  'defensive players are not ranked here — the feed’s line for the rest of the position carries no defensive scoring':
    'aquí no se da rango a los defensores: la línea del proveedor para el resto de la posición no lleva puntuación defensiva',
  // lib/core-app/snapShare.ts `NO_SLEEPER_ID_REASON`
  'we hold no Sleeper id for this player, and the game logs are keyed by one':
    'no tenemos el id de Sleeper de este jugador, y los registros de partidos se identifican por ese id',
}

const REASON_PATTERNS_ES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // snapShare.ts `missingColumnsReason`
  [
    /^no game on file carries both (\S+) and (\S+) for this player$/,
    (m) => `ningún partido registrado tiene ${m[1]} y ${m[2]} a la vez para este jugador`,
  ],
  // playerFinder.ts — a shared name the injury feed cannot tell apart
  [
    /^more than one (\S+) player is named (.+), and the injury feed carries no id to tell them apart — so we will not guess$/,
    (m) => `hay más de un jugador de ${m[1]} llamado ${m[2]}, y el parte de lesiones no trae un id para distinguirlos, así que no vamos a adivinar`,
  ],
  // lib/trade-value/scoringFit.ts — the league Value cell's note
  [
    /^(\S+) receptions are worth (-?[\d.]+) here, matching the chart — no adjustment$/,
    (m) => `las recepciones de ${m[1]} valen ${m[2]} aquí, igual que en la tabla de mercado: sin ajuste`,
  ],
  [
    /^(\S+) receptions are worth (-?[\d.]+) here vs (-?[\d.]+) on the chart \(([+-]?[\d.]+)\/catch\), which is (-?\d+)% of this position's points$/,
    (m) =>
      `las recepciones de ${m[1]} valen ${m[2]} aquí frente a ${m[3]} en la tabla de mercado (${m[4]} por recepción), lo que equivale al ${m[5]}% de los puntos de esta posición`,
  ],
]

/** Every loader sentence `reasonText` translates whole — exported so a test can hold each to its loader's source. */
export const FINDER_REASON_KEYS: readonly string[] = Object.keys(REASON_ES)

/** A loader's reason in the reader's language; unknown reasons fall to `coreUiCopy`, then stay English. */
export function reasonText(reason: string, language: string): string {
  if (language !== 'es') return reason
  const exact = REASON_ES[reason]
  if (exact != null) return exact
  for (const [pattern, build] of REASON_PATTERNS_ES) {
    const m = reason.match(pattern)
    if (m) return build(m)
  }
  // The impact reasons ("sign in to see which of your leagues this affects" …) are #2046's, in coreUiCopy.
  return coreUiCopy(reason, 'es')
}

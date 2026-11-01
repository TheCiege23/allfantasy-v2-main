import { coreUiCopy } from './coreUiCopy'
import { messagesFor } from '@/lib/i18n/messages'
import { finderScreenMessages } from './messages/finderScreen'

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

export function finderCopy(language: string): FinderCopy {
  return messagesFor(finderScreenMessages, language)
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

/**
 * Commissioner OS — League Analytics, Reports and Workspace in the reader's language (2026-10-06).
 *
 * Group C3 of the Commissioner OS Spanish pass. Every word these three screens draw that is the
 * app's OWN goes through here: the view chrome, the chart legends, axis labels and aria-labels, and
 * the sentences the loaders build on the server.
 *
 * ⚠ THE LOADERS ARE NOT EDITED. Their sentences are translated AT RENDER, whole, by the matchers
 * below. Two reasons, both about other people's files:
 *   - `lib/commissioner-ui/analytics/decision-os-client/live.ts` also feeds Mission Control's
 *     headline (`getSummary`, C1's screen), and `lib/commissioner-ui/charts/deriveChartSeries.ts` is
 *     read by League Health, Recommendations, Automations and Mission Control — shared loaders, which
 *     the brief says to translate at render rather than edit.
 *   - The workspace task rows and report history rows are STORED: the scanner
 *     (`lib/commissioner-workspace/taskSources.ts`, `operationalTasks.ts`) and the generator
 *     (`lib/commissioner-reports/reportCatalog.ts`) write English into Postgres at scan/generate time,
 *     so a `parts` field would only reach rows written after it ships.
 * __tests__/cos-analytics-spanish.test.tsx holds every matcher to its loader's source, so a reworded
 * loader sentence fails there instead of silently going English.
 *
 * ⚠ NUMBERS KEEP THE PINNED en-US FORMAT (`pinnedTime.count`, `toLocaleString()` on the server).
 * Only the WORDS around them change. Dates are `pinnedTime.ts`'s, called with the language (C1, #2099);
 * the warehouse's pre-formatted "Sep 01" week labels go through `kickoffText`, which writes the same
 * short months.
 *
 * ⚠ NO WINDOW IS INVENTED. "(last 90d)" is translated only where the loader already wrote it, and the
 * number in it is the loader's.
 *
 * Section names are C1's (`shellCopy.commissionerSectionName` / `moduleLabelText`), never copied here.
 *
 * Provider text is never translated: manager, team and league names, demo names, and the activity
 * types a provider sends that are not in `ACTIVITY_ES` (they pass through as written).
 *
 * Anything a matcher does not recognise passes through unchanged — never blanked. PURE, client-safe.
 */
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { commissionerSectionName, moduleLabelText } from '@/lib/commissioner-os/i18n/shellCopy'
import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'

const isEs = (language: string | null | undefined): boolean => language === 'es'

/* ── Related-evidence links ───────────────────────────────────────────────── */

/** The two link labels that are not section names (taskSources.ts, operationalTasks.ts). */
const LINK_ES: Record<string, string> = {
  'League settings': 'Ajustes de la liga',
  'Review league': 'Revisar la liga',
}

/**
 * The live report history labels its related links with the bare module ID ("analytics") —
 * reports/decision-os-client/live.ts, for every module but Mission Control. Spanish gives the name.
 */
const LINK_MODULE_IDS = new Set<string>(['analytics', 'managers', 'workspace', 'league-health', 'mission-control'])

function linkPart(part: string): string {
  if (LINK_ES[part]) return LINK_ES[part]!
  if (LINK_MODULE_IDS.has(part)) return moduleLabelText(part as CommissionerModuleId, part, 'es')
  return commissionerSectionName(part, 'es')
}

/** A related-evidence link label: a section name or module ID, or "<demo name> — <section name>". */
export function cosLinkText(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  const whole = linkPart(label)
  if (whole !== label) return whole
  const m = /^(.+) — (.+)$/.exec(label)
  if (m) {
    const left = linkPart(m[1]!)
    const right = linkPart(m[2]!)
    if (right !== m[2] || left !== m[1]) return `${left} — ${right}`
  }
  return label
}

/* ── Errors the adapter hands every screen ────────────────────────────────── */

const ERROR_ES: Record<string, string> = {
  'The live Decision OS backend is not yet integrated in this environment.':
    'El backend en vivo de Decision OS todavía no está integrado en este entorno.',
  'No active league could be resolved for this session.': 'No se pudo determinar una liga activa para esta sesión.',
  'Decision OS response failed contract validation.': 'La respuesta de Decision OS no pasó la validación del contrato.',
  'This league has not been scanned yet. The workspace task scan runs daily; an empty list here would claim a clean bill of health nothing has checked.':
    'Esta liga todavía no se ha analizado. El análisis de tareas del espacio de trabajo se ejecuta a diario; una lista vacía aquí afirmaría que todo está en orden sin que nada lo haya comprobado.',
}

/** An adapter error message in the reader's language; an unknown one passes through. */
export function cosErrorText(message: string, language: string | null | undefined): string {
  if (!isEs(language)) return message
  return ERROR_ES[message] ?? message
}

/* ── League Analytics: the loader's words ─────────────────────────────────── */

const TIER_ES: Record<string, string> = { High: 'Alta', Moderate: 'Moderada', Low: 'Baja', None: 'Ninguna' }

/** Activity types `warehouseReads.humaniseActivityType` produces, plus the donut's own fold. */
const ACTIVITY_ES: Record<string, string> = {
  Trade: 'Intercambio',
  Waiver: 'Reclamo',
  'Roster move': 'Movimiento de plantilla',
  'Draft pick': 'Selección del draft',
  'Free agent': 'Agente libre',
}

const ANALYTICS_EXACT_ES: Record<string, string> = {
  // live.ts — the KPI row
  'League Engagement Score': 'Puntuación de participación de la liga',
  ...TIER_ES,
  'Live league intelligence is unavailable right now, so the headline numbers and trend lines are hidden. Season history below is unaffected.':
    'La inteligencia de la liga en vivo no está disponible ahora mismo, así que las cifras principales y las líneas de tendencia están ocultas. El historial de temporadas de abajo no se ve afectado.',
  // warehouseReads.ts — competitive balance
  Blowouts: 'Palizas',
  'One-score games': 'Partidos de una anotación',
  'Average margin': 'Margen promedio',
  'Scoring spread': 'Diferencia de puntuación',
  'Title spread': 'Reparto de títulos',
  'Mean winning margin across every completed matchup this season.':
    'Margen de victoria promedio en cada enfrentamiento terminado esta temporada.',
  // demo.ts — the preview fixture's KPI and balance words (its names stay as written)
  'Total Transactions': 'Transacciones totales',
  'Competitive Balance Index': 'Índice de equilibrio competitivo',
  'Active Managers': 'Mánagers activos',
  'Steady all season': 'Estable toda la temporada',
  'No turnover this season': 'Sin bajas esta temporada',
  'Point differential (1st vs. 12th)': 'Diferencia de puntos (1.º vs. 12.º)',
  'Narrower than league average — a tightly contested season.': 'Más estrecha que el promedio de la liga: una temporada muy disputada.',
  'Playoff race margin': 'Margen en la carrera de playoffs',
  'Championship variety': 'Variedad de campeones',
  'Healthy variety — no single dynasty.': 'Variedad sana: ninguna dinastía domina.',
  ...ACTIVITY_ES,
}

const ANALYTICS_PATTERNS_ES: Array<[RegExp, (...m: string[]) => string]> = [
  // live.ts — "Active Managers (last 90d)": the window is the loader's own number.
  [/^Active Managers \(last (\d+)d\)$/, (n) => `Mánagers activos (últimos ${n} d)`],
  [/^Trade Activity \(last (\d+)d\)$/, (n) => `Actividad de intercambios (últimos ${n} d)`],
  [/^Waiver Activity \(last (\d+)d\)$/, (n) => `Actividad de reclamos (últimos ${n} d)`],
  [/^(\d+) of (\d+)$/, (a, b) => `${a} de ${b}`],
  [/^(High|Moderate|Low|None) · (\d+) all-time$/, (tier, n) => `${TIER_ES[tier]} · ${n} en total`],
  [/^([+-]?[\d.]+) vs previous capture$/, (d) => `${d} vs. la captura anterior`],
  // warehouseReads.ts — competitive balance interpretations
  [/^(\d+)% of games were decided by 30 points or more\.$/, (p) => `El ${p}% de los partidos se decidió por 30 puntos o más.`],
  [/^(\d+)% were decided by under 10 points\.$/, (p) => `El ${p}% se decidió por menos de 10 puntos.`],
  [/^Between the highest-scoring team \(([\d,.]+)\) and the lowest \(([\d,.]+)\)\.$/, (hi, lo) => `Entre el equipo con más puntos (${hi}) y el que menos (${lo}).`],
  [/^A different team has won each of the last (\d+) seasons\.$/, (n) => `Un equipo distinto ganó cada una de las últimas ${n} temporadas.`],
  [
    /^(\d+) different (?:team has|teams have) won the last (\d+) seasons\.$/,
    (k, n) => `${k} ${k === '1' ? 'equipo distinto ha' : 'equipos distintos han'} ganado las últimas ${n} temporadas.`,
  ],
  // demo.ts
  [/^([+-]?\d+) vs last month$/, (d) => `${d} vs. el mes pasado`],
  [/^([+-]?\d+) this month$/, (d) => `${d} este mes`],
  [/^(\d+) games?$/, (n) => `${n} ${n === '1' ? 'partido' : 'partidos'}`],
  [/^(\d+) different champions in (\d+) seasons$/, (k, n) => `${k} campeones distintos en ${n} temporadas`],
  [/^The closest playoff race in (\d+) seasons\.$/, (n) => `La carrera de playoffs más reñida en ${n} temporadas.`],
]

/**
 * A sentence or label the analytics loader built (KPI label, value and trend, the degraded notice,
 * a competitive-balance metric, an activity type), in the reader's language. "142.3 pts" and other
 * bare numbers come back as they went in.
 */
export function analyticsDataText(text: string | null | undefined, language: string | null | undefined): string {
  if (text == null) return ''
  if (!isEs(language)) return text
  const exact = ANALYTICS_EXACT_ES[text]
  if (exact != null) return exact
  for (const [pattern, build] of ANALYTICS_PATTERNS_ES) {
    const m = pattern.exec(text)
    if (m) return build(...m.slice(1))
  }
  return text
}

/** A week axis label: the fixture's "Wk 6" or the warehouse's calendar "Sep 01". */
export function weekLabelText(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  const wk = /^Wk (\d+)$/.exec(label)
  if (wk) return `${coreUiCopy('Wk', 'es')} ${wk[1]}`
  return kickoffText(label, 'es')
}

/** `describeRange`'s sentence, translated whole so the range logic keeps one definition. */
export function describeRangeText(text: string, language: string | null | undefined): string {
  if (!isEs(language)) return text
  let m: RegExpExecArray | null
  if ((m = /^Last (\d+) weeks$/.exec(text))) return `Últimas ${m[1]} semanas`
  if ((m = /^All (\d+) seasons on record$/.exec(text))) return m[1] === '1' ? '1 temporada registrada' : `Las ${m[1]} temporadas registradas`
  if ((m = /^Weeks 1–(\d+), this season$/.exec(text))) return `Semanas 1–${m[1]}, esta temporada`
  if ((m = /^(\d+) weeks with activity$/.exec(text))) return `${m[1]} ${m[1] === '1' ? 'semana' : 'semanas'} con actividad`
  if (text === 'This season') return 'Esta temporada'
  return text
}

/* ── League Analytics: the view's own words ───────────────────────────────── */

type RangeId = 'season' | 'last4' | 'all'

export interface AnalyticsCopy {
  loadFailed: string
  timeRange: string
  range: Record<RangeId, { label: string; hint: string }>
  exportCsv: string
  headlineNumbers: string
  notWired: (what: string) => string
  whatWeeklyHealth: string
  whatTransactions: string
  whatManagerActivity: string
  whatScoring: string
  healthBecause: string
  daysAgo: (days: number) => string
  freshNone: (lookbackDays: number) => { strong: string; rest: string }
  freshStale: (asOf: string, ago: string, inactiveAfterDays: number, events: string) => { strong: string; rest: string }
  freshCurrent: (lookbackDays: number, asOf: string, ago: string) => string
  thisSeason: string
  lastSeason: string
  target: (t: number) => string
  targetChip: (t: number) => string
  healthAria: (first: number | undefined, last: number | undefined, target: number | null) => string
  waiverClaims: string
  trades: string
  transactionsAria: (weeks: Array<{ week: string; waivers: number; trades: number }>) => string
  nameList: (names: string[]) => string
  calloutLeagueWide: (n: number, total: number, topPrior: number, topNow: number) => string
  calloutNamed: (low: number, threshold: number, declined: number, floor: number, named: string) => string
  activityFoot: string
  pointsFor: string
  pointsAgainst: string
  pointsAria: (teams: Array<{ team: string; pf: number; pa: number }>) => string
  pointsFoot: string
  healthTitle: string
  healthNote: string
  transactionsTitle: string
  transactionsNote: string
  activityTitle: string
  activityNote: string
  pointsTitle: string
  pointsNote: (seasonLabel: string | null) => string
  balanceTitle: string
  mixTitle: string
  mixNote: string
  mixAria: (slices: Array<{ label: string; count: number }>) => string
  recordsTitle: string
  recordsNote: string
  recordsAria: (rows: Array<{ team: string; wins: number; losses: number; seasons: number; titles: number }>) => string
  fingerprintsTitle: string
  fingerprintsNote: string
  fingerprintsAria: (n: number) => string
  generated: (when: string) => string
}

const enNameList = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
const esNameList = (names: string[]): string => {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} y ${names[1]}`
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`
}

const ANALYTICS_EN: AnalyticsCopy = {
  loadFailed: "Couldn't load league analytics right now.",
  timeRange: 'Time range',
  range: {
    season: { label: 'This season', hint: 'Every week played so far' },
    last4: { label: 'Last 4 weeks', hint: 'The four most recent weeks' },
    all: { label: 'All-time', hint: 'Every season on record' },
  },
  exportCsv: 'Export CSV',
  headlineNumbers: 'Headline numbers',
  notWired: (what) =>
    `No ${what} for this league yet. This section reads from the live platform and is left blank rather than filled with an example — an empty chart here would read as “no activity”, which is a different thing.`,
  whatWeeklyHealth: 'weekly health history',
  whatTransactions: 'transaction history',
  whatManagerActivity: 'per-manager activity',
  whatScoring: 'scoring totals',
  healthBecause:
    "A weekly engagement line is computable from league activity, but a dynasty league's activity is mostly offseason — it would draw a near-zero line for most of the year and read as a collapsing league rather than a normal August.",
  daysAgo: (days) => (days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`),
  freshNone: (lookback) => ({
    strong: 'No activity recorded for this league.',
    rest: `Every number below is measured over the last ${lookback} days of league activity, and we hold none — so they describe our data, not your league.`,
  }),
  freshStale: (asOf, ago, inactive, events) => ({
    strong: `Newest league activity is from ${asOf} (${ago}).`,
    rest: `Managers count as inactive after ${inactive} days without an action, so the participation and activity numbers below reflect how old this data is, not how quiet the league is. We hold ${events} events for it all-time.`,
  }),
  freshCurrent: (lookback, asOf, ago) => `Measured over the last ${lookback} days. Newest activity ${asOf} (${ago}).`,
  thisSeason: 'This season',
  lastSeason: 'Last season',
  target: (t) => `Target ${t}`,
  targetChip: (t) => `TARGET ${t}`,
  healthAria: (first, last, target) =>
    `League health by week. This season runs ${first} to ${last}${target !== null ? `, against a target of ${target}` : ''}.`,
  waiverClaims: 'Waiver claims',
  trades: 'Trades',
  transactionsAria: (weeks) =>
    `Weekly transactions: ${weeks.map((w) => `${w.week}, ${w.waivers} waiver claims and ${w.trades} trades`).join('; ')}.`,
  nameList: enNameList,
  calloutLeagueWide: (n, total, prior, now) =>
    `${n} of ${total} managers are doing less than they were. The most active manager is down from ${prior} to ${now} actions a week.`,
  calloutNamed: (low, threshold, declined, floor, named) => {
    const noun = low === 1 ? 'manager is' : 'managers are'
    const subject = declined === low ? (declined === 1 ? 'They were' : 'They were each') : `${declined} of them were`
    return `${low} ${noun} below ${threshold} actions a week. ${subject} above ${floor} earlier — ${named}.`
  },
  activityFoot:
    'Actions a week: lineup changes, waiver claims, trade offers and messages. The arrow compares against the same manager earlier this season, not against the league.',
  pointsFor: 'Points for',
  pointsAgainst: 'Points against',
  pointsAria: (teams) => `Points for and against per team: ${teams.map((t) => `${t.team}, ${t.pf} for and ${t.pa} against`).join('; ')}.`,
  pointsFoot: 'Season totals. A team high on both bars is playing a hard schedule, not a bad one — read the pair, not either bar alone.',
  healthTitle: 'League health by week',
  healthNote: 'This season against last, with the target this league set.',
  transactionsTitle: 'Transactions by week',
  transactionsNote: 'Waiver claims and trades, counted separately. Calendar weeks — most dynasty movement happens outside the NFL season.',
  activityTitle: 'Manager activity',
  activityNote: "Ranked by actions a week, against each manager's own rate over the previous window.",
  pointsTitle: 'Points for and against',
  pointsNote: (season) => (season ? `Season totals per team — ${season}.` : 'Season totals per team.'),
  balanceTitle: 'Competitive balance',
  mixTitle: 'What this league does',
  mixNote: 'Every recorded action since the import began, by kind.',
  mixAria: (slices) => `Share of league actions by type: ${slices.map((a) => `${a.label}, ${a.count}`).join('; ')}.`,
  recordsTitle: 'All-time records',
  recordsNote: 'Wins and losses across every season on record. ★ marks a championship.',
  recordsAria: (rows) =>
    `All-time records: ${rows.map((r) => `${r.team}, ${r.wins} wins and ${r.losses} losses over ${r.seasons} seasons, ${r.titles} titles`).join('; ')}.`,
  fingerprintsTitle: 'Manager fingerprints',
  fingerprintsNote:
    'Four behavioural measures per manager. Each spoke is scaled to the highest score that measure has ever reached across every league, so a full spoke means “as high as this gets”. Hover for the raw score.',
  fingerprintsAria: (n) => `Behavioural fingerprints for ${n} managers across aggression, activity, trading and risk.`,
  generated: (when) => `Snapshot generated ${when}. The export carries exactly the range shown above.`,
}

const ANALYTICS_ES: AnalyticsCopy = {
  loadFailed: 'No se pudo cargar la analítica de la liga en este momento.',
  timeRange: 'Rango de tiempo',
  range: {
    season: { label: 'Esta temporada', hint: 'Cada semana jugada hasta ahora' },
    last4: { label: 'Últimas 4 semanas', hint: 'Las cuatro semanas más recientes' },
    all: { label: coreUiCopy('All-time', 'es'), hint: 'Cada temporada registrada' },
  },
  exportCsv: 'Exportar CSV',
  headlineNumbers: 'Cifras principales',
  notWired: (what) =>
    `Todavía no hay ${what} para esta liga. Esta sección lee de la plataforma en vivo y se deja en blanco en lugar de rellenarla con un ejemplo: un gráfico vacío aquí se leería como “sin actividad”, que es otra cosa.`,
  whatWeeklyHealth: 'historial semanal de salud',
  whatTransactions: 'historial de transacciones',
  whatManagerActivity: 'actividad por mánager',
  whatScoring: 'totales de puntuación',
  healthBecause:
    'Una línea semanal de participación se puede calcular a partir de la actividad de la liga, pero la actividad de una liga dynasty ocurre sobre todo fuera de temporada: dibujaría una línea casi en cero la mayor parte del año y se leería como una liga que se hunde, no como un agosto normal.',
  daysAgo: (days) => (days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days} días`),
  freshNone: (lookback) => ({
    strong: 'No hay actividad registrada para esta liga.',
    rest: `Cada número de abajo se mide sobre los últimos ${lookback} días de actividad de la liga y no tenemos ninguna, así que describen nuestros datos, no tu liga.`,
  }),
  freshStale: (asOf, ago, inactive, events) => ({
    strong: `La actividad más reciente de la liga es del ${asOf} (${ago}).`,
    rest: `Los mánagers cuentan como inactivos tras ${inactive} días sin una acción, así que las cifras de participación y actividad de abajo reflejan la antigüedad de estos datos, no lo tranquila que está la liga. Tenemos ${events} eventos de esta liga en total.`,
  }),
  freshCurrent: (lookback, asOf, ago) => `Medido sobre los últimos ${lookback} días. Actividad más reciente: ${asOf} (${ago}).`,
  thisSeason: 'Esta temporada',
  lastSeason: 'Temporada pasada',
  target: (t) => `Meta ${t}`,
  targetChip: (t) => `META ${t}`,
  healthAria: (first, last, target) =>
    `Salud de la liga por semana. Esta temporada va de ${first} a ${last}${target !== null ? `, frente a una meta de ${target}` : ''}.`,
  waiverClaims: 'Reclamos',
  trades: coreUiCopy('Trades', 'es'),
  transactionsAria: (weeks) =>
    `Transacciones semanales: ${weeks.map((w) => `${w.week}, ${w.waivers} reclamos y ${w.trades} intercambios`).join('; ')}.`,
  nameList: esNameList,
  calloutLeagueWide: (n, total, prior, now) =>
    `${n} de ${total} mánagers están haciendo menos que antes. El mánager más activo bajó de ${prior} a ${now} acciones por semana.`,
  calloutNamed: (low, threshold, declined, floor, named) => {
    const noun = low === 1 ? 'mánager está' : 'mánagers están'
    const subject = declined === low ? (declined === 1 ? 'Estaba' : 'Cada uno estaba') : `${declined} de ellos estaban`
    return `${low} ${noun} por debajo de ${threshold} acciones por semana. ${subject} por encima de ${floor} antes — ${named}.`
  },
  activityFoot:
    'Acciones por semana: cambios de alineación, reclamos, ofertas de intercambio y mensajes. La flecha compara con el mismo mánager antes en esta temporada, no con la liga.',
  pointsFor: coreUiCopy('Points for', 'es'),
  pointsAgainst: coreUiCopy('Points against', 'es'),
  pointsAria: (teams) =>
    `Puntos a favor y en contra por equipo: ${teams.map((t) => `${t.team}, ${t.pf} a favor y ${t.pa} en contra`).join('; ')}.`,
  pointsFoot:
    'Totales de la temporada. Un equipo alto en las dos barras está jugando un calendario difícil, no uno malo: lee el par, no cada barra por separado.',
  healthTitle: 'Salud de la liga por semana',
  healthNote: 'Esta temporada frente a la anterior, con la meta que fijó esta liga.',
  transactionsTitle: 'Transacciones por semana',
  transactionsNote:
    'Reclamos e intercambios, contados por separado. Semanas del calendario: la mayor parte del movimiento dynasty ocurre fuera de la temporada de la NFL.',
  activityTitle: 'Actividad de los mánagers',
  activityNote: 'Ordenado por acciones por semana, frente al ritmo de cada mánager en la ventana anterior.',
  pointsTitle: 'Puntos a favor y en contra',
  pointsNote: (season) => (season ? `Totales de la temporada por equipo — ${season}.` : 'Totales de la temporada por equipo.'),
  balanceTitle: 'Equilibrio competitivo',
  mixTitle: 'Qué hace esta liga',
  mixNote: 'Cada acción registrada desde que empezó la importación, por tipo.',
  mixAria: (slices) => `Proporción de acciones de la liga por tipo: ${slices.map((a) => `${a.label}, ${a.count}`).join('; ')}.`,
  recordsTitle: 'Récords históricos',
  recordsNote: 'Victorias y derrotas en cada temporada registrada. ★ marca un campeonato.',
  recordsAria: (rows) =>
    `Récords históricos: ${rows
      .map((r) => `${r.team}, ${r.wins} victorias y ${r.losses} derrotas en ${r.seasons} temporadas, ${r.titles} títulos`)
      .join('; ')}.`,
  fingerprintsTitle: 'Huellas de los mánagers',
  fingerprintsNote:
    'Cuatro medidas de comportamiento por mánager. Cada radio se escala a la puntuación más alta que esa medida ha alcanzado en todas las ligas, así que un radio completo significa “lo más alto que llega”. Pasa el cursor para ver la puntuación exacta.',
  fingerprintsAria: (n) => `Huellas de comportamiento de ${n} mánagers en agresividad, actividad, intercambios y riesgo.`,
  generated: (when) => `Instantánea generada el ${when}. La exportación contiene exactamente el rango mostrado arriba.`,
}

export function analyticsCopy(language: string | null | undefined): AnalyticsCopy {
  return isEs(language) ? ANALYTICS_ES : ANALYTICS_EN
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

export interface ReportsCopy {
  status: Record<'queued' | 'generating' | 'ready' | 'failed', string>
  category: Record<'season_recap' | 'engagement' | 'transactions' | 'commissioner_digest', string>
  frequency: Record<'weekly' | 'monthly' | 'manual', string>
  runsByTemplate: string
  runsAria: string
  seriesReady: string
  seriesGenerating: string
  seriesFailed: string
  templatesHeading: string
  historyHeading: string
  emptyTitle: string
  emptyDescription: string
  colReport: string
  colStatus: string
  colFormat: string
  colGenerated: string
  view: string
  generationFailedStatus: (status: number) => string
  couldNotGenerate: string
  requestDidNotComplete: string
  next: (date: string) => string
  generateReport: string
  generatedBy: (when: string, who: string) => string
  relatedEvidence: string
  downloadPdf: string
  downloadCsv: string
  share: string
  unshare: string
  copied: string
  copyLink: string
  retry: string
}

const REPORTS_EN: ReportsCopy = {
  status: { queued: 'Queued', generating: 'Generating', ready: 'Ready', failed: 'Failed' },
  category: {
    season_recap: 'Season Recap',
    engagement: 'Engagement',
    transactions: 'Transactions',
    commissioner_digest: 'Commissioner Digest',
  },
  frequency: { weekly: 'Weekly', monthly: 'Monthly', manual: 'Manual only' },
  runsByTemplate: 'Report runs by template',
  runsAria: 'Report generation runs per template, split into ready, generating and failed',
  seriesReady: 'Ready',
  seriesGenerating: 'Generating',
  seriesFailed: 'Failed',
  templatesHeading: 'Report Templates',
  historyHeading: 'Report History',
  emptyTitle: 'No reports yet.',
  emptyDescription: 'Generate a report above to see it here.',
  colReport: 'Report',
  colStatus: 'Status',
  colFormat: 'Format',
  colGenerated: 'Generated',
  view: 'View',
  generationFailedStatus: (status) => `Generation failed (${status}).`,
  couldNotGenerate: 'The report could not be generated.',
  requestDidNotComplete: 'Generation failed — the request did not complete.',
  next: (date) => ` · Next: ${date}`,
  generateReport: 'Generate Report',
  generatedBy: (when, who) => `Generated ${when} by ${who}`,
  relatedEvidence: 'Related evidence',
  downloadPdf: 'Download PDF',
  downloadCsv: 'Download CSV',
  share: 'Share',
  unshare: 'Unshare',
  copied: 'Copied!',
  copyLink: 'Copy Link',
  retry: 'Retry',
}

const REPORTS_ES: ReportsCopy = {
  status: { queued: 'En cola', generating: 'Generando', ready: 'Listo', failed: 'Falló' },
  category: {
    season_recap: 'Resumen de temporada',
    engagement: 'Participación',
    transactions: 'Transacciones',
    commissioner_digest: 'Resumen del comisionado',
  },
  frequency: { weekly: 'Semanal', monthly: 'Mensual', manual: 'Solo manual' },
  runsByTemplate: 'Ejecuciones de informes por plantilla',
  runsAria: 'Ejecuciones de generación de informes por plantilla, divididas en listos, generando y fallidos',
  seriesReady: 'Listos',
  seriesGenerating: 'Generando',
  seriesFailed: 'Fallidos',
  templatesHeading: 'Plantillas de informes',
  historyHeading: 'Historial de informes',
  emptyTitle: 'Aún no hay informes.',
  emptyDescription: 'Genera un informe arriba para verlo aquí.',
  colReport: 'Informe',
  colStatus: coreUiCopy('Status', 'es'),
  colFormat: 'Formato',
  colGenerated: 'Generado',
  view: 'Ver',
  generationFailedStatus: (status) => `La generación falló (${status}).`,
  couldNotGenerate: 'No se pudo generar el informe.',
  requestDidNotComplete: 'La generación falló: la solicitud no se completó.',
  next: (date) => ` · Próximo: ${date}`,
  generateReport: 'Generar informe',
  generatedBy: (when, who) => `Generado el ${when} por ${who}`,
  relatedEvidence: 'Evidencia relacionada',
  downloadPdf: 'Descargar PDF',
  downloadCsv: 'Descargar CSV',
  share: 'Compartir',
  unshare: 'Dejar de compartir',
  copied: '¡Copiado!',
  copyLink: 'Copiar enlace',
  retry: 'Reintentar',
}

export function reportsCopy(language: string | null | undefined): ReportsCopy {
  return isEs(language) ? REPORTS_ES : REPORTS_EN
}

/** Template names (reportCatalog.ts and the preview fixture name the same four). */
const TEMPLATE_NAME_ES: Record<string, string> = {
  'Weekly Commissioner Digest': 'Resumen semanal del comisionado',
  'Season Recap': 'Resumen de temporada',
  'Manager Engagement Report': 'Informe de participación de mánagers',
  'Trade & Transaction Summary': 'Resumen de intercambios y transacciones',
}

const REPORT_EXACT_ES: Record<string, string> = {
  ...TEMPLATE_NAME_ES,
  // reportCatalog.ts — descriptions
  'Everything a commissioner would check on a Monday, in one file: how current the data is, who has gone quiet, what the league has been doing, and how the season is scoring.':
    'Todo lo que un comisionado revisaría un lunes, en un solo archivo: qué tan actuales son los datos, quién se ha quedado callado, qué ha estado haciendo la liga y cómo se está puntuando la temporada.',
  'The long view — every franchise’s all-time record and titles, and how the league has scored season over season.':
    'La vista larga: el récord histórico y los títulos de cada franquicia, y cómo ha puntuado la liga temporada tras temporada.',
  'Who is playing and how. Activity over the rolling window against the prior one, alongside each manager’s behavioural fingerprint.':
    'Quién está jugando y cómo. La actividad en la ventana móvil frente a la anterior, junto a la huella de comportamiento de cada mánager.',
  'What the league actually did — trades and waivers by week, and the all-time mix of every kind of league action.':
    'Lo que la liga hizo de verdad: intercambios y reclamos por semana, y la mezcla histórica de cada tipo de acción de la liga.',
  // demo.ts — the preview fixture's descriptions and history (its names stay as written)
  'A one-page recap of what happened this week and what needs attention.': 'Un resumen de una página de lo que pasó esta semana y lo que necesita atención.',
  'A comprehensive look back at the season: health trends, standings, and key moments.':
    'Un repaso completo de la temporada: tendencias de salud, clasificación y momentos clave.',
  'Participation, reliability, and engagement trends by manager.': 'Tendencias de participación, fiabilidad y compromiso por mánager.',
  'Every trade and waiver claim this season, with transaction-volume trends.':
    'Cada intercambio y reclamo de esta temporada, con tendencias del volumen de transacciones.',
  'Week 11 recap — engagement up 4 points, 1 automation needs attention, trade deadline in 9 days.':
    'Resumen de la semana 11: participación +4 puntos, 1 automatización necesita atención, fecha límite de intercambios en 9 días.',
  'Mid-season recap through Week 11 — league health at 91, the closest playoff race in 3 seasons.':
    'Resumen de mitad de temporada hasta la semana 11: salud de la liga en 91, la carrera de playoffs más reñida en 3 temporadas.',
  'Transaction summary through Week 11 — currently generating.': 'Resumen de transacciones hasta la semana 11: generándose ahora.',
  'Manager engagement report generation did not complete.': 'La generación del informe de participación de mánagers no se completó.',
  'Timed out while aggregating manager engagement data. No partial file was produced.':
    'Se agotó el tiempo al agregar los datos de participación de mánagers. No se generó ningún archivo parcial.',
  'Week 10 recap — engagement steady, no automations needed attention.':
    'Resumen de la semana 10: participación estable, ninguna automatización necesitó atención.',
  // generatedByLabel — reportStore.ts's default, the fixture's, and the local simulation's
  Scheduled: 'Programado',
  'Automated schedule': 'Programación automática',
  You: 'Tú',
}

const plural = (n: string, one: string, many: string) => (n === '1' ? one : many)

const REPORT_PATTERNS_ES: Array<[RegExp, (...m: string[]) => string]> = [
  // reportCatalog.ts `summarise`
  [
    /^Digest covering (\d+) managers and (\d+) weeks of transactions, (\d+) rows\.$/,
    (m, w, r) => `Resumen de ${m} ${plural(m, 'mánager', 'mánagers')} y ${w} ${plural(w, 'semana', 'semanas')} de transacciones, ${r} ${plural(r, 'fila', 'filas')}.`,
  ],
  [
    /^Recap of (\d+) franchises across (\d+) seasons, (\d+) rows\.$/,
    (f, s, r) => `Resumen de ${f} ${plural(f, 'franquicia', 'franquicias')} en ${s} ${plural(s, 'temporada', 'temporadas')}, ${r} ${plural(r, 'fila', 'filas')}.`,
  ],
  [
    /^Engagement for (\d+) managers and (\d+) fingerprints, (\d+) rows\.$/,
    (m, f, r) => `Participación de ${m} ${plural(m, 'mánager', 'mánagers')} y ${f} ${plural(f, 'huella', 'huellas')}, ${r} ${plural(r, 'fila', 'filas')}.`,
  ],
  [
    /^(\d+) weeks of transactions and (\d+) activity types, (\d+) rows\.$/,
    (w, a, r) => `${w} ${plural(w, 'semana', 'semanas')} de transacciones y ${a} ${plural(a, 'tipo', 'tipos')} de actividad, ${r} ${plural(r, 'fila', 'filas')}.`,
  ],
  // reportStore.ts — a failed run
  [/^(.+) could not be generated\.$/, (name) => `No se pudo generar ${reportTemplateText(name, 'es')}.`],
  // ReportsView's preview simulation
  [/^(.+) generated successfully\.$/, (name) => `${reportTemplateText(name, 'es')} se generó correctamente.`],
  [/^Generating (.+)…$/, (name) => `Generando ${reportTemplateText(name, 'es', true)}…`],
]

/**
 * A report template's name in the reader's language — THE report-name translator. Mission Control's
 * "Newest: <report>" and the notification/search text name the same templates and should call this
 * rather than keep their own table. An unknown name passes through.
 *
 * `caseless` matches the lowercased name the preview simulation writes ("Generating weekly
 * commissioner digest…") and returns it lowercased too.
 */
export function reportTemplateText(name: string, language: string | null | undefined, caseless = false): string {
  if (!isEs(language)) return name
  if (!caseless) return TEMPLATE_NAME_ES[name] ?? name
  const hit = Object.entries(TEMPLATE_NAME_ES).find(([en]) => en.toLowerCase() === name)
  return hit ? hit[1].toLowerCase() : name
}

/**
 * A report row's or template's text — name, description, summary, failure reason, "generated by" —
 * in the reader's language. Manager names and anything unknown pass through.
 */
export function reportText(text: string | null | undefined, language: string | null | undefined): string {
  if (text == null) return ''
  if (!isEs(language)) return text
  const exact = REPORT_EXACT_ES[text]
  if (exact != null) return exact
  for (const [pattern, build] of REPORT_PATTERNS_ES) {
    const m = pattern.exec(text)
    if (m) return build(...m.slice(1))
  }
  return text
}

/* ── Workspace ────────────────────────────────────────────────────────────── */

type TaskStatus = 'open' | 'in_progress' | 'waiting_on_manager' | 'waiting_on_league_vote' | 'completed' | 'archived'

export interface WorkspaceCopy {
  status: Record<TaskStatus, string>
  nextAction: Record<TaskStatus, string>
  /** Severity badge words. ⚠ The English lives in C2's cards/severityStyles.ts; see the note below. */
  severity: Record<'critical' | 'elevated' | 'standard' | 'advisory' | 'positive', string>
  workQueues: string
  queue: Record<string, { label: string; emptyTitle: string; emptyDescription: string }>
  openByAge: string
  openTasks: string
  ageAria: (n: number) => string
  ageBand: (label: string) => string
  due: (date: string) => string
  relatedEvidence: string
}

const AGE_BAND_ES: Record<string, string> = {
  Today: 'Hoy',
  '1–6 days': '1–6 días',
  '1–4 weeks': '1–4 semanas',
  'Over a month': 'Más de un mes',
}

const WORKSPACE_ES: WorkspaceCopy = {
  status: {
    open: 'Abierta',
    in_progress: 'En curso',
    waiting_on_manager: 'Esperando al mánager',
    waiting_on_league_vote: 'Esperando votación de la liga',
    completed: 'Completada',
    archived: 'Archivada',
  },
  nextAction: {
    open: 'Marcar en curso',
    in_progress: 'Marcar completada',
    waiting_on_manager: 'Hacer seguimiento',
    waiting_on_league_vote: 'Hacer seguimiento',
    completed: 'Reabrir',
    archived: 'Reabrir',
  },
  /*
   * ⚠ SEVERITY_LABELS is C2's (components/commissioner-os/cards/severityStyles.ts), and C2's cardsCopy
   * had not landed when this was written. The Spanish is here so the task badges are not English; it
   * should move to (or import from) C2's module once that exists — one translator per string.
   */
  severity: { critical: 'Crítica', elevated: 'Elevada', standard: 'Estándar', advisory: 'Informativa', positive: 'Saludable' },
  workQueues: 'Colas de trabajo',
  queue: {
    all: { label: 'Todas', emptyTitle: 'Aún no hay tareas.', emptyDescription: 'El trabajo operativo aparecerá aquí a medida que surja.' },
    'needs-attention': {
      label: 'Requieren atención',
      emptyTitle: 'Nada requiere tu atención ahora mismo.',
      emptyDescription: 'No hay tareas de prioridad alta sin resolver.',
    },
    'high-priority': {
      label: 'Prioridad alta',
      emptyTitle: 'No hay tareas de prioridad alta.',
      emptyDescription: 'Las tareas críticas y elevadas aparecerán aquí.',
    },
    'due-soon': {
      label: 'Vencen pronto',
      emptyTitle: 'Nada vence pronto.',
      emptyDescription: 'Las tareas que vencen en los próximos 7 días aparecerán aquí.',
    },
    'waiting-on-managers': {
      label: 'Esperando a mánagers',
      emptyTitle: 'No se espera a ningún mánager.',
      emptyDescription: 'Las tareas bloqueadas por la respuesta de un mánager aparecerán aquí.',
    },
    'waiting-on-league-vote': {
      label: 'Esperando votación de la liga',
      emptyTitle: 'Nada espera una votación de la liga.',
      emptyDescription: 'Las tareas bloqueadas por una decisión de toda la liga aparecerán aquí.',
    },
    'in-progress': { label: 'En curso', emptyTitle: 'Nada en curso.', emptyDescription: 'Las tareas que hayas empezado aparecerán aquí.' },
    'automation-candidates': {
      label: 'Candidatas a automatizar',
      emptyTitle: 'No hay candidatas a automatizar.',
      emptyDescription: 'Las tareas recurrentes y de poco riesgo que vale la pena automatizar aparecerán aquí.',
    },
    'recently-completed': {
      label: 'Completadas recientemente',
      emptyTitle: 'Nada completado recientemente.',
      emptyDescription: 'Las tareas que termines aparecerán aquí.',
    },
    'recently-archived': {
      label: 'Archivadas recientemente',
      emptyTitle: 'Nada archivado recientemente.',
      emptyDescription: 'Las tareas que archives aparecerán aquí.',
    },
  },
  openByAge: 'Tareas abiertas por antigüedad',
  openTasks: 'Tareas abiertas',
  ageAria: (n) => `${n} ${n === 1 ? 'tarea abierta agrupada' : 'tareas abiertas agrupadas'} según el tiempo que llevan abiertas`,
  ageBand: (label) => AGE_BAND_ES[label] ?? label,
  due: (date) => `Vence el ${date}`,
  relatedEvidence: 'Evidencia relacionada',
}

/**
 * The workspace's own words. In English the status, action, severity and queue text is the caller's
 * existing constant (`TASK_STATUS_LABELS`, `WORKSPACE_QUEUES`…), so English reads byte-for-byte as it
 * did; `null` here means "use your English constant".
 */
export function workspaceCopy(language: string | null | undefined): WorkspaceCopy | null {
  return isEs(language) ? WORKSPACE_ES : null
}

const daysEs = (n: string) => (n === '1' ? '1 día' : `${n} días`)

/** The dated events `lib/core-app/leagueCalendar.ts` names (only dated ones can raise a deadline task). */
const DEADLINE_LABEL_ES: Record<string, string> = {
  Draft: 'Draft',
  'Next waiver processing': 'Próximo procesamiento de reclamos',
  'Trade deadline': coreUiCopy('Trade deadline', 'es'),
  'Keeper deadline': 'Fecha límite de keepers',
}
/** taskSources.ts joins names "A, B and C"; only that last joiner is the app's word. */
const yHas = (names: string) => names.replace(/ and (?=[^,]*$)/, ' y ')

const TASK_EXACT_ES: Record<string, string> = {
  // taskSources.ts
  'League data has stopped arriving': 'Los datos de la liga dejaron de llegar',
  'No manager has acted in the last two weeks': 'Ningún mánager ha actuado en las últimas dos semanas',
  'This league is connected but has never sent any data': 'Esta liga está conectada pero nunca ha enviado datos',
  'One team has no manager': 'Un equipo no tiene mánager',
  'The league is linked to its platform, but no trade, waiver claim, roster move or draft pick has ever arrived for it. Until some does, every intelligence surface here has nothing to read — League Health, Manager Intelligence and the analytics panels stay empty no matter how active the league actually is. Re-running the import is the fix, and it is the whole fix.':
    `La liga está vinculada a su plataforma, pero nunca ha llegado ningún intercambio, reclamo, movimiento de plantilla ni selección del draft. Hasta que llegue alguno, ninguna sección de inteligencia de aquí tiene nada que leer: ${commissionerSectionName('League Health', 'es')}, ${commissionerSectionName('Manager Intelligence', 'es')} y los paneles de analítica siguen vacíos por activa que sea la liga. Volver a ejecutar la importación es la solución, y es toda la solución.`,
  // operationalTasks.ts
  'Roster evidence requires refresh': 'Los datos de plantilla necesitan actualizarse',
  'Roster evidence is stale or unreadable. Existing lineup findings remain open until a fresh roster can be read.':
    'Los datos de plantilla están desactualizados o no se pueden leer. Los hallazgos de alineación existentes siguen abiertos hasta que se pueda leer una plantilla actual.',
  'Starting slots need review': 'Hay puestos titulares que revisar',
  'Accepted trade awaits commissioner review': 'Un intercambio aceptado espera la revisión del comisionado',
  'Both managers accepted this trade. Review the recorded proposal before approving or rejecting it.':
    'Ambos mánagers aceptaron este intercambio. Revisa la propuesta registrada antes de aprobarlo o rechazarlo.',
  'Recorded scoring recalculation failed': 'Falló un recálculo de puntuación registrado',
  'Recorded league deadline approaches': 'Se acerca una fecha límite registrada de la liga',
}

const TASK_PATTERNS_ES: Array<[RegExp, (...m: string[]) => string]> = [
  // taskSources.ts — detectStaleImport
  [
    /^The newest imported event for this league is (\d+) days? old\. Every rolling-window figure on League Analytics — active managers, trade activity, transactions per week — is computed over a (\d+)-day and 90-day window, so they now read as though the league went quiet\. Re-run the import to bring the feed current; the figures correct themselves once it does\.$/,
    (age, inactive) =>
      `El evento importado más reciente de esta liga tiene ${daysEs(age)}. Cada cifra de ventana móvil de ${commissionerSectionName('League Analytics', 'es')} (mánagers activos, actividad de intercambios, transacciones por semana) se calcula sobre una ventana de ${inactive} días y otra de 90 días, así que ahora se leen como si la liga se hubiera quedado quieta. Vuelve a ejecutar la importación para poner al día los datos; las cifras se corrigen solas en cuanto lo hagas.`,
  ],
  // taskSources.ts — detectInactiveManagers
  [/^(\d+) managers? inactive for (\d+) days?$/, (n, d) => `${n} ${n === '1' ? 'mánager inactivo' : 'mánagers inactivos'} durante ${daysEs(d)}`],
  [
    /^None of the (\d+) managers has made a roster move, waiver claim or trade in the last (\d+) days?, and the league's data is current — so this is the league itself being quiet rather than a gap in what we receive\.$/,
    (n, d) =>
      `Ninguno de los ${n} mánagers ha hecho un movimiento de plantilla, reclamo o intercambio en los últimos ${daysEs(d)}, y los datos de la liga están al día: es la propia liga la que está quieta, no un hueco en lo que recibimos.`,
  ],
  [
    /^(.+) (has|have) made no roster move, waiver claim or trade in the last (\d+) days?\. The league's data is current, so this is real inactivity rather than a stale feed\.$/,
    (named, verb, d) =>
      `${yHas(named)} no ${verb === 'has' ? 'ha' : 'han'} hecho ningún movimiento de plantilla, reclamo ni intercambio en los últimos ${daysEs(d)}. Los datos de la liga están al día, así que es inactividad real y no un feed desactualizado.`,
  ],
  // taskSources.ts — detectOrphanTeams
  [/^(\d+) teams have no manager$/, (n) => `${n} equipos no tienen mánager`],
  [
    /^(\d+) of the (\d+) teams in this league are unclaimed\. Standings, scoring and every per-manager reading here describe only the seats that are filled, so treat them as partial until the roster is settled\.$/,
    (n, t) =>
      `${n} de los ${t} equipos de esta liga no tienen dueño. La clasificación, la puntuación y cada lectura por mánager de aquí describen solo los puestos ocupados, así que tómalas como parciales hasta que se complete la liga.`,
  ],
  [
    /^(\d+) teams? in this league (?:has|have) no manager attached\. An unclaimed team does not set a lineup or make a move, so it drags every league-wide participation figure down without anybody having gone quiet\.$/,
    (n) =>
      `${n} ${n === '1' ? 'equipo de esta liga no tiene' : 'equipos de esta liga no tienen'} mánager asignado. Un equipo sin dueño no fija alineación ni hace movimientos, así que baja cada cifra de participación de la liga sin que nadie se haya quedado quieto.`,
  ],
  // operationalTasks.ts — the roster name and the period are data and stay as written
  [
    /^(.+): (\d+) of (\d+) required starting slots are filled\. Review the lineup and ask the manager to submit eligible starters\.$/,
    (team, c, r) =>
      `${team}: ${c} de ${r} puestos titulares obligatorios están cubiertos. Revisa la alineación y pide al mánager que envíe titulares elegibles.`,
  ],
  [
    /^Period (.+): a recorded scoring recalculation failed\. Review the scoring rules and retry processing\.$/,
    (p) => `Periodo ${p}: falló un recálculo de puntuación registrado. Revisa las reglas de puntuación y vuelve a procesar.`,
  ],
  [
    /^(.+): this deadline is published in league settings\. Review requirements before the recorded time\.$/,
    (label) =>
      `${DEADLINE_LABEL_ES[label] ?? coreUiCopy(label, 'es')}: esta fecha límite está publicada en los ajustes de la liga. Revisa los requisitos antes de la hora registrada.`,
  ],
]

/**
 * A stored workspace task's title or description, in the reader's language. The scanner writes
 * these into Postgres in English at scan time; manager and team names inside them stay as written.
 */
export function taskText(text: string | null | undefined, language: string | null | undefined): string {
  if (text == null) return ''
  if (!isEs(language)) return text
  const exact = TASK_EXACT_ES[text]
  if (exact != null) return exact
  for (const [pattern, build] of TASK_PATTERNS_ES) {
    const m = pattern.exec(text)
    if (m) return build(...m.slice(1))
  }
  return text
}

import type { CommissionerModuleId } from '@/lib/commissioner-ui/navigation/moduleNav'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { commissionerOsText } from '@/lib/core-app/commissionerOsText'

/**
 * Commissioner OS's shell in the reader's language (2026-10-06): the sidebar, the header, the
 * breadcrumbs, the league picker, the data-mode picker, the preview banner, the access notice, the
 * AF Commissioner lock and Mission Control.
 *
 * ⚠ THE SECTION NAMES BELOW ARE THE ONES EVERY COMMISSIONER OS PAGE USES. The sidebar names each
 * section, and each section's own page heading must read the same word — so the other Commissioner
 * OS copy modules (cards, analytics, tools) import `commissionerSectionName` / `moduleLabelText`
 * rather than translating "League Health" or "Reports" a second time.
 *
 * Server-built sentences are translated here at render, WHOLE: the Mission Control loader
 * (lib/commissioner-ui/decision-os-client/live.ts) and the module summaries Mission Control
 * previews (automations, analytics, reports, notifications) write English, and their English stays
 * byte for byte. Each pattern below is held to its loader's source by
 * __tests__/cos-shell-spanish.test.tsx, so a reworded sentence fails there instead of quietly going
 * English. Anything not recognised passes through unchanged — names (leagues, managers, automations,
 * report templates) are never touched, and neither is demo-fixture prose.
 *
 * PURE and client-safe.
 */

export type ShellLang = 'en' | 'es'

const isEs = (language: string | null | undefined) => language === 'es'

/** Spanish plural for a counted noun: `n(3, 'informe', 'informes')` → "3 informes". */
const n = (count: string | number, one: string, many: string) => `${count} ${String(count) === '1' ? one : many}`

// ── Section names ─────────────────────────────────────────────────────────────────────────────────

/**
 * Every Commissioner OS section, by module id — the sidebar's labels and each page's heading.
 * "Commissioner OS" itself is the product name and stays, as /core's copy already prints it.
 */
export const COMMISSIONER_SECTION_NAMES_ES: Record<CommissionerModuleId, string> = {
  'mission-control': 'Centro de control',
  'league-health': 'Salud de la liga',
  recommendations: 'Recomendaciones',
  managers: 'Información de mánagers',
  workspace: 'Espacio de trabajo',
  automations: 'Automatizaciones',
  analytics: 'Analítica de la liga',
  reports: 'Informes',
  settings: coreUiCopy('Settings', 'es'),
  activity: 'Flujo de actividad',
  help: 'Ayuda y centro de conocimiento',
}

/** The sidebar's English labels (lib/commissioner-ui/navigation/moduleNav.ts), for lookups by text. */
const SECTION_BY_ENGLISH: Record<string, CommissionerModuleId> = {
  'Mission Control': 'mission-control',
  'League Health': 'league-health',
  Recommendations: 'recommendations',
  'Manager Intelligence': 'managers',
  Workspace: 'workspace',
  Automations: 'automations',
  'League Analytics': 'analytics',
  Reports: 'reports',
  Settings: 'settings',
  'Activity Stream': 'activity',
  'Help & Knowledge Center': 'help',
}

/** A module's label in the reader's language — the sidebar, breadcrumbs, and "View in …" source labels. */
export function moduleLabelText(id: CommissionerModuleId, english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  return COMMISSIONER_SECTION_NAMES_ES[id] ?? english
}

/** A section's name by its English sidebar label ("League Health" → "Salud de la liga"). */
export function commissionerSectionName(english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  const id = SECTION_BY_ENGLISH[english]
  return id ? COMMISSIONER_SECTION_NAMES_ES[id] : english
}

/** "Commissioner networks" — the sidebar's link to /commissioner-os/networks. */
export const NETWORKS_LINK_ES = 'Redes de comisionados'

// ── The shell's own words ─────────────────────────────────────────────────────────────────────────

const SHELL_ES: Record<string, string> = {
  // CommissionerSidebar
  'Close navigation': 'Cerrar navegación',
  'Commissioner networks': NETWORKS_LINK_ES,
  Off: 'Inactivo',
  // CommissionerHeader
  'Open navigation': 'Abrir navegación',
  'Expand navigation': 'Expandir navegación',
  'Collapse navigation': 'Contraer navegación',
  'Search Commissioner OS': 'Buscar en Commissioner OS',
  Search: 'Buscar',
  'Profile menu': 'Menú de perfil',
  // CommissionerBreadcrumbs
  Breadcrumb: 'Ruta de navegación',
  // LeagueSelector
  'No leagues': 'Sin ligas',
  'Select league': 'Elegir liga',
  // DataModeIndicator
  'Data mode': 'Modo de datos',
  'Stub (developer fixtures)': 'Stub (datos de prueba para desarrollo)',
  'Demo (curated data)': 'Demo (datos seleccionados)',
  'Live (real intelligence)': 'En vivo (inteligencia real)',
  // ErrorState
  "Couldn't load this right now.": 'No se pudo cargar en este momento.',
  Retry: 'Reintentar',
  // CommissionerAccessNotice
  'Commissioner OS is for league commissioners': 'Commissioner OS es para comisionados de liga',
  'This workspace manages a league you run — its health, its managers, and the decisions that keep it going. Your account does not currently commission a league, so there is nothing here for it to manage.':
    'Este espacio gestiona una liga que diriges: su salud, sus mánagers y las decisiones que la mantienen en marcha. Tu cuenta no es comisionada de ninguna liga ahora mismo, así que aquí no hay nada que gestionar.',
  'If you have just imported or created a league and expected to see it, it may still be syncing.':
    'Si acabas de importar o crear una liga y esperabas verla, puede que aún se esté sincronizando.',
  'Back to my leagues': 'Volver a mis ligas',
}

/**
 * One of the shell's fixed strings. Words /core already translates come from `coreUiCopy`
 * ("Notifications", "Commissioner Hub", "Import a league"), so the two products say them the same.
 */
export function shellText(english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  return SHELL_ES[english] ?? coreUiCopy(english, 'es')
}

/** The bell's label: "Notifications, 3 unread". */
export function notificationsAriaText(unread: number, language: string | null | undefined): string {
  if (!isEs(language)) return unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'
  return unread > 0 ? `${coreUiCopy('Notifications', 'es')}, ${unread} sin leer` : coreUiCopy('Notifications', 'es')
}

/** PreviewDataBanner's sentence; `modeLabel` is the mode's label already in the reader's language. */
export function previewBannerText(modeLabel: string, language: string | null | undefined): string {
  const lowered = modeLabel.toLowerCase()
  return isEs(language)
    ? `Datos de vista previa: este panel aún no está conectado a la inteligencia real de la liga. Todos los valores aquí son ${lowered}.`
    : `Preview data — this dashboard is not yet connected to live league intelligence. Every value here is ${lowered}.`
}

/**
 * The AF Commissioner lock's subject, per Commissioner OS page (`what=` in app/commissioner-os/*). The
 * lock's own words are `coreDepthLockCopy`'s; this only names the page. An unknown subject stays
 * English — the test reads every `what=` in those pages, so a new one fails there.
 */
const LOCK_SUBJECT_ES: Record<string, string> = {
  'Mission Control': 'Centro de control',
  Recommendations: 'Recomendaciones',
  'League health trends': 'Tendencias de salud de la liga',
  'Manager intelligence': 'Información de mánagers',
  'League analytics': 'Analítica de la liga',
  Reports: 'Informes',
  'The activity stream': 'Flujo de actividad',
  'The automation center': 'Centro de automatizaciones',
}

export const COS_LOCK_SUBJECT_KEYS: readonly string[] = Object.keys(LOCK_SUBJECT_ES)

export function cosLockSubjectText(english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  return LOCK_SUBJECT_ES[english] ?? english
}

// ── Mission Control ───────────────────────────────────────────────────────────────────────────────

const MISSION_CONTROL_ES: Record<string, string> = {
  'Nothing needs your attention right now.': 'Nada necesita tu atención ahora mismo.',
  'Your league is in good shape.': 'Tu liga está en buena forma.',
  'Not available yet — there is no reading for this league.': 'Aún no disponible: no hay lectura para esta liga.',
  'Open Recommendations': 'Recomendaciones abiertas',
  'Active Risks': 'Riesgos activos',
  'Engagement Score': 'Puntuación de participación',
  'Next Deadline': 'Próxima fecha límite',
  'Send League Digest': 'Enviar resumen de la liga',
  'Review Pending Trades': 'Revisar intercambios pendientes',
  'Invite Co-Commissioner': 'Invitar cocomisionado',
  'Activity over time': 'Actividad a lo largo del tiempo',
  'No activity history has been captured for this league yet. A capture runs daily; the first two give this chart a line.':
    'Aún no se ha capturado historial de actividad de esta liga. Se hace una captura al día; las dos primeras dan una línea a este gráfico.',
  'Only one capture so far — one more gives this chart a line.':
    'Solo hay una captura por ahora: una más da una línea a este gráfico.',
  'Today’s Priorities': 'Prioridades de hoy',
  'Recent Activity': 'Actividad reciente',
  'No recent activity to show.': 'No hay actividad reciente para mostrar.',
  'No open tasks in this preview.': 'No hay tareas abiertas en esta vista previa.',
  'Automation Status': 'Estado de las automatizaciones',
  'System Status': 'Estado del sistema',
  'Preview mode — not connected to live data': 'Modo de vista previa: sin conexión a datos en vivo',
  // page.tsx's fallback for a summary that could not be read
  Unavailable: 'No disponible',
  // the Mission Control loader's manager callout when nothing is flagged
  'Active and engaged': 'Activo y participativo',
}

/** One of Mission Control's own fixed strings. */
export function missionControlText(english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  return MISSION_CONTROL_ES[english] ?? english
}

/** The activity chart's window phrases. `days` is whatever the code already states — never a new one. */
export const activityChartText = {
  title: (days: number, language: string | null | undefined) =>
    isEs(language)
      ? `Actividad a lo largo del tiempo: eventos de los últimos ${days} días`
      : `Activity over time — events in the trailing ${days} days`,
  ariaLabel: (days: number, captures: number, language: string | null | undefined) =>
    isEs(language)
      ? `Eventos registrados en los últimos ${days} días, en ${n(captures, 'captura diaria', 'capturas diarias')}`
      : `Events recorded in the trailing ${days} days, across ${captures} daily captures`,
  seriesName: (days: number, language: string | null | undefined) =>
    isEs(language) ? `Eventos en los últimos ${days} días` : `Events in the trailing ${days} days`,
  /** The load-bearing explanation under the chart (see MissionControlView). */
  note: (days: number, language: string | null | undefined) =>
    isEs(language)
      ? `Cada punto cuenta todos los eventos de los últimos ${days} días a esa fecha, no la actividad de ese día. Un descenso constante fuera de temporada es normal: los eventos antiguos salen de la ventana más rápido de lo que llegan los nuevos.`
      : null,
}

/** "3 highlights this week" — the English keeps its own wording, "1 highlights" included. */
export function highlightsThisWeekText(count: number, language: string | null | undefined): string {
  return isEs(language) ? `${n(count, 'destacado', 'destacados')} esta semana` : `${count} highlights this week`
}

/**
 * The Next Deadline KPI (`formatDeadlineLabel` in the Mission Control loader, and the stub and demo
 * fixtures that share its shape). Spanish puts the event first and the time after a colon, so no verb
 * has to agree with it.
 */
const DEADLINE_WHAT_ES: Record<string, string> = {
  'Trade deadline': 'Fecha límite de intercambios',
  'Playoffs start': 'Inicio de los playoffs',
  Draft: 'Draft',
  'Next waiver processing': 'Próximo procesamiento de agentes libres',
}
const WHAT = '(Trade deadline|Playoffs start|Draft|Next waiver processing)'

const DEADLINE_RULES: [RegExp, (what: string, value: string) => string][] = [
  [new RegExp(`^${WHAT} is this week$`), (w) => `${w}: esta semana`],
  [new RegExp(`^${WHAT} in (\\d+) weeks?$`), (w, v) => `${w}: en ${n(v, 'semana', 'semanas')}`],
  [new RegExp(`^${WHAT} in (\\d+) days?$`), (w, v) => `${w}: en ${n(v, 'día', 'días')}`],
  [new RegExp(`^${WHAT} within the hour$`), (w) => `${w}: en menos de una hora`],
  [new RegExp(`^${WHAT} in (\\d+) hours?$`), (w, v) => `${w}: en ${n(v, 'hora', 'horas')}`],
  [new RegExp(`^${WHAT} on (\\d{4}-\\d{2}-\\d{2})$`), (w, v) => `${w}: el ${v}`],
]

export function deadlineLabelText(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  if (label === 'No upcoming deadlines configured') return 'No hay fechas límite próximas configuradas'
  if (label === 'Unavailable') return MISSION_CONTROL_ES.Unavailable
  for (const [pattern, build] of DEADLINE_RULES) {
    const m = pattern.exec(label)
    if (m) return build(DEADLINE_WHAT_ES[m[1]], m[2])
  }
  return label
}

/**
 * League Health's driver: Decision OS's narrative (through `commissionerOsText`, which knows the
 * health engine's sentences) plus the data-age caveat the loader appends (`withDataAgeCaveat`).
 */
export function healthDriverText(driver: string, language: string | null | undefined): string {
  if (!isEs(language)) return driver
  if (driver === 'Unavailable') return MISSION_CONTROL_ES.Unavailable
  let claim = driver
  let caveat = ''
  const ever = ' (no league activity has ever been recorded)'
  const recent = / \(no league activity recorded in (\d+) days\)$/.exec(driver)
  if (driver.endsWith(ever)) {
    claim = driver.slice(0, -ever.length)
    caveat = ' (nunca se ha registrado actividad en la liga)'
  } else if (recent) {
    claim = driver.slice(0, recent.index)
    caveat = ` (sin actividad registrada en la liga en ${n(recent[1], 'día', 'días')})`
  }
  return `${commissionerOsText(claim, 'es')}${caveat}`
}

/** A manager highlight's callout: the loader's own fallback, else the health engine's sentence. */
export function calloutText(callout: string, language: string | null | undefined): string {
  if (!isEs(language)) return callout
  return MISSION_CONTROL_ES[callout] ?? commissionerOsText(callout, 'es')
}

/**
 * The module summaries Mission Control previews, each written by that module's own loader
 * (lib/commissioner-ui/{automations,analytics,reports,notifications}/decision-os-client). Those
 * loaders are shared with the module pages, so they are not edited here; their sentences are
 * translated whole at render. Automation and report-template names inside them stay as written.
 */
const HEADLINE_RULES: [RegExp, (...g: string[]) => string][] = [
  // analytics (live) — the caveat is the same one the health driver carries
  [
    /^League engagement score (\d+) — (\d+) of (\d+) managers active(?: \(no league activity recorded in (\d+) days\))?$/,
    (score, active, total, days) =>
      `Puntuación de participación de la liga ${score}: ${active} de ${n(total, 'mánager activo', 'mánagers activos')}` +
      (days ? ` (sin actividad registrada en la liga en ${n(days, 'día', 'días')})` : ''),
  ],
  // analytics (stub)
  [/^(\d+) KPIs? tracked$/, (k) => `${n(k, 'KPI monitorizado', 'KPI monitorizados')}`],
  // automations (live)
  [/^(\d+) automations? running normally$/, (k) => `${n(k, 'automatización funciona', 'automatizaciones funcionan')} con normalidad`],
  [/^(.+) and (\d+) others? need attention$/s, (name, k) => `${name} y ${k} más necesitan atención`],
  [/^(.+) needs attention$/s, (name) => `${name}: necesita atención`],
  // automations (stub, demo)
  [
    /^(\d+) of (\d+) automations active(?: — (\d+) needs? attention)?$/,
    (a, t, k) => `${a} de ${t} automatizaciones activas${k ? ` · ${k} ${k === '1' ? 'necesita' : 'necesitan'} atención` : ''}`,
  ],
  // reports (live)
  [/^(\d+) scheduled reports?, none generated yet$/, (k) => `${n(k, 'informe programado', 'informes programados')}; aún no se ha generado ninguno`],
  [/^Newest: (.+) — (\d+) reports? ready$/s, (name, k) => `Más reciente: ${name} · ${n(k, 'informe listo', 'informes listos')}`],
  // reports (stub, demo)
  [/^(\d+) reports? ready(?: — (\d+) scheduled)?$/, (k, s) => `${n(k, 'informe listo', 'informes listos')}${s ? ` · ${n(s, 'programado', 'programados')}` : ''}`],
  // notifications
  [/^(\d+) unread notifications?$/, (k) => `${n(k, 'notificación sin leer', 'notificaciones sin leer')}`],
]

export function summaryHeadlineText(headline: string, language: string | null | undefined): string {
  if (!isEs(language)) return headline
  if (headline === 'Unavailable') return MISSION_CONTROL_ES.Unavailable
  if (headline === 'No unread notifications') return 'No hay notificaciones sin leer'
  for (const [pattern, build] of HEADLINE_RULES) {
    const m = pattern.exec(headline)
    if (m) return build(...m.slice(1))
  }
  return headline
}

/**
 * `allClearCopy` (lib/commissioner-ui/allClear.ts) — shared with League Health, so its sentences are
 * translated whole here. The caller's own title and reassurance pass in through `own`, already Spanish.
 */
const ALL_CLEAR_LIST_ES: Record<string, string> = { recommendations: 'las recomendaciones', risks: 'los riesgos' }

export function allClearText(text: string, language: string | null | undefined, own: Record<string, string> = {}): string {
  if (!isEs(language)) return text
  if (own[text]) return own[text]
  if (text === 'That isn’t the same as having none. Try again shortly.') {
    return 'Eso no significa que no haya nada. Vuelve a intentarlo en un momento.'
  }
  if (text === 'League health isn’t available yet, so this isn’t a verdict on the league.') {
    return 'La salud de la liga aún no está disponible, así que esto no es un veredicto sobre la liga.'
  }
  const level = /^League health is (critical|elevated), so an empty list isn’t the whole picture\.$/.exec(text)
  if (level) {
    return `La salud de la liga está en nivel ${level[1] === 'critical' ? 'crítico' : 'elevado'}, así que una lista vacía no lo cuenta todo.`
  }
  const load = /^Couldn’t load (.+)\.$/.exec(text)
  if (load) return `No se pudieron cargar ${ALL_CLEAR_LIST_ES[load[1]] ?? load[1]}.`
  return text
}

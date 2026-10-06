import type { CommissionerNotificationSeverity } from '@/lib/commissioner-ui/contracts/notifications'
import type { CommissionerSearchResultContract } from '@/lib/commissioner-ui/contracts/searchResults'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { kickoffText } from '@/lib/core-app/kickoffText'
import { ageText } from '@/lib/core-app/shellCopy'
import { commissionerSectionName, leagueEventNameText, shellText } from '@/lib/commissioner-os/i18n/shellCopy'
import { cosLoaderText, severityLabelText } from '@/lib/commissioner-os/i18n/cardsCopy'
import { cosErrorText, reportTemplateText, taskText } from '@/lib/commissioner-os/i18n/analyticsCopy'

/**
 * Commissioner OS's tools in the reader's language (2026-10-06): Automations, Notifications, the
 * Activity Stream, Search, Help and Settings — `components/commissioner-os/{automations,
 * notifications,activity,search,help,settings}` and their pages.
 *
 * Three kinds of words, kept apart:
 *
 * - `toolsText` — the screens' OWN words (headings, buttons, empty states, aria labels), falling back
 *   to `coreUiCopy` for the words /core already says ("All", "Bench", "Trade deadline"), so the two
 *   products say them the same.
 * - LOADER output translated at render, WHOLE: the live clients in
 *   `lib/commissioner-ui/{automations,notifications,activity,search}/decision-os-client/live.ts`, the
 *   help catalog (`lib/commissioner-ui/help/helpCatalog.ts`) and the settings read
 *   (`lib/commissioner-settings/leagueSettingsReads.ts`). Those loaders are shared — notifications,
 *   activity and automations feed Mission Control's summaries too — so none is edited; each fixed
 *   English string is a key here, held to its source by `__tests__/cos-tools-spanish.test.tsx`, so a
 *   reworded sentence fails there instead of quietly going English.
 * - Names are not translated: league, manager and team names, a run's own ledger message, a
 *   league's titleised platform values ("Dynasty Superflex", "Nfl"). AUTOMATION and REPORT-TEMPLATE
 *   names are the exception: they are our own catalogs' product copy (`CATALOG_METADATA` in the live
 *   automations client, `reportCatalog.ts`), not data — automations here, templates through
 *   analyticsCopy's `reportTemplateText`.
 *
 * ONE TRANSLATOR PER STRING (2026-10-06): section names are the shell's (`moduleLabelText` /
 * `commissionerSectionName`, shellCopy), severity badges the cards' (`severityLabelText`, cardsCopy),
 * report-template names and task titles analyticsCopy's. This module imports them; it keeps no copy.
 *
 * ⚠ DEMO-FIXTURE PROSE IS NOT TRANSLATED. The demo clients' seeded descriptions, run summaries and
 * names ("Trade-deadline reminder broadcast", "Reminder sent to all 12 managers") are a scenario, like
 * provider text; only the app's own words around them follow the language.
 *
 * Built at render from `useOptionalLanguage`, which starts at English on server and client alike, so
 * hydration is unaffected. English in, English out, byte for byte. PURE and client-safe.
 */

const isEs = (language: string | null | undefined) => language === 'es'

/** "1 ejecución" / "3 ejecuciones". */
const count = (n: number | string, one: string, many: string) => `${n} ${String(n) === '1' ? one : many}`

// ── Severity vocabularies ─────────────────────────────────────────────────────────────────────────
//
// The five-tier CONDITION scale (`SEVERITY_LABELS` — an automation's health badge here) is the
// cards' `severityLabelText` (cardsCopy), imported where it is drawn; this module keeps no copy.

/**
 * `EVENT_SEVERITY_LABELS` (components/commissioner-os/cards/severityStyles.ts) — the separate EVENT
 * scale Notifications and the Activity Stream badge with. "Advertencia", not "Aviso": "Aviso" is
 * already the condition scale's `advisory`, and the glossary insists the two scales are different
 * things. "Crítico" IS the same word on both scales, so it is read from the condition scale's table.
 */
const EVENT_SEVERITY_ES: Record<CommissionerNotificationSeverity, string> = {
  informational: 'Información',
  success: 'Éxito',
  warning: 'Advertencia',
  critical: severityLabelText('critical', 'Critical', 'es'),
}

export function eventSeverityText(severity: CommissionerNotificationSeverity, english: string, language: string | null | undefined): string {
  return isEs(language) ? (EVENT_SEVERITY_ES[severity] ?? english) : english
}

// ── The screens' own words ────────────────────────────────────────────────────────────────────────

const UI_ES: Record<string, string> = {
  // automationLabels.ts — status (an automatización, so feminine), category, result
  Enabled: 'Activada',
  Disabled: 'Desactivada',
  'Waiver Management': 'Gestión de agentes libres',
  Communications: 'Comunicaciones',
  'Compliance Reminders': 'Recordatorios de cumplimiento',
  Scheduling: 'Programación',
  Reporting: 'Informes',
  Success: 'Éxito',
  Failure: 'Fallo',
  Skipped: 'Omitida',
  // AutomationCenterView
  'Run outcomes': 'Resultados de las ejecuciones',
  'Automation runs per job, split into succeeded, skipped and failed':
    'Ejecuciones de cada automatización, divididas en exitosas, omitidas y fallidas',
  'A skip is the idempotency guard finding the window’s work already done — not a failure. It is shown separately because a job that skips constantly is telling you something different from one that fails.':
    'Una ejecución omitida es la protección de idempotencia encontrando ya hecho el trabajo de esa ventana; no es un fallo. Se muestra aparte porque una tarea que se omite constantemente dice algo distinto de una que falla.',
  'Days since last run': 'Días desde la última ejecución',
  Days: 'Días',
  'Days since each automation last ran, most stale first':
    'Días desde la última ejecución de cada automatización, las más atrasadas primero',
  'Judged on success rate alone a job that never runs looks perfect. This is the axis that shows it.':
    'Si solo se mira la tasa de éxito, una tarea que nunca se ejecuta parece perfecta. Este es el eje que lo muestra.',
  'No automations yet.': 'Aún no hay automatizaciones.',
  'Automations you create will appear here.': 'Las automatizaciones que crees aparecerán aquí.',
  // AutomationCatalogCard / AutomationHistoryDialog
  'View History': 'Ver historial',
  'No executions yet.': 'Aún no hay ejecuciones.',
  'This automation hasn’t run yet.': 'Esta automatización aún no se ha ejecutado.',
  When: 'Cuándo',
  Result: 'Resultado',
  Duration: 'Duración',
  Summary: 'Resumen',

  // notifications/page.tsx and NotificationPanel / NotificationRow
  'Notification Center is a platform service, not a module — the inbox for what needs a commissioner’s attention across League Health, Recommendations, Automations, Reports, and more, reached from the header’s bell icon anywhere in Commissioner OS.':
    'El Centro de notificaciones es un servicio de la plataforma, no un módulo: la bandeja de lo que necesita la atención de un comisionado en Salud de la liga, Recomendaciones, Automatizaciones, Informes y más, a la que llegas desde la campana de la cabecera en cualquier parte de Commissioner OS.',
  'Open Notifications': 'Abrir notificaciones',
  'Notifications from League Health, Recommendations, Automations, Reports, and other Commissioner OS modules.':
    'Notificaciones de Salud de la liga, Recomendaciones, Automatizaciones, Informes y otros módulos de Commissioner OS.',
  Unread: 'Sin leer',
  'Mark all as read': 'Marcar todo como leído',
  'Notification preferences': 'Preferencias de notificaciones',
  'Muted sources': 'Fuentes silenciadas',
  Mute: 'Silenciar',
  Unmute: 'Reactivar',
  'You’re all caught up.': 'Estás al día.',
  'No notifications yet.': 'Aún no hay notificaciones.',
  'No unread notifications right now.': 'No hay notificaciones sin leer ahora mismo.',
  'Notifications from across Commissioner OS will show up here.':
    'Aquí aparecerán las notificaciones de todo Commissioner OS.',
  'Mark as read': 'Marcar como leída',

  // ActivityStreamView / ActivityEventRow
  'Activity source': 'Origen de la actividad',
  'No activity yet.': 'Aún no hay actividad.',
  'Meaningful events from across Commissioner OS will show up here.':
    'Aquí aparecerán los eventos importantes de todo Commissioner OS.',
  'Initiated by a person': 'Iniciado por una persona',
  'Initiated automatically': 'Iniciado automáticamente',
  Human: 'Persona',
  System: 'Sistema',

  // search/page.tsx and CommissionerSearchPalette — the header's search words are the shell's
  Search: shellText('Search', 'es'),
  'Global Search & Command Palette is a platform service, not a module — find anything across recommendations, managers, tasks, reports, and automations from the header search button or ⌘K/Ctrl+K, anywhere in Commissioner OS.':
    'La búsqueda global y paleta de comandos es un servicio de la plataforma, no un módulo: encuentra lo que sea entre recomendaciones, mánagers, tareas, informes y automatizaciones con el botón de búsqueda de la cabecera o con ⌘K/Ctrl+K, en cualquier parte de Commissioner OS.',
  'Open Search': 'Abrir búsqueda',
  'Search Commissioner OS': shellText('Search Commissioner OS', 'es'),
  'Search Commissioner OS...': 'Buscar en Commissioner OS...',
  'Search recommendations, managers, tasks, reports, automations, settings, help articles, and pages.':
    'Busca recomendaciones, mánagers, tareas, informes, automatizaciones, ajustes, artículos de ayuda y páginas.',
  'No results found.': 'No se encontraron resultados.',
  Recent: 'Recientes',
  '↑↓ to navigate · Enter to select · Esc to close': '↑↓ para moverte · Intro para elegir · Esc para cerrar',
  // searchLabels.ts — the result groups ("Managers" and "Settings" are coreUiCopy's; the three that
  // are a section's own name read as that section)
  Recommendations: commissionerSectionName('Recommendations', 'es'),
  Tasks: 'Tareas',
  Reports: commissionerSectionName('Reports', 'es'),
  Automations: commissionerSectionName('Automations', 'es'),
  Pages: 'Páginas',
  'Help Articles': 'Artículos de ayuda',

  // HelpCenterView / HelpArticleCard / helpLabels.ts
  'Search help articles and glossary…': 'Buscar artículos de ayuda y glosario…',
  'Search help articles and glossary': 'Buscar artículos de ayuda y glosario',
  'Help category': 'Categoría de ayuda',
  'No articles match.': 'Ningún artículo coincide.',
  'Try a different search term or category.': 'Prueba con otro término de búsqueda u otra categoría.',
  Glossary: 'Glosario',
  'No glossary terms match.': 'Ningún término del glosario coincide.',
  'Try a different search term.': 'Prueba con otro término de búsqueda.',
  'Show less': 'Ver menos',
  'Read more': 'Leer más',
  'Getting Started': 'Primeros pasos',
  Workflows: 'Flujos de trabajo',
  Troubleshooting: 'Solución de problemas',
  'Module Guides': 'Guías de módulos',

  // LeagueSettingsView
  'Couldn’t load this league’s settings right now.': 'No se pudo cargar la configuración de esta liga ahora mismo.',
  'Rules as stored for this league': 'Reglas tal como están guardadas para esta liga',
  'Read-only here': 'Solo lectura aquí',
  '— not captured': '— no capturado',
  'Not captured from this league’s platform': 'No se capturó de la plataforma de esta liga',
  Scoring: 'Puntuación',
  Template: 'Modelo',
  'No scoring rules were captured for this league, so every projection and score on other pages is using league-default scoring rather than yours.':
    'No se capturaron reglas de puntuación de esta liga, así que todas las proyecciones y puntuaciones de otras páginas usan la puntuación predeterminada en lugar de la tuya.',
  'Every value here was captured from this league rather than assumed. Anything marked “not captured” was absent from what the import returned — it is not a default, and no page in Commissioner OS is treating it as one.':
    'Cada valor de aquí se capturó de esta liga, no se supuso. Lo marcado como «no capturado» no venía en lo que devolvió la importación: no es un valor predeterminado y ninguna página de Commissioner OS lo trata como tal.',

  // Errors the loaders hand these screens (every live client's not-integrated message, and the
  // settings client's two) — read from analyticsCopy's `cosErrorText`, the one translator for them.
  'The live Decision OS backend is not yet integrated in this environment.': cosErrorText(
    'The live Decision OS backend is not yet integrated in this environment.',
    'es',
  ),
  'No active league could be resolved for this session.': cosErrorText('No active league could be resolved for this session.', 'es'),
  // "This league could not be read." has no entry here on purpose: it means what /core's Competitive
  // Edge loaders mean by it (the league row could not be read), so `toolsText` falls through to
  // coreUiCopy's translation.
}

/** The source writes these with straight apostrophes; the table keys them typographically. */
const normalizeQuotes = (english: string) => english.replace(/'/g, '’')

/** One of the tools' own fixed strings. Words /core already translates come from `coreUiCopy`. */
export function toolsText(english: string, language: string | null | undefined): string {
  if (!isEs(language)) return english
  return UI_ES[english] ?? UI_ES[normalizeQuotes(english)] ?? coreUiCopy(english, 'es')
}

/**
 * The run-outcome chart's series (`AUTOMATION_OUTCOME_SERIES`): plural, counting runs — where the
 * history table's result label is one run ("Omitida").
 */
const OUTCOME_SERIES_ES: Record<string, string> = { Succeeded: 'Exitosas', Skipped: 'Omitidas', Failed: 'Fallidas' }

export function outcomeSeriesText(english: string, language: string | null | undefined): string {
  return isEs(language) ? (OUTCOME_SERIES_ES[english] ?? english) : english
}

/** A pinned short date ("Sep 10", `shortDate`) — Spanish reads the day first ("10 sep"). */
export function dateText(text: string, language: string | null | undefined): string {
  return kickoffText(text, language ?? 'en')
}

/** `formatRelativeTime` ("Just now", "5h ago", "3d ago") — the /core age translator. */
export function relativeTimeText(text: string, language: string | null | undefined): string {
  return ageText(text, language ?? 'en')
}

// ── Automations ───────────────────────────────────────────────────────────────────────────────────

/**
 * The live catalog's product copy — `CATALOG_METADATA` and `describe()` in
 * lib/commissioner-ui/automations/decision-os-client/live.ts — and the run-history fallbacks the same
 * file writes when a run carries no message of its own.
 */
const AUTOMATION_ES: Record<string, string> = {
  'League task scan': 'Revisión de tareas de la liga',
  'Checks each league for conditions a commissioner should know about — a feed that has stopped arriving, managers who have gone quiet — and keeps the Workspace task list current. Closes tasks on its own when the condition clears.':
    'Revisa cada liga en busca de situaciones que un comisionado debería conocer (datos que han dejado de llegar, mánagers que se han quedado callados) y mantiene al día la lista de tareas del Espacio de trabajo. Cierra las tareas por sí sola cuando la situación se resuelve.',
  'Daily at 08:40 UTC, one scan per league': 'Cada día a las 08:40 UTC, una revisión por liga',
  // A waiver RUN is «procesamiento de reclamos» (the owner's ruling, 2026-10-06); «agentes libres»
  // is only ever the players.
  'Waiver batch processing': 'Procesamiento de reclamos por lotes',
  'Settles pending waiver claims for leagues that run batched waivers, in FAAB or rolling-priority order. Only applies to leagues whose waivers are run by AllFantasy — an imported league settles its waivers on its own platform, so this never has work to do for one.':
    'Resuelve los reclamos de agentes libres pendientes en las ligas que los procesan por lotes, por orden de FAAB o de prioridad rotativa. Solo se aplica a las ligas cuyos reclamos procesa AllFantasy: una liga importada los resuelve en su propia plataforma, así que aquí nunca tiene trabajo para ella.',
  'Every 5 minutes, for leagues with pending claims': 'Cada 5 minutos, para las ligas con reclamos pendientes',
  'Scheduled report generation': 'Generación de informes programados',
  'Generates the reports each league has on a schedule — the weekly commissioner digest and the rest of the catalog — and files them in Reports ready to read or share. One report per league per ISO week, so a daily run never produces the same digest twice.':
    'Genera los informes que cada liga tiene programados (el resumen semanal del comisionado y el resto del catálogo) y los guarda en Informes, listos para leer o compartir. Un informe por liga y semana ISO, así que una ejecución diaria nunca produce el mismo resumen dos veces.',
  'Daily, generating any report whose schedule is due': 'Cada día, genera los informes a los que les toca según su programación',
  'This automation has run on the platform but is not described in the Automation Center catalog yet.':
    'Esta automatización se ha ejecutado en la plataforma, pero aún no está descrita en el catálogo del Centro de automatizaciones.',
  'Unknown — no catalog entry for this job type': 'Desconocida: no hay entrada en el catálogo para este tipo de tarea',
  // run history fallbacks
  'Skipped — already completed for this window': 'Omitida: ya se completó en esta ventana',
  Completed: 'Completada',
  'Platform-wide run': 'Ejecución para toda la plataforma',
}

/** The English keys above, for the test that holds each one to its loader's source. */
export const AUTOMATION_COPY_KEYS: readonly string[] = Object.keys(AUTOMATION_ES)

/**
 * An automation's name, description, schedule or run summary/detail. A run's own ledger message and a
 * demo fixture's prose pass through as written.
 */
export function automationText(text: string, language: string | null | undefined): string {
  if (!isEs(language)) return text
  const exact = AUTOMATION_ES[text]
  if (exact != null) return exact
  const league = /^League (\S+)$/.exec(text)
  if (league) return `Liga ${league[1]}`
  return text
}

/** A staleness bar's label: the name, with deriveChartSeries' " (never run)" suffix. */
export function automationChartLabelText(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  const never = / \(never run\)$/.exec(label)
  if (never) return `${automationText(label.slice(0, never.index), language)} (nunca ejecutada)`
  return automationText(label, language)
}

/** "Last ran Sep 10 · 98% success over 251 runs". `date` is the pinned short date. */
export function lastRanText(date: string, successPercent: number, runs: number, language: string | null | undefined): string {
  return isEs(language)
    ? `Última ejecución: ${dateText(date, language)} · ${successPercent}% de éxito en ${count(runs, 'ejecución', 'ejecuciones')}`
    : `Last ran ${date} · ${successPercent}% success over ${runs} runs`
}

/** The switch's label: "Disable League task scan". `name` is already in the reader's language. */
export function toggleAriaText(enabled: boolean, name: string, language: string | null | undefined): string {
  if (!isEs(language)) return `${enabled ? 'Disable' : 'Enable'} ${name}`
  return `${enabled ? 'Desactivar' : 'Activar'} ${name}`
}

/** "League task scan — Execution History". */
export function historyTitleText(name: string, language: string | null | undefined): string {
  return isEs(language) ? `${name}: historial de ejecuciones` : `${name} — Execution History`
}

// ── Notifications and the Activity Stream ─────────────────────────────────────────────────────────

/**
 * Related-link labels the notification composer and the help catalog write, each naming a section.
 */
const LINK_ES: Record<string, string> = {
  'Go to Mission Control': 'Ir al Centro de control',
  'View League Health': 'Ver Salud de la liga',
  'View Recommendations': 'Ver Recomendaciones',
  'View Workspace': 'Ver Espacio de trabajo',
  'View Automation Center': 'Ver el Centro de automatizaciones',
  'Review Automation': 'Revisar automatización',
  'View Reports': 'Ver Informes',
  'View Manager Intelligence': 'Ver Información de mánagers',
  'View League Analytics': 'Ver Analítica de la liga',
  'View Activity Stream': 'Ver Flujo de actividad',
}

export const LINK_COPY_KEYS: readonly string[] = Object.keys(LINK_ES)

/**
 * A related link's label. A bare section name ("Workspace", the automation catalog's links) reads as
 * the section; anything else unknown — a demo fixture's own label — passes through.
 */
export function relatedLinkText(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  return LINK_ES[label] ?? commissionerSectionName(label, language)
}

/** "View in League Health" — `sectionLabel` is already in the reader's language. */
export function viewInText(sectionLabel: string, language: string | null | undefined): string {
  return isEs(language) ? `Ver en ${sectionLabel}` : `View in ${sectionLabel}`
}

/**
 * The sentences the notification and activity composers build around another module's item —
 * lib/commissioner-ui/{notifications,activity}/decision-os-client/{live,demo}.ts. The name inside
 * is translated by the catalog that owns it: an automation's here, a report template's by
 * analyticsCopy's `reportTemplateText`. A name neither catalog knows stays as written.
 *
 * analyticsCopy's `reportText` also translates "<template> generated successfully." (the Reports
 * page's preview simulation), without the colon this one uses. Kept on purpose, and not a duplicate:
 * here it is a LIST LINE in the activity feed ("X: se generó…", name first like every other line),
 * there it is a sentence of prose ("X se generó…").
 */
const REPORT_DEFAULT_REASON = 'no partial file was produced.'
const report = (tpl: string) => reportTemplateText(tpl, 'es')
const COMPOSED_RULES: [RegExp, (...g: string[]) => string][] = [
  [/^(.+) needs attention — its last run failed\.$/s, (name) => `${automationText(name, 'es')}: necesita atención; su última ejecución falló.`],
  [
    /^(.+) needs attention — its last run was not fully successful\.$/s,
    (name) => `${automationText(name, 'es')}: necesita atención; su última ejecución no salió del todo bien.`,
  ],
  [
    /^(.+?) failed to generate — (.+)$/s,
    (tpl, reason) => `${report(tpl)}: no se pudo generar. ${reason === REPORT_DEFAULT_REASON ? 'No se produjo ningún archivo parcial.' : otherModuleText(reason)}`,
  ],
  [/^(.+) failed on its last run\.$/s, (name) => `${automationText(name, 'es')}: falló en su última ejecución.`],
  [/^(.+) ran successfully\.$/s, (name) => `${automationText(name, 'es')}: se ejecutó correctamente.`],
  [/^(.+) failed to generate\.$/s, (tpl) => `${report(tpl)}: no se pudo generar.`],
  // A list line, so name-colon — see the note above for why the Reports preview's prose differs.
  [/^(.+) generated successfully\.$/s, (tpl) => `${report(tpl)}: se generó correctamente.`],
]

/**
 * Another module's sentence quoted whole — a risk description, a recommendation title, a workspace
 * task title, a health-engine alert — through the translator that module's own screen uses:
 * `cosLoaderText` (cardsCopy: recommendations, League Health, managers, and from there
 * `commissionerOsText` for the health engine), then `taskText` (analyticsCopy: workspace tasks).
 * Unknown text passes through unchanged.
 */
function otherModuleText(text: string): string {
  const loader = cosLoaderText(text, 'es')
  return loader !== text ? loader : taskText(text, 'es')
}

/**
 * A notification's `message` or an activity event's `summary` — on the Notifications and Activity
 * pages and in Mission Control's Recent Activity. The composer's own sentences are translated whole;
 * anything else is another module's text and goes through `otherModuleText`.
 */
export function composedEventText(text: string, language: string | null | undefined): string {
  if (!isEs(language)) return text
  for (const [pattern, build] of COMPOSED_RULES) {
    const m = pattern.exec(text)
    if (m) return build(...m.slice(1))
  }
  return otherModuleText(text)
}

// ── Help ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The Help & Knowledge Center catalog — lib/commissioner-ui/help/helpCatalog.ts, product prose shared
 * by every data mode. Every title, summary, body, term and definition there is a key here; the test
 * fails on one that is missing. The section names inside follow the shell's `COMMISSIONER_SECTION_NAMES_ES`.
 */
const HELP_ES: Record<string, string> = {
  // help-welcome
  'Welcome to Commissioner OS': 'Bienvenido a Commissioner OS',
  'A quick orientation to Mission Control and how the sidebar is organized.':
    'Una orientación rápida sobre el Centro de control y cómo está organizada la barra lateral.',
  "Mission Control is your daily starting point — a KPI strip, today's priorities, and short previews of League Health, Manager Intelligence, Workspace, and Recent Activity, each linking to its own full module. The sidebar's primary section (League Health, Recommendations, Manager Intelligence, Workspace, Automations, League Analytics, Reports, Settings) holds daily-decision modules; Activity Stream and Help & Knowledge Center sit below as secondary, always-available destinations. The header's Search button (or Ctrl/⌘K) is the fastest way to jump to any page, recommendation, task, report, automation, or help article by name.":
    'El Centro de control es tu punto de partida diario: una franja de KPI, las prioridades de hoy y vistas previas breves de Salud de la liga, Información de mánagers, Espacio de trabajo y Actividad reciente, cada una con un enlace a su módulo completo. La sección principal de la barra lateral (Salud de la liga, Recomendaciones, Información de mánagers, Espacio de trabajo, Automatizaciones, Analítica de la liga, Informes y Configuración) reúne los módulos de decisiones diarias; Flujo de actividad y Ayuda y centro de conocimiento están debajo, como destinos secundarios siempre disponibles. El botón Buscar de la cabecera (o Ctrl/⌘K) es la forma más rápida de ir por su nombre a cualquier página, recomendación, tarea, informe, automatización o artículo de ayuda.',
  // help-demo-mode
  'Understanding Demo Mode': 'Cómo funciona el modo demo',
  'What the "Preview data" banner means, and the difference between stub, demo, and live data.':
    'Qué significa el aviso «Datos de vista previa» y en qué se diferencian los datos stub, demo y en vivo.',
  'Every Commissioner OS page can run in one of three data modes, shown by the small indicator in the header and, whenever the data isn\'t live, an unmissable "Preview data" banner at the top of the page. "Stub" is a minimal fixture that proves a page\'s shape works at all. "Demo" is a fuller, realistic scenario meant to show what the module looks like with real content in it. "Live" means the page is reading from the real Decision OS backend for your actual league — until a given module\'s live connection is built, it shows an honest error instead of fake success, never invented numbers dressed up as real ones.':
    'Cada página de Commissioner OS puede funcionar en uno de tres modos de datos, que muestra el pequeño indicador de la cabecera y, siempre que los datos no son en vivo, un aviso imposible de pasar por alto, «Datos de vista previa», arriba de la página. «Stub» es un conjunto mínimo de datos de prueba que demuestra que la estructura de una página funciona. «Demo» es un escenario más completo y realista, pensado para mostrar cómo se ve el módulo con contenido real. «En vivo» significa que la página lee del backend real de Decision OS para tu liga: hasta que se construye la conexión en vivo de un módulo, muestra un error honesto en lugar de un falso éxito, nunca números inventados disfrazados de reales.',
  // help-search-guide
  'Finding Anything with Search': 'Encuentra lo que sea con la búsqueda',
  'How the command palette indexes pages, recommendations, tasks, reports, automations, settings, and help articles.':
    'Cómo la paleta de comandos indexa páginas, recomendaciones, tareas, informes, automatizaciones, ajustes y artículos de ayuda.',
  "Search is reachable from any Commissioner OS page via the header button or the Ctrl/⌘K shortcut. It indexes every module's pages plus a preview of their real entities — recommendations, tasks, reports, automations, settings areas, and help articles among them — so typing a few letters of what you're looking for gets you there directly, without needing to know which module owns it first. Search never duplicates what it finds; every result is a title and a link back to the module that actually owns the real detail.":
    'La búsqueda está disponible desde cualquier página de Commissioner OS con el botón de la cabecera o el atajo Ctrl/⌘K. Indexa las páginas de cada módulo y una vista previa de sus elementos reales (entre ellos recomendaciones, tareas, informes, automatizaciones, secciones de configuración y artículos de ayuda), así que con escribir unas letras de lo que buscas llegas directamente, sin tener que saber antes qué módulo lo contiene. La búsqueda nunca duplica lo que encuentra: cada resultado es un título y un enlace al módulo que tiene el detalle real.',
  // help-league-health-workflow
  'How League Health Scoring Works': 'Cómo se calcula la salud de la liga',
  'What the League Health score measures and how its tiers are derived.':
    'Qué mide la puntuación de Salud de la liga y cómo se obtienen sus niveles.',
  'League Health rolls up into a single score and tier (from "positive" through "critical"), with a driver explaining the biggest factor behind it and a trend showing which direction things are moving. Underneath the score sits a list of specific detected risks, each with its own severity and supporting evidence — engagement drop-off, missed lineup deadlines, and similar league-operations signals. A risk detected here is often exactly what surfaces later as a suggested action in Recommendations Center, or as an entry in the Activity Stream — League Health is where the underlying condition is actually measured.':
    'Salud de la liga se resume en una sola puntuación y un nivel (de «positivo» a «crítico»), con un factor que explica qué es lo que más pesa y una tendencia que muestra hacia dónde van las cosas. Bajo la puntuación hay una lista de riesgos concretos detectados, cada uno con su gravedad y su evidencia: caída de la participación, alineaciones no enviadas a tiempo y señales parecidas de la gestión de la liga. Un riesgo detectado aquí suele ser justo lo que luego aparece como acción sugerida en el Centro de recomendaciones o como entrada en el Flujo de actividad: Salud de la liga es donde de verdad se mide la situación de fondo.',
  // help-acting-on-recommendation
  'Acting on a Recommendation': 'Cómo actuar sobre una recomendación',
  'How Recommendations Center surfaces suggested actions and what happens when you act on one.':
    'Cómo el Centro de recomendaciones muestra acciones sugeridas y qué pasa cuando actúas sobre una.',
  "Every recommendation states what was detected, why it matters, the expected impact of acting, and a single primary action — never just a number without a next step. Recommendations carry a confidence level and a status (new, viewed, in progress, completed, dismissed, and a few others) so you can track where each one stands. Mission Control's \"Today's Priorities\" always shows the same live queue from here, filtered to what's still open — it never keeps its own separate copy.":
    'Cada recomendación indica qué se detectó, por qué importa, el impacto esperado de actuar y una sola acción principal: nunca un número sin un siguiente paso. Las recomendaciones tienen un nivel de confianza y un estado (nueva, vista, en curso, completada, descartada y algunos más) para que sepas en qué punto está cada una. Las «Prioridades de hoy» del Centro de control muestran siempre esta misma cola en vivo, filtrada a lo que sigue abierto: nunca guardan una copia aparte.',
  // help-workspace-queue
  'Managing Your Workspace Queue': 'Cómo gestionar la cola del Espacio de trabajo',
  'How commissioner tasks are prioritized and tracked to completion in Workspace.':
    'Cómo se priorizan las tareas del comisionado y se siguen hasta completarlas en el Espacio de trabajo.',
  "Workspace is where day-to-day commissioner to-dos live — each task has a priority, a status, and often a related link back to whatever module it concerns (a trade to review, a report to send). Tasks move through a queue rather than disappearing once read, so nothing gets lost between when it's noticed and when it's actually done.":
    'El Espacio de trabajo es donde viven los pendientes diarios del comisionado: cada tarea tiene una prioridad, un estado y, a menudo, un enlace al módulo con el que tiene que ver (un intercambio que revisar, un informe que enviar). Las tareas avanzan por una cola en lugar de desaparecer al leerlas, así que nada se pierde entre el momento en que se detecta y el momento en que de verdad se hace.',
  // help-building-automation
  'Building an Automation': 'Cómo crear una automatización',
  'What an automation is, how its health is measured, and how to read its execution history.':
    'Qué es una automatización, cómo se mide su salud y cómo leer su historial de ejecuciones.',
  'An automation is a scheduled or triggered action — a lineup lock reminder, a trade deadline notice — that runs without you having to remember to send it yourself. Each automation shows a health indicator reflecting how its recent runs went, and a full execution history you can drill into when something needs a closer look.':
    'Una automatización es una acción programada o activada por un evento (un recordatorio del bloqueo de alineaciones, un aviso de la fecha límite de intercambios) que se ejecuta sin que tengas que acordarte de enviarla tú. Cada automatización muestra un indicador de salud que refleja cómo fueron sus ejecuciones recientes y un historial completo de ejecuciones que puedes revisar cuando algo merece una mirada más atenta.',
  // help-reports-generate-share
  'Generating and Sharing Reports': 'Cómo generar y compartir informes',
  'How to generate a report from a template, and the difference between sharing and downloading one.':
    'Cómo generar un informe a partir de una plantilla y en qué se diferencia compartirlo de descargarlo.',
  'Reports start from a template (a manager engagement summary, a season-midpoint digest, and similar) and generate into a real, dated entry in your report history. Sharing makes a report reachable by a link you can send to your league; downloading exports it as a PDF or CSV for your own records. Both are available from the same generated report, and neither duplicates the other.':
    'Los informes parten de una plantilla (un resumen de la participación de los mánagers, un resumen de mitad de temporada y otros parecidos) y se generan como una entrada real y fechada en tu historial de informes. Compartir hace que un informe sea accesible con un enlace que puedes enviar a tu liga; descargarlo lo exporta como PDF o CSV para tus propios registros. Ambas opciones están disponibles desde el mismo informe generado y ninguna duplica a la otra.',
  // help-manager-intelligence-guide
  'Manager Intelligence, Explained': 'Información de mánagers, explicada',
  'What Manager Intelligence tracks about each manager in your league, and what it deliberately does not track.':
    'Qué sigue Información de mánagers sobre cada mánager de tu liga y qué deja fuera a propósito.',
  "Manager Intelligence is a directory of engagement and behavior signals per manager — the kind of thing that helps you notice who might need a nudge before a lineup deadline, not a performance leaderboard. It does not compute league standings or scoring outcomes — that's League Analytics' job, and the two modules deliberately don't overlap.":
    'Información de mánagers es un directorio de señales de participación y comportamiento de cada mánager: lo que te ayuda a notar quién podría necesitar un empujón antes de una fecha límite de alineaciones, no una tabla de rendimiento. No calcula la clasificación de la liga ni los resultados de puntuación: eso es trabajo de Analítica de la liga, y los dos módulos no se solapan a propósito.',
  // help-league-analytics-guide
  'League Analytics, Explained': 'Analítica de la liga, explicada',
  'The league-wide trends and distributions League Analytics surfaces, and how they relate to League Health.':
    'Las tendencias y distribuciones de toda la liga que muestra Analítica de la liga, y cómo se relacionan con Salud de la liga.',
  'League Analytics shows league-wide trends and distributions — scoring spread, competitive balance, and similar season-level patterns — as charts you can scan at a glance from its own summary on Mission Control. League Health asks "is anything wrong right now"; League Analytics asks "what does the season look like as a whole." They\'re related but answer different questions, and neither recomputes the other\'s numbers.':
    'Analítica de la liga muestra tendencias y distribuciones de toda la liga (la dispersión de puntuaciones, el equilibrio competitivo y patrones parecidos de la temporada) como gráficos que puedes repasar de un vistazo desde su propio resumen en el Centro de control. Salud de la liga pregunta «¿hay algo mal ahora mismo?»; Analítica de la liga pregunta «¿cómo se ve la temporada en conjunto?». Están relacionadas, pero responden preguntas distintas, y ninguna recalcula los números de la otra.',
  // help-activity-stream-guide
  'Reading the Activity Stream': 'Cómo leer el Flujo de actividad',
  'How the Activity Stream differs from Notifications, and how to filter it by source module.':
    'En qué se diferencia el Flujo de actividad de las Notificaciones y cómo filtrarlo por módulo de origen.',
  "The Activity Stream is the permanent, chronological record of meaningful events across every module — a risk detected, a task completed, an automation run — never dismissed or marked read. That's the key difference from Notifications: Notifications are an actionable inbox you triage and clear, while the Activity Stream is the standing history you can always look back through. Use the tabs at the top of the page to filter down to just one source module's events.":
    'El Flujo de actividad es el registro permanente y cronológico de los eventos importantes de todos los módulos (un riesgo detectado, una tarea completada, una ejecución de una automatización) y nunca se descarta ni se marca como leído. Esa es la diferencia clave con las Notificaciones: las Notificaciones son una bandeja de acciones que revisas y vacías, mientras que el Flujo de actividad es el historial fijo que siempre puedes repasar. Usa las pestañas de arriba de la página para ver solo los eventos de un módulo de origen.',
  // help-notifications-guide
  'Working with Notifications': 'Cómo trabajar con las notificaciones',
  'What generates a notification, and how read state and priority work.':
    'Qué genera una notificación y cómo funcionan el estado de lectura y la prioridad.',
  "Notifications are actionable, dismissible inbox items — reachable from the bell icon in the header — each carrying a severity, a source module, and often a related link straight to whatever needs your attention. Once you've read or acted on one, it's marked read; unlike the Activity Stream, nothing here is meant to be a permanent record, only a current to-do list of things worth noticing.":
    'Las notificaciones son elementos de bandeja que se pueden atender y descartar (a los que llegas desde la campana de la cabecera), cada uno con una gravedad, un módulo de origen y, a menudo, un enlace directo a lo que necesita tu atención. Cuando lees o atiendes una, queda marcada como leída; a diferencia del Flujo de actividad, nada aquí pretende ser un registro permanente, solo una lista actual de cosas que vale la pena notar.',
  // help-report-failed
  'Why a Report Failed to Generate': 'Por qué no se pudo generar un informe',
  'Common reasons a scheduled or on-demand report shows a failed status, and what to check first.':
    'Motivos habituales por los que un informe programado o bajo demanda aparece como fallido y qué revisar primero.',
  "A failed report almost always means the underlying data it needed wasn't available at generation time — check Reports' own history entry for that run's specific failure reason before trying again. A failed report also automatically appears in both Notifications and the Activity Stream, so you don't have to be watching the Reports page itself to notice.":
    'Un informe fallido casi siempre significa que los datos que necesitaba no estaban disponibles al generarse: revisa la entrada de esa ejecución en el historial de Informes para ver el motivo concreto del fallo antes de volver a intentarlo. Un informe fallido también aparece automáticamente en Notificaciones y en el Flujo de actividad, así que no tienes que estar mirando la página de Informes para enterarte.',
  // help-automation-failed
  'What To Do When an Automation Fails': 'Qué hacer cuando falla una automatización',
  'How to read an automation health indicator and where to find its execution history.':
    'Cómo leer el indicador de salud de una automatización y dónde encontrar su historial de ejecuciones.',
  "An automation's health indicator reflects its recent runs, not just its most recent one — a single failure surrounded by successes reads differently than a run of consecutive failures. Open the automation's own execution history for the specific error from its last run before deciding whether to re-run it or adjust its configuration.":
    'El indicador de salud de una automatización refleja sus ejecuciones recientes, no solo la última: un fallo aislado entre éxitos se lee distinto que una serie de fallos seguidos. Abre el historial de ejecuciones de la automatización para ver el error concreto de su última ejecución antes de decidir si volver a ejecutarla o ajustar su configuración.',
  // help-terminology-overview
  'Commissioner OS Terminology Overview': 'Resumen de la terminología de Commissioner OS',
  'A short orientation to the recurring terms used across Commissioner OS — see the Glossary below for full definitions.':
    'Una breve orientación sobre los términos que se repiten en Commissioner OS; consulta el Glosario más abajo para ver las definiciones completas.',
  'A few words show up across almost every module: severity (how serious a condition is), confidence (how sure the system is), and source module (which module a piece of evidence or a link actually belongs to). The Glossary section on this page defines each of these, along with the handful of Commissioner-OS-specific terms — Decision OS Adapter, Demo Mode, Recommendation, Risk, Automation, Activity Event, and Notification — in one place.':
    'Unas pocas palabras aparecen en casi todos los módulos: gravedad (lo seria que es una situación), confianza (lo seguro que está el sistema) y módulo de origen (a qué módulo pertenece de verdad una evidencia o un enlace). La sección Glosario de esta página define cada una, junto con los pocos términos propios de Commissioner OS (Adaptador de Decision OS, Modo demo, Recomendación, Riesgo, Automatización, Evento de actividad y Notificación), en un solo lugar.',

  // ── Glossary ──
  'Decision OS Adapter': 'Adaptador de Decision OS',
  "The single layer every Commissioner OS page fetches through — it normalizes, validates, and logs every module's data uniformly, but never computes or owns any of it itself.":
    'La única capa a través de la que cada página de Commissioner OS obtiene sus datos: normaliza, valida y registra los datos de cada módulo de forma uniforme, pero nunca calcula ni posee ninguno de ellos.',
  'Demo Mode': 'Modo demo',
  'The stub / demo / live switch every page respects — see "Understanding Demo Mode" above for what each of the three means.':
    'El selector stub / demo / en vivo que respeta cada página: consulta «Cómo funciona el modo demo» más arriba para ver qué significa cada uno de los tres.',
  'Severity Tier': 'Nivel de gravedad',
  'The condition scale used by League Health, Workspace task priority, and Automation health: critical, elevated, standard, advisory, or positive.':
    'La escala de situaciones que usan Salud de la liga, la prioridad de las tareas del Espacio de trabajo y la salud de las automatizaciones: crítico, elevado, estándar, aviso o positivo.',
  'Event Severity': 'Gravedad del evento',
  'The separate scale used by Notifications and the Activity Stream for individual events: informational, success, warning, or critical — deliberately distinct from Severity Tier, since an event and an ongoing condition are different kinds of things.':
    'La escala aparte que usan las Notificaciones y el Flujo de actividad para cada evento: información, éxito, advertencia o crítico; distinta a propósito del Nivel de gravedad, porque un evento y una situación que continúa son cosas de distinto tipo.',
  Recommendation: 'Recomendación',
  'A suggested action surfaced by Recommendations Center — what was detected, why it matters, the expected impact, and one primary action.':
    'Una acción sugerida por el Centro de recomendaciones: qué se detectó, por qué importa, el impacto esperado y una acción principal.',
  Risk: 'Riesgo',
  "A specific detected condition underlying League Health's overall score — engagement drop-off or missed deadlines are typical examples.":
    'Una situación concreta detectada que está detrás de la puntuación general de Salud de la liga; la caída de la participación o las fechas límite incumplidas son ejemplos típicos.',
  Automation: 'Automatización',
  'A scheduled or triggered action managed by Automation Center, shown with a health indicator and a full execution history.':
    'Una acción programada o activada por un evento que gestiona el Centro de automatizaciones, con un indicador de salud y un historial completo de ejecuciones.',
  'Activity Event': 'Evento de actividad',
  "One entry in the Activity Stream's permanent chronological record — a summary, its source module, who or what triggered it, and a link back to the real detail.":
    'Una entrada del registro cronológico permanente del Flujo de actividad: un resumen, su módulo de origen, quién o qué lo provocó y un enlace al detalle real.',
  Notification: 'Notificación',
  'An actionable, dismissible inbox item with a read/unread state — distinct from an Activity Event, which is never dismissed.':
    'Un elemento de bandeja que se puede atender y descartar, con estado leído o sin leer; distinto de un Evento de actividad, que nunca se descarta.',
  'Related Link': 'Enlace relacionado',
  "A pointer back to whichever module actually owns something's real detail — the mechanism every module uses to reference another's data without ever copying it.":
    'Un enlace al módulo que tiene de verdad el detalle de algo: el mecanismo que usa cada módulo para referirse a los datos de otro sin copiarlos nunca.',
}

/** Every help string the catalog authors, for the test that holds the catalog to this table. */
export const HELP_COPY_KEYS: readonly string[] = Object.keys(HELP_ES)

/** An article's title, summary or body, or a glossary term or definition. Unknown text stays English. */
export function helpText(text: string, language: string | null | undefined): string {
  if (!isEs(language)) return text
  return HELP_ES[text] ?? text
}

// ── Search ────────────────────────────────────────────────────────────────────────────────────────

/** `SETTINGS_RESULTS` (lib/commissioner-ui/search/decision-os-client/settingsResults.ts). */
const SETTINGS_RESULT_ES: Record<string, string> = {
  'League format and size': 'Formato y tamaño de la liga',
  'Roster slots, bench, taxi and IR': 'Puestos de plantilla, suplentes, taxi e IR',
  'Scoring rules': 'Reglas de puntuación',
  'Waivers and FAAB budget': 'Agentes libres y presupuesto FAAB',
  'Playoffs and trade deadline': 'Playoffs y fecha límite de intercambios',
  'Draft type': 'Tipo de draft',
}

export const SETTINGS_RESULT_KEYS: readonly string[] = Object.keys(SETTINGS_RESULT_ES)

/**
 * A search result's title. Pages read as their section; our own catalogs (automations, report
 * templates, settings, help) translate; a recommendation or task title goes through the translator
 * its own screen uses (`otherModuleText`); a manager's name stays as written.
 */
export function searchResultTitleText(result: Pick<CommissionerSearchResultContract, 'category' | 'title'>, language: string | null | undefined): string {
  if (!isEs(language)) return result.title
  switch (result.category) {
    case 'page':
      return commissionerSectionName(result.title, language)
    case 'automation':
      return automationText(result.title, language)
    case 'report':
      return reportTemplateText(result.title, language)
    case 'setting':
      return SETTINGS_RESULT_ES[result.title] ?? result.title
    case 'help':
      return helpText(result.title, language)
    case 'recommendation':
    case 'task':
      return otherModuleText(result.title)
    default:
      return result.title
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The settings read's fixed words — group labels and descriptions, entry labels, the week note and
 * the yes/no values — from lib/commissioner-settings/leagueSettingsReads.ts. Labels /core already
 * says ("Bench", "Taxi squad", "Waiver type", "Trade deadline") come from `coreUiCopy` via
 * `settingsText`'s fallback. A titleised platform value ("Dynasty Superflex", "Nfl") is data and
 * passes through, except the handful of plain words below.
 */
const SETTINGS_ES: Record<string, string> = {
  // groups
  Roster: 'Plantilla',
  Draft: 'Draft',
  'What kind of league this is, as captured from its platform.': 'Qué tipo de liga es, tal como se capturó de su plataforma.',
  'Starting slots, bench depth and the developmental slots this league carries.':
    'Puestos titulares, profundidad de suplentes y los puestos de desarrollo que tiene esta liga.',
  'How this league adds free agents.': 'Cómo incorpora esta liga a los agentes libres.',
  'How the season ends.': 'Cómo termina la temporada.',
  'How this league drafts.': 'Cómo hace el draft esta liga.',
  // entries
  Teams: 'Equipos',
  Season: 'Temporada',
  Sport: 'Deporte',
  Matchups: 'Enfrentamientos',
  'Starting slots': 'Puestos titulares',
  IR: 'IR',
  'Devy / college': 'Devy / universitarios',
  'Total roster spots': 'Puestos totales de plantilla',
  'FAAB budget': 'Presupuesto FAAB',
  'Playoff teams': 'Equipos en playoffs',
  'Playoffs start': leagueEventNameText('Playoffs start', 'es'),
  'Draft type': 'Tipo de draft',
  // values
  Yes: 'Sí',
  No: 'No',
  Weekly: 'Semanal',
  Linear: 'Lineal',
  Snake: 'Serpiente',
  Auction: 'Subasta',
  Custom: 'Personalizado',
}

export const SETTINGS_COPY_KEYS: readonly string[] = Object.keys(SETTINGS_ES)

/** A settings group or entry label, description, note or plain value. Unknown text passes through. */
export function settingsText(text: string, language: string | null | undefined): string {
  if (!isEs(language)) return text
  return SETTINGS_ES[text] ?? coreUiCopy(text, 'es')
}

/**
 * The scoring rules' labels — `STAT_LABELS` in leagueSettingsReads.ts. Terms follow the scoring
 * editors' table (lib/i18n/scoring-stats/football.ts): a sack is a "captura", a fumble a "balón
 * suelto", a tackle a "tacleada"; TD, FG, PAT, QB, TE and IDP stay. A raw provider key (a stat nobody
 * has labelled yet) passes through.
 */
const SCORING_RULE_ES: Record<string, string> = {
  'Passing yards': 'Yardas por pase',
  'Passing TD': 'TD por pase',
  'Interception thrown': 'Intercepción lanzada',
  'Passing 2-pt': 'Conversión de 2 puntos por pase',
  'Sack taken': 'Captura recibida',
  'Rushing yards': 'Yardas por carrera',
  'Rushing TD': 'TD por carrera',
  'Rush attempt': 'Intento de carrera',
  'Rushing 2-pt': 'Conversión de 2 puntos por carrera',
  Reception: 'Recepción',
  'Receiving yards': 'Yardas por recepción',
  'Receiving TD': 'TD por recepción',
  'Receiving 2-pt': 'Conversión de 2 puntos por recepción',
  'TE reception bonus': 'Bono por recepción de TE',
  Fumble: 'Balón suelto',
  'Fumble lost': 'Balón suelto perdido',
  'Fumble recovered': 'Balón suelto recuperado',
  'Fumble recovery TD': 'TD por balón suelto recuperado',
  'Extra point made': 'PAT anotado',
  'Extra point missed': 'PAT fallado',
  'Field goal missed': 'FG fallado',
  'FG 0-19': 'FG 0-19',
  'FG 20-29': 'FG 20-29',
  'FG 30-39': 'FG 30-39',
  'FG 40-49': 'FG 40-49',
  'FG 50+': 'FG 50+',
  Sack: 'Captura',
  Interception: 'Intercepción',
  Safety: 'Safety',
  'Forced fumble': 'Balón suelto forzado',
  'Defensive TD': 'TD defensivo',
  'Blocked kick': 'Patada bloqueada',
  'Tackle for loss': 'Tacleada para pérdida',
  'IDP tackle': 'Tacleada (IDP)',
  'IDP solo tackle': 'Tacleada en solitario (IDP)',
  'IDP assisted tackle': 'Tacleada asistida (IDP)',
  'IDP tackle for loss': 'Tacleada para pérdida (IDP)',
  'IDP sack': 'Captura (IDP)',
  'IDP interception': 'Intercepción (IDP)',
  'IDP forced fumble': 'Balón suelto forzado (IDP)',
  'IDP fumble recovery': 'Balón suelto recuperado (IDP)',
  'IDP pass defended': 'Pase defendido (IDP)',
  'IDP QB hit': 'Golpe al QB (IDP)',
  'IDP safety': 'Safety (IDP)',
  'IDP defensive TD': 'TD defensivo (IDP)',
  'IDP blocked kick': 'Patada bloqueada (IDP)',
  Shutout: 'Blanqueada',
  'Points allowed 1-6': 'Puntos permitidos 1-6',
  'Points allowed 7-13': 'Puntos permitidos 7-13',
  'Points allowed 14-20': 'Puntos permitidos 14-20',
  'Points allowed 21-27': 'Puntos permitidos 21-27',
  'Points allowed 28-34': 'Puntos permitidos 28-34',
  'Points allowed 35+': 'Puntos permitidos 35+',
  'Special-teams TD': 'TD de equipos especiales',
  'Special-teams forced fumble': 'Balón suelto forzado en equipos especiales',
  'Special-teams tackle': 'Tacleada en equipos especiales',
  'Kick return yards': 'Yardas de retorno de patada',
  'Punt return yards': 'Yardas de retorno de despeje',
}

export const SCORING_RULE_KEYS: readonly string[] = Object.keys(SCORING_RULE_ES)

export function scoringRuleText(label: string, language: string | null | undefined): string {
  if (!isEs(language)) return label
  return SCORING_RULE_ES[label] ?? label
}

/**
 * The header line under the league name: "Rules as imported from Sleeper · 1048… · 2026 season".
 * `source` is a titleised platform name and stays.
 */
export function settingsProvenanceText(
  source: string | null,
  externalLeagueId: string | null,
  seasonLabel: string | null,
  language: string | null | undefined,
): string {
  const es = isEs(language)
  const origin = source
    ? `${es ? 'Reglas tal como se importaron de' : 'Rules as imported from'} ${source}${externalLeagueId ? ` · ${externalLeagueId}` : ''}`
    : toolsText('Rules as stored for this league', language)
  const season = seasonLabel ? (es ? ` · temporada ${seasonLabel}` : ` · ${seasonLabel} season`) : ''
  return `${origin}${season}`
}

/** "Read-only here — change these on Sleeper". */
export function readOnlyText(source: string | null, language: string | null | undefined): string {
  if (!isEs(language)) return `Read-only here${source ? ` — change these on ${source}` : ''}`
  return `Solo lectura aquí${source ? `: cámbialas en ${source}` : ''}`
}

/** The words after the count in "<n> rules captured". */
export function rulesCapturedText(n: number, language: string | null | undefined): string {
  if (!isEs(language)) return `rule${n === 1 ? '' : 's'} captured`
  return n === 1 ? 'regla capturada' : 'reglas capturadas'
}

/** "Show all 42 rules". */
export function showAllRulesText(n: number, language: string | null | undefined): string {
  return isEs(language) ? `Ver las ${n} reglas` : `Show all ${n} rules`
}

/** "Week 15" — the playoff and deadline notes sit before the value. */
export function weekNoteText(note: string, value: string, language: string | null | undefined): string {
  return `${settingsText(note, language)} ${value}`
}

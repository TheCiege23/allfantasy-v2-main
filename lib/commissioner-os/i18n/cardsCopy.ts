/**
 * Spanish for the Commissioner OS cards and the four screens built from them (2026-10-06):
 * `components/commissioner-os/{cards,recommendations,league-health,managers,networks}`.
 *
 * Two kinds of words live here, kept apart on purpose:
 *
 * - `cardsCopy` — the screens' OWN words: headings, labels, tabs, empty states, chart legends, the
 *   severity / status / confidence vocabularies, the networks form and its errors.
 * - `cosLoaderText` — sentences a LOADER wrote in English on the server: the live Decision OS clients
 *   in `lib/commissioner-ui/{recommendations,league-health,managers}/decision-os-client/live.ts`,
 *   the behavioural pipeline they relay (`lib/decision-os/behavioral/league-intelligence.ts`), the
 *   demo and stub fixtures, and the chart-series labels in
 *   `lib/commissioner-ui/charts/deriveChartSeries.ts`. Those loaders are shared with other screens,
 *   so they are NOT edited: their output is translated here at render, as whole sentences, keeping
 *   the names and numbers they carry. Anything unknown falls through to `commissionerOsText`
 *   (`lib/core-app/commissionerOsText.ts`, the health-engine / attention / drama translator), and
 *   from there passes through unchanged — never blanked.
 *
 * One translator per string: nothing here repeats a sentence `commissionerOsText` already knows.
 * Built at render from `useOptionalLanguage`, which starts at English on server and client alike, so
 * hydration is unaffected. PURE and client-safe.
 *
 * ⚠ KPI WINDOWS: these translate only what the code already says. "in window" stays "en la
 * ventana"; no sentence here names a number of days the English does not.
 */
import { commissionerOsText } from '@/lib/core-app/commissionerOsText'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { NETWORKS_LINK_ES } from '@/lib/commissioner-os/i18n/shellCopy'
import type { SeverityTier } from '@/lib/commissioner-ui/tokens/colors'

const plural = (n: string, one: string, many: string) => (n === '1' ? `1 ${one}` : `${n} ${many}`)

/* ── The cards' own vocabularies ─────────────────────────────────────────────── */

/**
 * `SEVERITY_LABELS` (severityStyles.ts) — a level, so masculine: "nivel crítico". THE severity
 * vocabulary: the cards' badges, an automation's health badge (toolsCopy), the event scale's
 * "Crítico" (toolsCopy) and the chart legend below all read it from here.
 */
const SEVERITY_ES: Record<SeverityTier, string> = {
  critical: 'Crítico',
  elevated: 'Elevado',
  standard: 'Estándar',
  advisory: 'Aviso',
  positive: 'Saludable',
}

/** The card badge for a severity tier, in the reader's language. English is `SEVERITY_LABELS`, unchanged. */
export function severityLabelText(tier: SeverityTier, english: string, language: string | null | undefined): string {
  return language === 'es' ? (SEVERITY_ES[tier] ?? english) : english
}

/**
 * The SAME five tiers as a workspace TASK's priority badge — feminine, because it agrees with
 * "prioridad" (and "tarea"): "prioridad crítica", never "prioridad crítico". This is not a duplicate
 * of `SEVERITY_ES` to be folded into it; forcing one table would put an agreement error on one of
 * the two screens. `advisory` reads "Informativa" here because "Aviso" is a noun and cannot agree.
 * (Moved here from analyticsCopy's `workspaceCopy().severity`, 2026-10-06, so both agreements sit
 * side by side.)
 */
const TASK_PRIORITY_ES: Record<SeverityTier, string> = {
  critical: 'Crítica',
  elevated: 'Elevada',
  standard: 'Estándar',
  advisory: 'Informativa',
  positive: 'Saludable',
}

/** A workspace task's priority badge, in the reader's language. English is `SEVERITY_LABELS`, unchanged. */
export function taskPriorityLabelText(tier: SeverityTier, english: string, language: string | null | undefined): string {
  return language === 'es' ? (TASK_PRIORITY_ES[tier] ?? english) : english
}

/* ── The screens' own words ──────────────────────────────────────────────────── */

const UI_ES: Record<string, string> = {
  // RecommendationCard — confidence and lifecycle status (a recomendación, so feminine)
  'Developing signal': 'Señal en desarrollo',
  'Moderate confidence': 'Confianza moderada',
  'High confidence': 'Confianza alta',
  'Very high confidence': 'Confianza muy alta',
  New: 'Nueva',
  Viewed: 'Vista',
  'In Progress': 'En curso',
  Completed: 'Completada',
  Dismissed: 'Descartada',
  Expired: 'Caducada',
  Automated: 'Automatizada',
  Deferred: 'Aplazada',
  Resolved: 'Resuelta',
  'View evidence': 'Ver evidencia',
  Dismiss: 'Descartar',

  // Charts
  Other: 'Otros',
  Wins: 'Victorias',
  Losses: 'Derrotas',
  Value: 'Valor',
  Aggression: 'Agresividad',
  Activity: 'Actividad',
  Trading: 'Intercambios',
  Risk: 'Riesgo',

  // RecommendationsView
  'Open queue by severity': 'Cola abierta por gravedad',
  'Recommendation view': 'Vista de recomendaciones',
  Queue: 'Cola',
  History: 'Historial',
  'Nothing archived recently.': 'Nada archivado recientemente.',
  "You're all caught up.": 'Estás al día.',
  'No open recommendations.': 'No hay recomendaciones abiertas.',

  // LeagueHealthView
  'League Health Score': 'Puntuación de salud de la liga',
  'What drives this score': 'Qué determina esta puntuación',
  'No narrative signals were available for this league.': 'No hubo señales narrativas disponibles para esta liga.',
  'Engagement score': 'Puntuación de participación',
  'Retention risk': 'Riesgo de abandono',
  // 'Commissioner load' is the loader's risk category too, so it lives once, in LOADER_ES.
  'Managers active in window': 'Mánagers activos en la ventana',
  'Risk Analysis': 'Análisis de riesgos',
  Category: 'Categoría',
  Severity: 'Gravedad',
  Age: 'Antigüedad',
  'Manager participation': 'Participación de los mánagers',
  'Data quality': 'Calidad de los datos',
  'Inputs available': 'Datos disponibles',
  'How much of what the intelligence pipeline wanted for this league it actually had. A property of the inputs, not a confidence rating for any single finding above.':
    'Cuánto de lo que el sistema de inteligencia necesitaba para esta liga tenía de verdad. Es una propiedad de los datos de entrada, no una calificación de confianza de ningún hallazgo de arriba.',
  'No active risks.': 'No hay riesgos activos.',
  'The league is in good shape.': 'La liga está en buena forma.',

  // ManagerIntelligenceView
  'No manager history yet.': 'Aún no hay historial de mánagers.',
  'Behavioral profiles build over time as the season progresses.':
    'Los perfiles de comportamiento se van formando a medida que avanza la temporada.',
  Rising: 'En alza',
  Steady: 'Estable',
  Declining: 'En descenso',
  Consistent: 'Constante',
  'Some gaps': 'Algunas ausencias',
  'Major gaps': 'Muchas ausencias',
  'Reliability:': 'Fiabilidad:',

  // CommissionerNetworks
  // The page heading reads the sidebar link's word: one source, in shellCopy.
  'Commissioner networks': NETWORKS_LINK_ES,
  'Unify leagues you own under one named commissioner workspace. Each item keeps its league-level drilldown.':
    'Une las ligas que son tuyas en un espacio de comisionado con nombre. Cada elemento conserva su detalle por liga.',
  'Edit network': 'Editar red',
  'Create network': 'Crear red',
  'Save network': 'Guardar red',
  'Network name': 'Nombre de la red',
  'Member leagues (first selected league is the host)': 'Ligas miembro (la primera liga seleccionada es la anfitriona)',
  'You do not own a league that can be linked yet.': 'Aún no tienes una liga que se pueda vincular.',
  Cancel: 'Cancelar',
  Delete: 'Eliminar',
  'Loading networks…': 'Cargando redes…',
  'Attention queue': 'Cola de atención',
  'No open workspace tasks on file.': 'No hay tareas abiertas registradas en el espacio de trabajo.',
  'Recent history': 'Historial reciente',
  'No projected audit history on file.': 'No hay historial de auditoría registrado.',
  'Delete this network? Its leagues and league data remain.': '¿Eliminar esta red? Sus ligas y los datos de las ligas se conservan.',
  League: coreUiCopy('League', 'es'),
  host: 'anfitriona',
  member: 'miembro',
  // the network form's own fallbacks …
  'Network data unavailable': 'Datos de la red no disponibles',
  'Could not save network': 'No se pudo guardar la red',
  'Could not delete network': 'No se pudo eliminar la red',
  // … and the errors /api/commissioner/networks returns, shown in the same alert
  Unauthorized: 'No autorizado',
  'Name and 1–50 league IDs are required': 'Se requieren un nombre y de 1 a 50 IDs de liga',
  'You must own every linked league': 'Debes ser el dueño de todas las ligas vinculadas',
  'A league already belongs to a commissioner network': 'Una de las ligas ya pertenece a una red de comisionado',
  'A league already belongs to another commissioner network': 'Una de las ligas ya pertenece a otra red de comisionado',
  'Could not create network; a league may already be linked': 'No se pudo crear la red; puede que una liga ya esté vinculada',
  'Could not update network; a league may already be linked': 'No se pudo actualizar la red; puede que una liga ya esté vinculada',
  'Invalid network update': 'Actualización de la red no válida',
  'Network not found': 'No se encontró la red',
  'Missing networkId': 'Falta el identificador de la red',
  // A queued task's priority is NOT here: the networks page reads `taskPriorityLabelText`, the
  // workspace badge's own labels, so the two screens cannot disagree on a tier again.
}

type Rule = [RegExp, (...groups: string[]) => string]

const UI_RULES: Rule[] = [
  [/^(\d+) recommendations? by severity$/, (n) => `${plural(n, 'recomendación', 'recomendaciones')} por gravedad`],
  [/^(\d+) of (\d+)$/, (a, b) => `${a} de ${b}`],
  [/^(-?\d+)d$/, (n) => `${n} d`],
  [
    /^(\d+) of (\d+) managers seen active in the intelligence window$/,
    (a, b) => `${a} de ${b} mánagers vistos activos en la ventana de inteligencia`,
  ],
  [/^Tenure: (\d+) seasons?$/, (n) => `Antigüedad: ${plural(n, 'temporada', 'temporadas')}`],
  // AllTimeRecordChart tooltip: "Team — 5 seasons, 1 title"
  [
    /^(.+) — (\d+) seasons?, (\d+) titles?$/s,
    (team, s, t) => `${team} — ${plural(s, 'temporada', 'temporadas')}, ${plural(t, 'título', 'títulos')}`,
  ],
]

/** One of the cards' or screens' own strings in the reader's language; unknown text passes through unchanged. */
export function cardsCopy(english: string, language: string): string {
  if (language !== 'es') return english
  const exact = UI_ES[english]
  if (exact != null) return exact
  for (const [pattern, build] of UI_RULES) {
    const m = pattern.exec(english)
    if (m) return build(...m.slice(1))
  }
  return english
}

/* ── Loader output (server-written English) ─────────────────────────────────── */

const LOADER_ES: Record<string, string> = {
  // recommendations/decision-os-client/live.ts — RECOMMENDATION_TITLES
  'Managers at risk of leaving': 'Mánagers en riesgo de irse',
  'Inactive managers need outreach': 'Hay que contactar a los mánagers inactivos',
  'Trade activity has stalled': 'Los intercambios se han estancado',
  'Waiver wire is going unused': 'Nadie está usando los agentes libres',
  'Weekly recap would lift engagement': 'Un resumen semanal aumentaría la participación',
  // behavioral/league-intelligence.ts — recommendation messages (the live rationale)
  'No trades have been made this season. Consider hosting a trade block or starting a league chat topic to spark activity.':
    'No se ha hecho ningún intercambio esta temporada. Considera abrir un mercado de intercambios o iniciar un tema en el chat de la liga para animar la actividad.',
  'No waiver claims have been made. Post a waiver wire recap to show managers what is available.':
    'No se ha hecho ninguna solicitud de agentes libres. Publica un resumen de agentes libres para mostrar a los mánagers lo que hay disponible.',
  'Post a weekly recap to highlight top performances and keep managers engaged.':
    'Publica un resumen semanal para destacar las mejores actuaciones y mantener a los mánagers involucrados.',
  // behavioral/league-intelligence.ts — health narrative (League Health's evidence)
  'No manager data available': 'No hay datos de mánagers disponibles',
  'No managers have recorded any activity': 'Ningún mánager ha registrado actividad',
  'League is highly engaged across all activity types': 'La liga participa mucho en todos los tipos de actividad',
  'Strong manager participation this season': 'Gran participación de los mánagers esta temporada',
  'High trade activity indicates strong manager investment': 'La alta actividad de intercambios indica un gran compromiso de los mánagers',
  'Managers are actively working the waiver wire': 'Los mánagers trabajan activamente los agentes libres',
  // league-health/decision-os-client/live.ts — evidence labels and risk categories
  'Engagement Summary': 'Resumen de participación',
  'Top Concern': 'Principal preocupación',
  'Standout Signal': 'Señal destacada',
  Retention: 'Retención',
  'Commissioner load': 'Carga del comisionado',
  Participation: 'Participación',
  // managers/decision-os-client/live.ts — risk flags
  'Major inactivity detected — may benefit from a personal check-in':
    'Inactividad importante detectada: podría venirle bien un contacto personal',
  'Engagement declining over recent periods — may benefit from a personal check-in':
    'Su participación baja en los últimos periodos: podría venirle bien un contacto personal',
  // deriveChartSeries.ts — recommendationsBySeverity and participationSlices labels. The tiers are the
  // badge vocabulary; "Positive" is the chart's own word (the badge says "Healthy").
  Critical: SEVERITY_ES.critical,
  Elevated: SEVERITY_ES.elevated,
  Advisory: SEVERITY_ES.advisory,
  Standard: SEVERITY_ES.standard,
  Positive: 'Positivo',
  'Active in window': 'Activos en la ventana',
  'Quiet in window': 'Inactivos en la ventana',
  // allClear.ts's sentences are NOT here: shellCopy's `allClearText` holds them (one translator per string).

  // Demo fixtures ("Iron Horse Dynasty") — the app's own words; the demo names stay
  'Manager engagement declining': 'La participación de un mánager está bajando',
  'A personal check-in has resolved similar patterns in this league before':
    'Un contacto personal ya ha resuelto casos parecidos en esta liga',
  'Send Check-In': 'Contactar',
  'Trade deadline approaching': 'Se acerca la fecha límite de intercambios',
  'Four teams have not made a roster move in over three weeks, with the deadline 9 days out.':
    'Cuatro equipos no han hecho ningún movimiento de plantilla en más de tres semanas, y la fecha límite es en 9 días.',
  'A reminder typically increases pre-deadline trade volume by a third':
    'Un recordatorio suele aumentar en un tercio los intercambios antes de la fecha límite',
  'Send Reminder': 'Enviar recordatorio',
  'Standings have tightened': 'La clasificación se ha apretado',
  'The gap between 1st and 8th place has narrowed to two games — the closest this league has been all season.':
    'La diferencia entre el 1.º y el 8.º puesto se ha reducido a dos partidos: lo más igualada que ha estado esta liga en toda la temporada.',
  'Worth highlighting in the next league digest': 'Vale la pena destacarlo en el próximo resumen de la liga',
  'Include in Digest': 'Incluir en el resumen',
  'Routine waiver approvals recurring weekly': 'Aprobaciones rutinarias de agentes libres cada semana',
  'A strong candidate for automation': 'Un buen candidato para automatizar',
  'Set Up Automation': 'Configurar automatización',
  Engagement: 'Participación',
  'Lineup compliance': 'Alineaciones a tiempo',
  'Trade activity': 'Actividad de intercambios',
  'Standings spread': 'Diferencia en la clasificación',
  'Gap between 1st and 8th place has narrowed to two games': 'La diferencia entre el 1.º y el 8.º puesto se ha reducido a dos partidos',
  'Recently joined as co-commissioner': 'Se unió hace poco como cocomisionado',
  // Stub fixtures
  'Test recommendation': 'Recomendación de prueba',
  'Stub fixture rationale.': 'Justificación de prueba.',
  'Stub fixture impact.': 'Impacto de prueba.',
  Act: 'Actuar',
  'One manager inactive for 3+ weeks': 'Un mánager inactivo durante más de 3 semanas',
}

/** Bands as the live client lower-cases them into a risk sentence (`bandLabel(...).toLowerCase()`). */
const RISK_BAND_ES: Record<string, string> = { low: 'bajo', medium: 'medio', high: 'alto', critical: 'crítico', unknown: 'desconocido' }
const ATTENTION_BAND_ES: Record<string, string> = { low: 'baja', medium: 'media', high: 'alta', critical: 'crítica', unknown: 'desconocida' }

const LOADER_RULES: Rule[] = [
  // league-intelligence.ts — recommendation messages
  [
    /^(\d+) manager\(s\) are at critical risk of abandoning the league\. Direct outreach is recommended immediately\.$/,
    (n) =>
      n === '1'
        ? '1 mánager está en riesgo crítico de abandonar la liga. Se recomienda contactarlo directamente de inmediato.'
        : `${n} mánagers están en riesgo crítico de abandonar la liga. Se recomienda contactarlos directamente de inmediato.`,
  ],
  [
    /^(\d+) manager\(s\) have not been active recently\. Reach out to re-engage them before they abandon the league\.$/,
    (n) =>
      n === '1'
        ? '1 mánager no ha estado activo recientemente. Contáctalo para recuperarlo antes de que abandone la liga.'
        : `${n} mánagers no han estado activos recientemente. Contáctalos para recuperarlos antes de que abandonen la liga.`,
  ],
  // league-intelligence.ts — health narrative
  [/^(\d+) of (\d+) managers are active$/, (a, b) => `${a} de ${b} mánagers están activos`],
  [/^(\d+) of (\d+) managers are inactive$/, (a, b) => `${a} de ${b} mánagers están inactivos`],
  [/^(\d+) manager\(s\) at critical retention risk$/, (n) => `${plural(n, 'mánager', 'mánagers')} en riesgo crítico de abandono`],
  [/^(\d+) manager\(s\) need engagement$/, (n) => (n === '1' ? '1 mánager necesita más participación' : `${n} mánagers necesitan más participación`)],
  // league-health live.ts — toRisks
  [
    /^League-wide retention risk is (low|medium|high|critical|unknown)\.$/,
    (band) => `El riesgo de abandono en toda la liga es ${RISK_BAND_ES[band]}.`,
  ],
  [
    /^This league is asking (low|medium|high|critical|unknown) attention of its commissioner right now\.$/,
    (band) => `Esta liga exige ahora una atención ${ATTENTION_BAND_ES[band]} de su comisionado.`,
  ],
  [
    /^(\d+) of the (\d+) managers? seen in this window (?:is|are) no longer active in it\.$/,
    (q, t) =>
      t === '1'
        ? `${q} de 1 mánager visto en esta ventana ya no está activo en ella.`
        : q === '1'
          ? `1 de los ${t} mánagers vistos en esta ventana ya no está activo en ella.`
          : `${q} de los ${t} mánagers vistos en esta ventana ya no están activos en ella.`,
  ],
  // Demo fixtures — the demo manager names stay
  [
    /^(.+) has missed lineup deadlines two weeks running, after a strong first half\.$/s,
    (who) => `${who} no ha enviado su alineación a tiempo dos semanas seguidas, tras una gran primera mitad.`,
  ],
  [/^(.+) has missed lineup deadlines two weeks running$/s, (who) => `${who} no ha enviado su alineación a tiempo dos semanas seguidas`],
  [
    /^The same low-stakes waiver claim pattern has repeated for (\d+) consecutive weeks\.$/,
    (n) => `El mismo patrón de solicitudes de agentes libres de poca importancia se ha repetido ${plural(n, 'semana seguida', 'semanas seguidas')}.`,
  ],
  [/^(\d+) of (\d+) teams set a lineup on time this week$/, (a, b) => `${a} de ${b} equipos pusieron su alineación a tiempo esta semana`],
  [
    /^(\d+) completed trades this season, above the league’s (\d+)-season average of (\d+)$/,
    (n, seasons, avg) => `${n} intercambios completados esta temporada, por encima del promedio de ${avg} de la liga en ${seasons} temporadas`,
  ],
  [/^Most active trader this season — (\d+) completed trades$/, (n) => `El que más intercambia esta temporada: ${plural(n, 'intercambio completado', 'intercambios completados')}`],
  [
    /^Engagement declining for (\d+) weeks — may benefit from a personal check-in$/,
    (n) => `Su participación baja desde hace ${plural(n, 'semana', 'semanas')}: podría venirle bien un contacto personal`,
  ],
  [/^Longest continuously active manager — (\d+)(?:st|nd|rd|th) season$/, (n) => `El mánager activo sin interrupción desde hace más tiempo: ${n}.ª temporada`],
]

/**
 * A manager's display name. Real names are the users' own and stay exactly as written — they are
 * never run through a sentence translator, where a manager called "Act" or "Positive" would be
 * rewritten. Only the loader's placeholder for a name it could not resolve
 * (`UNKNOWN_MANAGER_NAME` in `lib/commissioner-managers/managerNames.ts`) is the app's own word.
 */
export function managerNameText(name: string, language: string): string {
  return language === 'es' && name === 'Unknown manager' ? 'Mánager desconocido' : name
}

/**
 * A sentence a Commissioner OS loader wrote, in the reader's language. Falls back to
 * `commissionerOsText` (health-engine alerts, attention signals, drama headlines), then to the text
 * itself. Names and numbers inside a sentence are kept as they are.
 */
export function cosLoaderText(text: string | null | undefined, language: string): string {
  if (!text) return ''
  if (language !== 'es') return text
  const exact = LOADER_ES[text]
  if (exact != null) return exact
  for (const [pattern, build] of LOADER_RULES) {
    const m = pattern.exec(text)
    if (m) return build(...m.slice(1))
  }
  return commissionerOsText(text, language)
}

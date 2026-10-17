/**
 * lib/i18n/decision-os/leaguePulse.ts — Spanish for the League Pulse a league page renders.
 *
 * `buildLeagueHomePulse` (lib/decision-os/league-pulse.ts) writes its verdict in English, and it is
 * also called server-side (the dashboard command center), so the engine stays English and the
 * screens localize the finished view model with `localizeLeaguePulse` instead.
 *
 * English and any other language return the pulse untouched. Each string goes through the table,
 * then through the few patterns that carry a count; anything unknown stays English rather than
 * becoming a raw key — `__tests__/league-pulse-i18n.test.ts` runs the real engine through its
 * branches and fails on any sentence it produces without Spanish.
 *
 * ⚠ `confidenceLabel` is deliberately NOT localized here: DecisionOsConfidenceBadge picks its icon
 * and tone from the English 'High' | 'Medium' | 'Low'. A screen that prints it as text translates it
 * at render with `translatePulseText`.
 */

import type { LeaguePulseViewModel } from '@/lib/decision-os/league-pulse'

const PULSE_ES: Readonly<Record<string, string>> = {
  // Title, status and confidence words
  'League Pulse': 'Pulso de la liga',
  'Healthy': 'Saludable',
  'Watch': 'En observación',
  'At risk': 'En riesgo',
  'Insufficient data': 'Datos insuficientes',
  'High': 'Alta',
  'Medium': 'Media',
  'Low': 'Baja',

  // Headlines
  'League Pulse needs live league data.': 'El pulso de la liga necesita datos reales de la liga.',
  'League Pulse needs team data before it can call the league health.':
    'El pulso de la liga necesita datos de los equipos antes de poder valorar la salud de la liga.',
  'League Pulse needs at least one claimed team before it can call this league’s health.':
    'El pulso de la liga necesita al menos un equipo reclamado antes de poder valorar la salud de esta liga.',
  'Draft setup is the next launch blocker.': 'Configurar el draft es lo siguiente que frena el arranque.',
  'This league has enough signal for active monitoring.': 'Esta liga tiene suficientes señales para un seguimiento activo.',

  // Summaries
  'Connect or open a league so Fantasy OS can summarize health, activity, and recommended next actions.':
    'Conecta o abre una liga para que Fantasy OS pueda resumir su salud, su actividad y los próximos pasos recomendados.',
  'League Pulse is reading team ownership, league state, and competitive balance signals without adding AI guesses.':
    'El pulso de la liga lee la propiedad de los equipos, el estado de la liga y las señales de equilibrio competitivo, sin añadir suposiciones de IA.',

  // Why
  'No supported league state was available for deterministic analysis.':
    'No había un estado de liga compatible para un análisis determinista.',
  'No team in this league has been claimed by a real AllFantasy user yet, so a health score would not reflect real activity.':
    'Ningún equipo de esta liga ha sido reclamado aún por un usuario real de AllFantasy, así que una puntuación de salud no reflejaría actividad real.',
  'Unclaimed or orphan teams reduce engagement and commissioner confidence.':
    'Los equipos sin reclamar o huérfanos reducen la participación y la confianza del comisionado.',
  'The current points gap suggests competitive balance is worth watching.':
    'La diferencia de puntos actual indica que conviene vigilar el equilibrio competitivo.',
  'Team ownership and available standings signals do not show an urgent league-health blocker.':
    'La propiedad de los equipos y las señales de la clasificación no muestran un problema urgente de salud de la liga.',

  // Evidence
  'League data': 'Datos de la liga',
  'Not available': 'No disponible',
  'Teams checked': 'Equipos revisados',
  'Open manager slots': 'Puestos de mánager libres',
  'League state': 'Estado de la liga',
  'Unknown': 'Desconocido',
  'Points spread': 'Diferencia de puntos',
  'Based on current points-for range': 'Según el rango actual de puntos a favor',
  'Manager engagement': 'Participación del mánager',
  // League state values (lifecycle / status as stored)
  'pre_draft': 'antes del draft',
  'drafting': 'en draft',
  'post_draft': 'después del draft',
  'in_season': 'en temporada',
  'playoffs': 'playoffs',
  'complete': 'terminada',
  'completed': 'terminada',
  'active': 'activa',
  'offseason': 'fuera de temporada',

  // Derivation
  'Checked available league inputs': 'Revisó los datos de liga disponibles',
  'Stopped before making unsupported claims': 'Se detuvo antes de afirmar algo sin respaldo',
  'Compared expected team count to loaded teams': 'Comparó el número de equipos esperado con los cargados',
  'Flagged unclaimed and orphan team slots': 'Marcó los equipos sin reclamar y huérfanos',
  'Used points-for spread only when enough standings data exists':
    'Usó la diferencia de puntos a favor solo cuando hay suficientes datos de clasificación',
  'Included the real Phase 6 Manager DNA signal already resolved for this viewer':
    'Incluyó la señal real de ADN del mánager (fase 6) ya resuelta para quien la ve',

  // Metrics
  'Evidence': 'Evidencia',
  '0 sources': '0 fuentes',
  'Unsupported claims': 'Afirmaciones sin respaldo',
  'None': 'Ninguna',
  'Actionability': 'Accionabilidad',
  'Setup required': 'Requiere configuración',
  'Health': 'Salud',
  'Managers': 'Mánagers',
  'Balance': 'Equilibrio',
  'Pending': 'Pendiente',
  'Stable': 'Estable',

  // Next actions
  'Connect a league': 'Conecta una liga',
  'Import or create a league to unlock grounded recommendations.':
    'Importa o crea una liga para desbloquear recomendaciones fundamentadas.',
  'Review league setup': 'Revisar la configuración de la liga',
  'Check league setup': 'Ver la configuración de la liga',
  'Team and roster state are required before Fantasy OS can summarize this league.':
    'Fantasy OS necesita el estado de los equipos y las plantillas antes de poder resumir esta liga.',
  'Invite managers to claim teams': 'Invita a los mánagers a reclamar sus equipos',
  'Claim your team': 'Reclama tu equipo',
  'Team ownership must be confirmed before Fantasy OS can summarize real league health.':
    'Hay que confirmar la propiedad de los equipos antes de que Fantasy OS pueda resumir la salud real de la liga.',
  'Invite managers': 'Invitar mánagers',
  'View managers': 'Ver mánagers',
  'Fill open manager slots before league activity ramps up.':
    'Cubre los puestos de mánager libres antes de que suba la actividad de la liga.',
  'Set draft date': 'Fijar la fecha del draft',
  'A draft date makes the next league milestone clear.': 'Una fecha de draft deja claro el próximo hito de la liga.',
  'Open League Intelligence': 'Abrir League Intelligence',
  'Review deeper commissioner and manager intelligence for this league.':
    'Revisa información más profunda del comisionado y de los mánagers de esta liga.',

  // Insufficient data
  'Not enough signal yet': 'Aún no hay suficientes señales',
  'League Pulse is intentionally quiet until it has real league evidence.':
    'El pulso de la liga se mantiene en silencio a propósito hasta tener evidencia real de la liga.',
  'Connected league': 'Liga conectada',
  'Team state': 'Estado de los equipos',
  'Activity data': 'Datos de actividad',
  'No claimed teams yet': 'Aún no hay equipos reclamados',
  'No team in this league has been claimed by a real AllFantasy user, so League Pulse will not call this league’s health.':
    'Ningún equipo de esta liga ha sido reclamado por un usuario real de AllFantasy, así que el pulso de la liga no valorará su salud.',
  'At least one claimed team': 'Al menos un equipo reclamado',
}

/** Sentences that carry a number or a free value. English shape → Spanish builder. */
const PATTERNS: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^1 manager slot need attention\.$/, () => '1 puesto de mánager necesita atención.'],
  [/^(\d+) manager slots need attention\.$/, (m) => `${m[1]} puestos de mánager necesitan atención.`],
  [/^(\d+)% confidence$/, (m) => `${m[1]}% de confianza`],
  [/^Decision Intelligence identity: (.+)$/, (m) => `Identidad de Decision Intelligence: ${m[1]}`],
]

/** One League Pulse string in Spanish; unknown text comes back unchanged. */
export function translatePulseText(text: string): string {
  const exact = PULSE_ES[text]
  if (exact != null) return exact
  for (const [re, build] of PATTERNS) {
    const m = text.match(re)
    if (m) return build(m)
  }
  return text
}

/** The pulse a screen renders, in the viewer's language. Only 'es' changes anything. */
export function localizeLeaguePulse(pulse: LeaguePulseViewModel, language: string): LeaguePulseViewModel {
  if (language !== 'es') return pulse
  const tr = translatePulseText
  return {
    ...pulse,
    title: tr(pulse.title),
    statusLabel: tr(pulse.statusLabel),
    headline: tr(pulse.headline),
    summary: tr(pulse.summary),
    why: tr(pulse.why),
    evidence: pulse.evidence.map((e) => ({ ...e, label: tr(e.label), value: tr(e.value), ...(e.detail != null ? { detail: tr(e.detail) } : {}) })),
    derivation: pulse.derivation.map(tr),
    metrics: pulse.metrics.map((m) => ({ ...m, label: tr(m.label), value: tr(m.value) })),
    nextAction: { ...pulse.nextAction, label: tr(pulse.nextAction.label), detail: tr(pulse.nextAction.detail) },
    ...(pulse.insufficientData
      ? {
          insufficientData: {
            title: tr(pulse.insufficientData.title),
            message: tr(pulse.insufficientData.message),
            missing: pulse.insufficientData.missing.map(tr),
          },
        }
      : {}),
  }
}

/** Exposed for the coverage test. */
export const LEAGUE_PULSE_ES_TABLE = PULSE_ES
